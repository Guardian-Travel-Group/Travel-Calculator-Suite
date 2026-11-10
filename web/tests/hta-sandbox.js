/*!
 * hta-sandbox.js - loads the ORIGINAL HTA's <script> block into a stubbed
 * IE-ish DOM so its real calculation functions can be executed in Node and
 * diffed against the web port.
 *
 * Nothing here is shipped to the browser. It exists purely so math parity is
 * proven against the actual legacy code rather than against a re-reading of it.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

/* Ids the HTA expects to exist in its own markup. Anything NOT in this list
   (notably the dynamically generated partialPackagePrice* / partialPackageCancel*
   inputs) returns null from getElementById, which faithfully reproduces the
   HTA's `if (!priceInput) continue;` branch. */
var STATIC_IDS = [
  'paymentsTab', 'refundTab', 'partialRefundTab',
  'paymentsTabBtn', 'refundTabBtn', 'partialRefundTabBtn',
  'darkMode',
  'leftCol1', 'rightCol1', 'summaryPanel1', 'resultsPanel1', 'resultsBox1', 'summaryBox1', 'errorBox1',
  'leftCol2', 'rightCol2', 'summaryPanel2', 'resultsPanel2', 'resultsBox2', 'summaryBox2', 'errorBox2',
  'leftCol3', 'rightCol3', 'summaryPanel3', 'resultsPanel3', 'resultsBox3', 'summaryBox3', 'errorBox3',
  'packagePrice', 'depositType', 'depositPercent', 'depositAmount', 'totalPayments',
  'firstMatchesDeposit', 'depositPercentWrap', 'depositAmountWrap',
  'refundTotalCost', 'refundAmountPaid', 'refundTpp',
  'partialPackageCount', 'partialTpp', 'partialNonRefundPercent', 'partialAmountPaid',
  'partialPackageInputs'
];

function makeElement(id) {
  return {
    id: id,
    value: '',
    checked: false,
    innerHTML: '',
    className: '',
    style: {}
  };
}

/* Default frozen clock so the refund tab's "Calculation time" row is
   reproducible on both sides of the comparison. */
var FROZEN_MS = Date.UTC(2026, 4, 17, 13, 45, 7);

function createSandbox(htaPath, options) {
  options = options || {};
  var frozenMs = typeof options.frozenMs === 'number' ? options.frozenMs : FROZEN_MS;

  var source = fs.readFileSync(htaPath, 'utf8');
  var match = source.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('No <script> block found in ' + htaPath);
  var code = match[1];

  var elements = {};
  STATIC_IDS.forEach(function (id) { elements[id] = makeElement(id); });

  var document = {
    getElementById: function (id) {
      return Object.prototype.hasOwnProperty.call(elements, id) ? elements[id] : null;
    },
    documentElement: { clientWidth: 1200, clientHeight: 900, style: {} },
    body: {
      clientWidth: 1200,
      clientHeight: 900,
      className: '',
      style: {},
      currentStyle: { fontSize: '16px' }
    }
  };

  var RealDate = Date;
  function FrozenDate() {
    if (arguments.length === 0) return new RealDate(frozenMs);
    if (arguments.length === 1) return new RealDate(arguments[0]);
    return new RealDate(arguments[0], arguments[1], arguments[2] || 1,
      arguments[3] || 0, arguments[4] || 0, arguments[5] || 0, arguments[6] || 0);
  }
  FrozenDate.now = function () { return frozenMs; };
  FrozenDate.UTC = RealDate.UTC;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.prototype = RealDate.prototype;

  var windowStub = {};
  var context = {
    document: document,
    window: windowStub,
    Date: FrozenDate,
    navigator: { userAgent: 'hta-sandbox' }
  };
  context.self = context;
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(code, context, { filename: path.basename(htaPath) });

  /* Create one dynamic package row the way updatePartialPackageInputs would. */
  function addPackageRow(index, price, selected) {
    var priceEl = makeElement('partialPackagePrice' + index);
    priceEl.value = String(price);
    var cancelEl = makeElement('partialPackageCancel' + index);
    cancelEl.checked = !!selected;
    elements['partialPackagePrice' + index] = priceEl;
    elements['partialPackageCancel' + index] = cancelEl;
  }

  function clearPackageRows() {
    Object.keys(elements).forEach(function (id) {
      if (/^partialPackage(Price|Cancel)\d+$/.test(id)) delete elements[id];
    });
  }

  function set(id, value) {
    var el = document.getElementById(id);
    if (!el) throw new Error('Unknown element id: ' + id);
    el.value = String(value);
  }

  function read(id) {
    var el = document.getElementById(id);
    return el ? el.innerHTML : null;
  }

  /* --- scenario drivers: call the HTA's own functions, return its own HTML --- */

  function runPayments(raw) {
    set('packagePrice', raw.packagePrice);
    set('depositType', raw.depositType);
    set('depositPercent', raw.depositPercent);
    set('depositAmount', raw.depositAmount);
    set('totalPayments', raw.totalPayments);
    set('firstMatchesDeposit', raw.firstMatchesDeposit);
    context.calculatePayments();
    return { error: read('errorBox1'), summary: read('summaryBox1'), results: read('resultsBox1') };
  }

  function runRefund(raw) {
    set('refundTotalCost', raw.totalCost);
    set('refundAmountPaid', raw.amountPaid);
    set('refundTpp', raw.tpp);
    context.calculateRefund();
    return { error: read('errorBox2'), summary: read('summaryBox2'), results: read('resultsBox2') };
  }

  function runPartialRefund(raw) {
    clearPackageRows();
    set('partialPackageCount', raw.packageCount);
    set('partialTpp', raw.tpp);
    set('partialNonRefundPercent', raw.nonRefundPercent);
    set('partialAmountPaid', raw.amountPaid);
    (raw.packages || []).forEach(function (pkg, idx) {
      if (pkg === null || pkg === undefined) return; /* reproduce a missing row */
      addPackageRow(idx + 1, pkg.price, pkg.selected);
    });
    context.calculatePartialRefund();
    return { error: read('errorBox3'), summary: read('summaryBox3'), results: read('resultsBox3') };
  }

  return {
    context: context,
    frozenMs: frozenMs,
    runPayments: runPayments,
    runRefund: runRefund,
    runPartialRefund: runPartialRefund
  };
}

module.exports = { createSandbox: createSandbox, FROZEN_MS: FROZEN_MS };
