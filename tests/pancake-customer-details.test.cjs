const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/components/pancake-customer-details.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const output={};vm.runInNewContext(code,{exports:output,Date,require:name=>name==='../../public/buscar-cliente-utils.js'?require('../public/buscar-cliente-utils.js'):require(name)});

test('automatic customer details reuse the notes-first commission and existing bank/card/account parsing',()=>{
  const result=output.parsePancakeDetails({alias:'Cliente 1%',profileName:'Perfil',notes:['<p>atk30<br>1234 BCP cuenta 00112233445566<br>5678 IBK / 9012 ITB<br>cliente@example.com<br>Dirección: Calle de prueba 123</p>']});
  assert.equal(result.commission,'0.35%');assert.equal(result.email,'cliente@example.com');
  assert.ok(result.address.includes('Calle de prueba'));
  assert.deepEqual([...result.banks.map(bank=>bank.id)],['bcp','interbank']);
  assert.ok(result.accounts.some(account=>account.account==='00112233445566'));
  assert.ok(result.cards.some(card=>card.lastFour==='5678'&&card.bankId==='interbank'));
});

test('customer notes and aliases render as escaped text without active HTML',()=>{
  const html=renderToStaticMarkup(React.createElement(output.default,{customer:{alias:'<img src=x onerror=alert(1)>',profileName:'Perfil',notes:['<b>0.5%</b><br>1234 BCP']},checkedAt:null}));
  assert.equal(html.includes('<img src=x'),false);assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('Tarjeta'));assert.ok(html.includes('1234'));
});
