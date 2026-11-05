const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

function cache(lookup=async()=>({ok:true,found:true,complete:true,customer:{alias:'Cliente',profileName:'Perfil',notes:['1234 BCP']}})) {
  const rows=new Map();let calls=0;
  const table={
    upsert:async({where,create})=>{if(!rows.has(where.ticketId))rows.set(where.ticketId,{...create,result:null,checkedAt:null,leaseUntil:null,claimKey:null});return rows.get(where.ticketId);},
    findUnique:async({where})=>rows.get(where.ticketId)||null,
    findMany:async({where})=>[...rows.values()].filter(row=>where.ticketId.in.includes(row.ticketId)),
    updateMany:async({where,data})=>{
      const row=rows.get(where.ticketId);if(!row)return{count:0};
      if(where.claimKey&&where.claimKey!==row.claimKey)return{count:0};
      if(where.dni&&where.dni!==row.dni)return{count:0};
      if(where.OR&&row.leaseUntil&&row.leaseUntil>where.OR[1].leaseUntil.lte)return{count:0};
      if(where.AND){const conditions=where.AND[0].OR;if(row.expiresAt>conditions[0].expiresAt.lte&&row.dni===conditions[1].dni.not)return{count:0};}
      Object.assign(row,data);return{count:1};
    },
  };
  const dependencies={'@/lib/prisma':{prisma:{ticketPancakeSnapshot:table}},'@/lib/pancake':{lookupPancakeCustomerByDni:async(...args)=>{calls++;return lookup(...args);}},'@prisma/client':{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/ticket-pancake.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};vm.runInNewContext(code,{exports,Date,Map,Promise,AbortSignal,require:name=>dependencies[name]||require(name)});
  return{...exports,rows,get calls(){return calls;}};
}
const ticket={id:5,dni:'12345678'};

test('queue warmup saves customer data and a later attention reads it without another search',async()=>{
  const c=cache();await c.warmWaitingPancake([ticket]);
  const ready=await c.readTicketPancake(ticket);
  assert.equal(ready.state,'ready');assert.equal(ready.result.customer.notes[0],'1234 BCP');
  await c.warmWaitingPancake([ticket]);await c.fillTicketPancake(ticket);
  assert.equal(c.calls,1);
});

test('concurrent advisors share a lease and manual refresh invalidates the previous result',async()=>{
  let release;const blocked=new Promise(resolve=>release=resolve);
  const c=cache(async()=>{await blocked;return{ok:true,found:false,complete:true,customer:null};});
  const first=c.fillTicketPancake(ticket);const second=c.fillTicketPancake(ticket);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(c.calls,1);release();await Promise.all([first,second]);
  const initial=c.rows.get(5).checkedAt;
  await c.fillTicketPancake(ticket,true);assert.equal(c.calls,2);
  assert.ok(c.rows.get(5).checkedAt>=initial);
});

test('expired and changed-DNI snapshots cannot be mistaken for the current customer',async()=>{
  const c=cache();await c.fillTicketPancake(ticket);
  c.rows.get(5).expiresAt=new Date(0);
  assert.equal((await c.readTicketPancake(ticket)).state,'pending');
  await c.fillTicketPancake(ticket);assert.equal(c.calls,2);
  assert.equal((await c.readTicketPancake({id:5,dni:'87654321'})).state,'pending');
  await c.fillTicketPancake({id:5,dni:'87654321'});assert.equal(c.calls,3);
});

test('transient failures have a short cooldown and do not become a negative registration',async()=>{
  const c=cache(async()=>({ok:false,reason:'unavailable'}));await c.fillTicketPancake(ticket);
  const ready=await c.readTicketPancake(ticket);
  assert.equal(ready.result.ok,false);assert.equal('found' in ready.result,false);
  await c.warmWaitingPancake([ticket]);assert.equal(c.calls,1);
  assert.ok(c.rows.get(5).expiresAt-new Date()<31000);
});

test('warmup skips ready tickets before selecting the next two pending clients',async()=>{
  const c=cache();const tickets=[1,2,3,4].map(id=>({id,dni:String(12345670+id)}));
  await c.warmWaitingPancake(tickets);assert.equal(c.calls,2);
  await c.warmWaitingPancake(tickets);assert.equal(c.calls,4);
  await c.warmWaitingPancake(tickets);assert.equal(c.calls,4);
});

test('a late worker cannot overwrite a newer lookup after its lease was reclaimed',async()=>{
  let release,number=0;const blocked=new Promise(resolve=>release=resolve);
  const c=cache(async()=>{const first=++number===1;if(first)await blocked;return{ok:true,found:true,complete:true,customer:{profileName:first?'Old':'New'}};});
  const old=c.fillTicketPancake(ticket);await new Promise(resolve=>setImmediate(resolve));
  c.rows.get(5).leaseUntil=new Date(0);
  await c.fillTicketPancake(ticket);release();await old;
  assert.equal((await c.readTicketPancake(ticket)).result.customer.profileName,'New');
});
