const MAX_MONEY_CENTS = 99999999999;

export function moneyToCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_MONEY_CENTS ? cents : null;
}

export function calculateBusinessProfit(amount, cost) {
  const amountCents = moneyToCents(amount);
  const costCents = moneyToCents(String(cost ?? '').trim() || '0');
  if (amountCents === null || amountCents <= 0 || costCents === null) return null;
  return (amountCents - costCents) / 100;
}

export function resolveIncomeKind(record) {
  if (record?.type !== 'income') return 'pure';
  if (record.income_kind === 'business' || record.income_kind === 'pure') {
    return record.income_kind;
  }
  return Number(record.profit || 0) !== 0 ? 'business' : 'pure';
}

export function restoreBusinessCost(record) {
  if (resolveIncomeKind(record) !== 'business') return '';
  const amount = Number(record.amount);
  const profit = Number(record.profit || 0);
  if (!Number.isFinite(amount) || !Number.isFinite(profit)) return '';
  // Stored profit also lets older records recover their cost when edited.
  return ((Math.round(amount * 100) - Math.round(profit * 100)) / 100).toFixed(2);
}
