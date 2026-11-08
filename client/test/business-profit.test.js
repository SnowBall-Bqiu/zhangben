import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBusinessProfit, moneyToCents, resolveIncomeKind, restoreBusinessCost } from '../src/utils/business-profit.js';

test('business profit subtracts cost exactly to cents, including break-even and losses', () => {
  assert.equal(calculateBusinessProfit('1000', '650'), 350);
  assert.equal(calculateBusinessProfit('0.30', '0.10'), 0.2);
  assert.equal(calculateBusinessProfit('0.29', '0.28'), 0.01);
  assert.equal(calculateBusinessProfit('100', '100'), 0);
  assert.equal(calculateBusinessProfit('100', '120'), -20);
  assert.equal(calculateBusinessProfit('100', ''), 100);
  assert.equal(calculateBusinessProfit('100', '0'), 100);
});

test('invalid or excessive monetary inputs do not produce a profit preview', () => {
  for (const value of ['-1', '1.001', '1e2', 'Infinity', 'NaN', '1000000000', 'abc']) {
    assert.equal(moneyToCents(value), null);
    assert.equal(calculateBusinessProfit('100', value), null);
    assert.equal(calculateBusinessProfit(value, '1'), null);
  }
  assert.equal(calculateBusinessProfit('', '10'), null);
  assert.equal(calculateBusinessProfit('0', '10'), null);
  assert.equal(moneyToCents('999999999.99'), 99999999999);
});

test('editing existing business records restores cost without losing zero or negative profit', () => {
  for (const [amount, profit, cost] of [[1000, 350, '650.00'], [100, 0, '100.00'], [100, -20, '120.00'], [0.3, 0.2, '0.10']]) {
    const record = { type: 'income', income_kind: 'business', amount, profit };
    assert.equal(restoreBusinessCost(record), cost);
    assert.equal(calculateBusinessProfit(String(amount), cost), profit);
  }
  assert.equal(restoreBusinessCost({ type: 'income', income_kind: 'pure', amount: 100 }), '');
  assert.equal(resolveIncomeKind({ type: 'income', profit: -20 }), 'business');
  assert.equal(resolveIncomeKind({ type: 'expense', profit: 10 }), 'pure');
});
