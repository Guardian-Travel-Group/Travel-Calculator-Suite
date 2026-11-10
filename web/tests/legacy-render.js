/*!
 * legacy-render.js - renders the web port's structured results back into the
 * EXACT HTML strings the HTA produced, so parity can be asserted on the full
 * staff-visible output (every summary row, line item, note and error message)
 * rather than on a handful of numbers.
 *
 * Test-only. The shipped UI builds real DOM nodes instead (see app.js).
 */
'use strict';

var TCSCalc = require('../assets/js/calc.js');
var formatMoney = TCSCalc.formatMoney;

function summaryRows(rows) {
  return rows.map(function (row) {
    return '<div class="summaryRow"><strong>' + row.label + ':</strong> ' + row.value + '</div>';
  }).join('');
}

/* [HTA 466-500] */
function renderPayments(raw) {
  var res = TCSCalc.computePayments(raw);
  if (!res.ok) {
    return { error: res.error, summary: '', results: '', totalPaymentsField: String(raw.totalPayments) };
  }

  var results = res.lines.map(function (line) {
    var note = line.adjusted ? ' <span class="adjustedNote">(final adjusted)</span>' : '';
    return '<div class="lineItem"><strong>' + line.label + ':</strong> ' + formatMoney(line.amount) + note + '</div>';
  }).join('');

  /* The HTA writes a clamped count back into the field; replicate that here so
     the comparison covers the visible side effect, not just the numbers. */
  var field = (res.clampedPaymentCount !== null && res.clampedPaymentCount !== undefined)
    ? String(res.clampedPaymentCount)
    : String(raw.totalPayments);

  return { error: '', summary: summaryRows(res.summary), results: results, totalPaymentsField: field };
}

/* [HTA 568-573] */
function renderRefund(raw, now) {
  var res = TCSCalc.computeRefund(raw, now);
  if (!res.ok) return { error: res.error, summary: '', results: '' };

  var results = '';
  results += '<div class="lineItem"><strong>Refund Due:</strong> ' + formatMoney(res.refund) + '</div>';
  if (res.noRefundDue) {
    results += '<div class="lineItem">No refund is due.</div>';
  }
  results += '<div class="lineItem"><strong>Formula used:</strong> ' + res.formula + '</div>';

  return { error: '', summary: summaryRows(res.summary), results: results };
}

/* [HTA 721-746] */
function renderPartialRefund(raw) {
  var res = TCSCalc.computePartialRefund(raw);
  if (!res.ok) {
    return { error: res.error, summary: '', results: '', packageCountField: String(raw.packageCount) };
  }

  var field = (res.clampedPackageCount !== null && res.clampedPackageCount !== undefined)
    ? String(res.clampedPackageCount)
    : String(raw.packageCount);

  var results = '';
  res.packages.forEach(function (pkg) {
    if (!pkg.selected) return;
    results += '<div class="lineItem">';
    results += '<strong>Package ' + pkg.number + '</strong><br />';
    results += 'Package Price: ' + formatMoney(pkg.price) + '<br />';
    results += 'Estimated Paid Toward Package: ' + formatMoney(pkg.allocatedPaid) + '<br />';
    results += 'TPP Non-Refundable: ' + formatMoney(pkg.tpp) + '<br />';
    results += res.nonRefundPercent + '% Non-Refundable: ' + formatMoney(pkg.percentNonRefund) + '<br />';
    results += 'Total Non-Refundable: ' + formatMoney(pkg.nonRefundable) + '<br />';
    results += '<strong>Refund Due: ' + formatMoney(pkg.refund) + '</strong><br />';
    results += '<span class="adjustedNote">Math: ' + formatMoney(pkg.allocatedPaid) + ' - (' + formatMoney(pkg.tpp) + ' + ' + formatMoney(pkg.percentNonRefund) + ') = ' + formatMoney(pkg.refund) + '</span>';
    results += '</div>';
  });

  if (res.selectedCount === 0) {
    results = '<div class="lineItem">' + res.emptySelectionMessage + '</div>';
  } else if (res.selectedCount > 1) {
    results += '<div class="lineItem"><strong>Total Refund Due: ' + formatMoney(res.totalSelectedRefund) + '</strong></div>';
  }

  return { error: '', summary: summaryRows(res.summary), results: results, packageCountField: field };
}

module.exports = {
  renderPayments: renderPayments,
  renderRefund: renderRefund,
  renderPartialRefund: renderPartialRefund
};
