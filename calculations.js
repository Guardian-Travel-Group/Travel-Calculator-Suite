(function (root, factory) {
  var api = factory();
  root.TCSCalculations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(this, function () {
  'use strict';

  var MAX_SAFE_CENTS = 9007199254740991;

  function safeCents(value) { return isFinite(value) && value >= 0 && value <= MAX_SAFE_CENTS && Math.floor(value) === value; }

  function roundTwentyPercentCents(cents) {
    var quotient = Math.floor(cents / 5);
    var remainder = cents % 5;
    return quotient + (remainder >= 3 ? 1 : 0);
  }

  function trim(value) { return String(value).replace(/^\s+|\s+$/g, ''); }

  function parseMoneyCents(raw, label) {
    var text = trim(raw);
    var match;
    var whole;
    var fraction;
    var centsText;
    var cents;

    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      return { ok: false, message: label + ' must be a valid dollar amount with no more than two decimals.' };
    }

    match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    whole = match[1].replace(/^0+(?=\d)/, '');
    fraction = (match[2] || '') + '00';
    centsText = whole + fraction.slice(0, 2);
    cents = Number(centsText);

    if (!isFinite(cents) || cents > MAX_SAFE_CENTS) {
      return { ok: false, message: label + ' is too large to represent exactly.' };
    }
    return { ok: true, cents: cents };
  }

  function parseWholeNumber(raw, label) {
    var text = trim(raw);
    if (!/^[1-9]\d*$/.test(text)) return { ok: false, message: label + ' must be a positive whole number.' };
    return { ok: true, value: parseInt(text, 10) };
  }

  function parsePercentage(raw, label) {
    var text = trim(raw);
    var value;
    if (!/^\d+(\.\d{1,4})?$/.test(text)) return { ok: false, message: label + ' must be a valid percentage.' };
    value = parseFloat(text);
    if (!isFinite(value) || value < 0 || value > 100) return { ok: false, message: label + ' must be between 0 and 100 percent.' };
    return { ok: true, value: value };
  }

  function getDepositCents(packageCents, specification) {
    var depositCents;
    var percentResult;
    if (specification.type === 'amount') {
      depositCents = specification.cents;
      if (!isFinite(depositCents) || depositCents < 0) return { ok: false, message: 'Deposit amount cannot be negative.' };
    } else {
      percentResult = parsePercentage(specification.value, 'Deposit percentage');
      if (!percentResult.ok) return percentResult;
      depositCents = Math.round(packageCents * percentResult.value / 100);
    }
    if (depositCents > packageCents) return { ok: false, message: 'Deposit cannot exceed the package price.' };
    return { ok: true, cents: depositCents };
  }

  function validatePaymentScenario(packageCents, depositCents, totalPayments, firstMatches) {
    var remainingCents;
    if (!isFinite(packageCents) || packageCents < 0) return { ok: false, message: 'Package price cannot be negative.' };
    if (!isFinite(depositCents) || depositCents < 0) return { ok: false, message: 'Deposit cannot be negative.' };
    if (depositCents > packageCents) return { ok: false, message: 'Deposit cannot exceed the package price.' };
    if (!isFinite(totalPayments) || totalPayments < 1 || Math.floor(totalPayments) !== totalPayments) return { ok: false, message: 'Number of payments must be a positive whole number.' };
    remainingCents = firstMatches ? packageCents - depositCents - depositCents : packageCents - depositCents;
    if (remainingCents < 0) return { ok: false, message: 'The deposit and matching first payment cannot exceed the package price.' };
    if (firstMatches && totalPayments === 1 && remainingCents > 0) return { ok: false, message: 'At least two total payments are required when Payment 1 matches the deposit.' };
    if ((firstMatches ? totalPayments - 1 : totalPayments) > 0 && remainingCents < (firstMatches ? totalPayments - 1 : totalPayments)) return { ok: false, message: 'The remaining balance is too small to create a positive-dollar payment for every installment.' };
    return { ok: true, remainingCents: remainingCents, remainingPayments: firstMatches ? totalPayments - 1 : totalPayments };
  }

  function buildScheduleCents(balanceCents, paymentCount) {
    var regularCents;
    var remainderCents;
    var payments = [];
    var i;
    if (balanceCents < 0 || paymentCount < 1) return payments;
    regularCents = Math.floor(balanceCents / paymentCount);
    remainderCents = balanceCents % paymentCount;
    for (i = 0; i < paymentCount; i += 1) payments.push(regularCents + (i === paymentCount - 1 ? remainderCents : 0));
    return payments;
  }

  function allocateProportionallyCents(poolCents, pricesCents) {
    var totalPriceCents = 0;
    var allocations = [];
    var allocated = 0;
    var i;
    var share;
    for (i = 0; i < pricesCents.length; i += 1) totalPriceCents += pricesCents[i];
    if (totalPriceCents === 0) return buildScheduleCents(poolCents, pricesCents.length);
    for (i = 0; i < pricesCents.length; i += 1) {
      if (i === pricesCents.length - 1) share = poolCents - allocated;
      else share = Math.floor(poolCents * pricesCents[i] / totalPriceCents);
      allocations.push(share);
      allocated += share;
    }
    return allocations;
  }

  function calculateRefundCents(totalCostCents, amountPaidCents, tppCents) {
    var twentyPercentCents;
    var nonRefundableCents;
    var refundCents;
    if (!safeCents(totalCostCents)) return { ok: false, message: 'Total package cost is too large to represent exactly.' };
    if (!safeCents(amountPaidCents)) return { ok: false, message: 'Amount paid is too large to represent exactly.' };
    if (!safeCents(tppCents) || tppCents <= 0) return { ok: false, message: 'A TPP amount greater than $0.00 is required before a refund can be calculated.' };
    if (totalCostCents > MAX_SAFE_CENTS - tppCents) return { ok: false, message: 'Package price plus TPP is too large to represent exactly.' };
    if (amountPaidCents > totalCostCents + tppCents) return { ok: false, message: 'Amount paid cannot exceed package price plus TPP.' };
    twentyPercentCents = roundTwentyPercentCents(totalCostCents);
    nonRefundableCents = tppCents + twentyPercentCents;
    if (!safeCents(nonRefundableCents)) return { ok: false, message: 'The non-refundable amount is too large to represent exactly.' };
    refundCents = amountPaidCents - nonRefundableCents;
    if (refundCents < 0) refundCents = 0;
    return { ok: true, twentyPercentCents: twentyPercentCents, nonRefundableCents: nonRefundableCents, appliedNonRefundableCents: Math.min(amountPaidCents, nonRefundableCents), refundCents: refundCents };
  }

  function calculatePartialRefundCents(input) {
    var prices = input.pricesCents;
    var count = prices.length;
    var tppEach = input.tppEachCents;
    var amountPaid = input.amountPaidCents;
    var percent = input.nonRefundPercent;
    var totalPackage = 0;
    var totalTpp;
    var tripValue;
    var packagePool;
    var packageAllocations;
    var allocatedPaid = [];
    var results = [];
    var i;
    var percentNonRefundable;
    var nonRefundable;
    var refund;
    var selected = input.selected || [];

    if (!count || count > 50) return { ok: false, message: 'Number of packages must be between 1 and 50.' };
    if (!isFinite(tppEach) || tppEach <= 0) return { ok: false, message: 'TPP per package must be greater than $0.00.' };
    if (!isFinite(percent) || percent < 0 || percent > 100) return { ok: false, message: 'Non-refundable percentage must be between 0 and 100 percent.' };
    if (!safeCents(amountPaid)) return { ok: false, message: 'Amount paid must be a non-negative exact monetary value.' };

    for (i = 0; i < count; i += 1) {
      if (!safeCents(prices[i])) return { ok: false, message: 'Package prices must be non-negative exact monetary values.' };
      if (percent > 0 && prices[i] / 100 > MAX_SAFE_CENTS / percent) return { ok: false, message: 'A package percentage calculation is too large to represent exactly.' };
      if (totalPackage > MAX_SAFE_CENTS - prices[i]) return { ok: false, message: 'Combined package prices are too large to represent exactly.' };
      totalPackage += prices[i];
    }

    if (tppEach > Math.floor(MAX_SAFE_CENTS / count)) return { ok: false, message: 'Combined TPP is too large to represent exactly.' };
    totalTpp = tppEach * count;
    if (totalPackage > MAX_SAFE_CENTS - totalTpp) return { ok: false, message: 'Total package value plus TPP is too large to represent exactly.' };
    tripValue = totalPackage + totalTpp;
    if (amountPaid > tripValue) return { ok: false, message: 'Amount paid cannot exceed total package prices plus TPP.' };

    if (amountPaid < totalTpp) {
      allocatedPaid = buildScheduleCents(amountPaid, count);
    } else {
      packagePool = amountPaid - totalTpp;
      if (!safeCents(packagePool)) return { ok: false, message: 'The package payment pool is too large to represent exactly.' };
      for (i = 0; i < count; i += 1) {
        if (prices[i] > 0 && packagePool > Math.floor(MAX_SAFE_CENTS / prices[i])) return { ok: false, message: 'A proportional package allocation is too large to represent exactly.' };
      }
      packageAllocations = allocateProportionallyCents(packagePool, prices);
      for (i = 0; i < count; i += 1) allocatedPaid.push(tppEach + packageAllocations[i]);
    }

    for (i = 0; i < count; i += 1) {
      percentNonRefundable = Math.round(prices[i] * percent / 100);
      nonRefundable = tppEach + percentNonRefundable;
      refund = allocatedPaid[i] - nonRefundable;
      if (refund < 0) refund = 0;
      results.push({ packageCents: prices[i], allocatedPaidCents: allocatedPaid[i], percentNonRefundableCents: percentNonRefundable, nonRefundableCents: nonRefundable, refundCents: refund, selected: selected[i] === true });
    }

    return { ok: true, totalPackageCents: totalPackage, totalTppCents: totalTpp, tripValueCents: tripValue, allocatedPaidCents: allocatedPaid, results: results };
  }

  function formatCents(cents) {
    var absolute = Math.abs(cents);
    var dollars = Math.floor(absolute / 100);
    var remainder = ('0' + (absolute % 100)).slice(-2);
    return (cents < 0 ? '-$' : '$') + dollars + '.' + remainder;
  }

  return {
    parseMoneyCents: parseMoneyCents,
    parseWholeNumber: parseWholeNumber,
    parsePercentage: parsePercentage,
    getDepositCents: getDepositCents,
    validatePaymentScenario: validatePaymentScenario,
    buildScheduleCents: buildScheduleCents,
    calculateRefundCents: calculateRefundCents,
    calculatePartialRefundCents: calculatePartialRefundCents,
    formatCents: formatCents
  };
}));
