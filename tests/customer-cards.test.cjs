const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractCards, extractAccounts, getNoteBankOptions } = require('../public/buscar-cliente-utils.js');

test('four-digit card endings before or after a bank work with and without an account', () => {
  assert.deepEqual(extractCards(['1234 BCP 00123456789012']).map(card => [card.bankId, card.lastFour]), [['bcp', '1234']]);
  assert.deepEqual(extractCards(['BCP 1234']).map(card => [card.bankId, card.lastFour]), [['bcp', '1234']]);
  assert.deepEqual(extractCards(['0042 ITB']).map(card => [card.bankId, card.lastFour]), [['interbank', '0042']]);
  assert.equal(extractAccounts(['0042 ITB']).length, 0);
  assert.equal(getNoteBankOptions(['0042 ITB'])[0].label, 'Interbank · •••• 0042');
});

test('slash-separated cards and cards repeated in other notes keep the correct bank and deduplicate', () => {
  const notes = ['1234/5678 BCP 00123456789012 / 9012 BBVA 001234567890123456', 'BCP\nTarjeta 5678\nTarjeta 0042'];
  assert.deepEqual(extractCards(notes).map(card => [card.bankId, card.lastFour]), [
    ['bcp', '1234'], ['bcp', '5678'], ['bbva', '9012'], ['bcp', '0042'],
  ]);
  assert.deepEqual(extractCards(['BCP 1234 / BBVA 5678']).map(card => [card.bankId, card.lastFour]), [['bcp', '1234'], ['bbva', '5678']]);
  assert.deepEqual(extractCards(['1234/5678 BCP / 9012/3456 BBVA']).map(card => [card.bankId, card.lastFour]), [['bcp', '1234'], ['bcp', '5678'], ['bbva', '9012'], ['bbva', '3456']]);
  assert.deepEqual(extractCards(['0050 - 5267 BCP 19193980484079']).map(card => [card.bankId, card.lastFour]), [['bcp', '0050'], ['bcp', '5267']]);
  assert.deepEqual(extractAccounts(['0050 - 5267 BCP 19193980484079']).map(account => account.account), ['19193980484079']);
});

test('account groups, CCI, dates, phone numbers, DNI and commission numbers are not card endings', () => {
  for (const note of ['BCP 001 2345 6789012', 'CCI BCP 0021 2345 6789 0123 4567', '04/11/2026 BCP 00123456789012', 'BCP\nDNI 12345678\nTeléfono 912345678', 'BCP 0.3500%']) {
    assert.deepEqual(extractCards([note]), [], note);
  }
});

test('calculator options come exclusively from current notes, including card-only banks', () => {
  assert.deepEqual(getNoteBankOptions(['1234 BCP']).map(bank => bank.id), ['bcp']);
  assert.deepEqual(getNoteBankOptions(['Interbank']).map(bank => bank.id), ['interbank']);
  const refreshed = getNoteBankOptions(['5678/9012 BBVA\n0042 ITB']);
  assert.deepEqual(refreshed.map(bank => bank.id), ['bbva', 'interbank']);
  assert.equal(refreshed[0].label, 'BBVA · •••• 5678 / •••• 9012');
  assert.equal(refreshed.some(bank => bank.id === 'bcp'), false);
  assert.deepEqual(getNoteBankOptions(['Sin bancos registrados']), []);
});
