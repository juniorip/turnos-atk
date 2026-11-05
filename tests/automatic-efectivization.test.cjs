const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const tools=require('../public/buscar-cliente-utils.js');
function load(file){const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(code,{exports,Number,Math,require:()=>tools});return exports;}
const cards=load('lib/registered-cards.ts'), server=load('lib/effectivizacion.ts');

test('registered choices preserve multiple cards per bank, aliases and commercial bank mapping',()=>{
  const customer={alias:'Cliente 1%',profileName:'Perfil',notes:['<p>atk30<br>1234/5678 BCP / 0042 IBK<br>6789 CENCOSUD<br>BBVA cuenta 001234567890123456</p>']};
  assert.equal(cards.customerProfile(customer),'0.35%');
  const result=cards.getRegisteredCards(customer,[{id:1,name:'BCP'},{id:2,name:'Interbank'},{id:3,name:'Tarjeta Comercial'},{id:4,name:'BBVA'}]);
  assert.equal(result.length,5);assert.equal(result.filter(c=>c.bankKey==='bcp').length,2);
  assert.equal(result.find(c=>c.lastFour==='0042').bankId,2);
  assert.equal(result.find(c=>c.bankKey==='cencosud').bankId,3);
  assert.equal(result.find(c=>c.bankKey==='bbva').lastFour,undefined);
  assert.equal(result.some(c=>c.bankKey==='scotiabank'),false);
  assert.equal(cards.customerProfile({alias:'1%',notes:['atk30','atk50']}),null);
});

test('preview and server agree for all customer profiles, banks, timings, floors and cent rounding',()=>{
  const bankNames={bcp:'BCP',bbva:'BBVA',interbank:'Interbank',banbif:'BanBif',scotiabank:'Scotiabank',cmr:'CMR',io:'IO',diners:'Tarjeta Comercial'};
  for(const profile of ['0.35%','0.5%','1%'])for(const [bankId,name] of Object.entries(bankNames))for(const amountCents of [40000,100000,120001,240101,1000000,2000000])for(const timing of ['same-day',...(['banbif','scotiabank'].includes(bankId)?['next-day']:[])]){
    const preview=tools.calculateDeposit({amountCents,bankId,profile,timing});
    const saved=server.effectivizacionCommission(name,amountCents/100,cards.profileCommissionPlan(profile,name),timing==='next-day'?'NEXT_BUSINESS_DAY':'SAME_DAY');
    assert.equal(saved.profit,preview.commissionCents/100,`${profile} ${name} ${timing} ${amountCents}`);
    assert.equal(saved.rate,preview.rateBps===null?0:preview.rateBps/100);
  }
});

test('invalid amount or a nonpositive net cannot be saved, while debt calculation stays unchanged',()=>{
  for(const amount of [0,-1,1.001,Infinity,NaN])assert.throws(()=>server.effectivizacionCommission('BCP',amount,'ATK_1'));
  assert.throws(()=>server.effectivizacionCommission('IO',30,'ATK_1'));
  assert.equal(server.debtCommission(1000,1),30);assert.equal(server.debtCommission(10000,2.5),250);
});
