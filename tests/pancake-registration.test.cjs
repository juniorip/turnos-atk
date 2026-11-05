const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const {UserRole} = require('@prisma/client');

async function lookup({user={id:7,role:UserRole.WORKER,branchId:1},ticket={dni:'12345678'},result={ok:true,found:true,complete:true},id='5'}={}) {
  let scope, calls=0;
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/api/tickets/[id]/pancake-registration/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const dependencies={
    '@prisma/client':{UserRole},
    '@/lib/auth':{requireUser:async(...roles)=>{if(!user||!roles.includes(user.role))throw Error('UNAUTHORIZED');return user;},errorResponse:()=>Response.json({error:'Unauthorized'},{status:401})},
    '@/lib/prisma':{prisma:{ticket:{findFirst:async(query)=>{scope=query;return ticket;}}}},
    '@/lib/pancake':{lookupPancakeCustomerByDni:async(dni)=>{calls++;assert.equal(dni,ticket.dni);return result;}},
  };
  vm.runInNewContext(code,{exports,Response,Number,require:name=>dependencies[name]});
  const response=await exports.GET(new Request('http://localhost/api/tickets/5/pancake-registration?dni=87654321'),{params:Promise.resolve({id})});
  return {response,body:await response.json(),scope,calls};
}

test('worker lookup uses only an assigned ticket in their branch and exposes no notes',async()=>{
  const r=await lookup({result:{ok:true,found:true,complete:true,customer:{notes:['private'],alias:'private'}}});
  assert.equal(r.response.status,200);
  assert.deepEqual(JSON.parse(JSON.stringify(r.scope.where)),{id:5,branchId:1,assignedToId:7});
  assert.deepEqual(r.body,{registered:true,complete:true});
  assert.equal(r.response.headers.get('Cache-Control'),'no-store');
});

test('anonymous, unsupported role, inaccessible ticket and invalid id never query Pancake',async()=>{
  for(const args of [{user:null},{user:{id:1,role:UserRole.RECEPTION,branchId:1}},{ticket:null},{id:'-1'},{id:'abc'}]){
    const r=await lookup(args);
    assert.ok([400,401,404].includes(r.response.status));
    assert.equal(r.calls,0);
  }
});

test('admin can check tickets and managers remain limited to their own branch',async()=>{
  const admin=await lookup({user:{id:1,role:UserRole.ADMIN,branchId:null}});
  assert.deepEqual(JSON.parse(JSON.stringify(admin.scope.where)),{id:5});
  const manager=await lookup({user:{id:2,role:UserRole.MANAGER,branchId:3}});
  assert.deepEqual(JSON.parse(JSON.stringify(manager.scope.where)),{id:5,branchId:3});
});

test('a limited search can be negative while provider failures remain unknown',async()=>{
  const absent=await lookup({result:{ok:true,found:false,complete:false}});
  assert.deepEqual(absent.body,{registered:false,complete:false});
  for(const reason of ['not_configured','unavailable','unauthorized']){
    const failure=await lookup({result:{ok:false,reason}});
    assert.equal(failure.response.status,reason==='not_configured'?503:502);
    assert.equal('registered' in failure.body,false);
  }
});

test('badge distinguishes found, possible absence and unavailable service',()=>{
  const React=require('react');
  const {renderToStaticMarkup}=require('react-dom/server');
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/components/pancake-registration.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  for(const [status,label,icon] of [['registered','Registrado','✓'],['not-found','Posiblemente no registrado','✕'],['unavailable','No se pudo comprobar','—'],['loading','Consultando Pancake…','◌']]){
    const exports={};let index=0;
    vm.runInNewContext(code,{exports,require:name=>name==='react'?{useState:()=>[index++===0?status:0,()=>{}],useEffect:()=>{}}:name==='@/lib/app-fetch'?{}:require(name)});
    const html=renderToStaticMarkup(React.createElement(exports.default,{ticketId:5}));
    assert.ok(html.includes(label));assert.ok(html.includes(icon));
  }
});
