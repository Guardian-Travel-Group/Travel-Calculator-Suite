/*!
 * parity.test.js - proves the web port reproduces the HTA byte-for-byte.
 *
 * Strategy: for every scenario, run the ORIGINAL HTA code (via hta-sandbox)
 * and the PORTED code (via legacy-render), then assert the resulting
 * error/summary/results HTML strings are identical. Any divergence in a
 * number, a rounding step, a message, or even a label is a failure.
 *
 * Run: node web/tests/parity.test.js
 */
'use strict';

var path = require('path');
var assert = require('assert');
var sandboxLib = require('./hta-sandbox.js');
var legacy = require('./legacy-render.js');
var TCSCalc = require('../assets/js/calc.js');

var HTA_PATH = path.resolve(__dirname, '..', '..', 'TCS V5');
var sandbox = sandboxLib.createSandbox(HTA_PATH);

var passed = 0;
var failed = 0;
var failures = [];

function compare(kind, name, htaOut, portOut) {
  var fields = ['error', 'summary', 'results'];
  var mismatches = [];
  fields.forEach(function (f) {
    var a = htaOut[f] == null ? '' : String(htaOut[f]);
    var b = portOut[f] == null ? '' : String(portOut[f]);
    if (a !== b) mismatches.push({ field: f, hta: a, port: b });
  });

  if (mismatches.length === 0) {
    passed++;
    return;
  }
  failed++;
  failures.push({ kind: kind, name: name, mismatches: mismatches });
}

function checkPayments(name, raw) {
  compare('payments', name, sandbox.runPayments(raw), legacy.renderPayments(raw));
}
function checkRefund(name, raw) {
  compare('refund', name, sandbox.runRefund(raw), legacy.renderRefund(raw, new Date(sandbox.frozenMs)));
}
function checkPartial(name, raw) {
  compare('partialRefund', name, sandbox.runPartialRefund(raw), legacy.renderPartialRefund(raw));
}

function payRaw(over) {
  var base = {
    packagePrice: '2500', depositType: 'percent', depositPercent: '20',
    depositAmount: '500', totalPayments: '6', firstMatchesDeposit: 'yes'
  };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}

/* =====================================================================
 * 1) PAYMENT CALCULATOR
 * =================================================================== */

/* Defaults and the headline happy path */
checkPayments('defaults 2500/20%/6/yes', payRaw());
checkPayments('defaults, first does not match', payRaw({ firstMatchesDeposit: 'no' }));

/* Cent-adjustment stress: balances that do not divide evenly.
   e.g. 3 payments over a balance ending in .01 forces the final payment to absorb drift. */
var centStress = [
  ['2500', '3'], ['2500', '7'], ['1000', '3'], ['1000', '6'], ['1000', '7'],
  ['999.99', '3'], ['0.01', '3'], ['0.02', '3'], ['0.03', '3'], ['100.01', '3'],
  ['1234.56', '7'], ['4923.00', '9'], ['5000', '11'], ['3333.33', '3'],
  ['9999.99', '13'], ['7777.77', '6'], ['0.07', '7'], ['10.10', '3'],
  ['2500.005', '3'], ['1.005', '3'], ['8888.88', '17'], ['250.25', '4']
];
centStress.forEach(function (c) {
  checkPayments('cent-stress price=' + c[0] + ' n=' + c[1] + ' match=yes',
    payRaw({ packagePrice: c[0], totalPayments: c[1] }));
  checkPayments('cent-stress price=' + c[0] + ' n=' + c[1] + ' match=no',
    payRaw({ packagePrice: c[0], totalPayments: c[1], firstMatchesDeposit: 'no' }));
});

/* Payment-count boundaries, including the n=1 + firstMatches case where the
   remaining schedule is empty (paymentCount === 0). */
['1', '2', '3', '12', '24', '36', '60'].forEach(function (n) {
  checkPayments('n=' + n + ' match=yes', payRaw({ totalPayments: n }));
  checkPayments('n=' + n + ' match=no', payRaw({ totalPayments: n, firstMatchesDeposit: 'no' }));
});

/* Invalid payment counts */
['0', '-1', '-5', '', 'abc', 'NaN'].forEach(function (n) {
  checkPayments('invalid n="' + n + '"', payRaw({ totalPayments: n }));
});

/* Fractional payment counts - parseInt truncates. Covered because staff can type them. */
['6.7', '3.2', '1.9', '0.5'].forEach(function (n) {
  checkPayments('fractional n="' + n + '"', payRaw({ totalPayments: n }));
});

/* Negative and malformed prices */
['-1', '-0.01', '-2500', '', 'abc', '$', '.', '-'].forEach(function (p) {
  checkPayments('invalid price="' + p + '"', payRaw({ packagePrice: p }));
});

/* Permissive parseFloat prefix behaviour, preserved from the HTA */
['2500abc', '25 00', '2,500', '$2500', '2500.555', '1e3', '0x10', ' 2500 ', '+2500', '.5'].forEach(function (p) {
  checkPayments('loose price="' + p + '"', payRaw({ packagePrice: p }));
});

/* Deposit: percentage mode */
['0', '20', '25', '33.33', '50', '100', '150', '0.5', '7.77'].forEach(function (d) {
  checkPayments('depositPercent=' + d, payRaw({ depositPercent: d }));
  checkPayments('depositPercent=' + d + ' match=no', payRaw({ depositPercent: d, firstMatchesDeposit: 'no' }));
});
['-1', '-0.01', '', 'abc'].forEach(function (d) {
  checkPayments('invalid depositPercent="' + d + '"', payRaw({ depositPercent: d }));
});

/* Deposit: dollar mode, including the rounding-to-dollar note text */
['0', '500', '500.49', '500.50', '500.51', '499.999', '2500', '3000', '1234.56'].forEach(function (d) {
  checkPayments('depositAmount=' + d, payRaw({ depositType: 'amount', depositAmount: d }));
  checkPayments('depositAmount=' + d + ' match=no', payRaw({ depositType: 'amount', depositAmount: d, firstMatchesDeposit: 'no' }));
});
['-1', '-0.01', '', 'abc'].forEach(function (d) {
  checkPayments('invalid depositAmount="' + d + '"', payRaw({ depositType: 'amount', depositAmount: d }));
});

/* Over-deposit: deposit >= price drives negative remainders. The HTA does NOT
   block this, so the port must reproduce the same negative schedule. */
checkPayments('over-deposit percent 150%', payRaw({ depositPercent: '150' }));
checkPayments('over-deposit amount 3000 on 2500', payRaw({ depositType: 'amount', depositAmount: '3000' }));
checkPayments('over-deposit exact 2500 match=yes', payRaw({ depositType: 'amount', depositAmount: '2500' }));
checkPayments('over-deposit exact 2500 match=no', payRaw({ depositType: 'amount', depositAmount: '2500', firstMatchesDeposit: 'no' }));
checkPayments('deposit 100% match=yes', payRaw({ depositPercent: '100' }));
checkPayments('deposit 100% match=no', payRaw({ depositPercent: '100', firstMatchesDeposit: 'no' }));

/* Zero-value edges */
checkPayments('price 0 match=yes', payRaw({ packagePrice: '0' }));
checkPayments('price 0 match=no', payRaw({ packagePrice: '0', firstMatchesDeposit: 'no' }));
checkPayments('price 0 deposit 0', payRaw({ packagePrice: '0', depositPercent: '0' }));

/* Unknown deposit type falls through to the dollar branch in the HTA */
checkPayments('unknown depositType', payRaw({ depositType: 'weird' }));

/* Large values */
checkPayments('large price', payRaw({ packagePrice: '9999999.99', totalPayments: '23' }));
checkPayments('very large price', payRaw({ packagePrice: '123456789.01', totalPayments: '7' }));

/* =====================================================================
 * 2) REFUND CALCULATOR
 * =================================================================== */

var refundCases = [
  ['typical', { totalCost: '2500', amountPaid: '2000', tpp: '481' }],
  ['exact zero refund', { totalCost: '2500', amountPaid: '981', tpp: '481' }],
  ['one cent above zero', { totalCost: '2500', amountPaid: '981.01', tpp: '481' }],
  ['one cent below zero', { totalCost: '2500', amountPaid: '980.99', tpp: '481' }],
  ['floored at zero', { totalCost: '2500', amountPaid: '100', tpp: '481' }],
  ['all zeros', { totalCost: '0', amountPaid: '0', tpp: '0' }],
  ['zero tpp', { totalCost: '2500', amountPaid: '2500', tpp: '0' }],
  ['zero cost', { totalCost: '0', amountPaid: '500', tpp: '100' }],
  ['paid above cost', { totalCost: '2500', amountPaid: '5000', tpp: '481' }],
  ['rounding .005 up', { totalCost: '1000.05', amountPaid: '500', tpp: '0' }],
  ['rounding odd cents', { totalCost: '4923.33', amountPaid: '3000.77', tpp: '481.19' }],
  ['20% of odd cents', { totalCost: '333.33', amountPaid: '300', tpp: '0' }],
  ['half cent base', { totalCost: '0.05', amountPaid: '1', tpp: '0' }],
  ['tiny values', { totalCost: '0.01', amountPaid: '0.01', tpp: '0.01' }],
  ['large values', { totalCost: '999999.99', amountPaid: '888888.88', tpp: '4810.55' }],
  ['fractional cents input', { totalCost: '2500.004', amountPaid: '2000.006', tpp: '481.005' }]
];
refundCases.forEach(function (c) { checkRefund(c[0], c[1]); });

/* Refund validation: blanks, malformed, negatives */
[
  ['blank all', { totalCost: '', amountPaid: '', tpp: '' }],
  ['blank cost', { totalCost: '', amountPaid: '2000', tpp: '481' }],
  ['blank paid', { totalCost: '2500', amountPaid: '', tpp: '481' }],
  ['blank tpp', { totalCost: '2500', amountPaid: '2000', tpp: '' }],
  ['alpha cost', { totalCost: 'abc', amountPaid: '2000', tpp: '481' }],
  ['negative cost', { totalCost: '-2500', amountPaid: '2000', tpp: '481' }],
  ['negative paid', { totalCost: '2500', amountPaid: '-2000', tpp: '481' }],
  ['negative tpp', { totalCost: '2500', amountPaid: '2000', tpp: '-481' }],
  ['all negative', { totalCost: '-1', amountPaid: '-1', tpp: '-1' }],
  ['dot only', { totalCost: '.', amountPaid: '.', tpp: '.' }]
].forEach(function (c) { checkRefund('invalid ' + c[0], c[1]); });

/* The refund tab uses parseFloat, so comma/dollar formats parse loosely.
   This documents and locks that legacy behaviour. */
[
  ['comma cost', { totalCost: '2,500', amountPaid: '2000', tpp: '481' }],
  ['dollar cost', { totalCost: '$2500', amountPaid: '2000', tpp: '481' }],
  ['trailing text', { totalCost: '2500usd', amountPaid: '2000', tpp: '481' }],
  ['spaced', { totalCost: ' 2500 ', amountPaid: ' 2000 ', tpp: ' 481 ' }]
].forEach(function (c) { checkRefund('loose ' + c[0], c[1]); });

/* =====================================================================
 * 3) PARTIAL PACKAGE REFUNDS
 * =================================================================== */

function pkgs(list) {
  return list.map(function (p) {
    return Array.isArray(p) ? { price: String(p[0]), selected: !!p[1] } : { price: String(p), selected: false };
  });
}

function partialRaw(over) {
  var base = { packageCount: '5', tpp: '481', nonRefundPercent: '20', amountPaid: '', packages: [] };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}

/* Realistic receipt: 5 equal packages, part paid */
checkPartial('5 equal packages, one selected', partialRaw({
  packageCount: '5', amountPaid: '10000',
  packages: pkgs([['4923.00', true], '4923.00', '4923.00', '4923.00', '4923.00'])
}));

/* Equal prices must yield identical allocations - the stated policy intent */
checkPartial('equal prices identical results', partialRaw({
  packageCount: '3', amountPaid: '6000',
  packages: pkgs([['1000', true], ['1000', true], ['1000', true]])
}));

/* Proportional split across unequal prices */
checkPartial('unequal proportional', partialRaw({
  packageCount: '3', amountPaid: '5000',
  packages: pkgs([['1000', true], ['2000', true], ['3000', true]])
}));

/* Multi-select totals */
checkPartial('two of four selected', partialRaw({
  packageCount: '4', amountPaid: '8000',
  packages: pkgs([['2000', true], '2500', ['3000', true], '1500'])
}));
checkPartial('all selected', partialRaw({
  packageCount: '4', amountPaid: '8000',
  packages: pkgs([['2000', true], ['2500', true], ['3000', true], ['1500', true]])
}));
checkPartial('none selected', partialRaw({
  packageCount: '3', amountPaid: '4000',
  packages: pkgs(['1000', '2000', '3000'])
}));

/* TPP-shortfall branch: paid < total TPP triggers the even per-package split */
checkPartial('paid below total tpp', partialRaw({
  packageCount: '5', amountPaid: '1000',
  packages: pkgs([['4923.00', true], '4923.00', '4923.00', '4923.00', '4923.00'])
}));
checkPartial('paid exactly total tpp', partialRaw({
  packageCount: '5', amountPaid: '2405',
  packages: pkgs([['4923.00', true], '4923.00', '4923.00', '4923.00', '4923.00'])
}));
checkPartial('paid one cent below total tpp', partialRaw({
  packageCount: '5', amountPaid: '2404.99',
  packages: pkgs([['1000', true], '1000', '1000', '1000', '1000'])
}));
checkPartial('paid one cent above total tpp', partialRaw({
  packageCount: '5', amountPaid: '2405.01',
  packages: pkgs([['1000', true], '1000', '1000', '1000', '1000'])
}));
checkPartial('tpp shortfall uneven division', partialRaw({
  packageCount: '3', amountPaid: '1000',
  packages: pkgs([['1000', true], ['1000', true], ['1000', true]])
}));

/* Full payment of the entire trip value */
checkPartial('paid full trip value', partialRaw({
  packageCount: '2', amountPaid: '2962',
  packages: pkgs([['1000', true], ['1000', true]])
}));

/* Over-payment must be rejected at the trip-value guard */
checkPartial('overpaid by one cent', partialRaw({
  packageCount: '2', amountPaid: '2962.01',
  packages: pkgs([['1000', true], ['1000', true]])
}));
checkPartial('wildly overpaid', partialRaw({
  packageCount: '2', amountPaid: '999999',
  packages: pkgs([['1000', true], ['1000', true]])
}));

/* Zero-price packages: totalPackagePrice === 0 guard */
checkPartial('all zero prices', partialRaw({
  packageCount: '2', amountPaid: '962',
  packages: pkgs([['0', true], ['0', true]])
}));
checkPartial('mixed zero price', partialRaw({
  packageCount: '3', amountPaid: '2000',
  packages: pkgs([['0', true], ['1000', true], ['0', true]])
}));
checkPartial('zero tpp zero price', partialRaw({
  packageCount: '2', tpp: '0', amountPaid: '0',
  packages: pkgs([['0', true], ['0', true]])
}));

/* Non-refundable percentage boundaries */
['0', '20', '50', '99.99', '100'].forEach(function (p) {
  checkPartial('nonRefundPercent=' + p, partialRaw({
    packageCount: '2', nonRefundPercent: p, amountPaid: '3000',
    packages: pkgs([['1000', true], ['1000', true]])
  }));
});
['100.01', '101', '1000', '-1', '-0.01', '', 'abc'].forEach(function (p) {
  checkPartial('invalid nonRefundPercent="' + p + '"', partialRaw({
    packageCount: '2', nonRefundPercent: p, amountPaid: '3000',
    packages: pkgs([['1000', true], ['1000', true]])
  }));
});

/* parseMoney strictness on TPP / amount paid / prices - the partial tab's
   strict parser rejects what the other tabs accept. Locked deliberately. */
[
  ['comma price ok', '1,000', '3000'],
  ['dollar price ok', '$1000', '3000'],
  ['dollar comma price ok', '$1,000.00', '3000'],
  ['three decimals rejected', '1000.123', '3000'],
  ['alpha rejected', '1000abc', '3000'],
  ['exponent rejected', '1e3', '3000'],
  ['dot rejected', '.', '3000'],
  ['minus rejected', '-', '3000'],
  ['empty rejected', '', '3000'],
  ['negative rejected', '-1000', '3000']
].forEach(function (c) {
  checkPartial('price parse ' + c[0], partialRaw({
    packageCount: '2', amountPaid: c[2],
    packages: pkgs([[c[1], true], ['1000', true]])
  }));
});
[
  ['comma paid', '3,000'], ['dollar paid', '$3000'], ['three decimals paid', '3000.123'],
  ['alpha paid', '3000abc'], ['empty paid', ''], ['negative paid', '-3000'], ['dot paid', '.']
].forEach(function (c) {
  checkPartial('paid parse ' + c[0], partialRaw({
    packageCount: '2', amountPaid: c[1],
    packages: pkgs([['1000', true], ['1000', true]])
  }));
});
[
  ['comma tpp', '4,81'], ['dollar tpp', '$481'], ['three decimals tpp', '481.123'],
  ['alpha tpp', '481abc'], ['empty tpp', ''], ['negative tpp', '-481']
].forEach(function (c) {
  checkPartial('tpp parse ' + c[0], partialRaw({
    packageCount: '2', tpp: c[1], amountPaid: '3000',
    packages: pkgs([['1000', true], ['1000', true]])
  }));
});

/* Package-count validity and the count/rows mismatch branch
   (fewer rows than count -> HTA skips missing rows via `continue`) */
['0', '-1', '', 'abc'].forEach(function (c) {
  checkPartial('invalid count="' + c + '"', partialRaw({
    packageCount: c, amountPaid: '3000', packages: pkgs([['1000', true]])
  }));
});
checkPartial('count 3 but 2 rows', partialRaw({
  packageCount: '3', amountPaid: '3000',
  packages: pkgs([['1000', true], ['1000', true]])
}));
checkPartial('count 1 single package', partialRaw({
  packageCount: '1', amountPaid: '1481',
  packages: pkgs([['1000', true]])
}));
checkPartial('count 2 with hole in row 1', partialRaw({
  packageCount: '2', amountPaid: '3000', packages: [null, { price: '1000', selected: true }]
}));

/* Rounding stress on allocation: prices that force repeating-decimal shares */
checkPartial('thirds allocation', partialRaw({
  packageCount: '3', amountPaid: '5443',
  packages: pkgs([['1000', true], ['1000', true], ['1000', true]])
}));
checkPartial('sevenths allocation', partialRaw({
  packageCount: '7', amountPaid: '10000',
  packages: pkgs([['1000', true], ['1000', true], ['1000', true], ['1000', true], ['1000', true], ['1000', true], ['1000', true]])
}));
checkPartial('odd cent prices', partialRaw({
  packageCount: '3', amountPaid: '7777.77',
  packages: pkgs([['1234.56', true], ['2345.67', true], ['3456.78', true]])
}));
checkPartial('one cent paid', partialRaw({
  packageCount: '2', amountPaid: '0.01',
  packages: pkgs([['1000', true], ['1000', true]])
}));
checkPartial('large receipt', partialRaw({
  packageCount: '10', amountPaid: '49230',
  packages: pkgs([['4923.00', true], '4923.00', '4923.00', '4923.00', '4923.00',
                  '4923.00', '4923.00', '4923.00', '4923.00', ['4923.00', true]])
}));

/* Many packages, to exercise accumulation drift */
var many = [];
for (var m = 0; m < 25; m++) many.push([String(1000 + m), m % 3 === 0]);
checkPartial('25 packages mixed selection', partialRaw({
  packageCount: '25', amountPaid: '30000', packages: pkgs(many)
}));

/* =====================================================================
 * 4) UNIT-LEVEL INVARIANTS (independent of the HTA comparison)
 * =================================================================== */

var unitPassed = 0;
function unit(name, fn) {
  try {
    fn();
    unitPassed++;
    passed++;
  } catch (e) {
    failed++;
    failures.push({ kind: 'unit', name: name, mismatches: [{ field: 'assert', hta: 'pass', port: e.message }] });
  }
}

/* Schedule must always sum to the balance exactly, in cents. */
unit('schedule sums to balance (cents exact)', function () {
  var balances = [2500, 1000, 999.99, 0.01, 1234.56, 4923, 9999.99, 0.07, 333.33];
  var counts = [1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 17, 23];
  balances.forEach(function (b) {
    counts.forEach(function (n) {
      var s = TCSCalc.buildFinalAdjustedSchedule(b, n);
      var sumCents = s.payments.reduce(function (acc, p) { return acc + TCSCalc.moneyToCents(p); }, 0);
      assert.strictEqual(sumCents, TCSCalc.moneyToCents(b),
        'balance ' + b + ' over ' + n + ' payments summed to ' + sumCents);
    });
  });
});

unit('schedule length equals payment count', function () {
  [1, 2, 6, 12, 36].forEach(function (n) {
    assert.strictEqual(TCSCalc.buildFinalAdjustedSchedule(1000, n).payments.length, n);
  });
});

unit('zero payment count yields empty schedule', function () {
  var s = TCSCalc.buildFinalAdjustedSchedule(1000, 0);
  assert.strictEqual(s.payments.length, 0);
  assert.strictEqual(s.regular, 0);
});

unit('refund never negative', function () {
  [['2500', '0', '481'], ['2500', '100', '5000'], ['0', '0', '0']].forEach(function (c) {
    var r = TCSCalc.computeRefund({ totalCost: c[0], amountPaid: c[1], tpp: c[2] }, new Date(sandbox.frozenMs));
    assert.ok(r.ok && r.refund >= 0, 'refund negative for ' + c.join('/'));
  });
});

unit('partial refunds never negative', function () {
  var r = TCSCalc.computePartialRefund(partialRaw({
    packageCount: '3', amountPaid: '1443',
    packages: pkgs([['5000', true], ['5000', true], ['5000', true]])
  }));
  assert.ok(r.ok, 'expected ok, got: ' + r.error);
  r.packages.forEach(function (p) { assert.ok(p.refund >= 0, 'negative refund'); });
});

unit('equal prices produce equal allocations', function () {
  var r = TCSCalc.computePartialRefund(partialRaw({
    packageCount: '4', amountPaid: '7000',
    packages: pkgs([['2500', true], ['2500', true], ['2500', true], ['2500', true]])
  }));
  assert.ok(r.ok, 'expected ok, got: ' + r.error);
  var first = r.packages[0];
  r.packages.forEach(function (p) {
    assert.strictEqual(p.allocatedPaid, first.allocatedPaid, 'allocation differs for equal prices');
    assert.strictEqual(p.refund, first.refund, 'refund differs for equal prices');
  });
});

unit('refund formula matches policy statement', function () {
  var r = TCSCalc.computeRefund({ totalCost: '2500', amountPaid: '2000', tpp: '481' }, new Date(sandbox.frozenMs));
  assert.strictEqual(r.twentyPercent, 500);
  assert.strictEqual(r.nonRefundable, 981);
  assert.strictEqual(r.refund, 1019);
});

unit('parseMoney strictness', function () {
  assert.ok(isNaN(TCSCalc.parseMoney('1000.123')), '3 decimals should reject');
  assert.ok(isNaN(TCSCalc.parseMoney('1e3')), 'exponent should reject');
  assert.ok(isNaN(TCSCalc.parseMoney('')), 'empty should reject');
  assert.strictEqual(TCSCalc.parseMoney('$4,923.00'), 4923);
  assert.strictEqual(TCSCalc.parseMoney('4923'), 4923);
});

/* =====================================================================
 * Report
 * =================================================================== */

console.log('');
console.log('Travel Calculator Suite - web port parity suite');
console.log('HTA under test: ' + HTA_PATH);
console.log('');

if (failures.length) {
  failures.forEach(function (f) {
    console.log('FAIL [' + f.kind + '] ' + f.name);
    f.mismatches.forEach(function (m) {
      console.log('   field: ' + m.field);
      console.log('     HTA : ' + m.hta);
      console.log('     PORT: ' + m.port);
    });
    console.log('');
  });
}

console.log('scenarios compared against live HTA code: ' + (passed + failed - unitPassed));
console.log('unit invariants: ' + unitPassed);
console.log('PASSED: ' + passed);
console.log('FAILED: ' + failed);
console.log('');

if (failed > 0) {
  console.log('RESULT: PARITY BROKEN');
  process.exit(1);
}
console.log('RESULT: byte-identical parity with the HTA across all scenarios');
process.exit(0);
