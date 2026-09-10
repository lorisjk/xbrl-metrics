/**
 * Prerender the three ticker-independent views into `dist/<path>/index.html`,
 * and write `sitemap.xml` beside them.
 *
 * Why this exists: `curl https://xbrlmetrics.com/` returns an empty
 * `<div id="root"></div>` and the `<noscript>` fallback, and that text appeared
 * verbatim in a real Google result. A crawler that does not execute JavaScript
 * on its first pass sees exactly what curl sees.
 *
 * **It renders the real bundle in a real browser, and captures whatever came
 * out.** The alternative — a second, hand-written HTML generator — would be a
 * second implementation of `splitSections`, of the registry filtering, and of
 * the markdown rendering, and this project has removed that shape of defect
 * repeatedly (the outlier mask co-derived on two sides, the empty-panel notice
 * re-deciding `PanelSpec.empty`). Nothing here knows what an About section or a
 * metric entry looks like; it knows which DOM marker means "this view has
 * finished", and it copies the document.
 *
 * **Three things are read off the rendered page rather than written here**: the
 * page's own `<h2>` becomes the title, and its own lede paragraph becomes the
 * `<meta name="description">`. So neither can drift from the page, and neither
 * is copy nobody can verify — they are the text the page already shows.
 *
 * **The captured markup keeps every `<script>` it had**, so a human visitor
 * boots the live SPA the instant it downloads. This is prerendering, not a
 * static fork of the app: the static HTML is what the crawler and the first
 * paint get, and React replaces it with the identical tree a moment later.
 * `App.tsx` boots into the view its own pathname names -- `parsePath` is the
 * app's primary reader as of the real-path cycle, so the state the bundle wakes
 * up in is the state the static HTML was showing, by the same rule that governs
 * every other navigation rather than by a startup special case.
 *
 * **Failure here does not fail the build.** The nightly cron builds and deploys
 * the site; losing crawlability for a night is a smaller harm than not
 * deploying, so a missing browser or a hung page prints loudly and exits 0 with
 * the ordinary SPA in `dist/`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

/** The origin the sitemap's `<loc>` entries must be absolute against. */
const SITE = "https://xbrlmetrics.com";

/**
 * The site name the page titles are suffixed with, matching `index.html`'s
 * `<title>` ("xbrlmetrics — S&P 500 fundamentals from SEC filings"). Only the
 * name; the tagline would push every page title past what a search result shows.
 */
const SITE_NAME = "xbrlmetrics";

/**
 * How long a description may be before it is cut at a word boundary.
 *
 * Generous rather than tight: the three ledes are 155, 197 and 222 characters,
 * and cutting them at the ~160 a result snippet displays would drop the half of
 * each sentence that says why. A search engine truncates the display itself;
 * what it indexes is the whole string.
 */
const MAX_DESCRIPTION = 320;

/**
 * One route per prerendered page.
 *
 * `ready` is the DOM marker that view settles into, **not** a delay. Each is
 * the element that only exists in a terminal state:
 *
 *   - `section.about` — `About.tsx` returns a bare `<p class="caption">Loading…</p>`
 *     while `raw === undefined`, and only wraps its output in `<section class="about">`
 *     once the fetch has resolved. Both terminal states reach it: the rendered
 *     sections, and the "no About content found" notice. So this waits for the
 *     answer rather than for the good answer.
 *   - `section.encyclopedia` / `section.coverage` — `App.tsx` renders
 *     `<main class="loading">` until `registry` is non-null, so the view's own
 *     section element cannot exist before `registry.json` has arrived and parsed.
 *
 * `content` is a second, stricter assertion: the thing a crawler is supposed to
 * find. A page that reaches its terminal state with nothing in it is a failure
 * worth shouting about, not worth writing to disk.
 */
/**
 * How many tickers get a static page of their own.
 *
 * 50, and it is not a natural break -- the measurement says so and the number
 * is kept anyway. Ranks 50 and 51 (AXP and LIN) are **0.79%** apart; the only
 * material gaps anywhere near are after rank 40 (PANW -> GEV, 9.69%) and rank
 * 35 (MS -> PM, 8.38%). So this is a budget, not a cliff: it is the point past
 * which "{ticker} revenue growth SEC" stops having search volume, which is a
 * judgement about queries rather than about market capitalisation, and no
 * number the data offers would express it better.
 */
const TICKER_PAGES = 50;

/**
 * The largest `n` tickers by market capitalisation, computed from the export on
 * every build.
 *
 * **Computed, never a checked-in list**, on this project's standing preference
 * -- `PROFILE_HIDDEN` is a negative list rather than a positive one, the
 * raw-facts catalogue is derived from the candidates, the growth catalogue's
 * visibility is derived from `get_concept_candidates`. A file of fifty tickers
 * would be correct on the day it was written and quietly wrong a quarter later,
 * and nothing would say so. This tracks the ranking for free.
 *
 * The cost is measured: 609 core files, 86.1 MB of JSON, **1.25 s** to parse
 * all of them and pull one value out of each -- against 50 page loads in a
 * headless browser, which is where the time actually goes. `market_cap` is read
 * exactly as the pipeline published it in `current_snapshot`; nothing here
 * recomputes it, and the 18 tickers that carry no market cap simply cannot rank.
 */
function topByMarketCap(n) {
  const dir = path.join(DIST, "tickers");
  const universe = JSON.parse(readFileSync(path.join(DIST, "universe.json"), "utf8"));
  const profiles = new Map(universe.map((u) => [u.ticker, u.profile]));
  const ranked = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file.endsWith(".facts.json")) continue;
    const ticker = file.slice(0, -".json".length);
    const frame = JSON.parse(readFileSync(path.join(dir, file), "utf8")).frames.current_snapshot;
    if (!frame?.data?.length) continue;
    const ci = frame.columns.indexOf("concept");
    const vi = frame.columns.indexOf("value");
    for (let i = 0; i < frame.data[ci].length; i += 1) {
      if (frame.data[ci][i] !== "market_cap") continue;
      const value = frame.data[vi][i];
      if (typeof value === "number" && Number.isFinite(value)) {
        ranked.push({ ticker, profile: profiles.get(ticker) ?? "", marketCap: value });
      }
      break;
    }
  }
  ranked.sort((a, b) => b.marketCap - a.marketCap);
  return ranked.slice(0, n);
}

/**
 * One route per top-50 ticker: the Data tab, at `/ticker/<TICKER>`.
 *
 * **Two selectors to wait on, not one**, which is the two-tier pattern the
 * three reference pages already use -- settle, then confirm not empty. The
 * difference here is that the two things settle *independently*: the summary
 * comes from the ticker's core file and the raw/derived table from
 * `facts_full`, which `DataTab` fetches separately and shows "Loading the facts
 * frame…" for. Waiting only on the summary would capture that placeholder.
 *
 * `p.ticker-summary[data-ticker="X"]` is the marker the summary cycle handed
 * over, with the ticker predicate it asked for: `useTickerFrames` reports a
 * result for a different ticker as "still loading", so the attribute is what
 * separates "this company's summary has rendered" from "the previous one is
 * still on screen".
 */
const tickerRoute = ({ ticker, profile }) => ({
  path: `/ticker/${ticker}`,
  ticker,
  ready: [`p.ticker-summary[data-ticker="${ticker}"]`, ".data-tab table.data-table tbody tr"],
  content: ".data-tab table.data-table tbody tr",
  lede: `p.ticker-summary[data-ticker="${ticker}"]`,
  // The title is assembled rather than read from an `<h2>`, because the Data
  // tab has no heading naming the company and the export carries no company
  // names at all (`universe.json` is `{ticker, profile, n_*}`). Both halves are
  // the sidebar's own two strings in the sidebar's own order -- "AAPL —
  // standard" -- and the ticker half is checked against the rendered
  // `data-ticker` before the file is written, so it is verified against the
  // page even though it is not scraped from it.
  titleFrom: null,
  title: `${ticker} — ${profile} — ${SITE_NAME}`,
});

const ROUTES = [
  {
    // The homepage, and the one the reported symptom names: `curl
    // https://xbrlmetrics.com/` returns an empty `<div id="root"></div>` and
    // nothing else -- no body text at all for a crawler to read.
    //
    // **Captured with its body removed, deliberately.** `/` is the Analysis
    // view for whichever ticker is default, so capturing it whole would bake
    // one company's nightly-changing figures into the site's front page -- per
    // ticker prerendering, which is a different and much larger project. What
    // is kept is the part that is not about a ticker: the heading, the update
    // notice and the app's own intro paragraph, in the real shell markup so the
    // real stylesheet styles it. What replaces the body is a list of links to
    // the three pages below, labelled with those pages' own headings, so a
    // crawler arriving at `/` can walk to them without the sitemap.
    path: "/",
    ready: "main.content",
    content: ".intro",
    lede: ".intro",
    // No `<h2>`: the Analysis view has none, and the homepage keeps
    // `index.html`'s own site-wide title rather than inventing one.
    titleFrom: null,
    strip: ".content__body",
    links: true,
  },
  {
    path: "/about",
    ready: "section.about",
    titleFrom: "h2",
    content: ".about__section, .about .notice-inline",
    lede: ".about__body p",
  },
  {
    path: "/encyclopedia",
    ready: "section.encyclopedia",
    titleFrom: "h2",
    content: ".encyclopedia .entry",
    lede: ".encyclopedia__lede",
  },
  {
    path: "/coverage",
    ready: "section.coverage",
    titleFrom: "h2",
    content: ".coverage__matrix tbody tr",
    lede: ".coverage__lede",
  },
];

const log = (...parts) => console.log("[prerender]", ...parts);

/** Collapse the whitespace JSX leaves behind, then cut at a word boundary. */
function description(raw) {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_DESCRIPTION) return text;
  const cut = text.slice(0, MAX_DESCRIPTION);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:—-]$/, "")}…`;
}

/**
 * `sitemap.xml`, written whether or not the browser was available.
 *
 * Every prerendered path, absolute against SITE -- the homepage, the three
 * reference pages and the top-50 ticker pages.
 *
 * **The other 559 tickers are still deliberately absent, for a reason that
 * changed under them.** It used to be that they had no URL to list: they were
 * reachable only as hash fragments (`#/analysis/AAPL/data`), which are not
 * distinct URLs to a crawler. Since the real-path cycle every one of them has a
 * real URL -- `/analysis/AAOI/data` -- and `try_files` answers it. What it
 * answers with is the SPA shell, whose body is the homepage's: an empty
 * `.content__body` with three links in it. So listing them would still be
 * listing the homepage five hundred times, and the sitemap would be claiming
 * content that only appears after JavaScript runs. Listing them becomes right
 * the day those pages are prerendered, and not before -- see the report.
 */
async function writeSitemap(routes) {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = routes.map((r) => r.path)
    .map((p) => `  <url>\n    <loc>${SITE}${p}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  await writeFile(path.join(DIST, "sitemap.xml"), xml, "utf8");
  log(`sitemap.xml — ${routes.length} urls, lastmod ${lastmod}`);
}

async function main() {
  let tickers = [];
  try {
    const t0 = Date.now();
    tickers = topByMarketCap(TICKER_PAGES);
    log(`top ${tickers.length} by market cap in ${Date.now() - t0} ms — ` +
        `${tickers[0]?.ticker} ${(tickers[0]?.marketCap / 1e9).toFixed(0)}B … ` +
        `${tickers.at(-1)?.ticker} ${(tickers.at(-1)?.marketCap / 1e9).toFixed(0)}B`);
  } catch (error) {
    // The ranking is an optimisation of *which* pages exist, not a
    // prerequisite for any of them: losing it costs the 50 ticker pages and
    // leaves the four that do not depend on it.
    log("no ticker pages — could not rank the export:", error.message);
  }
  const routes = [...ROUTES, ...tickers.map(tickerRoute)];

  await writeSitemap(routes);

  let puppeteer;
  try {
    ({ default: puppeteer } = await import("puppeteer"));
  } catch (error) {
    log("SKIPPED — puppeteer is not installed:", error.message);
    log("SKIPPED — dist/ is a working SPA; run `npm ci` in frontend/ to restore prerendering.");
    return;
  }

  // The real `dist/`, over the same static server `npm run preview` uses, so the
  // pages are fetched exactly as they will be served -- including the SPA
  // fallback that answers `/about` with index.html before the prerendered file
  // for it exists. `vite build` empties dist/, so this is always a clean pass.
  const server = await preview({ root: ROOT, preview: { port: 4319, strictPort: true } });
  const base = `http://localhost:${server.config.preview.port}`;
  log(`serving dist/ at ${base}`);

  let browser;
  try {
    // --no-sandbox because the nightly build may run as root in a container,
    // where Chrome's sandbox refuses to start. Nothing untrusted is loaded here:
    // the only page visited is the build output sitting next to this script.
    browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  } catch (error) {
    log("SKIPPED — could not launch a browser:", error.message);
    log("SKIPPED — install one with `npx puppeteer browsers install chrome`.");
    log("SKIPPED — dist/ is a working SPA, so the build is still publishable.");
    await server.close();
    return;
  }

  const failures = [];
  // The three pages first, then the homepage: its link list is labelled with
  // their own headings, so it cannot be written until they have been read.
  const pages = routes.filter((r) => !r.links);
  const home = routes.filter((r) => r.links);
  const headings = new Map();

  try {
    for (const route of [...pages, ...home]) {
      const page = await browser.newPage();
      const problems = [];
      page.on("pageerror", (e) => problems.push(String(e)));
      try {
        await page.goto(`${base}${route.path}`, { waitUntil: "networkidle0", timeout: 45_000 });
        // A list where two things settle independently -- see `tickerRoute`.
        for (const selector of [route.ready].flat()) {
          await page.waitForSelector(selector, { timeout: 45_000 });
        }

        const found = await page.$$eval(route.content, (nodes) => nodes.length);
        if (found === 0) throw new Error(`reached ${route.ready} but ${route.content} is empty`);

        let title = null;
        let desc = null;
        if (route.lede) {
          const meta = await page.evaluate(
            (sel) => {
              const view = document.querySelector(sel.ready);
              return {
                heading: sel.titleFrom
                  ? (view?.querySelector(sel.titleFrom)?.textContent?.trim() ?? "")
                  : null,
                // Document level: every `lede` selector is unique in the page,
                // and a ticker page's lede *is* its ready element rather than a
                // descendant of it, which a scoped query could never match.
                lede: document.querySelector(sel.lede)?.textContent ?? "",
                onPage: sel.ticker
                  ? (document.querySelector("p.ticker-summary")?.dataset.ticker ?? null)
                  : null,
              };
            },
            { ready: [route.ready].flat()[0], lede: route.lede,
              titleFrom: route.titleFrom ?? null, ticker: route.ticker ?? null },
          );
          if (route.titleFrom && !meta.heading) {
            throw new Error(`no ${route.titleFrom} inside ${route.ready}`);
          }
          if (!meta.lede.trim()) throw new Error(`no text in ${route.lede}`);
          // A page that rendered a different company is a failure, not a file:
          // the title would name one ticker and the sentences another.
          if (route.ticker && meta.onPage !== route.ticker) {
            throw new Error(`rendered ${meta.onPage}, expected ${route.ticker}`);
          }
          if (meta.heading) headings.set(route.path, meta.heading);
          title = route.title ?? (meta.heading ? `${meta.heading} — ${SITE_NAME}` : null);
          desc = description(meta.lede);

          // Written into the captured document only. The live app never sets
          // document.title, so an interactive session keeps whatever the page it
          // was served carries -- which for these three is now the right one.
          await page.evaluate(
            (t, d) => {
              if (t) document.title = t;
              let tag = document.querySelector('meta[name="description"]');
              if (!tag) {
                tag = document.createElement("meta");
                tag.setAttribute("name", "description");
                document.head.appendChild(tag);
              }
              tag.setAttribute("content", d);
            },
            title,
            desc,
          );
        }

        if (route.strip) {
          const linked = [...headings].map(([href, label]) => ({ href, label }));
          if (route.links && linked.length === 0) {
            throw new Error("no pages to link to -- every other route failed");
          }
          await page.evaluate(
            (selector, items) => {
              const body = document.querySelector(selector);
              if (!body) throw new Error(`nothing matched ${selector}`);
              body.replaceChildren();
              if (!items.length) return;
              const nav = document.createElement("nav");
              nav.setAttribute("aria-label", "Reference pages");
              for (const { href, label } of items) {
                const a = document.createElement("a");
                a.setAttribute("href", href);
                a.textContent = label;
                nav.appendChild(a);
              }
              body.appendChild(nav);
            },
            route.strip,
            linked,
          );
        }

        const html = await page.evaluate(
          () => `<!doctype html>
${document.documentElement.outerHTML}`,
        );
        if (!/<script[^>]+type="module"/.test(html)) {
          throw new Error("captured HTML has no module script -- it would be a dead end");
        }

        const dir = path.join(DIST, route.path.replace(/^\//, ""));
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, "index.html");
        await writeFile(file, html, "utf8");

        log(
          `${route.path} -> ${path.relative(ROOT, file)}  ` +
            `${(html.length / 1024).toFixed(1)} kB, ${found} ${route.content.split(",")[0]} nodes`,
        );
        if (title) log(`  title: ${title}`);
        if (desc) log(`  desc:  ${desc.slice(0, 100)}${desc.length > 100 ? "…" : ""}`);
        if (route.links) log(`  links: ${[...headings.keys()].join(", ")}`);
        if (problems.length) log(`  page errors: ${problems.join(" | ")}`);
      } catch (error) {
        failures.push(`${route.path}: ${error.message}`);
        log(`FAILED ${route.path}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  log(`${routes.length - failures.length} of ${routes.length} routes prerendered`);
  if (failures.length) {
    // Isolation, stated: one ticker failing costs that ticker's static page and
    // nothing else. The path is not a dead link -- there is simply no file at
    // it, so `try_files` falls through to `/index.html`, the SPA boots,
    // `parsePath` reads `/ticker/<T>` and shows that ticker's Data tab. Which is
    // exactly how the other 559 tickers work today, at `/analysis/<T>/data`.
    log(`${failures.length} route(s) fell back to the interactive shell:`);
    for (const f of failures) log(`  ${f}`);
  }
}

// Never take the build down with it -- see the module docstring.
main().catch((error) => {
  log("SKIPPED — unexpected failure:", error?.stack ?? String(error));
});
