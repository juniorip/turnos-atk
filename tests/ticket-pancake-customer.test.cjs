const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {UserRole}=require('@prisma/client');
async function call({user={id:7,role:UserRole.WORKER,branchId:1},ticket={id:5,dni:'12345678'},state={state:'pending'},refresh=false}={}){
  let where;const jobs=[];
  const deps={'@prisma/client':{UserRole},'next/server':{after:fn=>jobs.push(fn)},'@/lib/auth':{requireUser:async()=>{if(!user)throw Error();return user;},errorResponse:()=>Response.json({error:'Unauthorized'},{status:401})},'@/lib/prisma':{prisma:{ticket:{findFirst:async args=>{where=args.where;return ticket;}}}},'@/lib/ticket-pancake':{readTicketPancake:async()=>state,fillTicketPancake:async()=>{}}};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/api/tickets/[id]/pancake-customer/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};vm.runInNewContext(code,{exports,Response,URL,Number,require:name=>deps[name]});
  const r=await exports.GET(new Request('http://localhost/api/tickets/5/pancake-customer'+(refresh?'?refresh=1':'')),{params:Promise.resolve({id:'5'})});
  return {r,body:await r.json(),where,jobs};
}
test('customer data is scoped to the assigned advisor and cannot be requested anonymously',async()=>{
  const c=await call();assert.deepEqual(JSON.parse(JSON.stringify(c.where)),{id:5,branchId:1,assignedToId:7});
  assert.equal((await call({ticket:null})).r.status,404);assert.equal((await call({user:null})).r.status,401);
});
test('pending lookup returns promptly and schedules background work while cached details are returned directly',async()=>{
  const pending=await call();assert.equal(pending.r.status,202);assert.equal(pending.jobs.length,1);
  const state={state:'ready',checkedAt:'2026-11-04T12:00:00Z',result:{ok:true,found:true,customer:{notes:['1234 BCP']}}};
  const ready=await call({state});assert.deepEqual(ready.body,state);assert.equal(ready.jobs.length,0);assert.equal(ready.r.headers.get('Cache-Control'),'no-store');
  const refreshed=await call({state,refresh:true});assert.equal(refreshed.r.status,202);assert.equal(refreshed.jobs.length,1);
});
