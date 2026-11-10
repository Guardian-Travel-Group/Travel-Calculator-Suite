#!/usr/bin/env node
/*!
 * mutate.test.js - mutation executor for the parity suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * The whole premise of this port is that two copies of the same math stay in
 * lockstep because a divergence mechanically FAILS a run. A green parity suite
 * on its own does not prove that: a suite that asserts nothing useful is also
 * green. So each known class of drift is injected deliberately and the suite
 * must catch it.
 *
 * The most valuable assertion in the project is fault 6 - changing the cap in
 * the HTA alone, leaving the port untouched. If that does not fail, the two
 * builds can drift apart silently and the port's guarantee is void.
 *
 * SAFETY
 * ------
 * The real working tree is NEVER modified. For each fault this script copies
 * the files the suite needs into a fresh temp directory OUTSIDE the repo,
 * mutates the copy, and runs the suite there with cwd set to that directory,
 * so even a core dump lands outside the repo. The originals are opened
 * read-only; there is no code path here that writes into the repo, so an
 * aborted or killed run cannot leave a mutated file behind. The script
 * verifies the originals' hashes before and after the whole run and fails
 * loudly if either changed.
 *
 * USAGE
 *   node web/tests/mutate.test.js            # run all faults
 *   node web/tests/mutate.test.js --verbose  # also print each suite's tail
 *   node web/tests/mutate.test.js --markdown # emit the README table
 *
 * EXIT CODE
 *   0  every fault was detected (>= 1 failing assertion each)
 *   1  at least one fault went UNDETECTED, or a baseline/integrity check failed
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var child = require('child_process');

var REPO = path.resolve(__dirname, '..', '..');
var VERBOSE = process.argv.indexOf('--verbose') !== -1;
var MARKDOWN = process.argv.indexOf('--markdown') !== -1;

/* Files the parity suite needs, relative to the repo root. The suite resolves
   the HTA as ../../TCS V5 from web/tests, so the layout must be preserved. */
var NEEDED = [
  'TCS V5',
  'web/assets/js/calc.js',
  'web/tests/parity.test.js',
  'web/tests/hta-sandbox.js',
  'web/tests/legacy-render.js'
];

/* ---------------------------------------------------------------------------
 * The faults. `find` must appear EXACTLY ONCE in the target file, which is
 * asserted before mutating - a search string that silently stops matching
 * would otherwise masquerade as an undetected fault and hide a real
 * regression. `note` explains what drift the fault stands in for.
 * ------------------------------------------------------------------------ */
var FAULTS = [
  {
    id: 'refund-rate',
    label: 'refund rate `0.20` -> `0.21`',
    file: 'web/assets/js/calc.js',
    find: 'var REFUND_NONREFUNDABLE_RATE = 0.20;',
    replace: 'var REFUND_NONREFUNDABLE_RATE = 0.21;',
    note: 'core refund formula drift'
  },
  {
    id: 'schedule-rounding',
    label: 'schedule `Math.round` -> `Math.floor`',
    file: 'web/assets/js/calc.js',
    find: 'var regularCents = paymentCount > 0 ? Math.round(totalCents / paymentCount) : 0;',
    replace: 'var regularCents = paymentCount > 0 ? Math.floor(totalCents / paymentCount) : 0;',
    note: 'one-cent drift in the payment schedule'
  },
  {
    id: 'port-payment-cap',
    label: 'port payment cap `120` -> `121` (HTA left at 120)',
    file: 'web/assets/js/calc.js',
    find: 'var MAX_PAYMENTS = 120;',
    replace: 'var MAX_PAYMENTS = 121;',
    note: 'port-side cap drift'
  },
  {
    id: 'port-package-cap',
    label: 'port package cap `50` -> `49` (HTA left at 50)',
    file: 'web/assets/js/calc.js',
    find: 'var MAX_PACKAGES = 50;',
    replace: 'var MAX_PACKAGES = 49;',
    note: 'port-side package ceiling drift'
  },
  {
    id: 'drop-finite-guard',
    label: "remove the port's non-finite payment guard",
    file: 'web/assets/js/calc.js',
    find: 'if (!isFiniteNumber(packagePrice) || !isFiniteNumber(totalPayments)) {',
    replace: 'if (false) {',
    note: 'Infinity reaching the arithmetic again'
  },
  {
    id: 'hta-payment-cap',
    label: '**HTA** payment cap `120` -> `130` (port left at 120)',
    file: 'TCS V5',
    find: 'var MAX_PAYMENTS = 120;',
    replace: 'var MAX_PAYMENTS = 130;',
    note: 'THE KEY ASSERTION - drift on the HTA side must also fail'
  },
  {
    id: 'payment-clamp-on-error',
    label: 'stop reporting the payment clamp on error returns',
    file: 'web/assets/js/calc.js',
    find: 'return { ok: false, error: message, clampedPaymentCount: clampedPaymentCount };',
    replace: 'return { ok: false, error: message, clampedPaymentCount: null };',
    note: 'reintroduces the round-2 write-back blocker'
  },
  {
    id: 'package-clamp-on-error',
    label: 'stop reporting the package clamp on error returns',
    file: 'web/assets/js/calc.js',
    find: 'return { ok: false, error: message, clampedPackageCount: clampedPackageCount };',
    replace: 'return { ok: false, error: message, clampedPackageCount: null };',
    note: 'reintroduces the round-2 blocker, partial tab'
  },
  {
    id: 'harness-blind-on-error',
    label: 'harness ignores the clamp on error paths (hides the bug)',
    file: 'web/tests/legacy-render.js',
    find: 'var field = clampedField(res.clampedPaymentCount, raw.totalPayments);',
    replace: 'var field = res.ok ? clampedField(res.clampedPaymentCount, raw.totalPayments) : String(raw.totalPayments);',
    note: 'proves the harness gap itself is closed'
  },
  {
    id: 'false-clamp-pre-clamp',
    label: 'report a clamp on a *pre*-clamp rejection',
    file: 'web/assets/js/calc.js',
    find: 'return { ok: false, error: message, clampedPaymentCount: null };',
    replace: 'return { ok: false, error: message, clampedPaymentCount: MAX_PAYMENTS };',
    note: 'over-correcting the write-back must fail too'
  },
  {
    id: 'money-parsefloat-regression',
    label: 'revert money parsing to `parseFloat` (comma defect)',
    file: 'web/assets/js/calc.js',
    find: '    var packagePrice = parseMoney(raw.packagePrice);',
    replace: '    var packagePrice = parseFloat(raw.packagePrice);',
    note: "reintroduces the '4,250' -> 4 silent misparse"
  },
  {
    id: 'refund-parsefloat-regression',
    label: 'revert refund money parsing to `parseFloat`',
    file: 'web/assets/js/calc.js',
    find: '    var totalCost = parseMoney(raw.totalCost);',
    replace: '    var totalCost = parseFloat(raw.totalCost);',
    note: "reintroduces the '3,000' -> $0.00 refund"
  },
  {
    id: 'percent-parsefloat-regression',
    label: 'revert percentage parsing to `parseFloat`',
    file: 'web/assets/js/calc.js',
    find: '    var nonRefundPercent = parsePercent(raw.nonRefundPercent);',
    replace: '    var nonRefundPercent = parseFloat(raw.nonRefundPercent);',
    note: "reintroduces '150abc' -> 150 silent parse"
  },
  {
    id: 'money-parser-loosened',
    label: 'loosen parseMoney to accept 3 decimals',
    file: 'web/assets/js/calc.js',
    find: 'if (text === "" || !/^-?\\d*(\\.\\d{0,2})?$/.test(text) || text === "." || text === "-" || text === "-.") return NaN;',
    replace: 'if (text === "" || !/^-?\\d*(\\.\\d{0,3})?$/.test(text) || text === "." || text === "-" || text === "-.") return NaN;',
    note: 'the documented 2dp money rule must be enforced'
  },
  {
    id: 'drop-deposit-upper-bound',
    label: 'remove the deposit upper bound entirely',
    file: 'web/assets/js/calc.js',
    find: '      if (percentAmount > maxDeposit) {',
    replace: '      if (false && percentAmount > maxDeposit) {',
    note: 'reintroduces negative schedules from an over-large percentage'
  },
  {
    id: 'drop-deposit-bound-dollar',
    label: 'remove the deposit upper bound (dollar mode)',
    file: 'web/assets/js/calc.js',
    find: '    if (amountDeposit > maxDeposit) {',
    replace: '    if (false && amountDeposit > maxDeposit) {',
    note: "reintroduces the $5,000-on-a-$1,000-package negative schedule"
  },
  {
    id: 'deposit-bound-ignores-first-payment',
    label: 'bound the deposit at full price even when Payment 1 mirrors it',
    file: 'web/assets/js/calc.js',
    find: '    var maxDeposit = firstMatchesDeposit ? packagePrice / 2 : packagePrice;',
    replace: '    var maxDeposit = packagePrice;',
    note: 'the yes-path subtracts the deposit twice, so price/2 is the real limit'
  },
  {
    id: 'deposit-bound-off-by-one',
    label: 'reject a deposit EQUAL to the limit (>= instead of >)',
    file: 'web/assets/js/calc.js',
    find: '    if (amountDeposit > maxDeposit) {',
    replace: '    if (amountDeposit >= maxDeposit) {',
    note: 'paying in full up front is legal and must stay legal'
  }
];

/* ------------------------------------------------------------------ utils */

function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function occurrences(hay, needle) {
  var n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function hashOriginals() {
  var out = {};
  NEEDED.forEach(function (rel) {
    out[rel] = sha(fs.readFileSync(path.join(REPO, rel)));
  });
  return out;
}

/* Temp root OUTSIDE the repo. TMPDIR is honoured, so core dumps and copies
   land in the scratch area rather than next to the sources. */
function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tcs-mutate-'));
}

function copyTree(dest) {
  NEEDED.forEach(function (rel) {
    var to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), to);
  });
}

function rmrf(p) {
  try {
    if (fs.rmSync) fs.rmSync(p, { recursive: true, force: true });
    else fs.rmdirSync(p, { recursive: true });
  } catch (e) { /* temp dir cleanup is best-effort */ }
}

/* Runs the parity suite in `dir` and parses its own PASSED/FAILED report.
   `truncated` distinguishes "the suite died" from "the suite ran but its
   report did not reach us", which are very different diagnoses. */
function runSuite(dir) {
  var res = child.spawnSync(
    process.execPath,
    ['--max-old-space-size=512', path.join(dir, 'web/tests/parity.test.js')],
    { cwd: dir, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 }
  );
  var out = (res.stdout || '') + (res.stderr || '');
  var mPass = out.match(/^PASSED:\s*(\d+)/m);
  var mFail = out.match(/^FAILED:\s*(\d+)/m);
  var sawFailureDetail = /^FAIL \[/m.test(out) || /PARITY BROKEN/.test(out);
  return {
    exit: res.status,
    signal: res.signal,
    /* A real crash: no summary AND no evidence the suite reached its report. */
    crashed: !mFail && !sawFailureDetail,
    /* Ran and clearly failed, but the summary line was lost in transit. */
    truncated: !mFail && sawFailureDetail,
    passed: mPass ? parseInt(mPass[1], 10) : null,
    failed: mFail ? parseInt(mFail[1], 10) : null,
    output: out
  };
}

/* ------------------------------------------------------------------- main */

console.log('');
console.log('Travel Calculator Suite - parity mutation executor');
console.log('repo: ' + REPO);

var before = hashOriginals();
var tmpRoot = makeTempRoot();
console.log('temp root (outside repo): ' + tmpRoot);
console.log('');

var results = [];
var undetected = [];
var hardFail = null;

try {
  /* Baseline: the unmutated copy must be green, or every "detection" below is
     meaningless. */
  var baseDir = path.join(tmpRoot, 'baseline');
  fs.mkdirSync(baseDir, { recursive: true });
  copyTree(baseDir);
  var base = runSuite(baseDir);

  if (base.crashed || base.failed === null) {
    hardFail = 'baseline suite did not run cleanly (exit ' + base.exit + ')';
    if (VERBOSE) console.log(base.output);
  } else if (base.failed !== 0) {
    hardFail = 'baseline suite is not green: ' + base.failed + ' failing';
  }

  if (!hardFail) {
    console.log('baseline: ' + base.passed + ' passed, ' + base.failed + ' failed  (clean)');
    console.log('');
    console.log('injecting ' + FAULTS.length + ' faults:');
    console.log('');

    FAULTS.forEach(function (f, idx) {
      var dir = path.join(tmpRoot, 'fault-' + (idx + 1) + '-' + f.id);
      fs.mkdirSync(dir, { recursive: true });
      copyTree(dir);

      var target = path.join(dir, f.file);
      var src = fs.readFileSync(target, 'utf8');
      var hits = occurrences(src, f.find);

      var row = { fault: f, failures: null, status: null, passed: null };

      if (hits !== 1) {
        /* The code moved out from under the fault definition. Treat as a hard
           error: an unmatched search string is NOT evidence of anything. */
        row.status = 'STALE';
        row.detail = 'search string matched ' + hits + ' times, expected exactly 1';
        undetected.push(row);
      } else {
        fs.writeFileSync(target, src.replace(f.find, f.replace), 'utf8');
        var r = runSuite(dir);
        row.passed = r.passed;
        row.failures = r.failed;

        if (r.crashed) {
          /* The suite never reached its report. Not a clean assertion, so it
             is not counted as detection. */
          row.status = 'CRASH';
          row.detail = 'suite crashed (exit ' + r.exit + (r.signal ? ', signal ' + r.signal : '') + ')';
          undetected.push(row);
        } else if (r.truncated) {
          /* The suite clearly failed but its summary line was lost. Treat as
             detected, and say so, rather than reporting a phantom crash. */
          row.status = 'DETECTED*';
          row.detail = 'failures seen, count line truncated';
        } else if (r.failed > 0) {
          row.status = 'DETECTED';
        } else {
          row.status = 'UNDETECTED';
          undetected.push(row);
        }
        if (VERBOSE) {
          console.log('--- output for ' + f.id + ' ---');
          console.log(r.output.trim());
          console.log('');
        }
      }

      results.push(row);
      var count = row.failures === null ? '   -' : String(row.failures).padStart(4);
      console.log('  ' + String(idx + 1).padStart(2) + '. ' +
                  row.status.padEnd(11) + count + ' failures  ' + f.id +
                  (row.detail ? '  [' + row.detail + ']' : ''));
    });
  }
} finally {
  rmrf(tmpRoot);
}

/* Integrity: the real sources must be untouched. */
var after = hashOriginals();
var tampered = NEEDED.filter(function (rel) { return before[rel] !== after[rel]; });

console.log('');
if (tampered.length) {
  console.log('INTEGRITY FAILURE - these repo files changed during the run:');
  tampered.forEach(function (rel) { console.log('  ' + rel); });
  process.exit(1);
}
console.log('integrity: all ' + NEEDED.length + ' source files unchanged (sha256 verified before/after)');

if (hardFail) {
  console.log('');
  console.log('RESULT: ' + hardFail);
  process.exit(1);
}

if (MARKDOWN) {
  console.log('');
  console.log('| Injected fault | Failures |');
  console.log('| --- | --- |');
  results.forEach(function (r) {
    console.log('| ' + r.fault.label + ' | ' + (r.failures === null ? 'n/a' : r.failures) + ' |');
  });
}

console.log('');
if (undetected.length) {
  console.log('RESULT: ' + undetected.length + ' of ' + FAULTS.length +
              ' faults NOT detected - the parity suite does not constrain them:');
  undetected.forEach(function (r) {
    console.log('  - ' + r.fault.id + ' (' + r.fault.note + ')' +
                (r.detail ? ': ' + r.detail : ''));
  });
  process.exit(1);
}

console.log('RESULT: all ' + FAULTS.length + ' faults detected - the parity suite ' +
            'mechanically catches drift on either side');
process.exit(0);
