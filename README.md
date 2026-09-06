# xbrlmetrics

README as of 2026-08-26

**10k and 10q cleaner for more than 600 companies**

Pulls XBRL facts from SEC EDGAR and prices from Yahoo Finance, derives 52 metrics across
more than 600 tickers, and serves them through a Streamlit app (for now).

The question it answers is not *"what is this company worth"* but
**"is this stock expensive relative to its own history, and is the business behind it
healthy"**.

```
> 600 tickers  ·  52 metrics  ·  24 business profiles  ·  ~1.0M facts  ·  12 min per full refresh
```

---

## Table of contents

- [Why not just use yfinance's numbers](#why-not-just-use-yfinances-numbers)
- [Quick start](#quick-start)
- [The app](#the-app)
- [What it computes](#what-it-computes)
- [Business profiles](#business-profiles)
- [How a number gets here](#how-a-number-gets-here)
- [Output](#output)
- [Project structure](#project-structure)
- [Notes on the data](#notes-on-the-data)
- [Honesty signals](#honesty-signals)
- [Limitations](#limitations)

---

## Why not just use yfinance's numbers

`yf.Ticker(x).info` already returns `trailingPE`, `priceToBook`, `enterpriseToEbitda` and
most of the rest. They are not used here.

The methodology behind those figures is undocumented — which EPS definition, which period,
what happens when a tag is missing. Everything in this project is computed from raw SEC
filings, so **every number traces back to a specific 10-Q or 10-K**. Yahoo Finance supplies
prices and the corporate-action feed, nothing else.

---

## Quick start

```bash
pip install -r requirements.txt
```

Set your contact details in `config.py` , because the SEC rejects requests without a real name and
email in the User-Agent:

```python
EDGAR_USER_AGENT = "Your Name your@email.com"
```

Then pick an entry point:

| Command | What it does | Universe |
|---|---|---|
| `python main.py` | development run: CSVs **and** chart files | `TICKERS` — two tickers |
| `python -c "from main import run_full_refresh; run_full_refresh()"` | the nightly run: CSVs + the app's parquet export | `get_active_tickers()` — all 501 |
| `streamlit run app.py` | the frontend, reading what the refresh exported | all 501 |

> **`TICKERS` is not the universe.** It holds two tickers and exists so `main()` stays a
> fast development loop. The real list is `get_active_tickers()`, which
> `run_full_refresh()` uses.

A full refresh takes about **12 minutes** for > 600 tickers and writes ~1.5M facts. Charts
are off by default there since they cost about a third of the wall clock and the app reads
parquet, never a chart file.

---

## The app

`frontend`. It is a reader only, nothing computed here.

**Analysis** — per ticker, six tabs:

| Tab | Shows |
|---|---|
| Data | the whole chain, as tables: raw facts → derived → metrics → valuation → snapshot |
| Raw Facts | filed concepts before any metric touches them |
| Growth | change in the filed figures, year over year or quarter over quarter (a control on the tab) |
| Fundamentals | business health, TTM with the quarterly series behind it |
| Valuation | multiples over time, each with its own five-year mean and a marker for today |
| Comparison | one metric, one line per ticker |

**Reference** — ticker-independent, reached from the sidebar:

- **Metric encyclopedia** — every metric with the formula the code actually uses.
- **Profile coverage** — which profile shows which metric, and what each hides.
- **About** — what this is, the data sources, and the disclaimer.

---

## What it computes

**52 metrics**, all registered in one place (`config.METRICS`) and derived from three
generic primitives. Adding a metric is a config change, not a code change.

<table>
<tr><th align="left">Fundamentals — 29</th><th align="left">Valuation — 13</th><th align="left">Growth — 10</th></tr>
<tr valign="top"><td>

Operating margin · FCF margin ·
ROE · ROTCE · ROA ·
Debt/equity · Net debt/EBITDA ·
Payout ratio · Rule of 40 ·
Effective tax rate ·
Operating leverage ·
R&D and capex intensity ·
Inventory turnover · DIO/DSO/DPO ·
Cash conversion cycle ·
Net interest margin ·
Efficiency ratio ·
Provision ratio ·
Combined / loss / expense ratio ·
Net investment yield ·
Reserve growth ·
FFO margin

</td><td>

P/E · P/B · P/FCF ·
P/FCF ex-SBC ·
EV/FCF · EV/EBITDA · EV/Sales ·
P/TBV · P/PPNR ·
P/Core earnings · P/FFO ·
Dividend yield ·
PEG (P/E ÷ revenue growth)

</td><td>

Revenue · Net income ·
Operating income ·
Shares outstanding ·
Dividends per share ·
FFO · PPNR ·
Core operating earnings ·
and their siblings

</td></tr>
</table>

**Eleven fundamentals also carry a quarterly counterpart**, drawn behind the TTM line so a
smoothed series dows not hide the quarter that moved it.

**Seven valuation multiples get a five-year mean**, computed as a **harmonic** mean over a
**calendar** window; averaging price-over-something ratios arithmetically overweights the
expensive periods, and twenty rows are five years only on a series with no holes.

---

## Business profiles

A REIT is not valued on earnings and a bank has no inventory. Showing every metric for
every company would mean showing numbers that do not mean anything, so each ticker belongs
to one of **24 profiles**:

```
standard · financial · insurance_life · insurance_pc · reit · retail · utilities
energy · energy_integrated · materials · materials_integrated · industrials
pharma_medtech · health_services · telecom_cable · media · marketplace · leisure
airline · railroads · homebuilder · consumer_staples · captive_finance
alt_asset_manager
```

A profile does two things: it **hides** metrics that do not apply, and it swaps in the
concepts that do. Banks get PPNR and net interest margin where operating income would be;
insurers get earned premiums, incurred losses and core operating earnings; REITs get FFO.

`is_hidden(ticker, metric)` is the single authority, and the **Profile coverage** page in
the app shows the whole matrix.

> Earlier versions of this README said the tool was "not suitable for financial companies".
> That has not been true for a long time; banks, insurers and REITs each have their own
> metric set.

---

## How a number gets here

```
yfinance ──► daily closes + the corporate-action feed
   │          (first, because the parser needs the splits)
   ▼
SEC EDGAR ──► XBRL companyfacts, us-gaap namespace, 10-K and 10-Q only
   │
   ├─ tag resolution      17 base concepts, per profile and per ticker
   ├─ decumulation        year-to-date ladders → real quarters
   ├─ Q4 derivation       FY − (Q1+Q2+Q3)
   ├─ split basis         share counts onto the current basis, corroborated
   ├─ duplicate merge     one period tagged twice → one row
   └─ masks               values that cannot be right for a concept of that kind
   ▼
derived concepts ──► 25 _TTM series, EPS_TTM_CALC, PPNR, FFO, CoreOperatingEarnings
   ▼
metrics ──► 52 registered metrics + 5 quality flags
   ▼
valuation history ──► multiples, priced off the close nearest each period end
   ▼
snapshot ──► one value per (ticker, concept) at the run date
   ▼
data/app/*.parquet ──► the Streamlit app
```

---

## Output

**`data/`** — human-facing CSVs

| File | Contents |
|---|---|
| `quarterly_facts.csv` | raw and derived concepts per ticker and quarter |
| `metrics_long.csv` | every computed metric, full history |
| `valuation_history.csv` | the multiples, full history |
| `current_snapshot.csv` | current figures, one row per (ticker, concept) |

**`data/app/`** — the frontend's inputs, written atomically

`metrics_long` · `valuation_history` · `facts_growth` · `facts_full` ·
`current_snapshot` · `universe` · `meta.json`

`meta.json` is written **last**, so its presence means every frame is already in place.

**`figures/`** — only when `write_charts=True`

`<TICKER>_fundamentals.json` · `_growth.json` · `_valuation.json`, plus optional
standalone `.html` viewers. Plotly figures, not images: the JSON is ~20–50KB and is the
interface a frontend consumes; the HTML inlines plotly.js at ~5MB a file, which is why it
is opt-in.

Single-ticker charts are always **per ticker**. A P/E of 30 means little next to a
competitor's 25; it means something next to that company's own five-year average. The
comparison chart exists for the cases where the cross-section really is the question.

---

## Project structure

```
app.py             Streamlit frontend — reads data/app/, computes nothing
main.py            Pipeline orchestration, the snapshot, the app export
config.py          Universe, XBRL tag mapping, profiles, the METRICS registry
metrics.py         Generic DataFrame calculations
figures.py         Plotly figures (build_*) and file writers (plot_*)
quality.py         Coverage check
fetchers/
  edgar.py         SEC EDGAR: fetch, cache, extract, decumulate
  yfinance_fetcher.py
parsers/
  parse_edgar.py   Tag resolution, split basis, scale repair, facts assembly
content/
  about.md         The About page's text
  update_notice.md The dismissible notice; empty means no notice
MDs/               Per-module documentation + the bugfix history
```

**Every module has a companion in `MDs/`**, covering the design decisions behind it and the
data problems it solves:

[main](MDs/main.md) · [metrics](MDs/metrics.md) · [config](MDs/config.md) ·
[figures](MDs/figures.md) · [app](MDs/app.md) · [parse_edgar](MDs/parser_edgar.md) ·
[fetcher_edgar](MDs/fetcher_edgar.md) · [fetcher_yfinance](MDs/fetcher_yfinance.md) ·
[quality](MDs/quality.md) · [metric encyclopedia](MDs/encyclopedia.md)

[**bugfixes_opdate_history.md**](MDs/bugfixes_opdate_history.md) is the running record of
what broke, what caused it, and how it was fixed — newest first. Most entries share a
theme: *the pipeline fails silently*, and the symptom shows up several layers from the
cause.

---

## Notes on the data

SEC filings are messier than they look. Handled here:

- **The `fp` field lies.** Some companies tag every value as `FY`, including quarters.
  Period classification uses the actual date span instead.
- **Cash-flow items are cumulative.** Operating cash flow, capex and D&A arrive
  year-to-date, not per quarter. They are decumulated automatically.
- **Q4 is never filed.** It is derived as `FY − (Q1+Q2+Q3)`.
- **A quarter is not always 13 weeks.** 52/53-week filers report 12- and 16-week quarters.
  Those are admitted up to 120 days, but only for filers that produce them *repeatedly* —
  a one-off 111-day period is a merger stub, not a fiscal quarter.
- **Tags change and differ.** Revenue moved tags in 2018; some filers report a total where
  others report only components. Resolved per period end by an ordered list of sources,
  where a source may itself be a sum.
- **Splits corrupt per-share values.** EDGAR restates EPS retroactively but inconsistently,
  so TTM EPS is computed from absolute figures (`net income ÷ share count`), never by
  summing quarterly EPS. Share-count history is put on the current split basis using the
  corporate-action feed — and only where the filer's *own restatement* confirms the event,
  because a spin-off ratio looks exactly like a split ratio.
- **Four rows are not always four quarters.** A `.rolling(4)` sum on a thin concept can
  span years. Every TTM window is checked against the calendar before the sum is kept, and
  a window that does not cover a year yields no value rather than a wrong one.

Adding a ticker runs a coverage check that reports any concept that is missing or thin,
with a ready-to-run command for finding the tag.

---

## Honesty signals

Tells you wheer a number rests on an assumption, the assumption is published rather than hidden.

| Signal | Says |
|---|---|
| `ttm_source` | whether a `_TTM` value was summed from four quarters or read from one 12-month fact |
| `ffo_gains_source` | whether FFO's real-estate-gains term was filed or imputed as zero |
| `<field>_age_days` | a snapshot input carried forward from an earlier period, and how far back |
| `<field>_stale_days` | a snapshot input the staleness guard **refused** to publish, and how far behind the ticker's newest period it was |
| `avg_*_5y_n` | how many observations the five-year mean actually had |
| `buyback_distortion_flag`, `share_count_jump_flag`, `inorganic_contaminated`, `low_tax_rate_flag`, `fcf_exceeds_ebitda` | quality flags on the periods themselves |
| `fundamentals_stale`, `filing_likely_overdue`, `days_since_last_filing` | how current the filings are |
| `*_band_elevated` | the one cross-sectional flag: this ticker's own five-year low sits above its peers' median |

A masked value is a **gap**, never a zero and never a forward-fill.

---

## Limitations

**No forward-looking metrics.** Forward P/E needs analyst estimates; EDGAR has none, and
`yfinance`'s own `forwardPE` is unreliable.

**No non-GAAP figures.** Companies define their own adjustments, and they appear in 8-K
press releases rather than in structured XBRL.

**Nothing is live.** Every figure comes from the last pipeline run; the app's sidebar shows
when that was. The app's as-of control filters the chart window — it does not recompute.

**Fundamentals are only as good as the tagging.** Where a company tags something unusually,
the pipeline may miss it or read it differently than a human would. That is what the
coverage check and the quality flags exist to surface.

**Not investment advice.** Informational purposes only, no warranty of accuracy. See the
app's About page.
