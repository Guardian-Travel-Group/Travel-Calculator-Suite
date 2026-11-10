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

**Locally:** open `web/index.html` in a browser.

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
  index.html              markup, three tab panels, Instructions panels
  assets/css/styles.css   design tokens, responsive layout, light/dark themes
  assets/js/calc.js       PORTED CALCULATION CORE — pure, no DOM
  assets/js/app.js        UI layer only: reads inputs, renders results
  tests/
    hta-sandbox.js        loads the real HTA's <script> into a stubbed DOM
    legacy-render.js      re-renders the port's output as the HTA's HTML
    parity.test.js        247 assertions: port vs. live HTA code
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
| `TCS V5` | `a02366baa021a4eef4ebe78667b98d4e` |
| `Travel Calculator Suite.hta` | `a02366baa021a4eef4ebe78667b98d4e` |
| `installer-package/Travel Calculator Suite.hta` | `a02366baa021a4eef4ebe78667b98d4e` |

All three are byte-identical and are the only copies containing the
Partial Package Refunds tab. (`Travel-Calculator-Suite V3` and
`travel_calculator_suite_updated_v2.hta` are older and lack it — not used.)

> **Note:** the HTA was `d9304122b4e2d60772545c129b371a9a` at `a735813`. It
> changed in this branch — and only in this branch — to apply the bounded-count
> fix described below. That change was explicitly approved, because the fix has
> to land in both builds for parity to stay meaningful. No formula, rounding
> step, or message text was altered.

### Verifying parity

```
node web/tests/parity.test.js
```

The suite loads the **real HTA script block** into a stubbed IE-ish DOM, runs
both implementations over the same inputs, and asserts the resulting
error / summary / results HTML is **identical string-for-string** — so a drift
of one cent, one label, or one validation message fails the run.

Current status: **329 passed, 0 failed** (313 scenarios compared against live
HTA code + 16 unit invariants).

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
121), the clamp write-back, `Infinity`, `-Infinity`, `NaN`, `1e500`, and huge
finite values (`999999999`, `2147483647`).

The harness was mutation-tested to confirm it is not vacuous. Six deliberate
breaks were each caught:

| Injected fault | Failures |
| --- | --- |
| refund rate `0.20` → `0.21` | 16 |
| schedule `Math.round` → `Math.floor` | 53 |
| port payment cap `120` → `121` (HTA left at 120) | 18 |
| port package cap `50` → `49` (HTA left at 50) | 8 |
| remove the port's non-finite payment guard | 4 |
| **HTA** payment cap `120` → `130` (port left at 120) | 18 |

The last row matters: parity breaks whichever side drifts, so the two builds
cannot silently diverge.

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
the DOM write. The parity suite compares the resulting **field value** in
addition to the rendered HTML, so a write-back present in one build but not the
other fails the run.

---

## Known legacy behaviours (deliberately preserved)

These are quirks of the HTA. They are reproduced exactly, because changing one
would change the number a staff member reads out to a customer. **Do not "fix"
them without a business decision.**

1. **Inconsistent input parsing between tabs.**
   - Payment and Refund tabs use `parseFloat`/`parseInt`, which parse prefixes:
     `"2500abc"` → `2500`, `"6.7"` payments → `6`, `"1e3"` → `1000`.
     Commas are **not** handled here, so `"2,500"` → `2`.
   - The Partial Refunds tab uses the strict `parseMoney`, which accepts
     `$`, commas and ≤2 decimals (`"$4,923.00"` → `4923`) and rejects
     `"1000.123"`, `"1e3"` and `"1000abc"` outright.

2. **Over-deposit is not blocked.** A deposit above the package price yields a
   negative remaining balance and negative scheduled payments. The HTA allows
   it; so does this build.

3. **Package count vs. rows.** If the count exceeds the number of price rows,
   the HTA skips the missing ones (`if (!priceInput) continue;`). The web build
   passes a hole through so the same skip happens. Note `Total TPP` is still
   `TPP × count`, so a mismatch shifts the allocation exactly as it did before.

4. **`Total Package Price` rounding.** The running total accumulates unrounded
   prices and is rounded once at the end, while each displayed package price is
   rounded individually. Preserved.

5. **Refund tab timestamp** is local machine time, as before.

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
