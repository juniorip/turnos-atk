const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function portal(env) {
  const source = fs.readFileSync(path.join(__dirname, '../app/api/auth/portal/route.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, URL, process: {env}, require: () => ({NextResponse: {redirect: (url, status) => Response.redirect(url, status)}}) });
  return exports.GET(new Request('http://127.0.0.1:3000/api/auth/portal'));
}

test('explicit development demo uses the same-origin login and supports the base path', async () => {
  const response = await portal({NODE_ENV:'development',TURNOS_LOCAL_DEMO_AUTH:'1'});
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), 'http://127.0.0.1:3000/acceso-local.html');
  const prefixed = await portal({NODE_ENV:'development',TURNOS_LOCAL_DEMO_AUTH:'1',NEXT_PUBLIC_APP_BASE_PATH:'/turnos'});
  assert.equal(prefixed.headers.get('Location'), 'http://127.0.0.1:3000/turnos/acceso-local.html');
});

test('production never opens demo login even if the demo environment flag is set', async () => {
  const response = await portal({NODE_ENV:'production',TURNOS_LOCAL_DEMO_AUTH:'1',REGISTROS_ATK_PORTAL_URL:'https://atkportal.app/'});
  assert.equal(response.headers.get('Location'), 'https://atkportal.app/?portal=turnos');
});

test('development without demo opt-in retains the external portal login', async () => {
  const response = await portal({NODE_ENV:'development'});
  assert.equal(response.headers.get('Location'), 'http://localhost:3100/?portal=turnos');
});
