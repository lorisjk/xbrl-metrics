# The Ticker Summary — A Written Lede for Every Ticker

**Task:** a short paragraph of real prose above every ticker's charts, stating the values the
snapshot already publishes as sentences instead of table cells, so that a search engine and a
person skimming a result have something readable to judge the page by.

Everything below was measured against the shipped export — 609 tickers, `frontend/public/`.

**Three of the brief's premises did not survive the data, and each changed the design:**

1. **The four named tickers are not "no valuation history at all".** V, STZ, ERIE and BKR carry
   378–740 rows of valuation history with 5–8 non-null multiples each. What they lack is exactly
   one thing: **P/E**. §1.3.
2. **The export has no company names.** `universe.json` is `{ticker, profile, n_metrics,
   n_valuation, n_growth}`, so "the company name and ticker" cannot both be stated. The ticker is
   the subject of every sentence, and inventing a name table would be the pipeline change this
   task excludes. §1.2.
3. **The snapshot's revenue-growth figure and the growth chart's Revenue panel are different
   quantities**, and not slightly: median 3.06pp apart, p90 15.09pp, max 196.30pp, **0 of 597
   identical**. So the sentence has to name which one it quotes. §1.4.

---

## 1. Step 1 — what is actually there, and what the summary says

### 1.1 Coverage, measured over all 609 tickers

Every figure a summary could quote, counted from the exported per-ticker `current_snapshot`:

| snapshot concept | tickers | coverage |
|---|---:|---:|
| `price` | 609 | 100.0% |
| `revenue_ttm` | 607 | 99.7% |
| `yoy_growth` | 597 | 98.0% |
| `market_cap` | 591 | 97.0% |
| `eps_ttm` | 574 | 94.3% |
| **`pe_ratio`** | **517** | **84.9%** |
| `ev_sales` | 513 | 84.2% |
| `pfcf_ratio` | 429 | 70.4% |
| `dividend_yield` | 398 | 65.4% |
| `ev_ebitda` | 365 | 59.9% |
| `p_tbv` | 40 | 6.6% |
| `p_ffo` | 27 | 4.4% |
| `p_ppnr` | 24 | 3.9% |
| `p_core_earnings` | 14 | 2.3% |

**A template that assumes a P/E is wrong for 92 tickers, not four.** That is the finding the brief
asked for and it is 15.1% of the universe, not 0.7%.

Named absences, in full:

```
no yoy_growth  (12): APLD, AUR, CRDO, EQR, FIG, HNGE, IONQ, NAVN, OXY, PSKY, Q, TAP
no market_cap  (18): ADI, AMG, AZO, BBY, COO, CPB, CRM, DAL, EL, HD, HPQ, HRL, IOT, KR,
                     LOW, MU, P, TGT
no revenue_ttm  (2): EQR, PSKY   -- and both of those have no growth figure either
```

### 1.2 The template

Four sentences, of which **only the first is mandatory** — it needs the ticker and the profile,
both of which the registry has for every ticker by construction. Each of the other three is a
clause that drops on its own, and every drop a reader could mistake for "this company has no such
figure" is replaced by a sentence that says so.

```
1.  {TICKER} is covered here under the {profile} profile. Every figure below is computed
    from {TICKER}'s own SEC EDGAR XBRL filings, as of {YYYY-MM-DD}.

2a. Trailing-twelve-month revenue is {revenue_ttm}; year-over-year revenue growth
    is {yoy_growth}.
2b. Trailing-twelve-month revenue is {revenue_ttm}. No year-over-year revenue growth
    figure is available for {TICKER} in this export.
2c. Year-over-year revenue growth is {yoy_growth}.
2d. No trailing-twelve-month revenue figure is available for {TICKER} in this export.

3a. {TICKER} trades at {a|an} {label} of {value}, on a market capitalisation of {market_cap}.
3b. {TICKER} trades at {a|an} {label} of {value}.

4a. {preferred label} is not available for {TICKER} in this export, so the multiple above
    is the next one the {profile} profile shows.
4b. No valuation multiple is available for {TICKER} in this export.
```

**Sources, none of them invented:**

- **the profile** — `registry.ticker_profile[ticker]`, spelled as the sidebar spells it
  (`AAPL — standard`), so no second naming vocabulary exists.
- **the date** — `meta.run_start.slice(0, 10)`, through `runDate` in the new
  `shell/provenance.ts`, which is now the *only* expression producing that string: the sidebar's
  "Data as of" line reads the same function. Two lines about when the data is from cannot disagree.
- **the multiple's name** — `registry.metrics[].label`: "P/E (TTM)", "P/TBV", "P/FFO (TTM)",
  "P/FCF (TTM)", "P/PPNR", "P/Core Earnings", "EV/EBITDA", "EV/Sales", "P/B".
- **the company** — the ticker, because there is no name in the export (see the preamble).

`{a|an}` is a rule on the label's first token, not a vowel test: every label that *starts* with a
vowel letter here is an EV multiple ("an EV/EBITDA") and every one starting with a consonant
letter is a P/ multiple read as "pee" ("a P/E"). A vowel test would say "an P/E".

### 1.3 The valuation figure is chosen by the registry, never hardcoded

One priority order, intersected with `registry.profile_visibility[profile]`:

```
p_ffo > p_tbv > pe_ratio > p_ppnr > p_core_earnings > ev_ebitda > pfcf_ratio > ev_sales > p_b
```

The first three are the distinction the brief names; the tail is the fallback, ordered earnings →
cash flow → sales → book. Measured outcome, and it is the encyclopedia's own split:

| profile | headline multiple |
|---|---|
| reit (29) | **p_ffo 27**, ev_sales 1, pb_ratio 1 |
| financial (26) | **p_tbv 25**, pe_ratio 1 |
| insurance_life (5) / insurance_pc (12) | **p_tbv 15**, pe_ratio 2 |
| standard (216) | **pe_ratio 175**, pfcf_ratio 19, ev_ebitda 15, ev_sales 5, pb_ratio 2 |
| utilities (31) | pe_ratio 31 |
| …the other 19 profiles | pe_ratio, with 13 fallbacks |

**A REIT can never be quoted a P/E**: the reit profile hides `pe_ratio` outright, so it is not in
`shown` at all — asserted for all 29 reits rather than assumed.

**0 of 609 tickers end with no multiple**, which is why sentence 4b never fires on today's export
— but it is implemented, because Step 2.3 forbids rendering blank and a future export could reach
it. It is verified on a synthetic empty snapshot in §4.2.

### 1.4 The four-ticker case, corrected and stated

The brief says V, STZ, ERIE and BKR "have no valuation history at all". Measured:

| ticker | valuation_history rows | non-null multiples | `eps_ttm` | `pe_ratio` |
|---|---:|---|---|---|
| V | 740 | pb_ratio 69, pfcf_ratio 67, pfcf_ex_sbc 66, ev_fcf 51, ev_ebitda 51, ev_sales 51, dividend_yield 34 | — | — |
| STZ | 700 | pfcf_ratio 62, ev_fcf 62, pfcf_ex_sbc 62, ev_ebitda 62, ev_sales 62, pb_ratio 45 | — | — |
| ERIE | 710 | pb_ratio 67, pfcf_ratio 51, ev_fcf 9, ev_sales 9, ev_ebitda 3 | — | — |
| BKR | 378 | buyback flag 37, pb_ratio 2, pfcf_ratio 2, ev_fcf 2, pfcf_ex_sbc 2, ev_sales 2 | **−0.047** | — |

So the honest gap is not "no valuation" — it is **"no P/E"**, and for two different reasons the
summary is deliberately not allowed to state: V, STZ and ERIE have no `EarningsPerShare` tag at
all (the `companyfacts` endpoint returns 404, per the dei-fallback cycle), while BKR's trailing
EPS is *negative* and `pe_ratio` requires a positive denominator. The component sees only an
absent value, so it says only that:

> **P/E (TTM) is not available for V in this export, so the multiple above is the next one the
> standard profile shows.**

Naming both the missing multiple and the substitute is the whole point. A summary that silently
printed EV/EBITDA where a P/E was expected would read perfectly and be dishonest. **68 of 609
tickers get this sentence** — the four named ones among them.

### 1.5 Year over year, not quarter over quarter — and which YoY

**Not QoQ**, on the growth cycle's own measurement: quarter-over-quarter growth is not seasonally
adjusted, so a seasonal filer shows a regular yearly cycle that is the calendar and not the trend
— DECK's QoQ amplitude is 32× its YoY. A one-sentence lede has nowhere to put that caveat, so it
quotes the rate that does not need it.

**And the sentence names which YoY, because there are two.** The snapshot's `yoy_growth` is
`Revenue_TTM` growth; the growth chart's Revenue panel is the *quarterly* `Revenue` concept's YoY.
Over the 597 tickers that have both:

```
|difference|   median 3.06pp   p90 15.09pp   max 196.30pp   identical: 0 of 597
```

They are genuinely different quantities, so the summary says **"Trailing-twelve-month revenue
growth"** in full. It quotes the snapshot's, for three reasons: every other figure in the sentence
comes from `current_snapshot`, so mixing frames would let one paragraph carry two different
as-of moments; the TTM base removes seasonality a second time; and it is the figure the pipeline
itself publishes as *the* current revenue growth (`pe_to_revenue_growth` divides by it). The cost
is measured and stated: 12 tickers have a chart growth point and no snapshot one, and they get
sentence 2b instead.

### 1.6 Formatting — the same functions, and one deliberate divergence

Every number goes through `valueFormat` + `formatCell` from `data/format.ts` — the exact pair the
data tab's snapshot section calls. String equality is verified, not value equality (§4.3).

**One concept needs an alias, and it exposes a real defect.** The snapshot publishes revenue
growth under the concept name `yoy_growth`, which is **not a registry id**, so `valueFormat` finds
no metric, falls to the magnitude rule, and prints `0.1424`. The identical quantity in
`metrics_long` is `revenue_yoy_growth`, which the registry marks `percent: true` and which prints
`14.24%`. **The data tab shows both spellings today, for one ticker, on one screen.**

`FORMAT_ALIASES` maps `yoy_growth → revenue_yoy_growth`, so the summary says what the registry
says the metric is. The divergence from the snapshot table is deliberate, is the only one, and is
asserted explicitly in the check rather than left to be noticed:

```
the one deliberate divergence: yoy_growth   data tab "0.1424"   summary "14.24%"
```

The underlying inconsistency is a follow-up (§6), because closing it means renaming a published
snapshot concept.

Everything else needs no alias: the valuation ids *are* registry ids, and `revenue_ttm` /
`market_cap` reach `absolute` on their own magnitude exactly as the table does. Ratios therefore
carry the table's four decimals — `P/E (TTM) of 35.5284` — which reads oddly in prose and is
kept, because Step 4.4 asks for string identity with the table and getting that means taking its
rounding rule whole.

---

## 2. Step 2 — design

### 2.1 Where it sits: `App.tsx`, above `ChartView`

Of the two placements Step 2.1 offers, the first — and the third reason is a measurement.

1. **It has to be on every tab.** `ChartView` renders inside `<div hidden={!isChartTab(tab)}>`, so
   a summary living in it would be invisible on Data, Raw Facts and Comparison. **Data is
   `DEFAULT_LOCATION.tab`** — the tab a link with no tab in it lands on, and the tab the next
   task's static page will land on. A summary that is absent from the default tab is absent from
   the page being prerendered.
2. **It is prose about the ticker, not about a chart.** The three chart tabs are one `ChartView`
   with a different `chart` prop; the summary does not change between them, so putting it inside
   would make a component redraw on a prop it ignores.
3. **In `.content__body`, not up in `.content__sticky`** — which is where "above the tab strip"
   would have put it. That block is `position: sticky`, and it was measured at five viewports
   before and after:

   | viewport | sticky header, before | with the summary in it |
   |---|---:|---:|
   | 1920×1080 | 337px | 438px |
   | 1400×900 | 359px | 460px |
   | 1280×800 | 359px | 460px |
   | 820×1180 | 364px | 463px |
   | **390×844 (phone)** | **690px (82% of the viewport)** | **879px — 104%** |

   On a phone that is a sticky block taller than the screen, with the tab strip pushed off the
   bottom and unreachable. Re-measured after moving it into the body: **337 / 359 / 359 / 364 /
   690px — identical to before this task**, and asserted in the DOM check (`the summary is not
   inside the sticky header`). It is still the first element in `.content__body`, above every
   tab's content.

### 2.2 Data source: no second fetch

`useTickerFrames(ticker)` — the same call `ChartView` makes, behind the same promise cache in
`DataProvider` (*"The promise is cached, not the result, so two components asking for the same
ticker in the same tick share one request instead of racing"*). Mounting the summary costs **zero
additional requests**: whichever component mounts first makes the request and the other gets the
same promise.

`current_snapshot` is one of the four frames already in that file. **Nothing was added to any
fetch**, no field, no file. `facts_full` (`useTickerFacts`) is not touched — the summary needs
nothing from it, so the largest file in the export stays deferred.

### 2.3 Loading, and the failure cases

- **Loading** — `p.ticker-summary` **does not exist**. A plain `<p class="caption">Loading AAPL…</p>`
  renders instead. That is deliberately the `About.tsx` pattern (`section.about` exists only once
  the fetch has resolved) and it is what gives the next task a marker it cannot capture half-loaded.
- **Fetch failed** — renders `null`. `ChartView` and `DataTab` already report a failed per-ticker
  fetch; a second copy of that message above them would say the same thing twice, and there is no
  sentence to write about a company whose file did not arrive.
- **Missing figures** — sentences 2b/2c/2d and 4a/4b, all of which state the absence.

### 2.4 Semantics

One real `<p class="ticker-summary" data-ticker="AAPL">` holding plain text. Not `aria-hidden`,
not inside an `<svg>`, not a `<title>` element, visible with a non-zero box — all four asserted in
the browser (§4.5).

---

## 3. What was implemented

| file | change |
|---|---|
| `frontend/src/shell/summary.ts` | **new**, ~200 lines. `VALUATION_PRIORITY`, `FORMAT_ALIASES`, `formatSnapshot`, `pickValuation`, `buildSummary`. No React, so Node runs it. |
| `frontend/src/TickerSummary.tsx` | **new**, ~85 lines. Reads `useTickerFrames`, flattens `current_snapshot` to a concept→value map, calls `buildSummary`. |
| `frontend/src/ticker-summary.css` | **new**, 8 declarations. |
| `frontend/src/shell/provenance.ts` | **new**, 20 lines. `runDate(meta)` — moved out of `Freshness.tsx` so one expression serves both callers. |
| `frontend/src/shell/Freshness.tsx` | **−1/+2**. Reads `runDate` from the new module. |
| `frontend/src/App.tsx` | **+27/−0**. One import, one element, and the comment recording §2.1. |
| `frontend/scripts/check-summary.mjs` | **new**, the fourth standing check (§4.1). |

**Nothing else.** No chart builder, no `panel.ts`/`grid.ts`/`mean.ts`, no contract, no pipeline,
no export, no route. `summary.ts` is imported by exactly one file, and no module under
`src/charts/` imports either of the new ones.

`check-summary.mjs` is the one addition beyond the brief's list, and it is deliberate: it is the
only one of the four standing checks that needs no server and no browser, it is what §4.1–4.4
actually run, and a verification that exists only in a report cannot catch the next regression.

---

## 4. Step 4 — verification

### 4.1 Every value against its source, all 609 tickers: **10,573 / 10,573**

`check-summary.mjs`, against `public/` with no browser. Per ticker: the mandatory sentence names
the ticker, the profile and the run date; every figure quoted is that ticker's own snapshot value
formatted by `data/format.ts`, compared **as a string**; the multiple quoted is one the profile
shows and no second multiple appears; a substitution is announced and never falsely claimed; a
missing figure produces its sentence; `buildSummary` is deterministic on one input.

**The check is sensitive, proven by four mutations** — and the first one is why it is worth
saying so:

| mutation | result |
|---|---|
| **M1** — prepend `pe_ratio` to every profile's list (the "hardcoded for all three" failure the brief names) | **40 failures** |
| M2 — drop the `yoy_growth → revenue_yoy_growth` format alias | 1 failure |
| M3 — drop the substitution sentence | 68 failures |
| M4 — round every value to 1dp before formatting | 4 failures |

**M1 passed against the first version of this check**, 9,638/9,638, because that version asserted
only internal consistency — it read its expectation out of `pickValuation`, so hardcoding the rule
moved the expectation with it. The check now reads the expectation off
`registry.profile_visibility` directly, and M1 fails on 40 insurance and financial tickers. The
harness was wrong; the code was not.

### 4.2 The edge cases, rendered in full

**The four named tickers** — all four take the P/E fallback, and all four say so:

> **V** is covered here under the standard profile. Every figure below is computed from V's own
> SEC EDGAR XBRL filings, as of 2026-08-21. Trailing-twelve-month revenue is 43.03B;
> year-over-year revenue growth is 14.37%. V trades at an EV/EBITDA of 23.0106, on a market
> capitalisation of 623.25B. **P/E (TTM) is not available for V in this export, so the multiple
> above is the next one the standard profile shows.**

> **BKR** … Trailing-twelve-month revenue is 27.73B; year-over-year revenue growth is 0.42%. BKR
> trades at a P/FCF (TTM) of 19.9233, on a market capitalisation of 62.32B. **P/E (TTM) is not
> available for BKR in this export**, so the multiple above is the next one the energy_integrated
> profile shows.

STZ and ERIE take the same shape (EV/EBITDA 10.1080 and 15.0623).

**Revenue present, growth absent** (12 tickers):

> **APLD** … Trailing-twelve-month revenue is 138.68M. **No year-over-year revenue growth figure
> is available for APLD in this export.** APLD trades at an EV/Sales of 47.3085 …

**No market capitalisation** (18 tickers) — the clause simply ends earlier, which states nothing
false:

> **ADI** … ADI trades at a P/E (TTM) of 43.7695.

**No revenue at all** (EQR, PSKY):

> **EQR** … **No trailing-twelve-month revenue figure is available for EQR in this export.** EQR
> trades at a P/B of 2.2731, on a market capitalisation of 23.87B. P/FFO (TTM) is not available
> for EQR in this export, so the multiple above is the next one the reit profile shows.

**Nothing at all** (0 tickers today; verified on a synthetic empty snapshot, because Step 2.3
forbids rendering blank):

> ZZZ is covered here under the standard profile. Every figure below is computed from ZZZ's own
> SEC EDGAR XBRL filings, as of 2026-08-21. **No trailing-twelve-month revenue figure is available
> for ZZZ in this export. No valuation multiple is available for ZZZ in this export.**

**No `meta.run_start`** — the first sentence drops its final clause rather than printing
"as of undefined":

> ZZZ is covered here under the standard profile. Every figure below is computed from ZZZ's own
> SEC EDGAR XBRL filings. …

### 4.3 Profile-appropriate selection

Asserted per ticker against `registry.profile_visibility`, not against the picker: **reit → P/FFO,
financial and both insurance profiles → P/TBV, standard and utilities → P/E**, whenever the
profile shows it and the value exists. Plus, for all 29 reits, that the paragraph contains no
"P/E (TTM) of " at all — the reit profile hides that metric, so quoting it would be a bug the
priority list alone would not catch. All pass; M1 breaks 40 of them.

### 4.4 Formatting identity

Compared as strings against the data tab's own `formatCell(v, valueFormat(byId, concept, v))`:

```
revenue_ttm   466.82B   ==   466.82B
market_cap    4.54T     ==   4.54T
pe_ratio      35.5284   ==   35.5284
pb_ratio      42.2542   ==   42.2542
ev_sales      9.8237    ==   9.8237
yoy_growth    14.24%    !=   0.1424     <- the one deliberate divergence, §1.6
```

and the divergent one is asserted equal to what the registry metric `revenue_yoy_growth` produces,
so it is not free-handed either.

### 4.5 The rendered page: **149 / 149**

Puppeteer against the dev server, 1400×900.

- **12 tickers × 6 tabs = 72 pairs**: the rendered `textContent` of `p.ticker-summary` is
  byte-identical to `buildSummary`'s string for that ticker, and `data-ticker` names the right
  company — on Data, Raw Facts, Growth, Fundamentals, Valuation and Comparison alike. Sample:
  AAPL, JPM, O, AFL, AEE, AMG, V, STZ, ERIE, BKR, MSFT, PLD.
- **Loading**: with the AAPL request held for 2.5s, `p.ticker-summary` is absent and a `Loading
  AAPL…` caption is present. The marker cannot be captured half-loaded.
- **Identical regardless of entry point** — the property the next task depends on entirely.
  AAPL reached by direct hash (`#/analysis/AAPL/data`), and AAPL reached by *typing into the
  sidebar combobox and clicking the option* after starting on `#/analysis/JPM/valuation`, driven
  with real keystrokes and a real click because the option's handler is `onMouseDown`:
  **byte-identical**.
- **Semantics**: `{"tag":"P","hidden":false,"inSvg":false,"visible":true,"firstInBody":true,"beforeChart":true}`.
- **Not inside `.content__sticky`** (§2.1).

### 4.6 No regression

```
check-chart-width    36/36 chart renders fill their container
check-tab-state      13/13 tab-state and default-route checks pass
check-table-format   6107/6107 cells carry a display format
check-summary        10573/10573
```

All at the baselines the previous cycle left them at. **The chart-builder A/B is vacuous by
construction and the import graph is the evidence**: `shell/summary.ts` is imported by exactly one
file (`TickerSummary.tsx`), no module under `src/charts/`, `src/data/` or `src/contracts.ts` was
touched, and no chart module imports either new file. `check-chart-width` renders all three chart
tabs plus comparison and raw facts in a real browser, from every landing tab, at both sidebar
states — 36 renders, all correct — which is a stronger statement than a digest diff over unchanged
bytes.

**The prerender step, which landed in the previous cycle and now runs on every build, is
unaffected and stayed ticker-independent.** `/` is captured with `.content__body` emptied, and the
summary is the first child of that element, so it is stripped with the rest: `grep -c
ticker-summary dist/index.html` → **0**. About, Encyclopedia and Coverage are not Analysis views
and never had one. All four routes still prerender.

### 4.7 `tsc`, `eslint`, `vite build`

- **`npx tsc -b`: clean**, exit 0.
- **`npx eslint .`: 2 errors, both pre-existing** — `Chart.tsx:11` (`no-explicit-any`) and
  `Sidebar.tsx:94` (`set-state-in-effect`). Neither is in a file this task touched. A third,
  `react-refresh/only-export-components`, appeared briefly when `runDate` was exported from
  `Freshness.tsx` beside its component; that is exactly why `DataContext.ts` was split out of
  `DataProvider.tsx`, and `shell/provenance.ts` is the same answer.
- **`npm run build`: clean**, 11.2s, all four routes prerendered.

---

## 5. What the next task needs to know

**The marker to wait on is `p.ticker-summary`, and it exists only in the loaded state.**

```
await page.waitForSelector('p.ticker-summary[data-ticker="AAPL"]');
```

Exactly the shape `section.about` already gives that step, and for the same reason: while
`useTickerFrames` is in flight the component renders a `<p class="caption">Loading …</p>` with no
such class, so a prerender that waits on this selector cannot capture a half-loaded page. Add the
`[data-ticker]` predicate — it is what distinguishes "this ticker's summary has rendered" from
"the previous ticker's is still on screen", which matters because `useTickerFrames` reports a
result for a different ticker as "still loading" and the DOM briefly holds neither.

Four further things that route depends on and which are now measured:

1. **The summary is byte-identical regardless of how the ticker was reached** (§4.5), so the
   static page and the interactive one cannot say different things about one company. That is the
   cloaking property the brief flags, and it holds because there is one code path: one pure
   function of `(ticker, profile, snapshot values, registry, asOf)`.
2. **It renders on the Data tab**, which is `DEFAULT_LOCATION.tab` and therefore where a
   `/ticker/AAPL` page with no tab in it lands. Placing it inside `ChartView` would have made it
   absent from exactly that page (§2.1).
3. **It is the first element of `.content__body`.** A per-ticker capture that strips or truncates
   the body — the way `/`'s capture does today — would strip the summary with it. That route wants
   the opposite: keep the body, or keep at least its first child.
4. **`check-summary.mjs` already asserts the sentences** against the export with no browser, so
   the prerender check only has to assert that the *captured HTML* contains the string
   `buildSummary` produces — the same two-source comparison §4.5 does in the DOM.

---

## 6. Follow-ups

**1 — the snapshot publishes revenue growth under a name the registry does not know.** `yoy_growth`
against `metrics_long`'s `revenue_yoy_growth`, the same quantity; the data tab prints `0.1424` for
one and `14.24%` for the other on the same screen. `FORMAT_ALIASES` routes the summary to the
right one, and the alias is one entry precisely so the defect stays visible. Closing it properly
means renaming a published snapshot concept (`main.py`'s `build_snapshot` melts
`metrics["revenue_growth"]`'s column name straight through), which is a pipeline change.

**2 — the sticky header is 690px on a 390×844 phone, 82% of the viewport, before this task.**
Measured at five sizes in §2.1. The summary was moved out of it rather than making it worse, but
`.content__sticky` holding the `<h1>`, the update notice and the intro paragraph is a layout
question of its own.

**3 — ratios read as `35.5284` in prose**, because that is the four-decimal rule the data tab
applies to any value under `ABSOLUTE_THRESHOLD`. Kept for string identity with the table (§1.6). A
prose-specific rounding rule would be a second formatter, which is the thing this task most
deliberately did not build.

**4 — the export carries no company names.** "Apple Inc." would be a better search result than
"AAPL", and `universe.json` is where a `name` column would go — one field in `export_for_app`, and
a source for it that is not yfinance-dependent. Out of scope here twice over: it is a pipeline
change, and the summary must not invent one.

**5 — 12 tickers quote no growth figure** because `current_snapshot` has no `yoy_growth` for them
while the growth chart's Revenue panel does. Whether the snapshot should carry the chart's figure
as a fallback is a pipeline question, and §1.5 measures why the two are not interchangeable.

---

### Verification performed

- Coverage of all 14 quotable snapshot concepts counted over 609 tickers from the exported
  per-ticker JSON; the four named tickers' valuation history counted row by row.
- 597 paired comparisons of the snapshot's `Revenue_TTM` growth against the growth chart's
  `Revenue` YoY, to establish that they are different quantities.
- 10,573 assertions over all 609 tickers, browser-free, and the harness proven to fail under four
  separate mutations — including one that the first version of it passed.
- 149 browser assertions over 12 tickers × 6 tabs, a held request, a real combobox interaction,
  and the DOM semantics.
- Sticky-header height measured at five viewports before and after the placement decision.
- The three existing standing checks re-run at their baselines, and the prerender step re-run to
  confirm the homepage capture stayed ticker-independent.

No scratch files left behind; `data/`, the pipeline and the export untouched.
