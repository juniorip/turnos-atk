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
  vm.runInNewContext(code, {
    exports, require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    }, process: { env: environment }, TextEncoder, Response,
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

function queueFixture(workerCount = 1) {
  const workers = Array.from({ length: workerCount }, (_, i) => ({ id: i + 1, name: `Worker ${i + 1}`, services: [{ serviceId: 1 }] }));
  const tickets = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, serviceId: 1, status: 'WAITING', assignedToId: null, isPreferential: i === 4, arrivedAt: i }));
  const history = [];
  let tail = Promise.resolve();
  const active = (id) => tickets.some(t => t.assignedToId === id && ['CALLED', 'IN_SERVICE'].includes(t.status));
  const prisma = { $transaction: async (callback, options) => {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    let locked = false, release;
    const read = (fn) => async (...args) => {
      assert.ok(locked, 'Queue reads must happen after acquiring the shared branch lock');
      await new Promise(resolve => setImmediate(resolve));
      return fn(...args);
    };
    const tx = {
      $queryRaw: async (strings, branchId) => {
        assert.equal(strings.join('?'), 'SELECT pg_advisory_xact_lock(?)::text');
        assert.equal(branchId, 1);
        const previous = tail;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        locked = true;
        return [{ pg_advisory_xact_lock: '' }];
      },
      user: {
        findUnique: read(() => ({ availability: 'AVAILABLE' })),
        findMany: read(() => workers.filter(w => !active(w.id))),
      },
      ticket: {
        count: read(() => tickets.filter(t => t.status === 'CALLED').length),
        findMany: read(({ orderBy }) => {
          assert.equal(JSON.stringify(orderBy), JSON.stringify([{ isPreferential: 'desc' }, { arrivedAt: 'asc' }, { id: 'asc' }]));
          return tickets.filter(t => t.status === 'WAITING').sort((a, b) => Number(b.isPreferential) - Number(a.isPreferential) || a.arrivedAt - b.arrivedAt || a.id - b.id);
        }),
        groupBy: read(() => []),
        findFirst: read(({ where }) => active(where.assignedToId) ? { id: 1 } : null),
        findUnique: read(({ where }) => tickets.find(t => t.id === where.id)),
        updateMany: read(({ where, data }) => {
          const ticket = tickets.find(t => t.id === where.id && t.status === where.status);
          if (!ticket) return { count: 0 };
          Object.assign(ticket, data);
          return { count: 1 };
        }),
      },
      ticketHistory: { create: read(({ data }) => { history.push(data); return data; }) },
    };
    try { return await callback(tx); } finally { release?.(); }
  } };
  const handlers = Object.fromEntries(['claim', 'dispatch'].map(route => [route, load(`app/api/queue/${route}/route.ts`, {
    '@prisma/client': enums, '@/lib/prisma': { prisma },
    '@/lib/auth': {
      requireUser: async () => ({ id: 1, role: 'WORKER', branchId: 1 }),
      errorResponse: error => { throw error; },
    },
  }).POST]));
  return { handlers, tickets, history };
}

for (const order of [['claim', 'dispatch'], ['dispatch', 'claim'], ['claim', 'claim'], ['dispatch', 'dispatch']]) {
  test(`concurrent ${order.join(' + ')} assigns only one ticket to one worker`, async () => {
    const { handlers, tickets, history } = queueFixture();
    const responses = await Promise.all(order.map(route => handlers[route]()));
    assert.ok(responses.every(r => [200, 409].includes(r.status)));
    const assigned = tickets.filter(t => t.assignedToId !== null);
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].id, 5, 'Preferential ticket remains first');
    assert.equal(history.length, 1);
    if (order.includes('claim')) assert.equal((await handlers.claim()).status, 409);
  });
}

test('automatic dispatch preserves its limit of three calls and distinct workers', async () => {
  const { handlers, tickets, history } = queueFixture(5);
  const responses = await Promise.all([handlers.dispatch(), handlers.dispatch()]);
  const payloads = await Promise.all(responses.map(r => r.json()));
  assert.equal(payloads.reduce((sum, p) => sum + p.assigned, 0), 3);
  const assigned = tickets.filter(t => t.assignedToId !== null);
  assert.equal(new Set(assigned.map(t => t.assignedToId)).size, 3);
  assert.deepEqual(history.map(h => h.ticketId), [5, 1, 2]);
});
