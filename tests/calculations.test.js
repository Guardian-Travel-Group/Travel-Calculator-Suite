const assert = require('assert');
const calc = require('../calculations.js');

function rejected(result, text) {
  assert.strictEqual(result.ok, false);
  assert.ok(result.message.toLowerCase().indexOf(text.toLowerCase()) !== -1, result.message);
}

assert.strictEqual(calc.parseMoneyCents('100.25', 'Amount').cents, 10025);
rejected(calc.parseMoneyCents('100abc', 'Amount'), 'valid dollar amount');
rejected(calc.parseMoneyCents('10.999', 'Amount'), 'valid dollar amount');
rejected(calc.parseMoneyCents('90071992547409.92', 'Amount'), 'too large');
assert.strictEqual(calc.parseMoneyCents('90071992547409.91', 'Amount').ok, true);
assert.strictEqual(calc.parseWholeNumber('6', 'Payments').value, 6);
rejected(calc.parseWholeNumber('2.5', 'Payments'), 'positive whole number');
assert.strictEqual(calc.parsePercentage('20', 'Deposit').value, 20);
rejected(calc.parsePercentage('100.1', 'Deposit'), 'between 0 and 100');

assert.strictEqual(calc.getDepositCents(10000, { type: 'amount', cents: 2500 }).cents, 2500);
rejected(calc.getDepositCents(10000, { type: 'amount', cents: 10001 }), 'cannot exceed');
rejected(calc.validatePaymentScenario(10000, 6000, 3, true), 'cannot exceed');
rejected(calc.validatePaymentScenario(10000, 2000, 1, true), 'at least two');
rejected(calc.validatePaymentScenario(10000, 9999, 2, false), 'too small');
assert.deepStrictEqual(calc.buildScheduleCents(10000, 3), [3333, 3333, 3334]);

rejected(calc.calculateRefundCents(10000, 10000, 0), 'TPP');
rejected(calc.calculateRefundCents(10000, 13001, 3000), 'cannot exceed');
assert.strictEqual(calc.calculateRefundCents(10000, 13000, 3000).refundCents, 8000);
assert.strictEqual(calc.calculateRefundCents(10000, 2000, 3000).refundCents, 0);
assert.strictEqual(calc.calculateRefundCents(10000, 2000, 3000).appliedNonRefundableCents, 2000);

assert.strictEqual(calc.calculateRefundCents(500000, 400000, 20000).refundCents, 280000);

const partial = calc.calculatePartialRefundCents({
  pricesCents: [100000, 200000],
  tppEachCents: 3000,
  nonRefundPercent: 20,
  amountPaidCents: 206000,
  selected: [true, false]
});
assert.strictEqual(partial.ok, true);
assert.deepStrictEqual(partial.allocatedPaidCents, [69666, 136334]);
assert.strictEqual(partial.results[0].refundCents, 46666);
assert.strictEqual(partial.results[1].refundCents, 93334);
rejected(calc.calculatePartialRefundCents({ pricesCents: [10000], tppEachCents: 0, nonRefundPercent: 20, amountPaidCents: 10000 }), 'TPP');
rejected(calc.calculatePartialRefundCents({ pricesCents: [10000], tppEachCents: 1000, nonRefundPercent: 20, amountPaidCents: 12001 }), 'cannot exceed');

rejected(calc.calculatePartialRefundCents({ pricesCents: [9007199254740991, 1], tppEachCents: 1, nonRefundPercent: 20, amountPaidCents: 9007199254740991 }), 'combined package prices');

console.log('calculations.test.js: all tests passed');
