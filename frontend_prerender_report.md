# Prerendered, Crawlable Public Pages

**Task:** what `curl https://xbrlmetrics.com/` returns should be readable text, not an empty
`<div id="root"></div>`. Closed for the three ticker-independent views — About, Metric
encyclopedia, Profile coverage — plus the homepage, by rendering the real bundle in a real browser
after `vite build` and writing what came out.

Everything below was measured on this machine against the actual build output.

**Two corrections to the brief's premises, both material, both up front:**

1. **There is no `<noscript>` fallback.** The live homepage is 722 bytes and its body is
   `<div id="root"></div>` and nothing else — no `<noscript>`, no text at all. The Google result
   was built from `<title>` and `<meta name="description">` alone, and that description read
   `" computed directly from SEC EDGAR XBRL filings."` — a sentence fragment with a leading space.
   §1.3.
2. **`dist/<path>/index.html` is not automatically enough for Caddy.** Probing the live server
   narrows its `try_files` to two possibilities, and under one of them the prerendered files are
   never reached. Measured under both, side by side: §5.1. The operator has one line to check.
   §7.

---

## 1. Step 1 — the reference, read

### 1.1 The hash scheme

`navigation.ts` — `VIEWS = ["analysis", "encyclopedia", "coverage", "about"]`. `parseHash` splits
on `/` after stripping `#/`, and for any view other than `analysis` returns immediately with
`{ view, tab: "data", ticker: null }`; `formatHash` writes `#/about`, `#/encyclopedia`,
`#/coverage` for exactly those three, and `#/analysis/<TICKER>/<tab>` for the fourth. So the three
views this task makes crawlable are precisely the three the hash carries with **no** other state.

That is what makes the mapping a mapping rather than a second router: `/about` → `view: "about"`
is the same `Location` `#/about` already produces, so the new code path ends in the state the
existing one ends in. The addition is 3 lines of data and 12 of function (§3), and `parseHash`,
`formatHash`, `withView`, `withTab`, `withTicker` are untouched — verified by 67 assertions
including a round trip of all 4 views × 6 tabs (§5.3).

### 1.2 What each view fetches, and the terminal state a prerender must wait for

Not a delay: each view has an element that **cannot exist** before its data has arrived.

| view | fetch | loading state | the marker |
|---|---|---|---|
| About | `fetchAbout()` → `/about.md`, in a `useEffect` on mount | `raw === undefined` returns a bare `<p class="caption">Loading…</p>` — no wrapper | **`section.about`** |
| Encyclopedia | none of its own; reads `registry` from `DataProvider` | `App.tsx` renders `<main class="loading">` until `registry` is non-null | **`section.encyclopedia`** |
| Coverage | same | same | **`section.coverage`** |

About's is the interesting one. `raw` is a three-state variable — `undefined` (in flight), `null`
(absent or non-ok), a string — and only the `undefined` case returns without the `<section
class="about">` wrapper. So waiting for `section.about` waits for **the answer**, not for the good
answer: a missing `about.md` renders the "No About content found" notice inside the same wrapper
and the prerender captures that rather than hanging for 30 seconds. A second, stricter assertion
then checks that the page is not empty (§2.2).

`fetchAbout`'s two guards matter here too: it rejects a non-ok status **and** an `html`
content-type, because a static server answers an unknown path with `index.html` at 200. The
prerender is served over exactly such a server, and `/about.md` is a real file in `dist/`, so the
guard passes on content rather than by luck.

### 1.3 The existing title and description

```html
<title>xbrlmetrics — S&P 500 fundamentals from SEC filings</title>
<meta name="description" content=" computed directly from SEC EDGAR XBRL filings." />
```

The title is generic and correct and is left alone. **The description is not.** It is a sentence
fragment beginning with a space, it names no subject, and with an empty `#root` under it, it was
the entire text a search engine had. It is replaced with the app's own intro paragraph — `INTRO`
in `App.tsx`, which the file's own comment marks as `app.py:837-841` verbatim:

> This pipeline fetches SEC EDGAR 10k and 10q filings of more than 600 companies, extracts the
> XBRL facts, computes derived metrics, and links them to yfinance course data. This data stream
> is as pure as possible.

The prerender step re-reads the same sentence off the rendered `.intro` and writes it into
`dist/index.html`, so the static copy and the app cannot silently disagree.

**Per-page titles and descriptions are read off the rendered page, not written into the script.**
Title = the view's own `<h2>` + `" — xbrlmetrics"`. Description = the view's own lede paragraph,
whitespace-collapsed. Sources and results:

| path | title | description, and where it comes from |
|---|---|---|
| `/about` | `About — xbrlmetrics` | the first paragraph of `about.md`'s first section — *"This project was made in order to provide free and easy accessible data for the biggest US-companies, all while providing a data stream as pure as possible."* (155 chars) |
| `/encyclopedia` | `Metric encyclopedia — xbrlmetrics` | `.encyclopedia__lede`, marked `app.py:634-638, verbatim` — *"Every metric this pipeline computes, with the formula it actually uses. These are read off the implementation, not from a textbook — where the two differ, what is written here is what the code does."* (197) |
| `/coverage` | `Profile coverage — xbrlmetrics` | `.coverage__lede`, marked `app.py:678-683, verbatim` — *"Which metrics each business profile shows, and which it suppresses. A bank has no inventory and a REIT is not valued on earnings, so showing every metric for every company would mean showing numbers that do not mean anything."* (222) |
| `/` | unchanged (the site title) | `.intro`, as above (216) |

**No invented copy anywhere.** Every string is text the page already shows, and the About one is
read from a file an operator edits — proven to track it in §5.4. The 320-character cut point is
generous on purpose: all four ledes pass through whole, and a search engine truncates the display
itself.

---

## 2. Step 2 — the mechanism

### 2.1 Puppeteer, and why the real bundle

**Puppeteer, not Playwright**, on one practical difference that Step 4 makes decisive: `puppeteer`
downloads its browser in its own `npm install` postinstall, so `npm ci && npm run build` is
complete. Playwright needs `npx playwright install chromium` as a *second* command — exactly the
step the brief says the operator must not have to remember to add to the cron. (Both would work
otherwise; nothing else in the choice is load-bearing.)

**Rendering the real bundle rather than writing a second generator** is the whole design, and the
alternative is worse in a way this project has already paid for. A hand-written generator would
be a second implementation of `splitSections`, of `isProminent`'s disclaimer rule, of the
registry's per-chart filtering, of the `profile_visibility` lookup, and of the markdown rendering —
five places to drift. The same shape of defect has been found and removed here repeatedly: the
outlier mask co-derived on two sides, the empty-panel notice re-deciding `PanelSpec.empty`, the
coverage page's docstring itself warning that "adding a client-side `isHidden` here would create a
second answer to a question that already has one".

`scripts/prerender.mjs` knows **nothing** about what these pages contain. It knows a CSS selector
that means "this view has settled", a selector that means "this is the content", and how to copy
`document.documentElement.outerHTML`. Change what a view renders and the prerender changes with
it, with no edit here.

### 2.2 The step's shape

1. `vite build` writes `dist/` (and empties it first, so every pass is clean).
2. `sitemap.xml` is written — before anything can fail, so it exists either way.
3. `dist/` is served over **Vite's own preview server**, programmatically (`import { preview }`).
   No new dependency, the same static server `npm run preview` uses, and its SPA fallback answers
   `/about` with `index.html` — which is what lets the page boot at all before the file for it
   exists.
4. For each route: navigate, `waitForSelector(ready)` — never a delay — then a **second, stricter
   assertion** that the content is actually there (`.about__section` count, `.entry` count,
   `.coverage__matrix tbody tr` count). A page that reaches its terminal state empty is a failure,
   not something to write to disk.
5. Read the `<h2>` and the lede, set `document.title` and the description **in the captured
   document only**, capture, and write.
6. The captured HTML is checked for `<script type="module"` before it is written; a capture that
   lost it would be a dead end for real visitors, and the check makes that unwritable rather than
   merely unlikely.

**Failure never fails the build.** The nightly cron builds and deploys; losing crawlability for a
night is a smaller harm than not deploying. A missing browser, a hung page or an empty view prints
a `SKIPPED`/`FAILED` banner and exits 0 with an ordinary, working SPA in `dist/`.

### 2.3 Caddy — the premise does not hold unconditionally, and here is the measurement

The brief asks to confirm that `file_server` + `try_files` already serves a directory's
`index.html`. **The Caddyfile is not in this repository** — it lives on the operator's server — so
it was probed instead, from outside:

```
/                     200 text/html   722 B
/nonexistent-xyz-123  200 text/html   722 B     <- a catch-all fallback exists
/assets               200 text/html   722 B     <- a real directory, and no 301 to /assets/
/assets/              200 text/html   722 B     <- file_server's directory handling never runs
/tickers/AAPL.json    200 application/json      <- real nested files are served normally
/robots.txt           200 text/html   722 B     <- did not exist; answered with the SPA
/sitemap.xml          200 text/html   722 B     <- likewise
```

A bare `file_server` would answer `/assets` with a 301 to `/assets/`. It does not, so a
`try_files` rewrite is taking the request first. That narrows it to two shapes, which the probe
**cannot** tell apart, because no directory on the server has an `index.html` in it today:

| | Caddyfile | what happens to `/about` |
|---|---|---|
| **A** | `try_files {path} /index.html` | Caddy's file matcher rejects a directory for a candidate not ending in `/`, so `/about` never matches `dist/about/` and falls through to the root `index.html`. **The prerendered file is never served.** |
| **B** | `try_files {path} {path}/index.html /index.html` | the directory's index is an explicit candidate and is served. |

So this was measured directly: the same `dist/` behind two servers implementing exactly A and B.
The result is §5.1, and it is unambiguous — **A: 12/24, B: 24/24**. The minimal addition, if the
Caddyfile is A, is one candidate:

```
try_files {path} {path}/index.html /index.html
```

It changes nothing else: a real file still wins, and an unknown path still falls to `/index.html`.

**Under A the site is not broken, only un-crawlable.** A human visiting `/about` gets the root
`index.html`, the bundle boots, `locationFrom` reads the pathname, and the About view renders —
verified, 22/22 under *both* policies (§5.2). Only the non-executing crawler loses.

### 2.4 The captured markup still boots the app

`vite build` emits `<script type="module" crossorigin src="/assets/index-<hash>.js">` and
`<link rel="stylesheet" crossorigin href="/assets/index-<hash>.css">` into `<head>`. Both survive
the capture untouched — `document.documentElement.outerHTML` is the whole document — and the paths
are absolute, so they resolve identically from `/about` as from `/`. The stylesheet loading before
paint is why the prerendered pages are **styled**, not a wall of unstyled text: they carry the
app's real class names and the real CSS.

The script check in step 6 above asserts this on every capture. Confirmed in the shipped output by
`curl`: `type="module"` present in all four pages (§5.1).

### 2.5 Seamless boot

`App.tsx`'s `useLocation` read one thing and now reads two:

```ts
typeof window === "undefined"
  ? DEFAULT_LOCATION
  : locationFrom(window.location.hash, window.location.pathname);
```

`locationFrom` is 4 lines: **the hash wins whenever it names anything**; only an empty hash lets
the pathname speak. That ordering is the design, not a detail — `/about#/analysis/AAPL/valuation`
is a link somebody built deliberately, and the path is then just the door they came through.
Verified: landing on `/about#/analysis/MSFT/valuation` gives the Valuation tab for MSFT (§5.2).

Nothing writes a path. `go()` still sets `window.location.hash`; after switching to Analysis from
`/about` the URL is `/about#/analysis//data` — path untouched, hash authoritative — which is
asserted in §5.2. The hash stays the single source of truth exactly as `navigation.ts`'s docstring
says.

---

## 3. What was implemented

| file | change |
|---|---|
| `frontend/scripts/prerender.mjs` | **new**, 260 lines. The step: sitemap, preview server, browser, four routes, capture, write. |
| `frontend/src/shell/navigation.ts` | **+52**. `PATH_VIEWS` (3 entries), `viewForPath` (trailing slash tolerant), `locationFrom` (4 lines). Nothing existing edited. |
| `frontend/src/App.tsx` | **+17/−2**. `read()` calls `locationFrom`; one import; the docstring says why. |
| `frontend/index.html` | **+9/−2**. The broken `<meta name="description">` replaced (§1.3). |
| `frontend/package.json` | **+3/−1**. `puppeteer` devDependency; `build` gains the step (§4). |
| `frontend/public/robots.txt` | **new**, 10 lines (§4.2). |
| `frontend/scripts/check-chart-width.mjs`, `check-tab-state.mjs` | **+2/−2**, deliberately outside this task — see §5.5. |

No component, no chart builder, no data module, no contract, and nothing under `src/charts/`,
`src/data/` or `src/contracts.ts` was touched. `navigation.ts` is imported by exactly three files
— `App.tsx`, `shell/Sidebar.tsx`, `shell/TabPanel.tsx` — and by no chart module, which is why the
chart-builder question in §5.5 has the answer it has.

**Scope of the location addition**, stated precisely because the brief asks for it: one
`Record<string, ViewId>` with three entries, one pure function reading a pathname, one call site.
It runs once, at the first `useState` initialiser. It cannot run again — `hashchange` still calls
`parseHash` alone — and it writes nothing.

---

## 4. Step 3 and 4 — sitemap, robots, and the build

### 4.1 `sitemap.xml`

Generated by the same step, from `ROUTES`, so a route added later appears without a second edit:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://xbrlmetrics.com/</loc><lastmod>2026-09-05</lastmod></url>
  <url><loc>https://xbrlmetrics.com/about</loc><lastmod>2026-09-05</lastmod></url>
  <url><loc>https://xbrlmetrics.com/encyclopedia</loc><lastmod>2026-09-05</lastmod></url>
  <url><loc>https://xbrlmetrics.com/coverage</loc><lastmod>2026-09-05</lastmod></url>
</urlset>
```

Four absolute `https://xbrlmetrics.com/...` locs, confirmed by parsing (§5.6). The 609 per-ticker
views are absent deliberately: they are hash fragments, which are not distinct URLs to a crawler,
so listing them would be listing the homepage 609 times.

It is written **before** the browser is even imported, so a build with no browser still ships a
valid sitemap.

### 4.2 `robots.txt`

**It did not exist**, and the absence was not silent: `/robots.txt` returned the SPA's
`index.html` at **200 text/html**, so a crawler asking for crawl rules was handed a page of HTML.
Added as a static file in `public/` — it is content, it never changes, and `public/` is where Vite
copies content from — permitting everything and naming the sitemap:

```
User-agent: *
Allow: /

Sitemap: https://xbrlmetrics.com/sitemap.xml
```

Nothing is disallowed: every page is computed from public SEC filings. Both files are served
correctly under **either** Caddy policy, because both are real files with extensions and `{path}`
matches them directly.

### 4.3 The build script

```diff
- "build": "tsc -b && vite build",
+ "build": "tsc -b && vite build && node scripts/prerender.mjs",
```

That is the whole wiring. **`npm run build` is sufficient as-is** — the cron needs no new command
(subject to §7's one caveat about the browser binary).

---

## 5. Step 5 — verification

### 5.1 The `curl` proof — the decisive one

The same `dist/`, behind two servers implementing Caddy policies A and B exactly (§2.3). Every
check is a literal `grep -F` over the raw HTTP body. No browser involved.

```
===== policy B: try_files {path} {path}/index.html /index.html =====
  [ok  ] /              the app's own intro sentence
  [ok  ] /              a crawlable link to /about
  [ok  ] /              a crawlable link to /encyclopedia
  [ok  ] /              a crawlable link to /coverage
  [ok  ] /              no per-ticker analysis table
  [ok  ] /              the body holds only the nav
  [ok  ] /              keeps the module script
  [ok  ] /about         About's own opening sentence
  [ok  ] /about         the disclaimer heading
  [ok  ] /about         the disclaimer's first line
  [ok  ] /about         the data-sources section
  [ok  ] /about         keeps the module script
  [ok  ] /encyclopedia  the page lede
  [ok  ] /encyclopedia  a metric label
  [ok  ] /encyclopedia  a metric id
  [ok  ] /encyclopedia  a rendered formula
  [ok  ] /encyclopedia  keeps the module script
  [ok  ] /coverage      the page lede
  [ok  ] /coverage      a profile name
  [ok  ] /coverage      the matrix's shown marker
  [ok  ] /coverage      a metric row
  [ok  ] /coverage      keeps the module script
  [ok  ] /robots.txt    the sitemap pointer
  [ok  ] /sitemap.xml   an absolute loc
  --> 24/24

===== policy A: try_files {path} /index.html =====
  --> 12/24     (the 12 failures are all three pages' content; /, robots and sitemap pass)
```

Raw bodies and titles, policy B:

| path | before | after | `<title>` |
|---|---:|---:|---|
| `/` | 722 B | **70,048 B** (11.4 kB gzipped) | `xbrlmetrics — S&P 500 fundamentals from SEC filings` |
| `/about` | 722 B | **75,517 B** (13.9 kB) | `About — xbrlmetrics` |
| `/encyclopedia` | 722 B | **82,698 B** (14.3 kB) | `Metric encyclopedia — xbrlmetrics` |
| `/coverage` | 722 B | **271,029 B** (23.3 kB) | `Profile coverage — xbrlmetrics` |

**The homepage is handled differently, on purpose.** `/` is the Analysis view for a default
ticker, so capturing it whole would bake one company's nightly-changing figures into the site's
front page — per-ticker prerendering, which this task excludes. It is captured with
`.content__body` emptied and replaced by links to the three pages, labelled with **those pages'
own `<h2>`s**. What survives is the part that is not about a ticker: the heading, the update
notice, the intro paragraph, the tab strip, the sidebar — in the real shell markup, styled by the
real stylesheet. Asserted directly: the body is exactly
`<div class="content__body"><nav aria-label="Reference pages"><a href="/about">…` and the page
contains no `<table>` at all.

### 5.2 A real browser still gets the live, interactive app

Puppeteer, 1400×900, sampling the visible `<h2>` on **every animation frame from the first paint**
— if the app booted into the wrong view, one sample would show it.

```
--- /about ---
  [ok  ] only this page's heading was ever painted  ["About","(none)"]
  [ok  ] React took over
  [ok  ] the sidebar's Analysis radio clicks
  [ok  ] view switching reaches Analysis  {"hash":"#/analysis//data","path":"/about","tabs":6}
  [ok  ] it wrote a hash and left the path alone
  [ok  ] a hash change still routes
  [ok  ] no page errors
--- /encyclopedia ---   ["Metric encyclopedia","(none)"]   7/7
--- /coverage ---       ["Profile coverage","(none)"]      7/7
--- /about#/analysis/MSFT/valuation ---
  [ok  ] an explicit hash beats the pathname  {"active":"Valuation","ticker":"MSFT — standard"}
  --> 22/22
```

**22/22 under policy B and 22/22 under policy A.** Under A the browser is served the root shell
and still lands on the right view, because the pathname fix works off whatever HTML arrives.

**The harness is sensitive, proven by mutation.** With `locationFrom` reduced to
`parseHash(hash)`, rebuilt:

```
  [FAIL] only this page's heading was ever painted  ["(none)","Raw & derived facts"]
  [FAIL] it wrote a hash, and left the path alone   {"hash":"","path":"/about","tabs":6}
```

— the exact flash-then-jump the fix prevents, on all three paths. The prerender step catches the
same regression independently: with the mutation in place, `/about` renders Analysis, so
`section.about` never appears and the route fails rather than writing a wrong page.

### 5.3 The routing addition, checked from Node

`navigation.ts` imports no React, so the rules are checkable directly. **67/67**:

- `viewForPath` for all 3 paths, with and without a trailing slash; `null` for `/`, `/analysis`,
  `/about/extra`, `/aboutx`, `""`.
- `locationFrom` with an empty / `#` / `#/` hash → the path's view; `/` and `/unknown` →
  `DEFAULT_LOCATION`.
- `locationFrom` with any real hash → identical to `parseHash`, including a nonsense one.
- **`parseHash`/`formatHash` round trip for all 4 views × 6 tabs**, and `locationFrom` agreeing
  with `parseHash` on every one of them — the guarantee that the existing router was not
  disturbed.

### 5.4 Freshness, proven in both directions

A marked section was appended and the site rebuilt:

| edited | marker in `dist/about/index.html` |
|---|---|
| `content/about.md` only | **absent (0)** |
| `frontend/public/about.md` | **present (1)**, as `<section class="about__section"><h3>FRESHNESS-PROBE-…</h3><div class="about__body"><p>…` — sections 7 → 8 |

So the prerendered page tracks its source exactly, rendered by the real `splitSections` and the
real markdown renderer. Both files were restored and the build re-run; sections back to 7, marker
gone.

**And a pre-existing finding the test surfaced: `content/about.md` and `frontend/public/about.md`
are two unlinked copies.** Nothing in the repo copies one to the other — the frontend serves the
`public/` one, and editing only `content/` changes nothing. They are byte-identical today. Not
introduced here; §6.

### 5.5 Hash navigation, unaffected

```
check-chart-width    36/36 chart renders fill their container
check-tab-state      13/13 tab-state and default-route checks pass
check-table-format   6107/6107 cells carry a display format
```

**Two of these were red before this task, and it was a stale literal in the harnesses, not a
regression.** Both hard-code the growth tab as `"Growth (YoY)"`; the QoQ cycle renamed it to
`"Growth"` — because the chart draws either mode, so no tab label can name one — and did not
update them. First run: `check-chart-width` 30/36 with all six failures reading `Growth (YoY) …
container 0px` (the harness cannot find the tab, so it never switches), and `check-tab-state`
12/13 with `landed on Growth, expected Growth (YoY)`. Patching only that literal in a copy gave
36/36 and 13/13 immediately.

The one-word fix was then applied to both harnesses. It is **outside this task's scope and is
called out as such**: a standing regression check that fails for a reason unrelated to the change
under test is worse than no check, because the next cycle cannot tell the two apart.

**The chart-builder A/B is vacuous by construction here, and the import graph is the evidence.**
`navigation.ts` is imported only by `App.tsx`, `Sidebar.tsx` and `TabPanel.tsx`; no module under
`src/charts/` imports anything from `src/shell/`; and today's diff touches no file under
`src/charts/`, `src/data/` or `src/contracts.ts`. The builders are the same bytes and take the
same inputs. What was run instead is stronger than a digest comparison over unchanged files:
`check-chart-width` renders all three chart tabs plus comparison and raw facts in a real browser,
from every landing tab, at both sidebar states — 36 renders, all correct.

### 5.6 Sitemap validity

Parsed with `xml.etree`: **valid, 4 `<url>` entries, all absolute against `https://xbrlmetrics.com`**.
Each fetched over the policy-B server:

```
  /               200    69,912 B  title=xbrlmetrics — S&P 500 fundamentals from SEC filings
  /about          200    75,363 B  title=About — xbrlmetrics
  /encyclopedia   200    82,544 B  title=Metric encyclopedia — xbrlmetrics
  /coverage       200   264,164 B  title=Profile coverage — xbrlmetrics
```

### 5.7 `tsc`, `eslint`, `vite build`

- **`npx tsc -b`: clean**, exit 0.
- **`npx eslint .`: 2 errors, both pre-existing** — `Chart.tsx:11` (`no-explicit-any`) and
  `Sidebar.tsx:94` (`set-state-in-effect`). Neither is in a file this task touched. (This is down
  from 4: the two `ChartView.tsx` errors were fixed by the "React #300" commit that landed in the
  repo between cycles.)
- **`npm run build`: clean**, all four routes prerendered on every run.

---

## 6. Step 5.6 — the measured build cost

Median of three runs each, on this machine, warm:

| step | before | after |
|---|---:|---:|
| `tsc -b` (incremental) | 7.6 s | 7.6 s |
| `vite build` | 13.9 s | 13.9 s |
| `node scripts/prerender.mjs` | — | **14.8 s** |
| **`npm run build` end to end** | ~21.5 s | **32.1 s** |

**The prerender adds ~14.8 s, roughly +69%.** (The brief's "~5 s `vite build`" does not match what
this build measures: `vite build` alone is 13.8–14.7 s here, with 5.2 s of it inside
`vite:prepare-out-dir` and a 5.0 MB bundle.) Four page loads of a 5 MB bundle in a headless
browser is most of the 14.8 s; it is flat in the number of tickers and grows only if routes are
added.

Against a ~40-minute nightly pipeline this is 0.6% of the run.

Payload cost, first paint: the homepage goes from 0.72 kB to **70 kB raw / 11.4 kB gzipped**, and
the three pages from 0.72 kB to 13.9–23.3 kB gzipped. In exchange the first paint is content
rather than a blank screen, on the same request that used to carry nothing.

---

## 7. What the operator's server needs to know

**Two things to check once. Nothing to change in the crontab.**

**1 — the Caddyfile's `try_files` line (§2.3, §5.1).** This is the one that decides whether the
work is visible to a crawler. The Caddyfile is not in this repo, so it could not be read; the live
server's behaviour narrows it to two shapes that today's probes cannot distinguish. After the next
deploy, one command answers it:

```
curl -s https://xbrlmetrics.com/about | grep -c "about__section"
```

- **non-zero** — the Caddyfile is already policy B. Nothing to do.
- **0** — it is policy A, and the directory index is never reached. The minimal addition is one
  candidate in the existing line:

  ```
  try_files {path} {path}/index.html /index.html
  ```

  A real file still wins; an unknown path still falls to `/index.html`. Nothing else changes.

Either way the site works for humans; under A only the crawler misses the pages (§5.2).

**2 — the headless browser on the build machine.** `npm ci` normally fetches it via puppeteer's
postinstall, but **npm 11 gates install scripts** — this machine's `npm install` printed
`puppeteer@25.10.0 (postinstall: node install.mjs)` under `allow-scripts … not yet covered`. If
the build machine's npm does the same and no browser is present, the prerender step prints

```
[prerender] SKIPPED — could not launch a browser: …
[prerender] SKIPPED — install one with `npx puppeteer browsers install chrome`.
[prerender] SKIPPED — dist/ is a working SPA, so the build is still publishable.
```

and **exits 0** — the deploy proceeds with an ordinary SPA and the sitemap, and nothing breaks.
The fix is that one command, run once. On a bare Linux server headless Chrome also needs its usual
shared libraries (`libnss3`, `libatk-1.0`, `libgbm`, `libasound2` and friends); `--no-sandbox` is
already passed, which is what a root/container build needs.

**Nothing else.** `npm run build` is the whole invocation, `robots.txt` and `sitemap.xml` land in
`dist/` beside `index.html`, and no other file moves.

---

## 8. Follow-ups

**1 — the encyclopedia prerenders one of three tab groups.** `Encyclopedia.tsx` renders only the
active section's entries, so the captured page holds the **29 fundamentals metrics of 81**;
valuation (13) and growth (39) are behind tab clicks and are not in the HTML. Changing that means
changing what the view renders, which this task excludes. Two ways out for a later task: render
all three groups and let the tabs hide rather than unmount them (which also makes the page's own
filter work across groups), or give each group a path of its own. **Coverage has no such gap** —
its matrix is the full 81 metrics × 24 profiles and prerenders whole (81 rows, 27 header cells).

**2 — the two `about.md` copies are unlinked** (§5.4). `content/about.md` is what an operator
would naturally edit; `frontend/public/about.md` is what is served. They are identical today and
nothing keeps them so. A build-time copy, or making `public/about.md` a generated artifact, would
close it. Pre-existing; the freshness test is what made it visible.

**3 — no `<link rel="canonical">`.** `/about`, `/about/` and `/#/about` are the same content at
three URLs. A canonical tag is one line in the capture step and was left out as outside the
brief's list.

**4 — the three pages do not link to each other.** The sidebar's view control is a radio group,
not anchors, so a crawler landing on `/coverage` cannot reach `/about` by following a link — only
via `/` (which now carries all three, §5.1) or the sitemap. Adding the same nav to the three
captures would be a two-line change to the `strip`/`links` handling.

**5 — per-ticker crawlability remains out of reach**, as the brief says, and for the reason it
says: 609 hash-routed views are not 609 URLs. It would need a real path scheme and a much larger
prerender or SSR pass.

---

### Verification performed

- The live server probed from outside on 8 paths, including two real directories, to establish
  what its `try_files` can and cannot be.
- The shipped `dist/` served behind two servers implementing Caddy policies A and B exactly, and
  24 literal content assertions run over the raw HTTP bodies of both — 24/24 and 12/24.
- 22 browser assertions per policy on boot, view switching, hash precedence and page errors —
  22/22 and 22/22 — and the same harness proven to fail under a mutation that removes the fix.
- 67 Node assertions on `viewForPath`/`locationFrom`, including a full round trip of
  `parseHash`/`formatHash` over all 4 views × 6 tabs.
- Freshness proven in both directions with a marked section, and both files restored afterwards.
- `sitemap.xml` parsed as XML and every listed URL fetched.
- `check-chart-width` 36/36, `check-tab-state` 13/13, `check-table-format` 6107/6107, with the two
  pre-existing failures traced to a stale label literal and shown to pass once it is corrected.
- Build cost measured over three runs of each step separately and two of the whole.

No scratch files left behind; `data/` and the pipeline untouched.
