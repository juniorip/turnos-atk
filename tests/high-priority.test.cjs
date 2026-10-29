const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const enums = require('@prisma/client');
const fields = load('lib/user-fields.ts', {});
const commission = load('lib/effectivizacion.ts', {});

function load(file, dependencies, extras = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (name in dependencies) return dependencies[name];
    return require(name);
  }, Request, Response, URL, AbortSignal, process: { env: {} }, ...extras }, { filename: file });
  return exports;
}
const actor = { id: 1, role: 'MANAGER', branchId: 1 };
const auth = { requireUser: async () => actor, errorResponse: () => Response.json({ error: 'error' }, { status: 500 }) };
const request = body => new Request('http://local/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: '42' }) };

test('manager cannot edit an admin, another branch or an absent account', async () => {
  for (const target of [{ role: 'ADMIN', branchId: 1 }, { role: 'WORKER', branchId: 2 }, null]) {
    let writes = 0;
    const handler = load('app/api/admin/route.ts', { '@/lib/auth': auth, '@/lib/user-fields': fields, '@/lib/prisma': { prisma: { user: { findUnique: async () => target, update: async () => { writes++; } } } } });
    const response = await handler.POST(request({ action: 'user', id: 99, name: 'Target', username: 'new-user', role: 'WORKER', branchId: 1, active: true, password: 'new-password' }));
    assert.equal(response.status, target ? 403 : 404);
    assert.equal(writes, 0);
  }
});

test('manager can edit a permitted account and receives no credential fields', async () => {
  let query;
  const handler = load('app/api/admin/route.ts', { '@/lib/auth': auth, '@/lib/user-fields': fields, '@/lib/prisma': { prisma: { user: {
    findUnique: async ({ where }) => where.id ? { role: 'WORKER', branchId: 1 } : null,
    update: async args => { query = args; return { id: 99, name: args.data.name }; },
  } } } });
  const response = await handler.POST(request({ action: 'user', id: 99, name: 'Target', username: 'new-user', role: 'WORKER', branchId: 1, active: true }));
  assert.equal(response.status, 200);
  assert.equal(query.where.branchId, 1);
  assert.equal(query.select.passwordHash, undefined);
  assert.equal((await response.json()).user.passwordHash, undefined);
});

test('ticket API requests only public user fields', async () => {
  let query;
  const handler = load('app/api/tickets/route.ts', { '@/lib/auth': auth, '@/lib/user-fields': fields, '@/lib/ticket': {}, '@/lib/prisma': { prisma: { ticket: { findMany: async args => { query = args; return []; } } } } });
  assert.equal((await handler.GET()).status, 200);
  assert.equal(query.include.assignedTo.select.passwordHash, undefined);
  assert.equal(query.include.assignedTo.select.name, true);
});

function completionFixture(sync = async () => ({ synced: true })) {
  const state = { ticket: { id: 42, code: 'CON-001', serviceId: 1, status: 'IN_SERVICE', assignedToId: 1, branchId: 1, service: { id: 1, name: 'Consulta' }, assignedTo: { username: 'worker', dni: '12345678' }, clientName: 'Client Test', dni: '87654321', notes: null }, operations: [], history: [], syncs: 0 };
  const prisma = { $transaction: async fn => fn({
    ticket: {
      findFirst: async () => state.ticket.status === 'IN_SERVICE' ? { ...state.ticket } : null,
      updateMany: async ({ where, data }) => {
        if (state.ticket.status !== where.status || state.ticket.assignedToId !== where.assignedToId) return { count: 0 };
        Object.assign(state.ticket, data); return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ ...state.ticket, operations: state.operations }),
    },
    service: { findUnique: async ({ where }) => ({ id: 2, name: where.name, active: true }) },
    bank: { findUnique: async () => ({ id: 1, name: 'BCP', active: true }) },
    rate: { findUnique: async () => ({ rate: 10 }) },
    operation: { create: async ({ data }) => { state.operations.push(data); return data; } },
    ticketHistory: { create: async ({ data }) => { state.history.push(data); return data; } },
  }) };
  const handler = load('app/api/tickets/[id]/complete/route.ts', { '@/lib/auth': auth, '@/lib/prisma': { prisma }, '@/lib/effectivizacion': commission, '@/lib/registros-atk': { sendToRegistrosAtK: async payload => { state.syncs++; return sync(payload); } } });
  return { state, handler };
}

test('simultaneous completions record one operation, one history and one sync', async () => {
  const { state, handler } = completionFixture();
  const body = { successful: true, escalation: 'REGISTRO', operations: [{ bankId: 1, amount: 100 }] };
  const responses = await Promise.all([handler.POST(request(body), params), handler.POST(request(body), params)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(state.operations.length, 1); assert.equal(state.history.length, 1); assert.equal(state.syncs, 1);
  assert.equal(state.operations[0].serviceId, 2, 'Registration escalation uses the effective service');
});

test('failed tickets reject operations and do not record escalation or synchronize', async () => {
  const { state, handler } = completionFixture();
  assert.equal((await handler.POST(request({ successful: false, operations: [{ bankId: 1, amount: 100 }] }), params)).status, 400);
  assert.equal(state.ticket.status, 'IN_SERVICE');
  assert.equal((await handler.POST(request({ successful: false, escalation: 'REGISTRO', operations: [] }), params)).status, 200);
  assert.equal(state.ticket.status, 'FAILED'); assert.equal(state.ticket.notes, null);
  assert.equal(state.operations.length, 0); assert.equal(state.syncs, 0);
});

test('external network failure returns committed local success with integration failure', async () => {
  const { state, handler } = completionFixture(async () => { throw new Error('network'); });
  const response = await handler.POST(request({ successful: true, escalation: 'REGISTRO', operations: [] }), params);
  assert.equal(response.status, 200); assert.equal(state.ticket.status, 'COMPLETED');
  assert.equal((await response.json()).integration.synced, false);
  assert.equal((await handler.POST(request({ successful: true, operations: [] }), params)).status, 409);
  assert.equal(state.syncs, 1);
});

test('simultaneous start and failure resolve only one called transition', async () => {
  let status = 'CALLED'; const history = [];
  const handler = load('app/api/tickets/[id]/status/route.ts', { '@/lib/auth': auth, '@/lib/prisma': { prisma: { $transaction: async fn => fn({
    ticket: { updateMany: async ({ where, data }) => { if (status !== where.status) return { count: 0 }; status = data.status; return { count: 1 }; }, findUnique: async () => ({ id: 42, status }) },
    ticketHistory: { create: async ({ data }) => { history.push(data); } },
  }) } } });
  const responses = await Promise.all(['IN_SERVICE', 'FAILED'].map(status => handler.POST(request({ status }), params)));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(history.length, 1);
});

test('concurrent ticket creation shares the branch lock and reserves unique codes', async () => {
  const tickets = [{ code: 'REG-002' }, { code: 'REG-009' }];
  let tail = Promise.resolve();
  const prisma = { $transaction: async (fn, options) => {
    assert.equal(options.isolationLevel, 'ReadCommitted');
    let release, locked = false;
    try { return await fn({
      $queryRaw: async (sql, branch) => { assert.equal(branch, 1); const previous = tail; tail = new Promise(resolve => { release = resolve; }); await previous; locked = true; },
      branch: { findFirst: async () => { assert.ok(locked); return { id: 1 }; } },
      service: { findFirst: async () => ({ name: 'Registro' }) },
      ticket: {
        findMany: async ({ where }) => { assert.ok(locked); assert.equal(where.createdAt.gte.getUTCHours(), 5); return [...tickets]; },
        create: async ({ data }) => { tickets.push(data); return data; },
      },
    }); } finally { release?.(); }
  } };
  const lib = load('lib/ticket.ts', { './prisma': { prisma } });
  const data = { branchId: 1, serviceId: 1, dni: '12345678', documentType: 'DNI', clientName: 'Client Test', isPreferential: false };
  const result = await Promise.all([lib.createTicket(data), lib.createTicket(data)]);
  assert.deepEqual(result.map(t => t.code), ['REG-010', 'REG-011']);
  assert.equal(lib.businessDayRange(new Date('2026-10-04T03:00:00Z')).start.toISOString(), '2026-10-03T05:00:00.000Z');
});

test('disabled local account cannot fall back to external authentication', async () => {
  let externalCalls = 0;
  const handler = load('app/api/auth/login/route.ts', { '@/lib/prisma': { prisma: { user: { findUnique: async () => ({ active: false }) } } }, '@/lib/auth': { createSession: async () => { throw new Error('must not create a session'); } } }, { fetch: async () => { externalCalls++; throw new Error('must not request external authentication'); } });
  assert.equal((await handler.POST(request({ username: 'disabled', password: 'test-password' }))).status, 401);
  assert.equal(externalCalls, 0);
});

test('external login preserves local role, branch, service permissions and pause', async () => {
  const user = { id: 1, name: 'Local Worker', username: 'worker', dni: '12345678', role: 'WORKER', branchId: 1, branch: { name: 'Lince' }, moduleNumber: 1, active: true, availability: 'PAUSED', passwordHash: 'old-local-hash' };
  const writes = []; let session;
  const handler = load('app/api/auth/login/route.ts', {
    '@/lib/prisma': { prisma: { user: {
      findUnique: async () => ({ ...user }),
      update: async ({ data }) => { writes.push(data); Object.assign(user, data); return { ...user }; },
    } } },
    '@/lib/auth': { createSession: async (value, hash) => { session = value; assert.equal(hash, user.passwordHash); return 'test-token'; } },
  }, { process: { env: { REGISTROS_ATK_URL: 'http://external', NODE_ENV: 'production' } }, fetch: async () => Response.json({ currentUser: { username: 'worker', name: 'External Worker', role: 'ADMIN', sede: 'Sur' } }) });
  const response = await handler.POST(request({ username: 'worker', password: 'external-password' }));
  assert.equal(response.status, 200); assert.equal(session.role, 'WORKER'); assert.equal(session.branchId, 1);
  assert.equal(user.availability, 'PAUSED');
  assert.ok(writes.every(data => !('active' in data) && !('role' in data) && !('branchId' in data)));
  assert.ok(response.headers.get('Set-Cookie').includes('; Secure'));
});

test('commercial totals and conversions exclude failed historical tickets', async () => {
  const tickets = ['COMPLETED', 'FAILED'].map((status, i) => ({
    id: i + 1, status, assignedToId: 1, serviceId: 1, dni: String(i), service: { name: 'Consulta' },
    notes: '[escalado:EFECTIVIZACION]', arrivedAt: new Date(), startedAt: null, completedAt: new Date(),
    operations: [{ ticketId: i + 1, amount: (i + 1) * 100, profit: (i + 1) * 10, service: { name: 'Efectivización' } }],
  }));
  const handler = load('app/api/dashboard/route.ts', {
    '@/lib/auth': { ...auth, requireUser: async () => ({ id: 1, role: 'ADMIN', branchId: null }) },
    '@/lib/prisma': { prisma: {
      ticket: { count: async () => 0, findMany: async () => tickets }, branch: { findMany: async () => [] },
      service: { findMany: async () => [{ id: 1, name: 'Consulta' }] }, bank: { findMany: async () => [] },
      user: { findMany: async () => [{ id: 1, name: 'Worker', services: [] }] },
    } },
  });
  const response = await handler.GET(new Request('http://local/?period=today'));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.stats.totalAmount, 100); assert.equal(result.stats.totalProfit, 10); assert.equal(result.stats.avgTicket, 100);
  assert.equal(result.workerPerformance[0].volume, 100); assert.equal(result.servicesDistribution[0].volume, 100);
  assert.equal(result.conversions.toEfectivizacion, 1); assert.equal(result.conversions.consultations, 2);
});

function componentFixture(file, fetch) {
  let cursor = 0, pending = [];
  const hooks = [], intervals = [];
  const changed = (before, after) => !before || before.length !== after.length || after.some((item, i) => !Object.is(item, before[i]));
  const react = {
    useState(initial) { const id = cursor++; if (!(id in hooks)) hooks[id] = typeof initial === 'function' ? initial() : initial; return [hooks[id], next => { hooks[id] = typeof next === 'function' ? next(hooks[id]) : next; }]; },
    useRef(initial) { const id = cursor++; return hooks[id] ||= { current: initial }; },
    useEffect(effect, deps) { const id = cursor++; if (changed(hooks[id]?.deps, deps)) { hooks[id]?.cleanup?.(); pending.push(() => { hooks[id] = { deps, cleanup: effect() }; }); } },
    useCallback(fn, deps) { const id = cursor++; if (changed(hooks[id]?.deps, deps)) hooks[id] = { deps, fn }; return hooks[id].fn; },
  };
  const jsx = (type, props) => ({ type, props });
  const component = load(file, { react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, 'next/navigation': { useParams: () => ({ sede: 'LIN' }) }, '@/lib/effectivizacion': commission }, {
    fetch, setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, URLSearchParams,
  }).default;
  function render() { cursor = 0; const tree = component(); const effects = pending; pending = []; effects.forEach(effect => effect()); return tree; }
  async function settle() { await new Promise(resolve => setImmediate(resolve)); render(); return render(); }
  return { render, settle, intervals };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children : [children]).flat(Infinity).flatMap(nodes)];
}
function node(tree, predicate) { const result = nodes(tree).find(predicate); assert.ok(result, 'Expected UI node'); return result; }

test('public document lookup ignores stale names and submits the matching document', async () => {
  const lookups = new Map(); let submitted;
  const fixture = componentFixture('app/registro/[sede]/page.tsx', async (url, options) => {
    if (url.startsWith('/api/public/branch')) return Response.json({ branch: { id: 1, name: 'Lince', code: 'LIN' }, services: [{ id: 1, name: 'Registro' }] });
    if (url === '/api/dni') return new Promise(resolve => { lookups.set(JSON.parse(options.body).document, resolve); });
    if (url === '/api/public/tickets') { submitted = JSON.parse(options.body); return Response.json({ ticket: { code: 'REG-001', branch: { name: 'Lince' }, service: { name: 'Registro' } } }); }
    throw new Error('Unexpected request: ' + url);
  });
  let tree = fixture.render(); tree = await fixture.settle();
  node(tree, n => n.type === 'input' && n.props.inputMode === 'numeric').props.onChange({ target: { value: '11111111' } });
  fixture.render();
  tree = fixture.render();
  node(tree, n => n.type === 'input' && n.props.inputMode === 'numeric').props.onChange({ target: { value: '22222222' } });
  fixture.render();
  lookups.get('11111111')(Response.json({ fullName: 'Wrong Person' })); tree = await fixture.settle();
  assert.notEqual(node(tree, n => n.type === 'input' && n.props.readOnly).props.value, 'Wrong Person');
  lookups.get('22222222')(Response.json({ fullName: 'Correct Person' })); tree = await fixture.settle();
  assert.equal(node(tree, n => n.type === 'input' && n.props.readOnly).props.value, 'Correct Person');
  node(tree, n => n.type === 'button' && n.props.className?.startsWith('service-card')).props.onClick(); tree = fixture.render();
  await node(tree, n => n.type === 'button' && n.props.children === 'Confirmar y generar ticket').props.onClick();
  assert.equal(submitted.dni, '22222222'); assert.equal(submitted.clientName, 'Correct Person');
});

test('automatic current-ticket changes clear drafts and absent active tickets clear the form', async () => {
  let active = { id: 42, code: 'EFEC-001', dni: '12345678', clientName: 'Test Person', status: 'IN_SERVICE', service: { name: 'Efectivización' }, arrivedAt: new Date().toISOString() };
  const fixture = componentFixture('app/page.tsx', async url => {
    if (url.startsWith('/api/dashboard')) return Response.json({ user: { id: 1, name: 'Test Worker', role: 'WORKER', branchId: 1, moduleNumber: 1, availability: 'PAUSED' }, activeTicket: active, workerHistory: [], stats: { waiting: 0, inService: 1, completed: 0, failed: 0, totalAmount: 0, totalProfit: 0, ownToday: 0 }, banks: [{ id: 1, name: 'BCP' }], services: [], branches: [] });
    if (url === '/api/tickets') return Response.json({ tickets: [] });
    throw new Error('Unexpected request: ' + url);
  });
  fixture.render(); let tree = await fixture.settle();
  node(tree, n => n.type === 'button' && JSON.stringify(n.props.children).includes('Mi cola')).props.onClick(); tree = fixture.render();
  node(tree, n => n.type === 'button' && n.props.children === '+ Agregar operación').props.onClick(); tree = fixture.render();
  node(tree, n => n.type === 'input' && n.props.placeholder === 'Monto S/').props.onChange({ target: { value: '100' } }); tree = fixture.render();
  assert.equal(node(tree, n => n.type === 'input' && n.props.placeholder === 'Monto S/').props.value, '100');
  active = { ...active, id: 43, code: 'EFEC-002' };
  await fixture.intervals[0](); tree = await fixture.settle();
  assert.equal(nodes(tree).filter(n => n.type === 'input' && n.props.placeholder === 'Monto S/').length, 0);
  active = null;
  await fixture.intervals[0](); tree = await fixture.settle();
  node(tree, n => n.type === 'h2' && n.props.children === 'Sin atención activa');
});
