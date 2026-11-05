const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractAccounts, parseAmountCents, getTariff, calculateDeposit } = require('../public/buscar-cliente-utils.js');

test('accounts normalize bank aliases and distinguish accounts from CCI on the same line', () => {
  const rows = extractAccounts(['ITB Cuenta 0123456789012 CCI 00312345678901234567 BBVA 001234567890123456']);
  assert.deepEqual(rows.map(row => [row.bankId, row.kind, row.account]), [
    ['interbank', 'Cuenta', '0123456789012'],
    ['interbank', 'CCI', '00312345678901234567'],
    ['bbva', 'Cuenta', '001234567890123456'],
  ]);
  for (const code of ['IBK', 'INTERBANK', 'INTER BANK']) assert.equal(extractAccounts([`${code} 0123456789012`])[0].bank, 'Interbank');
  for (const code of ['SCO', 'SCOT', 'SCOTI', 'SCOTIA', 'SCOTIABANK']) assert.equal(extractAccounts([`${code} 0012345678`])[0].bank, 'Scotiabank');
});

test('multiple accounts, number spacing and multiline labels preserve identifiers and leading zeros', () => {
  const rows = extractAccounts(['BCP00123456789012\nCCI\n002 123 45678901234567\nBBVA 001234567890123456 / 009876543210123456']);
  assert.deepEqual(rows.map(row => [row.bankId, row.kind, row.account]), [
    ['bcp', 'Cuenta', '00123456789012'],
    ['bcp', 'CCI', '00212345678901234567'],
    ['bbva', 'Cuenta', '001234567890123456'],
    ['bbva', 'Cuenta', '009876543210123456'],
  ]);
  assert.equal(extractAccounts(['BCP 001-2345678-0-12'])[0].account, '0012345678012');
  assert.equal(extractAccounts(['BCP 0012345678 0098765432']).length, 2);
  assert.equal(extractAccounts(['CCI BCP 00212345678901234567'])[0].kind, 'CCI');
  assert.equal(extractAccounts(['BCP 00212345678901234567 (CCI)'])[0].kind, 'CCI');
  assert.equal(extractAccounts(['BCP 00123456789012 1%'])[0].account, '00123456789012');
  assert.deepEqual(extractAccounts(['BCP\nCCI 00212345678901234567\n00123456789012']).map(row => row.kind), ['CCI', 'Cuenta']);
});

test('duplicate notes, DNI and phone numbers do not create duplicate or unrelated accounts', () => {
  const notes = ['BCP 00123456789012\nDNI 12345678\nCelular 912345678\nCorreo cliente@example.test', 'BCP 00123456789012'];
  assert.deepEqual(extractAccounts(notes).map(row => row.account), ['00123456789012']);
  assert.equal(extractAccounts(['BCP 00123456789012', '12345678']).length, 1);
  const unidentified = extractAccounts(['CCI 00212345678901234567'])[0];
  assert.equal(unidentified.bankId, '');
  assert.equal(unidentified.kind, 'CCI');
  assert.equal(extractAccounts(['BCP 00123456789012\nOtroBanco 001234567890']).length, 1);
  assert.equal(extractAccounts(['TC COMERCIAL 0012345678901234'])[0].bank, 'Tarjeta comercial');
  const mixed = extractAccounts(['IBK 0123456789012\n001234567890 SCOTIABANK 0012345678']);
  assert.equal(mixed[1].bankId, '');
  assert.equal(mixed[2].bankId, 'scotiabank');
  assert.equal(extractAccounts(['12345678 IBK 0123456789012']).length, 1);
});

test('monetary input accepts Peruvian and international decimal formats without silent truncation', () => {
  for (const [input, cents] of [['2000', 200000], ['2,000.50', 200050], ['2.000,50', 200050], ['2000,5', 200050], ['0.01', 1], ['1,000', 100000], ['1.000', 100000]]) {
    assert.equal(parseAmountCents(input), cents, input);
  }
  for (const input of ['', '0', '-2', 'NaN', '1e5', '1000.005', '12,34,56', '1,00.25', '99999999999999999', 'abc']) assert.equal(parseAmountCents(input), null, input);
});

test('BanBif and Scotiabank use the confirmed rates and floors for both settlement timings', () => {
  for (const [profile, timing, rateBps, banbifBreakEven, scotiaBreakEven] of [
    ['0.35%', 'next-day', 35, 342857, 571429],
    ['0.35%', 'same-day', 100, 120000, 200000],
    ['0.5%', 'next-day', 50, 240000, 400000],
    ['0.5%', 'same-day', 100, 120000, 200000],
    ['1%', 'next-day', 100, 120000, 200000],
    ['1%', 'same-day', 150, 80000, 133333],
  ]) {
    for (const [bankId, minimum, threshold] of [['banbif', 1200, banbifBreakEven], ['scotiabank', 2000, scotiaBreakEven]]) {
      assert.equal(getTariff(bankId, profile, timing).rateBps, rateBps);
      const small = calculateDeposit({ amountCents: 50000, bankId, profile, timing });
      assert.equal(small.commissionCents, minimum);
      assert.equal(small.depositCents, 50000 - minimum);
      assert.equal(calculateDeposit({ amountCents: threshold, bankId, profile, timing }).commissionCents, minimum);
    }
  }
  assert.equal(calculateDeposit({ amountCents: 1000000, bankId: 'scotiabank', profile: '0.35%', timing: 'next-day' }).commissionCents, 3500);
});

test('iO is always a fixed S/30, including a S/20000 operation', () => {
  for (const profile of ['0.35%', '0.5%', '1%']) {
    for (const amountCents of [40000, 100000, 2000000]) {
      const quote = calculateDeposit({ amountCents, bankId: 'io', profile });
      assert.equal(quote.commissionCents, 3000);
      assert.equal(quote.depositCents, amountCents - 3000);
      assert.equal(quote.rateBps, null);
    }
  }
});

test('other banks apply their own rate instead of the customer profile percentage', () => {
  const fee = (bankId, profile, amountCents) => calculateDeposit({ bankId, profile, amountCents }).commissionCents;
  assert.equal(fee('bcp', '0.35%', 1000000), 5000);
  assert.equal(fee('bbva', '1%', 1000000), 10000);
  assert.equal(fee('interbank', '0.35%', 1000000), 15000);
  assert.equal(fee('interbank', '1%', 1000000), 20000);
  assert.equal(fee('cmr', '0.35%', 1000000), 20000);
  for (const bankId of ['sip', 'cencosud', 'ripley', 'diners']) {
    assert.equal(fee(bankId, '0.5%', 100000), 8000);
    assert.equal(fee(bankId, '1%', 10000), 3000);
  }
});

test('rounding is to the nearest cent and invalid or nonpositive deposits are blocked', () => {
  const quote = calculateDeposit({ amountCents: 240101, bankId: 'bcp', profile: '0.5%' });
  assert.equal(quote.commissionCents, 1201);
  assert.equal(quote.depositCents, 238900);
  assert.equal(calculateDeposit({ amountCents: 3000, bankId: 'io', profile: '1%' }).reason, 'amount_below_fee');
  for (const selection of [
    { amountCents: 100000, bankId: 'unknown', profile: '1%' },
    { amountCents: 100000, bankId: 'bcp', profile: 'Por confirmar' },
    { amountCents: 100000, bankId: 'bcp', profile: '1%', timing: 'next-day' },
    { amountCents: NaN, bankId: 'bcp', profile: '1%' },
  ]) assert.equal(calculateDeposit(selection).ok, false);
});
