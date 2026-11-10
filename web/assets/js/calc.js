/*!
 * Travel Calculator Suite - calculation core (web build)
 *
 * DIRECT PORT of the calculation logic in the authoritative HTA artifact:
 *   "TCS V5"  ==  "Travel Calculator Suite.hta"  ==  "installer-package/Travel Calculator Suite.hta"
 *   md5 d9304122b4e2d60772545c129b371a9a
 *
 * PORTING RULES OBSERVED (do not "improve" these without a policy decision):
 *   1. Function names, order, operation order and rounding points mirror the HTA
 *      one-for-one so this file stays easy to diff against the original.
 *   2. The HTA's *inconsistent* input parsing is preserved deliberately:
 *        - Payment Calculator  -> parseFloat / parseInt  (permissive, prefix parsing)
 *        - Refund Calculator   -> parseFloat             (permissive, prefix parsing)
 *        - Partial Refunds     -> parseMoney (strict) for TPP / Amount Paid / prices,
 *                                 parseFloat for the non-refundable percentage,
 *                                 parseInt for the package count
 *      Changing any of these would change staff-visible results, so parity wins.
 *      See web/README.md "Known legacy behaviours" before touching this.
 *   3. All validation checks keep their original ORDER and exact message text,
 *      because the first failing check decides which message staff see.
 *   4. Monetary rounding uses the HTA's own helpers (roundMoney / moneyToCents)
 *      at exactly the same points in the arithmetic.
 *
 * HTA line references appear as [HTA NNN] against each ported block.
 *
 * This module is pure: no DOM access, no globals, no I/O. It runs unchanged in
 * the browser (window.TCSCalc) and in Node (module.exports) for parity tests.
 */
;(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
  } else {
    root.TCSCalc = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ----------------------------------------------------------------------
   * Shared helpers - ported verbatim from [HTA 260-309]
   * -------------------------------------------------------------------- */

  /* [HTA 261] */
  function roundToDollar(value) { return Math.round(value); }

  /* [HTA 262] */
  function roundMoney(value) { return Math.round(value * 100) / 100; }

  /* [HTA 263] */
  function formatMoney(value) { return "$" + roundMoney(value).toFixed(2); }

  /* [HTA 265-274]
     Accept common currency entry styles without losing the decimal point.
     Examples: 4923.00, 4,923.00, $4,923.00 */
  function parseMoney(value) {
    var text = String(value == null ? "" : value);
    text = text.replace(/\s/g, "");
    text = text.replace(/\$/g, "");
    text = text.replace(/,/g, "");
    if (text === "" || !/^-?\d*(\.\d{0,2})?$/.test(text) || text === "." || text === "-" || text === "-.") return NaN;
    return parseFloat(text);
  }

  /* [HTA 275-280] */
  function formatSignedMoney(value) {
    var amount = roundMoney(value);
    if (amount > 0) return "+" + formatMoney(amount);
    if (amount < 0) return "-" + formatMoney(Math.abs(amount));
    return "$0.00";
  }

  /* [HTA 281-283] */
  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* [HTA 284] */
  function moneyToCents(value) { return Math.round(value * 100); }

  /* [HTA 285] */
  function centsToMoney(value) { return value / 100; }

  /* [HTA 286-309]
     Even payments in whole cents, with the rounding drift pushed into the
     FINAL payment so the schedule always sums to the balance exactly.
     paymentCount === 0 yields an empty schedule (reachable when Payment 1
     matches the deposit and the total payment count is 1). */
  function buildFinalAdjustedSchedule(balance, paymentCount) {
    var payments = [];
    var totalCents = moneyToCents(balance);
    var regularCents = paymentCount > 0 ? Math.round(totalCents / paymentCount) : 0;
    var usedCents = 0;
    var finalCents = 0;
    var i = 0;

    for (i = 0; i < paymentCount; i++) {
      var paymentCents = regularCents;
      if (i === paymentCount - 1) paymentCents = totalCents - usedCents;
      payments.push(centsToMoney(paymentCents));
      usedCents += paymentCents;
      finalCents = paymentCents;
    }

    return {
      payments: payments,
      regular: centsToMoney(regularCents),
      final: centsToMoney(finalCents),
      adjustment: centsToMoney(finalCents - regularCents),
      total: centsToMoney(totalCents)
    };
  }

  /* ----------------------------------------------------------------------
   * 1) Payment Calculator
   * -------------------------------------------------------------------- */

  /* [HTA 390-415] getDepositAmount().
     NOTE: the HTA reads the deposit fields with parseFloat, so "20abc" parses
     as 20. Preserved. */
  function getDepositAmount(packagePrice, raw) {
    var depositType = raw.depositType;
    var depositPercent = parseFloat(raw.depositPercent);
    var depositAmountInput = parseFloat(raw.depositAmount);

    if (depositType === "percent") {
      if (isNaN(depositPercent)) return { ok: false, message: "Please enter a valid deposit percentage." };
      if (depositPercent < 0) return { ok: false, message: "Deposit percentage cannot be negative." };
      return {
        ok: true,
        amount: roundToDollar(packagePrice * (depositPercent / 100)),
        label: "Deposit percentage",
        valueText: depositPercent + "%"
      };
    }

    if (isNaN(depositAmountInput)) return { ok: false, message: "Please enter a valid deposit dollar amount." };
    if (depositAmountInput < 0) return { ok: false, message: "Deposit amount cannot be negative." };

    return {
      ok: true,
      amount: roundToDollar(depositAmountInput),
      label: "Deposit amount",
      valueText: formatMoney(roundToDollar(depositAmountInput)) + " (rounded to nearest dollar)"
    };
  }

  /* [HTA 424-517] calculatePayments().
     Input: raw strings exactly as they come off the form controls.
     Output: { ok:false, error } or a structured result for the renderer. */
  function computePayments(raw) {
    var packagePrice = parseFloat(raw.packagePrice);
    var totalPayments = parseInt(raw.totalPayments, 10);
    var firstMatches = raw.firstMatchesDeposit === "yes";

    /* [HTA 433-447] validation order is load-bearing */
    if (isNaN(packagePrice) || isNaN(totalPayments)) {
      return { ok: false, error: "Please enter valid numbers." };
    }
    if (packagePrice < 0) {
      return { ok: false, error: "Package price cannot be negative." };
    }
    if (totalPayments < 1) {
      return { ok: false, error: "Number of payments must be at least 1." };
    }

    var depositInfo = getDepositAmount(packagePrice, raw);
    if (!depositInfo.ok) {
      return { ok: false, error: depositInfo.message };
    }

    var deposit = depositInfo.amount;
    var summary = [];
    var lines = [];
    var remainder = 0;
    var eachPayment = 0;
    var remainingCount = 0;
    var i = 0;
    var schedule = null;

    /* [HTA 466] deposit line always first */
    lines.push({ label: "Deposit", amount: deposit, adjusted: false });

    if (firstMatches) {
      /* [HTA 468-491] */
      var firstPayment = deposit;
      lines.push({ label: "Payment 1", amount: firstPayment, adjusted: false });

      remainder = roundMoney(packagePrice - deposit - firstPayment);
      remainingCount = totalPayments - 1;
      schedule = buildFinalAdjustedSchedule(remainder, remainingCount);
      eachPayment = schedule.regular;

      for (i = 0; i < remainingCount; i++) {
        lines.push({
          label: "Payment " + (i + 2),
          amount: schedule.payments[i],
          adjusted: (i === remainingCount - 1 && schedule.adjustment !== 0)
        });
      }

      summary.push({ label: depositInfo.label, value: depositInfo.valueText });
      summary.push({ label: "Deposit used", value: formatMoney(deposit) });
      summary.push({ label: "Payment 1 matches deposit", value: "Yes" });
      summary.push({ label: "Remaining balance after deposit and Payment 1", value: formatMoney(remainder) });
      summary.push({ label: "Remaining payments after Payment 1", value: String(remainingCount) });
      summary.push({ label: "Regular remaining payment", value: formatMoney(eachPayment) });
      if (remainingCount > 0 && schedule.adjustment !== 0) {
        summary.push({ label: "Final payment adjustment", value: formatSignedMoney(schedule.adjustment) });
        summary.push({ label: "Final remaining payment", value: formatMoney(schedule.final) });
      }
    } else {
      /* [HTA 492-512] */
      remainder = roundMoney(packagePrice - deposit);
      schedule = buildFinalAdjustedSchedule(remainder, totalPayments);
      eachPayment = schedule.regular;

      for (i = 0; i < totalPayments; i++) {
        lines.push({
          label: "Payment " + (i + 1),
          amount: schedule.payments[i],
          adjusted: (i === totalPayments - 1 && schedule.adjustment !== 0)
        });
      }

      summary.push({ label: depositInfo.label, value: depositInfo.valueText });
      summary.push({ label: "Deposit used", value: formatMoney(deposit) });
      summary.push({ label: "Payment 1 matches deposit", value: "No" });
      summary.push({ label: "Remaining balance after deposit", value: formatMoney(remainder) });
      summary.push({ label: "Number of even payments", value: String(totalPayments) });
      summary.push({ label: "Regular payment", value: formatMoney(eachPayment) });
      if (schedule.adjustment !== 0) {
        summary.push({ label: "Final payment adjustment", value: formatSignedMoney(schedule.adjustment) });
        summary.push({ label: "Final payment", value: formatMoney(schedule.final) });
      }
    }

    return {
      ok: true,
      firstMatches: firstMatches,
      deposit: deposit,
      depositLabel: depositInfo.label,
      depositValueText: depositInfo.valueText,
      remainder: remainder,
      paymentCount: firstMatches ? remainingCount : totalPayments,
      regular: eachPayment,
      schedule: schedule,
      summary: summary,
      lines: lines
    };
  }

  /* [HTA 519-527] resetPayments() defaults */
  var PAYMENT_DEFAULTS = {
    packagePrice: "2500",
    depositType: "percent",
    depositPercent: "20",
    depositAmount: "500",
    totalPayments: "6",
    firstMatchesDeposit: "yes"
  };

  /* ----------------------------------------------------------------------
   * 2) Refund Calculator
   * -------------------------------------------------------------------- */

  /* The 20% non-refundable share is hard-coded in the HTA refund tab. */
  var REFUND_NONREFUNDABLE_RATE = 0.20;

  /* [HTA 552-558] timestamp helper, local time, zero padded */
  function formatStamp(now) {
    return now.getFullYear() + "-" +
      ("0" + (now.getMonth() + 1)).slice(-2) + "-" +
      ("0" + now.getDate()).slice(-2) + " " +
      ("0" + now.getHours()).slice(-2) + ":" +
      ("0" + now.getMinutes()).slice(-2) + ":" +
      ("0" + now.getSeconds()).slice(-2);
  }

  /* [HTA 529-578] calculateRefund().
     Formula: Amount Paid - (TPP + 20% of Package Cost), floored at zero.
     `now` is injectable only so tests can freeze the clock; the app passes
     nothing and gets new Date() exactly like the HTA. */
  function computeRefund(raw, now) {
    var totalCost = parseFloat(raw.totalCost);
    var amountPaid = parseFloat(raw.amountPaid);
    var tpp = parseFloat(raw.tpp);

    /* [HTA 538-547] */
    if (isNaN(totalCost) || isNaN(amountPaid) || isNaN(tpp)) {
      return { ok: false, error: "Please enter valid non-negative numbers." };
    }
    if (totalCost < 0 || amountPaid < 0 || tpp < 0) {
      return { ok: false, error: "Negative values are not allowed." };
    }

    var twentyPercent = roundMoney(totalCost * REFUND_NONREFUNDABLE_RATE);
    var nonRefundable = roundMoney(tpp + twentyPercent);
    var refund = roundMoney(Math.max(amountPaid - nonRefundable, 0));
    var stamp = formatStamp(now || new Date());

    var summary = [];
    summary.push({ label: "Calculation time", value: stamp });
    summary.push({ label: "Total Package Cost", value: formatMoney(totalCost) });
    summary.push({ label: "Amount Paid", value: formatMoney(amountPaid) });
    summary.push({ label: "TPP", value: formatMoney(tpp) });
    summary.push({ label: "20% of Package Cost", value: formatMoney(twentyPercent) });
    summary.push({ label: "Non-Refundable (TPP + 20%)", value: formatMoney(nonRefundable) });

    return {
      ok: true,
      stamp: stamp,
      totalCost: totalCost,
      amountPaid: amountPaid,
      tpp: tpp,
      twentyPercent: twentyPercent,
      nonRefundable: nonRefundable,
      refund: refund,
      noRefundDue: (refund === 0),
      formula: "Amount Paid - (TPP + 20% of Package Cost)",
      summary: summary
    };
  }

  /* ----------------------------------------------------------------------
   * 3) Partial Package Refunds
   * -------------------------------------------------------------------- */

  /* [HTA 604-607] the package-count clamp lives in the input builder */
  var PARTIAL_MAX_PACKAGES = 50;

  /* [HTA 625-751] calculatePartialRefund().
     raw = { packageCount, tpp, nonRefundPercent, amountPaid,
             packages: [{ price: "<string>", selected: <bool> }, ...] }

     Allocation policy (comment preserved from [HTA 687-690]):
       The receipt does not split Amount Paid by package. TPP is treated as
       paid first. Any amount above total TPP is allocated proportionally by
       package price. Each package is calculated independently from the same
       formula so two packages with the same price always receive the same
       estimated paid amount/refund. */
  function computePartialRefund(raw) {
    var count = parseInt(raw.packageCount, 10);
    var tppEach = parseMoney(raw.tpp);
    var nonRefundPercent = parseFloat(raw.nonRefundPercent);
    var amountPaid = parseMoney(raw.amountPaid);
    var entries = raw.packages || [];
    var prices = [];
    var selected = [];
    var allocatedPaid = [];
    var totalPackagePrice = 0;
    var totalTpp = 0;
    var tripValue = 0;
    var totalSelectedRefund = 0;
    var selectedCount = 0;
    var summary = [];
    var i = 0;

    /* [HTA 646-660] validation order is load-bearing */
    if (isNaN(count) || count < 1 || isNaN(tppEach) || isNaN(nonRefundPercent) || isNaN(amountPaid)) {
      return { ok: false, error: "Please complete the package count, TPP, non-refundable percentage, amount paid, and all package prices." };
    }
    if (tppEach < 0 || nonRefundPercent < 0 || amountPaid < 0) {
      return { ok: false, error: "Negative values are not allowed." };
    }
    if (nonRefundPercent > 100) {
      return { ok: false, error: "Non-refundable percentage cannot be greater than 100%." };
    }

    /* [HTA 662-675]
       Mirrors the HTA's 1-based scan over the generated price inputs. A missing
       entry is SKIPPED (the HTA's `if (!priceInput) continue;`), which is why
       prices.length can be smaller than count.
       NOTE: totalPackagePrice accumulates the UNROUNDED price while prices[]
       stores the rounded price - preserved exactly. */
    for (i = 1; i <= count; i++) {
      var entry = entries[i - 1];
      if (!entry) continue;
      var price = parseMoney(entry.price);
      if (isNaN(price) || price < 0) {
        return { ok: false, error: "Please enter a valid price for Package " + i + " (for example 4923.00 or 4,923.00)." };
      }
      prices.push(roundMoney(price));
      selected.push(!!entry.selected);
      totalPackagePrice += price;
    }

    /* [HTA 677-679] */
    totalPackagePrice = roundMoney(totalPackagePrice);
    totalTpp = roundMoney(tppEach * count);
    tripValue = roundMoney(totalPackagePrice + totalTpp);

    /* [HTA 681-685] */
    if (amountPaid > tripValue) {
      return { ok: false, error: "Amount Paid cannot be greater than the total trip value (package prices + TPP)." };
    }

    /* [HTA 691-708] allocation in whole cents */
    var amountPaidCents = moneyToCents(amountPaid);
    var totalTppCents = moneyToCents(totalTpp);
    var packagePoolCents = Math.max(amountPaidCents - totalTppCents, 0);

    if (amountPaidCents < totalTppCents) {
      var partialTppPerPackage = roundMoney(amountPaid / count);
      for (i = 0; i < count; i++) {
        allocatedPaid.push(partialTppPerPackage);
      }
    } else {
      for (i = 0; i < count; i++) {
        var packageShare = 0;
        if (totalPackagePrice > 0) {
          packageShare = centsToMoney(packagePoolCents) * (prices[i] / totalPackagePrice);
        }
        allocatedPaid.push(roundMoney(tppEach + packageShare));
      }
    }

    /* [HTA 710-719] */
    summary.push({ label: "Number of Packages", value: String(count) });
    summary.push({ label: "Total Package Price", value: formatMoney(totalPackagePrice) });
    summary.push({ label: "TPP Per Package", value: formatMoney(tppEach) });
    summary.push({ label: "Total TPP", value: formatMoney(totalTpp) });
    summary.push({ label: "Amount Paid", value: formatMoney(amountPaid) });
    summary.push({ label: "Non-Refundable Percentage", value: nonRefundPercent + "% per package" });
    summary.push({ label: "Payment Allocation", value: "TPP first, then remaining paid amount proportionally by package price" });
    var showAllocatedRow = (amountPaidCents >= totalTppCents);
    if (showAllocatedRow) {
      summary.push({ label: "Paid Amount Allocated to Package Prices", value: formatMoney(centsToMoney(packagePoolCents)) });
    }

    /* [HTA 721-746] per-package independent calculation */
    var packages = [];
    for (i = 0; i < prices.length; i++) {
      var percentNonRefund = roundMoney(prices[i] * (nonRefundPercent / 100));
      var nonRefundable = roundMoney(tppEach + percentNonRefund);
      var refund = roundMoney(Math.max(allocatedPaid[i] - nonRefundable, 0));

      packages.push({
        number: i + 1,
        price: prices[i],
        allocatedPaid: allocatedPaid[i],
        tpp: tppEach,
        percentNonRefund: percentNonRefund,
        nonRefundable: nonRefundable,
        refund: refund,
        selected: !!selected[i]
      });

      if (selected[i]) {
        totalSelectedRefund = roundMoney(totalSelectedRefund + refund);
        selectedCount++;
      }
    }

    return {
      ok: true,
      count: count,
      tppEach: tppEach,
      nonRefundPercent: nonRefundPercent,
      amountPaid: amountPaid,
      totalPackagePrice: totalPackagePrice,
      totalTpp: totalTpp,
      tripValue: tripValue,
      packagePool: centsToMoney(packagePoolCents),
      showAllocatedRow: showAllocatedRow,
      packages: packages,
      selectedCount: selectedCount,
      totalSelectedRefund: totalSelectedRefund,
      emptySelectionMessage: "Check the package you want to refund to see its result.",
      summary: summary
    };
  }

  /* [HTA 753-762] resetPartialRefund() defaults */
  var PARTIAL_DEFAULTS = {
    packageCount: "5",
    tpp: "481",
    nonRefundPercent: "20",
    amountPaid: ""
  };

  return {
    /* helpers */
    roundToDollar: roundToDollar,
    roundMoney: roundMoney,
    formatMoney: formatMoney,
    formatSignedMoney: formatSignedMoney,
    parseMoney: parseMoney,
    escapeHtml: escapeHtml,
    moneyToCents: moneyToCents,
    centsToMoney: centsToMoney,
    buildFinalAdjustedSchedule: buildFinalAdjustedSchedule,
    formatStamp: formatStamp,
    /* calculators */
    getDepositAmount: getDepositAmount,
    computePayments: computePayments,
    computeRefund: computeRefund,
    computePartialRefund: computePartialRefund,
    /* constants */
    PAYMENT_DEFAULTS: PAYMENT_DEFAULTS,
    PARTIAL_DEFAULTS: PARTIAL_DEFAULTS,
    PARTIAL_MAX_PACKAGES: PARTIAL_MAX_PACKAGES,
    REFUND_NONREFUNDABLE_RATE: REFUND_NONREFUNDABLE_RATE
  };
}));
