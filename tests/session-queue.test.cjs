const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const enums = require('@prisma/client');

// Execute the actual handlers with isolated dependencies; no production DB.
function load(file, dependencies, environment = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const shared = { './ticket-district-schema': { ensureTicketDistrictSchema: async () => {} } };
  vm.runInNewContext(code, {
    exports, require: (name) => {
      if (name in dependencies) return dependencies[name];
      if (name in shared) return shared[name];
      throw new Error(`Unexpected dependency: ${name}`);
    }, process: { env: environment }, TextEncoder, Response, URL, Request,
  }, { filename: file });
  return exports;
}

test('session configuration fails closed and revalidates current account and credentials', async () => {
  const jose = await import('jose');
  const env = {};
  let token;
  const current = { id: 1, role: 'WORKER', branchId: 1, name: 'Test', active: true, passwordHash: 'test-password-hash' };
  const auth = load('lib/auth.ts', {
    jose, '@prisma/client': enums,
    'node:crypto': require('node:crypto'),
    './prisma': { prisma: { user: { findUnique: async () => current } } },
    'next/headers': { cookies: async () => ({ get: () => token ? { value: token } : undefined }) },
  }, env);
  const user = { id: 1, role: 'WORKER', branchId: 1, name: 'Test' };
  // Importing without AUTH_SECRET must work during a build.
  for (const secret of [undefined, '', '   ', 'turnos-atk-local-only-change-me', 'cambia-esto-por-un-secreto-largo-y-unico']) {
    env.AUTH_SECRET = secret;
    await assert.rejects(auth.createSession(user, current.passwordHash), /AUTH_SECRET/);
    token = await new jose.SignJWT(user).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('turnos-atk-local-only-change-me'));
    assert.equal(await auth.sessionUser(), null);
  }
  env.AUTH_SECRET = 'test-only-existing-key-kept-exactly-123456789';
  const key = new TextEncoder().encode(env.AUTH_SECRET);
  token = await auth.createSession(user, current.passwordHash);
  assert.equal((await auth.sessionUser()).id, user.id);
  const created = await jose.jwtVerify(token, key);
  assert.equal(created.payload.exp - created.payload.iat, 43200);
  current.role = 'RECEPTION'; current.branchId = 2;
  assert.equal((await auth.sessionUser()).role, 'RECEPTION');
  assert.equal((await auth.sessionUser()).branchId, 2);
  await assert.rejects(auth.requireUser('WORKER'), /UNAUTHORIZED/);
  current.active = false;
  assert.equal(await auth.sessionUser(), null);
  current.active = true; current.passwordHash = 'changed-password';
  assert.equal(await auth.sessionUser(), null);
  token = await new jose.SignJWT(user).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('12h').sign(key);
  assert.equal(await auth.sessionUser(), null, 'Legacy tokens require a new login');
  token = await new jose.SignJWT(user).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('wrong-key'));
  assert.equal(await auth.sessionUser(), null);
});

function queueFixture() {
  const tickets = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, serviceId: 1, status: enums.TicketStatus.WAITING, assignedToId: null, isPreferential: i === 4, arrivedAt: new Date(Date.now() - (6 - i) * 60_000) }));
  const history = [];
  let tail = Promise.resolve();
  const active = (id) => tickets.some(t => t.assignedToId === id && [enums.TicketStatus.CALLED, enums.TicketStatus.IN_SERVICE].includes(t.status));
  const prisma = { $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    let release;
    const tx = {
      $queryRaw: async (strings, branchId) => {
        assert.equal(strings.join('?'), 'SELECT pg_advisory_xact_lock(?)::text');
        assert.equal(branchId, 1);
        const previous = tail;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        return [{ pg_advisory_xact_lock: '' }];
      },
      user: {
        findUnique: async () => ({ active: true, branchId: 1, moduleNumber: 1, availability: enums.WorkerAvailability.AVAILABLE, lastActiveAt: new Date() }),
      },
      ticket: {
        count: async ({ where }) => tickets.filter(t => t.assignedToId === where.assignedToId && t.status === where.status).length,
        findMany: async ({ where }) => tickets.filter(t => t.status === where.status),
        findFirst: async ({ where }) => active(where.assignedToId) ? { id: 1 } : null,
        findUnique: async ({ where }) => tickets.find(t => t.id === where.id),
        updateMany: async ({ where, data }) => {
          const ticket = tickets.find(t => t.id === where.id && t.status === where.status);
          if (!ticket) return { count: 0 };
          Object.assign(ticket, data);
          return { count: 1 };
        },
      },
      ticketHistory: { create: async ({ data }) => { history.push(data); return data; } },
    };
    try { return await callback(tx); } finally { release?.(); }
  } };
  const queueOrder = { sortTicketsForCall: list => [...list].sort((a, b) => {
    const left = a.arrivedAt.getTime() - (a.isPreferential ? 30 * 60_000 : 0);
    const right = b.arrivedAt.getTime() - (b.isPreferential ? 30 * 60_000 : 0);
    return left - right || Number(b.isPreferential) - Number(a.isPreferential) || a.id - b.id;
  }) };
  const presence = { presenceCutoff: (now = Date.now()) => new Date(now - 90_000) };
  const handlers = Object.fromEntries(['claim', 'dispatch'].map(route => [route, load(`app/api/queue/${route}/route.ts`, {
    '@prisma/client': enums, '@/lib/prisma': { prisma },
    '@/lib/queue-order': queueOrder,
    '@/lib/presence': presence,
    '@/lib/auth': {
      requireUser: async () => ({ id: 1, role: 'WORKER', branchId: 1 }),
      errorResponse: error => { throw error; },
    },
  }).POST]));
  return { handlers, tickets, history };
}

for (const order of [['claim', 'claim']]) {
  test(`concurrent ${order.join(' + ')} assigns only one ticket to one worker`, async () => {
    const { handlers, tickets, history } = queueFixture();
    const responses = await Promise.all(order.map(route => handlers[route](new Request('http://local/api/queue/claim'))));
    assert.ok(responses.every(r => [200, 409].includes(r.status)));
    const assigned = tickets.filter(t => t.assignedToId !== null);
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].id, 5, 'Preferential ticket remains first');
    assert.equal(history.length, 1);
    assert.equal((await handlers.claim(new Request('http://local/api/queue/claim'))).status, 409);
  });
}

test('legacy dispatch endpoint never assigns tickets automatically', async () => {
  const { handlers, tickets, history } = queueFixture();
  const response = await handlers.dispatch(new Request('http://local/api/queue/dispatch', { method: 'POST' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { assigned: 0, mode: 'manual' });
  assert.equal(tickets.filter(t => t.assignedToId !== null).length, 0);
  assert.equal(history.length, 0);
});
