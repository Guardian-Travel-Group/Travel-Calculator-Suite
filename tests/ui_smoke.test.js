const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const calculations = require('../calculations.js');

const htaPath = path.join(__dirname, '..', 'TCS V5');
const source = fs.readFileSync(htaPath, 'utf8');
const inlineScript = source.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/i)[1];
const ids = [
  'darkMode', 'paymentsTab', 'refundTab', 'partialRefundTab', 'paymentsTabBtn', 'refundTabBtn', 'partialRefundTabBtn',
  'leftCol1', 'rightCol1', 'summaryPanel1', 'resultsPanel1', 'resultsBox1',
  'leftCol2', 'rightCol2', 'summaryPanel2', 'resultsPanel2', 'resultsBox2',
  'leftCol3', 'rightCol3', 'summaryPanel3', 'resultsPanel3', 'resultsBox3',
  'packagePrice', 'depositType', 'depositPercent', 'depositAmount', 'totalPayments', 'firstMatchesDeposit', 'errorBox1', 'summaryBox1',
  'refundTotalCost', 'refundAmountPaid', 'refundTpp', 'errorBox2', 'summaryBox2',
  'partialPackageCount', 'partialTpp', 'partialNonRefundPercent', 'partialAmountPaid', 'partialPackageInputs', 'errorBox3', 'summaryBox3'
];
const elements = {};
ids.forEach((id) => { elements[id] = { id, value: '', innerHTML: '', className: '', checked: false, style: {} }; });
elements.darkMode.checked = false;
elements.packagePrice.value = '2500';
elements.depositType.value = 'percent';
elements.depositPercent.value = '20';
elements.depositAmount.value = '500';
elements.totalPayments.value = '6';
elements.firstMatchesDeposit.value = 'yes';
elements.partialPackageCount.value = '2';
elements.partialTpp.value = '30';
elements.partialNonRefundPercent.value = '20';
elements.partialAmountPaid.value = '2060';
const documentMock = {
  body: { className: '', currentStyle: { fontSize: '16px' } },
  documentElement: { participantWidth: 900, participantHeight: 700 },
  getElementById(id) { return elements[id]; }
};
const context = { document: documentMock, window: {}, TCSCalculations: calculations, Math, Date, parseFloat, parseInt, isFinite, String };
vm.runInNewContext(inlineScript, context, { filename: htaPath });

context.calculatePayments();
assert.ok(elements.summaryBox1.innerHTML.indexOf('$2500.00') !== -1);

elements.packagePrice.value = '100';
elements.depositType.value = 'amount';
elements.depositAmount.value = '120';
elements.totalPayments.value = '3';
context.calculatePayments();
assert.ok(elements.errorBox1.innerHTML.indexOf('cannot exceed') !== -1);

context.showTab('refund');
elements.refundTotalCost.value = '100';
elements.refundAmountPaid.value = '130';
elements.refundTpp.value = '30';
context.calculateRefund();
assert.ok(elements.resultsBox2.innerHTML.indexOf('$80.00') !== -1);

elements.refundAmountPaid.value = '20';
context.calculateRefund();
assert.ok(elements.resultsBox2.innerHTML.indexOf('$0.00') !== -1);
assert.ok(elements.resultsBox2.innerHTML.indexOf('$20.00 of $50.00 required') !== -1);

context.showTab('partialRefund');
context.updatePartialPackageInputs();
elements.partialPackagePrice1 = { value: '1000', innerHTML: '', style: {}, checked: false };
elements.partialPackagePrice2 = { value: '2000', innerHTML: '', style: {}, checked: false };
elements.partialPackageCancel1 = { value: '', innerHTML: '', style: {}, checked: true };
elements.partialPackageCancel2 = { value: '', innerHTML: '', style: {}, checked: false };
context.calculatePartialRefund();
assert.ok(elements.resultsBox3.innerHTML.indexOf('Package 1') !== -1);
assert.ok(elements.resultsBox3.innerHTML.indexOf('Refund Due: $466.66') !== -1);
assert.ok(elements.resultsBox3.innerHTML.indexOf('Package 2') === -1);

console.log('ui_smoke.test.js: all tests passed');
