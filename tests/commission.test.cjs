const { test } = require('node:test');
const assert = require('node:assert/strict');
const { commissionFromText, resolveCommission } = require('../public/buscar-cliente-utils.js');

test('commission aliases normalize to the three agreed percentages', () => {
  for (const code of ['beto30', 'luis30', 'humberto 30', 'ccfvip30', 'atk30', '0.35%', 'jack30', 'martin30', 'MARTÍN 30', '0.30%', '0.3%', '0,30 %', 'VIP 30', 'Beto 35']) {
    assert.equal(commissionFromText(`Cliente ${code}`), '0.35%', code);
  }
  for (const code of ['atk50', 'atk0.5%', 'ATK 50', '0,50 %', '.5%']) {
    assert.equal(commissionFromText(`Cliente ${code}`), '0.5%', code);
  }
  for (const code of ['remy', '1%', 'atk 1%', '1.00%']) {
    assert.equal(commissionFromText(`Cliente ${code}`), '1%', code);
  }
});

test('notes override the alias for both numeric and named commissions', () => {
  assert.equal(resolveCommission(['0.35%'], 'Cliente 1%'), '0.35%');
  assert.equal(resolveCommission(['Beto30'], 'Cliente 1%'), '0.35%');
  assert.equal(resolveCommission(['ATK 50'], 'Cliente beto30'), '0.5%');
  assert.equal(resolveCommission(['remy'], 'Cliente 0.35%'), '1%');
  assert.equal(resolveCommission(['Sin comisión indicada'], 'Cliente jack30'), '0.35%');
});

test('conflicting valid commissions require confirmation instead of guessing', () => {
  assert.equal(resolveCommission(['0.30%'], 'Cliente 1%'), '0.35%');
  assert.equal(resolveCommission(['ATK30', 'ATK50'], 'Cliente 1%'), 'Por confirmar');
  assert.equal(commissionFromText('remy 0.35%'), 'Por confirmar');
  assert.equal(commissionFromText('0.35% ATK30'), '0.35%');
  assert.equal(resolveCommission(['VIP 30'], 'Cliente 1%'), '0.35%');
  assert.equal(resolveCommission(['Beto 35'], 'Cliente 1%'), '0.35%');
});

test('percentages outside the three commissions are ignored', () => {
  assert.equal(commissionFromText('1.5% y 2%'), '');
  assert.equal(commissionFromText('30%'), '');
  assert.equal(resolveCommission(['2% y Beto35'], 'Cliente 1%'), '0.35%');
  assert.equal(resolveCommission(['1.5% y 2%'], 'Cliente ATK50'), '0.5%');
  assert.equal(resolveCommission(['1% y 1.5% y 2%'], 'Cliente ATK30'), '1%');
  assert.equal(resolveCommission(['Sin comisión'], 'Cliente 2%'), '');
});

test('customer emails, larger numbers and partial words are not commission codes', () => {
  for (const value of ['luis30@example.com', 'humberto 300', 'notremy', 'miatk50', 'ATK300', null]) {
    assert.equal(commissionFromText(value), '', value);
  }
  assert.equal(resolveCommission(['luis30@example.com'], 'Cliente ATK50'), '0.5%');
  assert.equal(resolveCommission([], null), '');
});
