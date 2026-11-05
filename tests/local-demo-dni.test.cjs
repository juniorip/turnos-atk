const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function route(env, fetch) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/api/dni/route.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports,process:{env},Request,Response,AbortSignal,fetch,require:name=>name==='@/lib/auth'?{errorResponse:()=>Response.json({error:'Error'},{status:500})}:require(name)});
  return exports.POST(new Request('http://localhost/api/dni',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document:'12345678',documentType:'DNI'})}));
}

test('development demo validates through the existing registry without provider credentials', async () => {
  const r = await route({NODE_ENV:'development',TURNOS_LOCAL_DEMO_AUTH:'1'}, async (url,options) => {
    assert.equal(url,'https://atkportal.app/turnos/api/dni');
    assert.equal(options.cache,'no-store');
    assert.deepEqual(JSON.parse(options.body),{document:'12345678',documentType:'DNI'});
    return Response.json({document:'12345678',fullName:'APELLIDOS, NOMBRES'});
  });
  assert.equal(r.status,200);
  assert.equal((await r.json()).fullName,'APELLIDOS, NOMBRES');
});

test('production and development without demo opt-in never use the demo proxy', async () => {
  for (const env of [{NODE_ENV:'production',TURNOS_LOCAL_DEMO_AUTH:'1'},{NODE_ENV:'development'}]) {
    const r = await route(env,()=>assert.fail('Unexpected proxy request'));
    assert.equal(r.status,503);
  }
});

test('demo rejects a response for a different document and retains lookup errors', async () => {
  const env={NODE_ENV:'development',TURNOS_LOCAL_DEMO_AUTH:'1'};
  const mismatch=await route(env,async()=>Response.json({document:'87654321',fullName:'OTRO CLIENTE'}));
  assert.equal(mismatch.status,502);
  const absent=await route(env,async()=>Response.json({error:'No se encontró el DNI.'},{status:404}));
  assert.equal(absent.status,404);
});
