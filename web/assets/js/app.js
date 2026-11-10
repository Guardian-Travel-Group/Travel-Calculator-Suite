/*!
 * Travel Calculator Suite - web build UI layer
 *
 * This file owns PRESENTATION ONLY. Every number it shows comes from
 * assets/js/calc.js (TCSCalc), which is a direct port of the HTA's math.
 * No arithmetic or rounding happens here - keep it that way so QA can diff
 * calc.js against the HTA without reading UI code.
 */
(function () {
  'use strict';

  var C = window.TCSCalc;
  var fm = C.formatMoney;

  function byId(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* Summary rows are <dt>/<dd> pairs. Values that are not pure money get the
     is-text modifier so long policy strings wrap instead of overflowing. */
  function renderSummary(target, rows) {
    clear(target);
    rows.forEach(function (row) {
      var wrap = el('div', 'summary-row');
      wrap.appendChild(el('dt', null, row.label));
      var isMoneyish = /^[+\-]?\$|^\d|%$/.test(String(row.value));
      var dd = el('dd', isMoneyish ? null : 'is-text', row.value);
      wrap.appendChild(dd);
      target.appendChild(wrap);
    });
  }

  function lineItem(label, value, opts) {
    opts = opts || {};
    var row = el('div', 'line-item' + (opts.variant ? ' line-item--' + opts.variant : ''));
    var l = el('span', 'line-item__label', label);
    var v = el('span', 'line-item__value', value);
    if (opts.adjusted) {
      v.appendChild(document.createTextNode(' '));
      v.appendChild(el('span', 'badge-adjusted', 'final adjusted'));
    }
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function setError(target, message) {
    target.textContent = message || '';
  }

  /* ------------------------------------------------------------------
   * Tabs: roving tabindex + arrow/Home/End keys (WAI-ARIA tab pattern)
   * ---------------------------------------------------------------- */
  var tabs = [
    { tab: 'tab-payments', panel: 'panel-payments' },
    { tab: 'tab-refund', panel: 'panel-refund' },
    { tab: 'tab-partial', panel: 'panel-partial' }
  ];

  function selectTab(index, focus) {
    tabs.forEach(function (t, i) {
      var tabEl = byId(t.tab);
      var panelEl = byId(t.panel);
      var active = (i === index);
      tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
      tabEl.tabIndex = active ? 0 : -1;
      if (active) { panelEl.removeAttribute('hidden'); } else { panelEl.setAttribute('hidden', ''); }
    });
    if (focus) byId(tabs[index].tab).focus();
    try { window.localStorage.setItem('tcs.tab', String(index)); } catch (e) {}
  }

  function initTabs() {
    tabs.forEach(function (t, i) {
      var tabEl = byId(t.tab);
      tabEl.addEventListener('click', function () { selectTab(i, false); });
      tabEl.addEventListener('keydown', function (ev) {
        var next = null;
        if (ev.key === 'ArrowRight') next = (i + 1) % tabs.length;
        else if (ev.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
        else if (ev.key === 'Home') next = 0;
        else if (ev.key === 'End') next = tabs.length - 1;
        if (next !== null) { ev.preventDefault(); selectTab(next, true); }
      });
    });

    var saved = 0;
    try {
      var raw = window.localStorage.getItem('tcs.tab');
      if (raw !== null) {
        var parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed < tabs.length) saved = parsed;
      }
    } catch (e) {}
    selectTab(saved, false);
  }

  /* ------------------------------------------------------------------
   * Theme: explicit choice persists; otherwise follow the OS
   * ---------------------------------------------------------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var btn = byId('themeToggle');
    var isDark = (theme === 'dark');
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    byId('themeToggleLabel').textContent = isDark ? 'Light mode' : 'Dark mode';
  }

  function initTheme() {
    var stored = null;
    try { stored = window.localStorage.getItem('tcs.theme'); } catch (e) {}
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));

    byId('themeToggle').addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { window.localStorage.setItem('tcs.theme', next); } catch (e) {}
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function (e) {
        var hasChoice = null;
        try { hasChoice = window.localStorage.getItem('tcs.theme'); } catch (err) {}
        if (!hasChoice) applyTheme(e.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ------------------------------------------------------------------
   * 1) Payment Calculator
   * ---------------------------------------------------------------- */
  function readPaymentRaw() {
    return {
      packagePrice: byId('packagePrice').value,
      depositType: byId('depositType').value,
      depositPercent: byId('depositPercent').value,
      depositAmount: byId('depositAmount').value,
      totalPayments: byId('totalPayments').value,
      firstMatchesDeposit: byId('firstMatchesDeposit').value
    };
  }

  function calculatePayments() {
    var summaryBox = byId('summaryBox1');
    var resultsBox = byId('resultsBox1');
    var errorBox = byId('errorBox1');

    clear(summaryBox);
    clear(resultsBox);
    setError(errorBox, '');

    var res = C.computePayments(readPaymentRaw());
    if (!res.ok) {
      setError(errorBox, res.error);
      return;
    }

    renderSummary(summaryBox, res.summary);
    res.lines.forEach(function (line) {
      var variant = (line.label === 'Deposit') ? 'deposit' : null;
      resultsBox.appendChild(lineItem(line.label, fm(line.amount), {
        adjusted: line.adjusted,
        variant: variant
      }));
    });
  }

  function updateDepositInputs() {
    var type = byId('depositType').value;
    var percentWrap = byId('depositPercentWrap');
    var amountWrap = byId('depositAmountWrap');
    if (type === 'percent') {
      percentWrap.removeAttribute('hidden');
      amountWrap.setAttribute('hidden', '');
    } else {
      percentWrap.setAttribute('hidden', '');
      amountWrap.removeAttribute('hidden');
    }
    calculatePayments();
  }

  function resetPayments() {
    var d = C.PAYMENT_DEFAULTS;
    byId('packagePrice').value = d.packagePrice;
    byId('depositType').value = d.depositType;
    byId('depositPercent').value = d.depositPercent;
    byId('depositAmount').value = d.depositAmount;
    byId('totalPayments').value = d.totalPayments;
    byId('firstMatchesDeposit').value = d.firstMatchesDeposit;
    updateDepositInputs();
  }

  function initPayments() {
    ['packagePrice', 'depositPercent', 'depositAmount', 'totalPayments'].forEach(function (id) {
      byId(id).addEventListener('input', calculatePayments);
    });
    byId('firstMatchesDeposit').addEventListener('change', calculatePayments);
    byId('depositType').addEventListener('change', updateDepositInputs);
    byId('btnCalcPayments').addEventListener('click', calculatePayments);
    byId('btnResetPayments').addEventListener('click', resetPayments);
  }

  /* ------------------------------------------------------------------
   * 2) Refund Calculator
   * ---------------------------------------------------------------- */
  function calculateRefund() {
    var summaryBox = byId('summaryBox2');
    var resultsBox = byId('resultsBox2');
    var errorBox = byId('errorBox2');

    clear(summaryBox);
    clear(resultsBox);
    setError(errorBox, '');

    var res = C.computeRefund({
      totalCost: byId('refundTotalCost').value,
      amountPaid: byId('refundAmountPaid').value,
      tpp: byId('refundTpp').value
    });

    if (!res.ok) {
      setError(errorBox, res.error);
      return;
    }

    renderSummary(summaryBox, res.summary);

    var headline = el('div', 'headline' + (res.noRefundDue ? ' headline--zero' : ''));
    headline.appendChild(el('div', 'headline__label', 'Refund Due'));
    headline.appendChild(el('div', 'headline__value', fm(res.refund)));
    if (res.noRefundDue) {
      headline.appendChild(el('div', 'headline__note', 'No refund is due.'));
    }
    resultsBox.appendChild(headline);

    var formula = el('div', 'formula');
    formula.appendChild(document.createTextNode('Formula used: ' + res.formula));
    resultsBox.appendChild(formula);
  }

  function resetRefund() {
    byId('refundTotalCost').value = '';
    byId('refundAmountPaid').value = '';
    byId('refundTpp').value = '';
    clear(byId('summaryBox2'));
    clear(byId('resultsBox2'));
    setError(byId('errorBox2'), '');
  }

  function initRefund() {
    ['refundTotalCost', 'refundAmountPaid', 'refundTpp'].forEach(function (id) {
      byId(id).addEventListener('input', calculateRefund);
    });
    byId('btnCalcRefund').addEventListener('click', calculateRefund);
    byId('btnResetRefund').addEventListener('click', resetRefund);
  }

  /* ------------------------------------------------------------------
   * 3) Partial Package Refunds
   * ---------------------------------------------------------------- */
  function readPackageEntries() {
    var count = parseInt(byId('partialPackageCount').value, 10);
    var entries = [];
    if (isNaN(count) || count < 1) return entries;
    for (var i = 1; i <= count; i++) {
      var priceEl = byId('partialPackagePrice' + i);
      var checkEl = byId('partialPackageCancel' + i);
      /* A missing row is pushed as undefined so calc.js reproduces the HTA's
         `if (!priceInput) continue;` skip rather than inventing a price. */
      if (!priceEl) { entries.push(undefined); continue; }
      entries.push({ price: priceEl.value, selected: !!(checkEl && checkEl.checked) });
    }
    return entries;
  }

  function readPartialRaw() {
    return {
      packageCount: byId('partialPackageCount').value,
      tpp: byId('partialTpp').value,
      nonRefundPercent: byId('partialNonRefundPercent').value,
      amountPaid: byId('partialAmountPaid').value,
      packages: readPackageEntries()
    };
  }

  function syncPackageSelectionStyles() {
    var count = parseInt(byId('partialPackageCount').value, 10);
    if (isNaN(count)) return;
    for (var i = 1; i <= count; i++) {
      var card = byId('partialPackageCard' + i);
      var check = byId('partialPackageCancel' + i);
      if (card && check) {
        card.className = 'pkg' + (check.checked ? ' pkg--selected' : '');
      }
    }
  }

  function calculatePartialRefund() {
    var summaryBox = byId('summaryBox3');
    var resultsBox = byId('resultsBox3');
    var errorBox = byId('errorBox3');

    clear(summaryBox);
    clear(resultsBox);
    setError(errorBox, '');
    syncPackageSelectionStyles();

    var res = C.computePartialRefund(readPartialRaw());
    if (!res.ok) {
      setError(errorBox, res.error);
      return;
    }

    renderSummary(summaryBox, res.summary);

    var shown = 0;
    res.packages.forEach(function (pkg) {
      if (!pkg.selected) return;
      shown++;

      var card = el('div', 'line-item pkg-result');

      var head = el('div', 'pkg-result__head');
      head.appendChild(el('span', 'pkg-result__title', 'Package ' + pkg.number));
      head.appendChild(el('span', 'pkg-result__refund', fm(pkg.refund)));
      card.appendChild(head);

      var rows = el('dl', 'pkg-result__rows');
      [
        ['Package Price', fm(pkg.price)],
        ['Estimated Paid Toward Package', fm(pkg.allocatedPaid)],
        ['TPP Non-Refundable', fm(pkg.tpp)],
        [res.nonRefundPercent + '% Non-Refundable', fm(pkg.percentNonRefund)],
        ['Total Non-Refundable', fm(pkg.nonRefundable)]
      ].forEach(function (pair) {
        var row = el('div', 'pkg-result__row');
        row.appendChild(el('dt', null, pair[0]));
        row.appendChild(el('dd', null, pair[1]));
        rows.appendChild(row);
      });
      card.appendChild(rows);

      card.appendChild(el('div', 'pkg-result__math',
        'Math: ' + fm(pkg.allocatedPaid) + ' - (' + fm(pkg.tpp) + ' + ' + fm(pkg.percentNonRefund) + ') = ' + fm(pkg.refund)));

      resultsBox.appendChild(card);
    });

    if (res.selectedCount === 0) {
      resultsBox.appendChild(el('div', 'line-item line-item--plain', res.emptySelectionMessage));
    } else if (res.selectedCount > 1) {
      resultsBox.appendChild(lineItem('Total Refund Due', fm(res.totalSelectedRefund), { variant: 'total' }));
    }
  }

  /* Rebuild the per-package rows, preserving whatever the user already typed. */
  function updatePartialPackageInputs() {
    var countRaw = byId('partialPackageCount').value;
    var count = parseInt(countRaw, 10);
    var wrap = byId('partialPackageInputs');

    var previous = [];
    var existing = wrap.querySelectorAll('input[type="text"]');
    for (var p = 0; p < existing.length; p++) {
      var chk = byId('partialPackageCancel' + (p + 1));
      previous.push({ price: existing[p].value, selected: !!(chk && chk.checked) });
    }

    if (isNaN(count) || count < 1) {
      clear(wrap);
      setError(byId('errorBox3'), 'Number of packages must be at least 1.');
      clear(byId('summaryBox3'));
      clear(byId('resultsBox3'));
      return;
    }

    if (count > C.PARTIAL_MAX_PACKAGES) {
      count = C.PARTIAL_MAX_PACKAGES;
      byId('partialPackageCount').value = String(C.PARTIAL_MAX_PACKAGES);
    }

    setError(byId('errorBox3'), '');
    clear(wrap);

    for (var i = 1; i <= count; i++) {
      var prior = previous[i - 1] || { price: '', selected: false };

      var card = el('div', 'pkg' + (prior.selected ? ' pkg--selected' : ''));
      card.id = 'partialPackageCard' + i;

      var head = el('div', 'pkg__head');
      head.appendChild(el('span', 'pkg__title', 'Package ' + i));

      var check = el('label', 'check');
      var checkInput = document.createElement('input');
      checkInput.type = 'checkbox';
      checkInput.id = 'partialPackageCancel' + i;
      checkInput.checked = prior.selected;
      checkInput.addEventListener('change', calculatePartialRefund);
      check.appendChild(checkInput);
      check.appendChild(document.createTextNode('Include in refund'));
      head.appendChild(check);
      card.appendChild(head);

      var field = el('div', 'field');
      var label = el('label', null, 'Package Price');
      label.htmlFor = 'partialPackagePrice' + i;
      field.appendChild(label);

      var moneyWrap = el('div', 'input-money');
      var priceInput = document.createElement('input');
      priceInput.type = 'text';
      priceInput.inputMode = 'decimal';
      priceInput.autocomplete = 'off';
      priceInput.id = 'partialPackagePrice' + i;
      priceInput.value = prior.price;
      priceInput.addEventListener('input', calculatePartialRefund);
      moneyWrap.appendChild(priceInput);
      field.appendChild(moneyWrap);
      card.appendChild(field);

      wrap.appendChild(card);
    }

    clear(byId('summaryBox3'));
    clear(byId('resultsBox3'));
  }

  function resetPartialRefund() {
    var d = C.PARTIAL_DEFAULTS;
    byId('partialPackageCount').value = d.packageCount;
    byId('partialTpp').value = d.tpp;
    byId('partialNonRefundPercent').value = d.nonRefundPercent;
    byId('partialAmountPaid').value = d.amountPaid;
    setError(byId('errorBox3'), '');
    clear(byId('summaryBox3'));
    clear(byId('resultsBox3'));
    var wrap = byId('partialPackageInputs');
    clear(wrap);
    updatePartialPackageInputs();
  }

  function initPartial() {
    byId('partialPackageCount').addEventListener('input', updatePartialPackageInputs);
    ['partialTpp', 'partialNonRefundPercent', 'partialAmountPaid'].forEach(function (id) {
      byId(id).addEventListener('input', calculatePartialRefund);
    });
    byId('btnCalcPartial').addEventListener('click', calculatePartialRefund);
    byId('btnResetPartial').addEventListener('click', resetPartialRefund);
  }

  /* ------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------- */
  function init() {
    initTheme();
    initTabs();
    initPayments();
    initRefund();
    initPartial();

    updateDepositInputs();      /* also runs the first payment calculation */
    updatePartialPackageInputs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Exposed for the browser smoke test only. */
  window.TCSApp = {
    calculatePayments: calculatePayments,
    calculateRefund: calculateRefund,
    calculatePartialRefund: calculatePartialRefund,
    updatePartialPackageInputs: updatePartialPackageInputs,
    resetPayments: resetPayments,
    resetRefund: resetRefund,
    resetPartialRefund: resetPartialRefund,
    selectTab: selectTab
  };
}());
