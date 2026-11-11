# Travel Calculator Suite — web build

A browser-based version of the Travel Calculator Suite for modern desktop and
mobile browsers. It contains all three calculators with **math ported directly
from the HTA**, not rewritten.

The Windows HTA remains the Windows fallback. It received one approved change in
this branch — a bounded payment/package count, applied identically to both
builds — and is otherwise unaltered. See "Bounded counts" below.

---

## Running it

It is a static site. No server, no build step, no dependencies.

**Locally:** open `web/Webapp.html` in a browser (double-click it).

**Hosted:** serve the `web/` directory. `index.html` is a small redirect to
`Webapp.html`, so the root URL loads the app on any static host (Wix, Netlify,
S3, IIS, an internal share) rather than showing a directory listing. It uses a
meta refresh plus a plain link, so it works with JavaScript disabled.

**Served (recommended for staff):** publish the contents of `web/` to any static
host — SharePoint, IIS, nginx, S3, Netlify, GitHub Pages, a file share. Nothing
needs to run server-side.

```
python3 -m http.server 8080    # from inside web/, for a quick local check
```

---

## Files

```
web/
  Webapp.html             THE APP — markup, three tab panels, Instructions
  index.html              redirect stub so hosted root URLs still work
  assets/css/styles.css   design tokens, responsive layout, light/dark themes
  assets/js/calc.js       PORTED CALCULATION CORE — pure, no DOM
  assets/js/app.js        UI layer only: reads inputs, renders results
  tests/
    hta-sandbox.js        loads the real HTA's <script> into a stubbed DOM
    legacy-render.js      re-renders the port's output as the HTA's HTML
    parity.test.js        700 assertions: port vs. live HTA code
    mutate.test.js        injects drift; fails if the suite can't catch it
```

The split matters: **all arithmetic lives in `calc.js`**, which is a pure module
with no DOM access. `app.js` never does math. That keeps `calc.js` readable
side-by-side with the HTA's `<script>` block.

---

## Math parity

`calc.js` mirrors the HTA function-for-function, in the same order, with the
same rounding points. Every ported block carries an `[HTA NNN]` comment giving
the line number in the authoritative artifact so it can be diffed directly.

Authoritative source artifact:

| File | md5 |
| --- | --- |
| `TCS V5` | `ab8c37c5b0464eff94b1c549e6f095ce` |
| `Travel Calculator Suite.hta` | `ab8c37c5b0464eff94b1c549e6f095ce` |
| `installer-package/Travel Calculator Suite.hta` | `ab8c37c5b0464eff94b1c549e6f095ce` |

All three are byte-identical and are the only copies containing the
Partial Package Refunds tab. (`Travel-Calculator-Suite V3` and
`travel_calculator_suite_updated_v2.hta` are older and lack it — not used.)

> **Note:** the HTA was `d9304122b4e2d60772545c129b371a9a` at `a735813`. It
> changed in this branch — and only in this branch — to apply four approved
> changes that have to land in both builds for parity to stay meaningful: the
> bounded-count fix, the money/percentage parsing fix, the deposit upper
> bound, and the Partial tab's Total Package Price field and its
> reconciliation rule. All are described below. No formula or rounding step
> was altered. The Partial tab gains one input and one renamed label
> ("Total Amount Paid on Receipt" is now "Amount Paid", same element id, same
> role in the math); the other message-text changes are existing validation
> messages now being *reached* by inputs that previously parsed silently.

### Verifying parity

```
node web/tests/parity.test.js     # math + UI parity vs the live HTA
node web/tests/mutate.test.js     # proves the suite above actually bites
```

Both exit 0 on success and non-zero on failure, so either can gate a merge.
No `package.json`, no dependencies, no build step — plain `node`.

The suite loads the **real HTA script block** into a stubbed IE-ish DOM, runs
both implementations over the same inputs, and asserts the resulting
error / summary / results HTML is **identical string-for-string** — so a drift
of one cent, one label, or one validation message fails the run.

Current status: **701 passed, 0 failed** (664 scenarios compared against live
HTA code + 37 unit invariants).

Coverage includes the three gates called out for review:

- **Final-payment cent adjustment** — 22 indivisible balances × both
  deposit-match modes, plus payment counts 1–60, plus the `n=1` +
  "Payment 1 matches deposit" case where the remaining schedule is empty.
- **Refund formula** — `Amount Paid - (TPP + 20% of Package Cost)`, with the
  zero floor probed at exactly zero and ±1 cent.
- **Partial-refund allocation** — TPP paid first, remainder proportional to
  package price; the TPP-shortfall branch probed at exactly total TPP and
  ±1 cent; zero-price packages; the trip-value overpay guard at +1 cent.

…and the bounded-count behaviour described below: the cap boundary (119 / 120 /
121), the clamp write-back on **both success and error paths**, `Infinity`,
`-Infinity`, `NaN`, `1e500`, and huge finite values (`999999999`,
`2147483647`).

### Mutation testing (a gate, not a note)

A green parity suite does not by itself prove anything: a suite that asserts
nothing useful is also green. The drift-detection property is the whole premise
of this port, so it is enforced by a committed executor rather than described
in prose:

    node web/tests/mutate.test.js              # all faults
    node web/tests/mutate.test.js --verbose    # plus each suite's output
    node web/tests/mutate.test.js --markdown   # regenerate the table below

It injects each known class of drift in turn, runs the parity suite against the
live HTA, and **exits non-zero if any fault goes undetected**. The table below
is generated by `--markdown`; regenerate it rather than editing by hand.

| Injected fault | Failures |
| --- | --- |
| refund rate `0.20` -> `0.21` | 43 |
| schedule `Math.round` -> `Math.floor` | 64 |
| port payment cap `120` -> `121` (HTA left at 120) | 60 |
| port package cap `50` -> `49` (HTA left at 50) | 25 |
| remove the port's non-finite payment guard | 1 |
| **HTA** payment cap `120` -> `130` (port left at 120) | 60 |
| stop reporting the payment clamp on error returns | 43 |
| stop reporting the package clamp on error returns | 26 |
| harness ignores the clamp on error paths (hides the bug) | 42 |
| report a clamp on a *pre*-clamp rejection | 58 |
| revert money parsing to `parseFloat` (comma defect) | 29 |
| revert refund money parsing to `parseFloat` | 17 |
| revert percentage parsing to `parseFloat` | 4 |
| loosen parseMoney to accept 3 decimals | 24 |
| remove the deposit upper bound entirely | 21 |
| remove the deposit upper bound (dollar mode) | 29 |
| bound the deposit at full price even when Payment 1 mirrors it | 18 |
| reject a deposit EQUAL to the limit (`>=` instead of `>`) | 9 |
| drop the Total Package Price reconciliation check entirely | 11 |
| reconcile against `tripValue` instead of `totalPackagePrice` | 89 |
| make the reconciliation error `failEarly`, losing the clamp write-back | 4 |
| drop the Number of Packages vs priced rows check entirely | 8 |
| only reject when the count is SMALLER than the rows | 8 |
| make the count/rows error `failEarly`, losing the clamp write-back | 5 |

Two rows matter especially. The **HTA** cap row is the single most valuable
assertion in the project: drift introduced on the *HTA* side, with the port
left alone, must also fail — that is what keeps two copies of the same math in
lockstep. The *"harness ignores the clamp on error paths"* row is a past
blocker's own signature: before it was fixed the suite could not see that bug,
and now hiding it in the test fails the run.

**One fault was written and then removed, deliberately.** A *"compare the
reconciliation in floats instead of cents"* mutant was added and proved to be
an **equivalent mutant** — a change that cannot alter observable behaviour, so
no test could ever kill it. Both sides of that comparison are already
normalised to two decimals before it runs (the left by `roundMoney`, the right
by `parseMoney`, which rejects a third decimal), and IEEE-754 division is
correctly rounded, so `k/100` is the identical double a 2dp literal parses to.
Verified across all 2,000,001 cent values to $20,000.00, 400,000 random
multi-row sums up to 1e8, and the 2^53 boundary: zero divergences. Keeping it
would have left the gate permanently red for no defect. The cents comparison
remains the correct code — it stays robust if the rounding above ever moves.

**Watch the thin margin.** The *"remove the port's non-finite payment guard"*
row now fails on a single scenario. Unifying the parsers is what narrowed it:
`parseMoney` rejects `"Infinity"` and `"1e500"` before they can reach the
finite guards, so the only input still exercising them is a 400-digit run of
`9`s, which is valid money syntax and still overflows to `Infinity`. Those
digit-overflow scenarios are the reason the guard is still covered at all — the
mutation gate caught this going `UNDETECTED` and the scenarios were added in
response. Do not delete them.

Safety properties, each verified rather than assumed:

- The real working tree is **never** modified. Each fault is applied to a copy
  in a temp directory outside the repo, and the suite runs with its cwd set
  there, so even a core dump lands outside the repo.
- Source hashes are checked before and after the whole run; a mismatch is an
  integrity failure and exits non-zero.
- `SIGKILL` mid-run leaves the repo byte-identical, because nothing in the
  executor ever writes inside it.
- A fault whose search string stops matching (because the code moved) is
  reported `STALE` and **fails**, rather than quietly counting as "detected".
  An unmatched pattern is not evidence.
- Verified with a negative control: a deliberately unobservable no-op mutation
  is correctly reported `UNDETECTED` with exit 1, so the executor cannot
  rubber-stamp a fault the suite genuinely cannot see.
- Deterministic: 10 consecutive runs produce identical per-fault counts.

Building the executor surfaced a reporting bug in `parity.test.js` worth
knowing about. It ended with `process.exit()`, which discards queued stdout
writes when stdout is a pipe. A broad fault produced ~400KB of failure detail,
so under a parent process that captures output the `FAILED:` summary line was
sometimes lost — making a genuinely-detected fault look like a crash. Fixed by
setting `process.exitCode` instead of calling `process.exit()`, and by bounding
the failure report (25 scenarios, 300 chars per value). Exit codes are
unchanged, so this only affects whether the report survives being piped.

---

## Bounded counts (payment count cap)

User-supplied counts drive loops and array allocation, and were previously
unbounded in **both** builds. `999999999` payments exhausted memory and crashed
the process (leaving ~1.2GB core dumps); a non-finite count risked an endless
loop and a hung tab.

Both builds now enforce the same rules:

| Constant | Value | Rationale |
| --- | --- | --- |
| `MAX_PAYMENTS` | 120 | 10 years of monthly payments, far beyond any real travel package |
| `MAX_PACKAGES` | 50 | the pre-existing package ceiling, now also enforced in the calculation |

- **Over-large counts clamp silently**, following the precedent the Partial
  Package Refunds tab already set for package count.
- **Non-finite values are rejected explicitly** with the existing error
  message. `isNaN` alone does *not* catch `Infinity`; `isFiniteNumber()` does.
  This mattered for the money fields too, where `parseFloat("Infinity")`
  returns a real `Infinity` and previously rendered `$Infinity` / `$NaN`.
- `buildFinalAdjustedSchedule()` carries its own defensive bound, because it is
  a public entry point called directly by tests.
- The 50-package clamp is now enforced **inside the calculation**, not only in
  the input builder. The allocation loop runs `count` times regardless of how
  many price rows exist, so a pasted count of 50,000,000 previously stalled the
  HTA for ~26 seconds with just two rows on screen.

### Clamp write-back is visible in both builds

The HTA writes the capped value back into the input field, so staff see the
count change. The web build does the same: `calc.js` stays pure and reports the
clamp via `clampedPaymentCount` / `clampedPackageCount`, and `app.js` performs
the DOM write.

**Ordering matters, because the clamp precedes later validation.** The HTA
clamps and writes the field *before* it validates the deposit (payments tab) or
the amounts, percentage and prices (partial tab). So an over-cap count combined
with some *other* invalid field still leaves the corrected count on screen. To
match this, `calc.js` reports the clamp on **error returns as well as success**,
and `app.js` writes the field **before** its `if (!res.ok) return` guard.

The exact validation order is load-bearing and is mirrored in both builds:

    calculatePayments:       isNaN -> non-finite -> price<0 -> count<1
                             -> CLAMP -> deposit validation
    calculatePartialRefund:  isNaN -> non-finite -> CLAMP -> negatives
                             -> pct>100 -> per-package prices -> overpay

One consequence worth knowing: a *negative package price* is rejected **before**
the clamp runs, so an over-cap count stays as typed in that case. That is the
HTA's behaviour and the port reproduces it, including the asymmetry. Returns
before the clamp point report `null`; returns at or after it carry the clamped
value.

What the user sees when a count is clamped **and** another field is invalid:
the clamped count in the field, the error message beneath it, and no results.
When the count is clamped and everything else is valid: the clamped count and
the results. `calculatePartialRefund` does not rebuild the package rows — that
is the count field's own `updatePartialPackageInputs` handler, which clamps
there too — so results are never suppressed on the clamped-but-valid path.

The parity suite compares the resulting **field value** in addition to the
rendered HTML, on **error paths as well as success paths**. An earlier revision
only exercised the write-back where it already worked, which is how an
error-path divergence shipped; the regression scenarios in sections 1c and 3c
close that gap.

---

## Money and percentage parsing

The HTA originally read the Payment and Refund tabs with bare `parseFloat`.
`parseFloat("4,250")` is `4`, so a `4,250` package price silently produced a
schedule built on **four dollars**, with no error shown. `3,000` in the refund
calculator produced a `$0.00` refund. `$4,250.00` was rejected outright. The
Partial Refunds tab was already correct, which is why the same typing produced
different answers on different tabs.

Parsing is now uniform **by field type**, applied identically in the HTA and in
`calc.js`:

| Field type | Parser | Accepts | Rejects |
|---|---|---|---|
| money | `parseMoney` | `2500`, `2500.50`, `2,500`, `$2,500.00` | `2500.555`, `12abc`, `1e3`, `+2500`, `.`, `-`, `$`, empty |
| percentage | `parsePercent` | `20`, `33.333`, `0`, `100` | `150abc`, `20%`, `1,0`, `1e2`, empty |
| counts | `parseInt` | unchanged | unchanged |

**Judgement call 1 — money is capped at 2 decimals, not rounded.**
`parseMoney` rejects a third decimal rather than rounding it. A dollar figure
with three decimals is a typo or a paste from a different system, and silently
turning `2500.555` into `2500.56` hides it inside a payment schedule the
customer then gets billed against. An explicit error costs one correction; a
silent round can be wrong by a cent on every line and still look plausible.
Rounding remains available in `roundMoney` for computed values — this rule is
only about what a human may *type*.

**Judgement call 2 — percentages get their own parser, not `parseMoney`.**
A percentage has no `$` and no thousands separator, and `33.333%` is a
legitimate value, so `parseMoney`'s 2-decimal cap is wrong for it. But
`parseFloat("150abc")` returning `150` is the same silent-garbage class of bug.
`parsePercent` therefore allows unlimited decimals while still rejecting junk,
trailing symbols and exponent notation. Both percentage fields (deposit
percentage, non-refundable percentage) use it.

### Behaviour changes beyond the comma cases

Measured by diffing 180 inputs across every money and percentage field against
the previous build: 125 identical, 55 changed. All 55 are intended, but three
classes go beyond "commas now work" and a reviewer should know about them:

- `+2500` — a leading `+` is now rejected (was `2500`).
- `0.001` — more than 2 decimals is now rejected (was `0`, silently).
- `1e3` — exponent notation is now rejected (was `1000`).

Each was previously accepted *by accident* on two of three tabs and already
rejected on the third. None are plausible staff entry for a dollar figure, and
every one of them previously produced a silently wrong number rather than a
visible error.

---

## Deposit upper bound

Every validation in `getDepositAmount` used to be a **lower** bound — `isNaN`,
`isFiniteNumber`, `< 0` — and nothing compared the deposit against the package
price. A $5,000 deposit on a $1,000 package was accepted and produced a
**-$9,000 balance with negative scheduled payments**. 150% did the same thing
in percentage mode.

There is now one upper bound, inside `getDepositAmount`, applied to the
**computed dollar amount** in both branches — so an over-large percentage is
caught by the same rule rather than needing a separate `pct > 100` check.

**The limit is not the same on both paths**, and this is the part worth
understanding before changing anything:

| Payment 1 matches deposit | Limit | Why |
|---|---|---|
| No | deposit ≤ price | balance is `price - deposit` |
| Yes | deposit ≤ price / 2 | balance is `price - deposit - deposit` |

When Payment 1 mirrors the deposit, the schedule subtracts the deposit **twice**
(`[HTA 518]`). So bounding the deposit at the package price is *not* sufficient
on that path: a 60% deposit is a perfectly reasonable deposit that nonetheless
overdraws the balance once Payment 1 repeats it. That is why the bound reads
`firstMatchesDeposit ? packagePrice / 2 : packagePrice`.

The double-subtraction arithmetic itself was **left alone deliberately** —
changing it would move every existing schedule. The over-large case is an
explicit error instead.

**Equal to the limit is legal** (`>`, not `>=`). Paying in full up front is
real: it leaves a zero balance and a schedule of `$0.00` lines, not a negative
one. Likewise a deposit of exactly half the price with Payment 1 matching is
legal and lands on zero. Both are covered by scenarios.

Messages name the specific mistake rather than the rule:

- `Deposit cannot be more than the package price. Check for an extra zero, or
  switch to a deposit percentage.`
- `Deposit works out to more than the package price. Check the percentage for
  an extra digit.`
- `Deposit cannot be more than half the package price when Payment 1 matches
  the deposit. Lower the deposit, or set Payment 1 matches deposit to No.`

The bound sits **after** the count clamp, like every other deposit error, so an
over-cap count still corrects to 120 on screen even when the deposit is also
wrong.

### Behaviour change

Measured across 336 deposit combinations (4 prices × 2 Payment-1 modes ×
2 counts × 21 deposit values) against the previous build: 186 identical, 150
changed. **All 150 are a negative schedule becoming an error.** Zero
previously-valid non-negative schedules changed — verified explicitly, because
that was the risk worth checking.

---

## Partial Package Refunds: Total Package Price

The tab takes two distinct figures, because a booking is not always paid in
full:

- **Total Package Price** — what the trip costs in total, from the receipt.
- **Amount Paid** — what the participant has actually handed over so far,
  often less. Partial payment is the normal case and is unconstrained by the
  new field; Amount Paid may be below, equal to, or above the Total Package
  Price, still bounded only by the existing total-trip-value check.

The individual package price rows must add up to the typed Total Package
Price, or the calculator errors and renders nothing:

    Package prices add up to $6000.00 but Total Package Price is $6000.01.
    Check the individual package prices, including any left blank.

Three implementation points that are easy to get wrong:

1. **Compared in integer cents**, never float `===`.
2. **Compared against `totalPackagePrice`**, the same variable the allocation
   uses, so the check and the math can never disagree.
3. **The typed total does not enter the arithmetic.** Allocation stays driven
   by the rows. Since the two must match to pass validation the result is
   identical either way, and leaving the rows authoritative means the existing
   allocation code and its parity assertions are untouched.

The scan loop skips absent rows, so a blank row short-changes the sum and
lands on the same error — hence the wording naming blank rows explicitly.

This is a `failAfterClamp` return: an over-cap package count is still written
back to the field on this error path, per the clamp-reporting contract.

A blank Total Package Price is caught by the existing "please complete..."
early check, which reports no clamp.

---

## Partial Package Refunds: package count must match the priced rows

**This fixed a silent under-refund.** `Total TPP` is `TPP × Number of
Packages`, but the price scan loop skips rows that do not exist
(`if (!priceInput) continue;`). A Number of Packages larger than the rendered
rows therefore billed TPP for **phantom packages that no row reconciles
against**, inflating the non-refundable base and cutting the refund, with no
error shown and a result that looked entirely normal.

Worked example, measured against the calculation module:

| Number of Packages | 3 priced rows totalling $6000, TPP $481, paid $7000 |
| --- | --- |
| `3` (truthful) | Total TPP $1443, trip value $7443, **refund $4357.00** |
| `5` (desynced) | Total TPP $2405, trip value $8405, **refund $3395.00** |

A **$962 under-refund** (2 phantom packages × $481), and the old build
rendered it without complaint. The Total Package Price reconciliation does not
catch this: the rows still add up to the typed total, because the phantom
packages contribute no price, only TPP.

Both builds now require the count and the priced rows to agree:

    Number of Packages is 5 but 3 package price rows are shown.
    Re-enter the Number of Packages so the rows match.

Notes:

- Placed **after** the Total Package Price reconciliation, so that error keeps
  precedence and its existing contract tests are unchanged.
- A `failAfterClamp` return, like its neighbours: an over-cap count is still
  written back to the field on this error path.
- Normally unreachable by typing, because the count field's input handler
  re-renders the rows. It is reached by pasting, autofill, a restored form, or
  any path that sets the value without firing `input`, and by the clamp, where
  a count above `MAX_PACKAGES` is lowered to 50 while the rows stay as they were.

---

## Known legacy behaviours (deliberately preserved)

These are quirks of the HTA. They are reproduced exactly, because changing one
would change the number a staff member reads out to a customer. **Do not "fix"
them without a business decision.**

1. ~~**Package count vs. rows.**~~ **FIXED: this was a money defect, not a
   quirk.** It previously read: *"If the count exceeds the number of price
   rows, the HTA skips the missing ones. Note `Total TPP` is still `TPP ×
   count`, so a mismatch shifts the allocation exactly as it did before."*
   That shift is a **silent under-refund**, so it was not safe to preserve.
   See "Package count must match the priced rows" above.

2. **`Total Package Price` rounding.** The running total accumulates unrounded
   prices and is rounded once at the end, while each displayed package price is
   rounded individually. Preserved.

3. **Refund tab timestamp** is local machine time, as before.

4. **Thousands grouping is not validated.** `parseMoney` strips every comma
   before validating, so `"1,0,0"` parses as `100` rather than erroring. This
   was already live on the Partial Refunds tab before parsing was unified;
   unifying spread it to the other two tabs rather than introducing it.
   Tightening it is a separate decision about what staff may type.

---

## What changed (presentation only)

- Modern responsive layout; CSS Grid two-column above 900px, one column below.
  Replaces the HTA's JS-driven `width <= 760` panel sizing, which existed to
  work around IE9 and is unnecessary in a real browser.
- Proper WAI-ARIA tabs: `role="tablist"`, roving `tabindex`, Arrow/Home/End
  keys, skip link, visible focus rings, `aria-live` result regions.
- Dark mode preserved; now follows the OS by default and remembers an explicit
  choice (`localStorage`). The selected tab is also remembered.
- Inline `onclick`/`onkeyup` attributes replaced with real event listeners.
- Results are built as DOM nodes rather than HTML strings — no `innerHTML` on
  user input, so malformed entries cannot inject markup.
- Instructions panels kept verbatim, restyled as numbered steps in a collapsible
  panel (open by default).
- Money inputs get `inputmode="decimal"` so mobile shows a numeric keypad.
- Print stylesheet included, so a refund breakdown can be printed or saved to
  PDF for a file note.

No formula, rounding step, or message text was changed. The only behavioural
change is the bounded count described above, which is applied identically to the
HTA and the web build.