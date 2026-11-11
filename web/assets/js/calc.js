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
 *   2. Input parsing is UNIFORM by field type, applied identically in the HTA:
 *        - money fields       -> parseMoney   (strips $ and commas, max 2dp)
 *        - percentage fields  -> parsePercent (no $/commas, unlimited decimals)
 *        - counts             -> parseInt
 *      The HTA originally used bare parseFloat on the Payment and Refund tabs,
 *      so "4,250" silently became 4. That was a defect, fixed in both builds
 *      together. See web/README.md "Money and percentage parsing".
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

  /* [HTA 262-268]
     Upper bounds on user-supplied counts that drive loops and array
     allocation. Without these, a pasted or fat-fingered count hangs or
     crashes the app: 999999999 payments exhausts memory, and a non-finite
     count loops forever. MAX_PAYMENTS is 120 (10 years of monthly payments),
     far beyond any real travel package. MAX_PACKAGES keeps the pre-existing
     50-package ceiling. Both thresholds and the clamp-vs-error behaviour are
     identical to the HTA so parity stays meaningful. */
  var MAX_PAYMENTS = 120;
  var MAX_PACKAGES = 50;

  /* [HTA 270-273]
     isNaN() alone does not reject Infinity, so every numeric field is checked
     with this before it reaches arithmetic, a loop, or an array allocation. */
  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  /* [HTA 275] */
  function roundToDollar(value) { return Math.round(value); }

  /* [HTA 276] */
  function roundMoney(value) { return Math.round(value * 100) / 100; }

  /* [HTA 277] */
  function formatMoney(value) { return "$" + roundMoney(value).toFixed(2); }

  /* [HTA 279-288]
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

  /* [HTA 291-303]
     Percentages are not money: no currency symbol, no thousands separator,
     and more than two decimals is legitimate (33.333%). But parseFloat
     ("150abc") returns 150, the same silent-garbage problem parseMoney fixes
     for dollar fields, so percentages get their own strict parser. */
  function parsePercent(value) {
    var text = String(value == null ? "" : value);
    text = text.replace(/\s/g, "");
    if (text === "" || !/^-?\d*(\.\d*)?$/.test(text) || text === "." || text === "-" || text === "-.") return NaN;
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

  /* [HTA 300-330]
     Even payments in whole cents, with the rounding drift pushed into the
     FINAL payment so the schedule always sums to the balance exactly.
     paymentCount === 0 yields an empty schedule (reachable when Payment 1
     matches the deposit and the total payment count is 1). */
  function buildFinalAdjustedSchedule(balance, paymentCount) {
    var payments = [];
    /* [HTA 303-307] Defensive bound: this is also called directly, so it must
       never be handed a non-finite or unbounded count that would loop or
       allocate without end. */
    if (!isFiniteNumber(balance)) balance = 0;
    if (!isFiniteNumber(paymentCount) || paymentCount < 0) paymentCount = 0;
    paymentCount = Math.min(Math.floor(paymentCount), MAX_PAYMENTS);
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

  /* [HTA 421-485] getDepositAmount().
     Money fields use parseMoney, the percentage field uses parsePercent, so
     "1,500" means 1500 and "150abc" is rejected rather than parsed as 150.
     The non-finite guards remain: both parsers can still return a real
     Infinity for "1e500", which isNaN does not catch. */
  function getDepositAmount(packagePrice, raw) {
    var depositType = raw.depositType;
    var depositPercent = parsePercent(raw.depositPercent);
    var depositAmountInput = parseMoney(raw.depositAmount);

    /* [HTA 426-439]
       Upper bound on the deposit. Every other check here is a LOWER bound, so
       nothing stopped a deposit above the package price from producing a
       negative balance and negative scheduled payments.

       The limit depends on how Payment 1 is treated, because the schedule
       subtracts the deposit TWICE when Payment 1 mirrors it ([HTA 518]:
       price - deposit - firstPayment, where firstPayment === deposit).
       Bounding the deposit alone is therefore NOT sufficient on that path.
         Payment 1 matches deposit = No  ->  deposit may be up to the full price
         Payment 1 matches deposit = Yes ->  deposit may be up to half the price
       Equal to the limit is allowed: paying in full up front is legitimate and
       leaves a zero balance, not a negative one. */
    var firstMatchesDeposit = raw.firstMatchesDeposit === "yes";
    var maxDeposit = firstMatchesDeposit ? packagePrice / 2 : packagePrice;

    if (depositType === "percent") {
      if (isNaN(depositPercent)) return { ok: false, message: "Please enter a valid deposit percentage." };
      /* [HTA 428] */
      if (!isFiniteNumber(depositPercent)) return { ok: false, message: "Please enter a valid deposit percentage." };
      if (depositPercent < 0) return { ok: false, message: "Deposit percentage cannot be negative." };
      /* [HTA 444-452]
         Bound the COMPUTED amount, not the raw percentage, so one rule covers
         both 150% and a percentage that only overshoots on the Payment 1 path. */
      var percentAmount = roundToDollar(packagePrice * (depositPercent / 100));
      if (percentAmount > maxDeposit) {
        return {
          ok: false,
          message: firstMatchesDeposit
            ? "Deposit works out to more than half the package price, which it cannot be when Payment 1 matches the deposit. Lower the percentage, or set Payment 1 matches deposit to No."
            : "Deposit works out to more than the package price. Check the percentage for an extra digit."
        };
      }
      return {
        ok: true,
        amount: percentAmount,
        label: "Deposit percentage",
        valueText: depositPercent + "%"
      };
    }

    if (isNaN(depositAmountInput)) return { ok: false, message: "Please enter a valid deposit dollar amount." };
    /* [HTA 464] */
    if (!isFiniteNumber(depositAmountInput)) return { ok: false, message: "Please enter a valid deposit dollar amount." };
    if (depositAmountInput < 0) return { ok: false, message: "Deposit amount cannot be negative." };

    /* [HTA 468-476] */
    var amountDeposit = roundToDollar(depositAmountInput);
    if (amountDeposit > maxDeposit) {
      return {
        ok: false,
        message: firstMatchesDeposit
          ? "Deposit cannot be more than half the package price when Payment 1 matches the deposit. Lower the deposit, or set Payment 1 matches deposit to No."
          : "Deposit cannot be more than the package price. Check for an extra zero, or switch to a deposit percentage."
      };
    }

    return {
      ok: true,
      amount: amountDeposit,
      label: "Deposit amount",
      valueText: formatMoney(amountDeposit) + " (rounded to nearest dollar)"
    };
  }

  /* [HTA 449-560] calculatePayments().
     Input: raw strings exactly as they come off the form controls.
     Output: { ok:false, error } or a structured result for the renderer.

     CLAMP REPORTING CONTRACT — the HTA clamps and writes the field BEFORE the
     deposit is validated, so a clamp followed by a deposit error still leaves
     the corrected count on screen. `clampedPaymentCount` is therefore carried
     on EVERY return that happens at or after the clamp point, success or
     failure. Returns that happen BEFORE the clamp point report null, because
     the HTA has not written the field at that stage either (e.g. a negative
     package price is rejected first and the over-cap count stays as typed).
     app.js writes the field before its own !ok guard, so the two agree. */
  function computePayments(raw) {
    var packagePrice = parseMoney(raw.packagePrice);
    var totalPayments = parseInt(raw.totalPayments, 10);
    var firstMatches = raw.firstMatchesDeposit === "yes";
    var clampedPaymentCount = null;

    /* Error return for checks that run BEFORE the clamp. */
    function failEarly(message) {
      return { ok: false, error: message, clampedPaymentCount: null };
    }
    /* Error return for checks that run AFTER the clamp; carries the clamp so
       the UI still corrects the field, exactly as the HTA does. */
    function failAfterClamp(message) {
      return { ok: false, error: message, clampedPaymentCount: clampedPaymentCount };
    }

    /* [HTA 458-485] validation order is load-bearing */
    if (isNaN(packagePrice) || isNaN(totalPayments)) {
      return failEarly("Please enter valid numbers.");
    }
    /* [HTA 462-466] isNaN misses Infinity, which would reach the arithmetic
       and render "$Infinity"/"$NaN" amounts. Reject non-finite explicitly. */
    if (!isFiniteNumber(packagePrice) || !isFiniteNumber(totalPayments)) {
      return failEarly("Please enter valid numbers.");
    }
    if (packagePrice < 0) {
      return failEarly("Package price cannot be negative.");
    }
    if (totalPayments < 1) {
      return failEarly("Number of payments must be at least 1.");
    }
    /* [HTA 475-479] Silently clamp an over-large count, matching how the
       Partial Package Refunds tab already clamps the package count to 50.
       The HTA writes the field here, before the deposit check below. */
    if (totalPayments > MAX_PAYMENTS) {
      totalPayments = MAX_PAYMENTS;
      clampedPaymentCount = MAX_PAYMENTS;
    }

    var depositInfo = getDepositAmount(packagePrice, raw);
    if (!depositInfo.ok) {
      /* [HTA 483-487] runs AFTER the clamp */
      return failAfterClamp(depositInfo.message);
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
      clampedPaymentCount: clampedPaymentCount,
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
    var totalCost = parseMoney(raw.totalCost);
    var amountPaid = parseMoney(raw.amountPaid);
    var tpp = parseMoney(raw.tpp);

    /* [HTA 572-583] */
    if (isNaN(totalCost) || isNaN(amountPaid) || isNaN(tpp)) {
      return { ok: false, error: "Please enter valid non-negative numbers." };
    }
    /* [HTA 577-581] Reject Infinity, which isNaN allows through into the
       refund arithmetic. */
    if (!isFiniteNumber(totalCost) || !isFiniteNumber(amountPaid) || !isFiniteNumber(tpp)) {
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

  /* [HTA 644-648] the package-count clamp also lives in the input builder.
     Alias of MAX_PACKAGES - kept as a named export because app.js builds the
     package rows against it. One source of truth. */
  var PARTIAL_MAX_PACKAGES = MAX_PACKAGES;

  /* [HTA 625-751] calculatePartialRefund().
     raw = { packageCount, tpp, nonRefundPercent, amountPaid,
             packages: [{ price: "<string>", selected: <bool> }, ...] }

     Allocation policy (comment preserved from [HTA 687-690]):
       The receipt does not split Amount Paid by package. TPP is treated as
       paid first. Any amount above total TPP is allocated proportionally by
       package price. Each package is calculated independently from the same
       formula so two packages with the same price always receive the same
       estimated paid amount/refund.

     CLAMP REPORTING CONTRACT — the HTA clamps and writes the field very early,
     before the negative / percentage / price / overpay checks, so every one of
     those errors still leaves the corrected count on screen.
     `clampedPackageCount` is carried on all of those returns. Only the two
     isNaN/non-finite checks run before the clamp and report null. */
  function computePartialRefund(raw) {
    var count = parseInt(raw.packageCount, 10);
    var tppEach = parseMoney(raw.tpp);
    var nonRefundPercent = parsePercent(raw.nonRefundPercent);
    var amountPaid = parseMoney(raw.amountPaid);
    var typedTotalPackagePrice = parseMoney(raw.totalPackagePrice);
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
    var clampedPackageCount = null;

    function failEarly(message) {
      return { ok: false, error: message, clampedPackageCount: null };
    }
    function failAfterClamp(message) {
      return { ok: false, error: message, clampedPackageCount: clampedPackageCount };
    }

    /* [HTA 734-738] validation order is load-bearing */
    if (isNaN(count) || count < 1 || isNaN(tppEach) || isNaN(nonRefundPercent) || isNaN(amountPaid) || isNaN(typedTotalPackagePrice)) {
      return failEarly("Please complete the package count, TPP, non-refundable percentage, total package price, amount paid, and all package prices.");
    }
    /* [HTA 739-745] isNaN misses Infinity; a non-finite count would also drive
       the allocation loop below without end. */
    if (!isFiniteNumber(count) || !isFiniteNumber(tppEach) || !isFiniteNumber(nonRefundPercent) || !isFiniteNumber(amountPaid) || !isFiniteNumber(typedTotalPackagePrice)) {
      return failEarly("Please complete the package count, TPP, non-refundable percentage, total package price, amount paid, and all package prices.");
    }
    /* [HTA 746-753] The allocation loop below runs `count` times regardless of
       how many price rows exist, so the 50-package ceiling must be enforced
       HERE as well as in updatePartialPackageInputs. Without this, a pasted
       count of 50,000,000 stalls the app for ~26 seconds with two rows.
       The HTA writes the field here, before all the checks that follow. */
    if (count > MAX_PACKAGES) {
      count = MAX_PACKAGES;
      clampedPackageCount = MAX_PACKAGES;
    }
    if (tppEach < 0 || nonRefundPercent < 0 || amountPaid < 0 || typedTotalPackagePrice < 0) {
      return failAfterClamp("Negative values are not allowed.");
    }
    if (nonRefundPercent > 100) {
      return failAfterClamp("Non-refundable percentage cannot be greater than 100%.");
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
      if (isNaN(price) || price < 0 || !isFiniteNumber(price)) {
        /* runs AFTER the clamp */
        return failAfterClamp("Please enter a valid price for Package " + i + " (for example 4923.00 or 4,923.00).");
      }
      prices.push(roundMoney(price));
      selected.push(!!entry.selected);
      totalPackagePrice += price;
    }

    /* [HTA 780-782] */
    totalPackagePrice = roundMoney(totalPackagePrice);
    totalTpp = roundMoney(tppEach * count);
    tripValue = roundMoney(totalPackagePrice + totalTpp);

    /* [HTA 784-799] The individual package price rows must add up to the typed
       Total Package Price. Compared in integer CENTS against
       `totalPackagePrice`, the same variable the allocation uses, so the check
       and the math can never disagree; a float comparison would produce
       phantom mismatches (1000.10 + 2000.20 + 3000.30 is 6000.599999999999).
       The loop above SKIPS absent rows, so a blank row short-changes the sum
       and lands here - hence the wording.
       This is failAfterClamp, not failEarly: the package-count clamp must
       still reach the field on this error path. */
    if (moneyToCents(totalPackagePrice) !== moneyToCents(typedTotalPackagePrice)) {
      return failAfterClamp("Package prices add up to " + formatMoney(totalPackagePrice) +
        " but Total Package Price is " + formatMoney(typedTotalPackagePrice) +
        ". Check the individual package prices, including any left blank.");
    }

    /* [HTA 801-812] Number of Packages must match the rows actually priced.
       totalTpp is tppEach * count, but the scan loop above SKIPS rows that do
       not exist, so a count larger than the rendered rows bills TPP for
       phantom packages that no row ever reconciles against. That inflates the
       non-refundable base and silently UNDER-REFUNDS the customer with no
       error shown (3 rows priced at $6000 with count=5 loses $962).
       Placed after the reconciliation check so that error keeps precedence
       and its clamp contract is unchanged. failAfterClamp, same as its
       neighbours: an over-cap count must still write back to the field. */
    if (prices.length !== count) {
      return failAfterClamp("Number of Packages is " + count + " but " + prices.length +
        (prices.length === 1 ? " package price row is shown." : " package price rows are shown.") +
        " Re-enter the Number of Packages so the rows match.");
    }

    /* [HTA 814-818] */
    if (amountPaid > tripValue) {
      /* runs AFTER the clamp */
      return failAfterClamp("Amount Paid cannot be greater than the total trip value (package prices + TPP).");
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
      clampedPackageCount: clampedPackageCount,
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

  /* [HTA 871-880] resetPartialRefund() defaults */
  var PARTIAL_DEFAULTS = {
    packageCount: "5",
    tpp: "481",
    nonRefundPercent: "20",
    totalPackagePrice: "",
    amountPaid: ""
  };

  return {
    /* helpers */
    isFiniteNumber: isFiniteNumber,
    roundToDollar: roundToDollar,
    roundMoney: roundMoney,
    formatMoney: formatMoney,
    formatSignedMoney: formatSignedMoney,
    parseMoney: parseMoney,
    parsePercent: parsePercent,
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
    MAX_PAYMENTS: MAX_PAYMENTS,
    MAX_PACKAGES: MAX_PACKAGES,
    REFUND_NONREFUNDABLE_RATE: REFUND_NONREFUNDABLE_RATE
  };
}));
