(function (root, factory) {
  const tools = factory();
  if (typeof module === 'object' && module.exports) module.exports = tools;
  else root.TurnosCustomerTools = tools;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const profiles = ['0.35%', '0.5%', '1%'];
  const banks = [
    { id: 'bcp', name: 'BCP', aliases: 'B[ .]*C[ .]*P' },
    { id: 'bbva', name: 'BBVA', aliases: 'B[ .]*B[ .]*V[ .]*A' },
    { id: 'interbank', name: 'Interbank', aliases: 'INTER[ ]*BANK|IBK|ITB' },
    { id: 'scotiabank', name: 'Scotiabank', aliases: 'SCOTIABANK|SCOTIA|SCOTI|SCOT|SCO' },
    { id: 'banbif', name: 'BanBif', aliases: 'BAN[ ]*BIF' },
    { id: 'cmr', name: 'CMR', aliases: 'CMR(?:[ ]+FALABELLA)?' },
    { id: 'io', name: 'iO', aliases: 'I[ .]*O' },
    { id: 'sip', name: 'SIP', aliases: 'SIP' },
    { id: 'cencosud', name: 'Cencosud', aliases: 'CENCOSUD' },
    { id: 'ripley', name: 'Ripley', aliases: '(?:BANCO[ ]+)?RIPLEY' },
    { id: 'diners', name: 'Diners Club', aliases: 'DINERS(?:[ ]+CLUB)?' },
  ];

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function commissionFromText(value) {
    const text = normalize(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
    const rates = new Set();
    for (const match of text.matchAll(/(\d+(?:[.,]\d+)?|[.,]\d+)\s*%/g)) {
      const amount = Number(match[1].replace(',', '.'));
      const rate = amount === 0.3 ? 0.35 : amount;
      if ([0.35, 0.5, 1].includes(rate)) rates.add(`${rate}%`);
    }
    if (/\b(?:beto|luis|humberto|ccfvip|atk|jack|martin)[\s._-]*30\b/i.test(text)) rates.add('0.35%');
    if (/\batk[\s._-]*50\b/i.test(text)) rates.add('0.5%');
    if (/\bremy\b/i.test(text)) rates.add('1%');
    if (/\b(?:vip[\s._-]*30|beto[\s._-]*35)\b/i.test(text)) rates.add('0.35%');
    if (rates.size > 1) return 'Por confirmar';
    return rates.size ? [...rates][0] : '';
  }

  function resolveCommission(notes, alias) {
    return commissionFromText((notes || []).join('\n')) || commissionFromText(alias);
  }

  function bankMatches(text) {
    const matches = [];
    const definitions = [...banks, { id: '', name: 'Tarjeta comercial', aliases: 'TARJETA[ ]+COMERCIAL|TC[ ]+COMERCIAL' }];
    for (const bank of definitions) {
      const pattern = new RegExp(`(?<![a-z])(?:${bank.aliases})(?![a-z])`, 'gi');
      for (const match of normalize(text).matchAll(pattern)) {
        matches.push({ bank, index: match.index, end: match.index + match[0].length });
      }
    }
    return matches.sort((a, b) => a.index - b.index);
  }

  function lastIdentifierLabel(text) {
    const labels = [...normalize(text).matchAll(/\b(CCI|CUENTA|CTA|TARJETA)\b/gi)];
    return labels.length ? (labels.at(-1)[1].toUpperCase() === 'CCI' ? 'CCI' : 'Cuenta') : '';
  }

  function numberRuns(text) {
    const result = [];
    for (const match of text.matchAll(/\d[\d \t-]*\d|\d/g)) {
      const chunks = [...match[0].matchAll(/\d[\d-]*/g)];
      // Two full account numbers separated by spaces are distinct identifiers.
      const wholeNumbers = chunks.filter(chunk => chunk[0].replace(/\D/g, '').length >= 8);
      if (wholeNumbers.length >= 2 && wholeNumbers.length === chunks.length) {
        for (const chunk of chunks) result.push({ raw: chunk[0], index: match.index + chunk.index });
      } else {
        result.push({ raw: match[0], index: match.index });
      }
    }
    return result;
  }

  function extractBanks(notes) {
    const found = new Map();
    for (const note of notes || []) {
      const text = String(note).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
      for (const { bank } of bankMatches(text)) if (bank.id && !found.has(bank.id)) found.set(bank.id, bank);
    }
    return [...found.values()];
  }

  function extractCards(notes) {
    const cards = [], seen = new Set();
    const cardOnly = value => !normalize(value).replace(/\d{4}/g, ' ').replace(/\b(?:TARJETA|TARJETAS|TERMINADA|TERMINADAS|TERMINA|ULTIMOS|DIGITOS|NUEVA|ADICIONAL)\b/gi, ' ').replace(/[\s*•.,:;()_-]/g, '');
    function add(bank, digits) {
      if (!bank?.id) return;
      const key = `${bank.id}:${digits}`;
      if (!seen.has(key)) { seen.add(key); cards.push({ bankId: bank.id, bank: bank.name, lastFour: digits }); }
    }
    for (const note of notes || []) {
      let currentBank = null, pending = [];
      const text = String(note)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
        .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ')
        .replace(/(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*%/g, ' ');
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*(?:DNI|RUC|CELULAR|CEL|TELEFONO|TEL|WHATSAPP|WSP|DIRECCION|AV\.?|CALLE|JR\.?)\b/i.test(normalize(line))) {
          currentBank = null; pending = []; continue;
        }
        const chunks = line.split('/');
        for (const [chunkIndex, chunk] of chunks.entries()) {
          const matches = bankMatches(chunk);
          const suffixes = numberRuns(chunk).filter(candidate => /^\d{4}$/.test(candidate.raw.trim()));
          if (matches.length) {
            for (const digits of pending) add(matches[0].bank, digits);
            pending = [];
            for (const candidate of suffixes) {
              const left = matches.filter(match => match.end <= candidate.index).at(-1);
              const right = matches.find(match => match.index >= candidate.index + candidate.raw.length);
              const closest = !left ? right : !right ? left : candidate.index - left.end <= right.index - (candidate.index + candidate.raw.length) ? left : right;
              if (closest) add(closest.bank, candidate.raw.trim());
            }
            currentBank = matches.at(-1).bank;
          } else {
            if (cardOnly(chunk) && suffixes.length) {
              let followingBank = null;
              for (const following of chunks.slice(chunkIndex + 1)) {
                const nextBanks = bankMatches(following);
                if (nextBanks.length) {
                  const prefix = following.slice(0, nextBanks[0].index);
                  if (cardOnly(prefix) && numberRuns(prefix).some(candidate => /^\d{4}$/.test(candidate.raw.trim()))) followingBank = nextBanks[0].bank;
                  break;
                }
                if (!cardOnly(following)) break;
              }
              for (const candidate of suffixes) {
                if (followingBank || currentBank) add(followingBank || currentBank, candidate.raw.trim());
                else pending.push(candidate.raw.trim());
              }
            } else if (chunk.trim()) { currentBank = null; pending = []; }
          }
        }
      }
    }
    return cards;
  }

  function getNoteBankOptions(notes) {
    const cards = extractCards(notes);
    return extractBanks(notes).map(bank => {
      const suffixes = cards.filter(card => card.bankId === bank.id).map(card => card.lastFour);
      return { id: bank.id, name: bank.name, label: bank.name + (suffixes.length ? ` · ${suffixes.map(digits => `•••• ${digits}`).join(' / ')}` : '') };
    });
  }

  function extractAccounts(notes) {
    const accounts = [];
    const seen = new Set();
    for (const note of notes || []) {
      let currentBank = null, currentLabel = '';
      for (const rawLine of String(note).split(/\r?\n/)) {
        const line = rawLine.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
        if (!line.trim()) continue;
        const matches = bankMatches(line);
        function consume(segment, inlineBank, preserveUnknown = false) {
          segment = segment.replace(/(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*%/g, value => ' '.repeat(value.length));
          let previousEnd = 0;
          for (const candidate of numberRuns(segment)) {
            const before = segment.slice(previousEnd, candidate.index);
            const label = lastIdentifierLabel(before);
            if (label) currentLabel = label;
            previousEnd = candidate.index + candidate.raw.length;
            const digits = candidate.raw.replace(/\D/g, '');
            if (digits.length < 8 || digits.length > 22) continue;
            if (/\b(?:DNI|RUC|CELULAR|CEL|TELEFONO|TEL|WHATSAPP|WSP|DIRECCION)\b/i.test(normalize(before))) continue;
            if (!currentBank && !currentLabel && !preserveUnknown) continue;
            if (preserveUnknown && !currentLabel && digits.length < 10) continue;
            if (!inlineBank && !label && !currentLabel && digits.length === 9 && digits.startsWith('9')) continue;
            const suffix = segment.slice(previousEnd);
            const suffixCCI = /^\s*\(?CCI\b/i.test(suffix) && numberRuns(suffix).length === 0;
            const kind = currentLabel === 'CCI' || suffixCCI || digits.length === 20 ? 'CCI' : 'Cuenta';
            currentLabel = '';
            const bankId = currentBank?.id || '';
            const key = `${bankId}:${kind}:${digits}`;
            if (!seen.has(key)) {
              seen.add(key);
              accounts.push({ bankId, bank: currentBank?.name || 'Banco sin identificar', kind, account: digits });
            }
          }
          const tailLabel = lastIdentifierLabel(segment.slice(previousEnd));
          if (tailLabel) currentLabel = tailLabel;
        }
        if (matches.length) {
          const prefix = line.slice(0, matches[0].index);
          // A number before a new bank name may belong to an earlier account.
          // Keep it unassigned rather than guessing which bank it belongs to.
          if (/\d/.test(prefix)) { currentBank = null; currentLabel = ''; consume(prefix, false, true); }
          for (let index = 0; index < matches.length; index++) {
            const match = matches[index];
            currentBank = match.bank;
            currentLabel = index === 0 && !/\d/.test(prefix) ? lastIdentifierLabel(prefix) : '';
            consume(line.slice(match.end, matches[index + 1]?.index ?? line.length), true);
          }
        } else {
          if (/^\s*(?:DNI|RUC|CELULAR|CEL|TELEFONO|TEL|WHATSAPP|WSP|DIRECCION|AV\.?|CALLE|JR\.?)\b/i.test(normalize(line))) {
            currentBank = null; currentLabel = '';
            continue;
          }
          if (/^\s*[a-z]/i.test(normalize(line)) && !/\b(?:CCI|CUENTA|CTA|AHORROS|SOLES|PEN|USD|DOLARES|NRO|NUMERO|TARJETA)\b/i.test(normalize(line))) {
            currentBank = null; currentLabel = '';
          }
          consume(line, false);
          if (!/\d/.test(line) && !lastIdentifierLabel(line)) { currentBank = null; currentLabel = ''; }
        }
      }
    }
    return accounts;
  }

  function parseAmountCents(value) {
    const text = String(value ?? '').trim().replace(/\s/g, '');
    if (!/^\d[\d.,]*$/.test(text)) return null;
    let integer = text, decimals = '';
    const dot = text.lastIndexOf('.'), comma = text.lastIndexOf(',');
    if (dot >= 0 && comma >= 0) {
      const decimal = dot > comma ? '.' : ',', grouping = decimal === '.' ? ',' : '.';
      const parts = text.split(decimal);
      if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])) return null;
      if (!new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})+$`).test(parts[0])) return null;
      integer = parts[0].split(grouping).join(''); decimals = parts[1];
    } else if (dot >= 0 || comma >= 0) {
      const separator = dot >= 0 ? '.' : ',', parts = text.split(separator);
      if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) {
        integer = parts[0]; decimals = parts[1];
      } else if (/^\d{1,3}$/.test(parts[0]) && parts.slice(1).every(part => /^\d{3}$/.test(part))) {
        integer = parts.join('');
      } else return null;
    }
    const cents = BigInt(integer) * 100n + BigInt(decimals.padEnd(2, '0') || '0');
    if (cents <= 0n || cents > 99999999999n) return null;
    return Number(cents);
  }

  function getTariff(bankId, profile, timing) {
    if (!profiles.includes(profile)) return null;
    if (!banks.some(bank => bank.id === bankId)) return null;
    const delayed = ['banbif', 'scotiabank'].includes(bankId);
    if (!['same-day', 'next-day'].includes(timing) || (!delayed && timing !== 'same-day')) return null;
    const base = { '0.35%': 35, '0.5%': 50, '1%': 100 }[profile];
    if (bankId === 'io') return { flatCents: 3000, minimumCents: 3000, rateBps: null };
    if (['bcp', 'bbva'].includes(bankId)) return { rateBps: base === 100 ? 100 : 50, minimumCents: 1200 };
    if (delayed) return {
      rateBps: timing === 'next-day' ? base : base === 100 ? 150 : 100,
      minimumCents: bankId === 'scotiabank' ? 2000 : 1200,
    };
    if (bankId === 'interbank') return { rateBps: base === 100 ? 200 : 150, minimumCents: 3000 };
    if (bankId === 'cmr') return { rateBps: 200, minimumCents: 3000 };
    return { rateBps: 800, minimumCents: 3000 };
  }

  function calculateDeposit({ amountCents, bankId, profile, timing = 'same-day' }) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 99999999999) return { ok: false, reason: 'amount' };
    const tariff = getTariff(bankId, profile, timing);
    if (!tariff) return { ok: false, reason: 'selection' };
    // All arithmetic uses cents and basis points, rounding half up to one cent.
    const percentageCents = tariff.rateBps === null ? 0 : Number((BigInt(amountCents) * BigInt(tariff.rateBps) + 5000n) / 10000n);
    const commissionCents = tariff.flatCents ?? Math.max(percentageCents, tariff.minimumCents);
    if (amountCents <= commissionCents) return { ok: false, reason: 'amount_below_fee', commissionCents };
    return {
      ok: true, amountCents, commissionCents, depositCents: amountCents - commissionCents,
      ...tariff, minimumApplied: tariff.flatCents === undefined && percentageCents < tariff.minimumCents,
    };
  }

  return { profiles, banks, commissionFromText, resolveCommission, extractAccounts, extractBanks, extractCards, getNoteBankOptions, parseAmountCents, getTariff, calculateDeposit };
});
