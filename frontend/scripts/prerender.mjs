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
 * `App.tsx` reads `window.location.pathname` once at startup so that the view
 * it boots into is the one the static HTML showed.
 *
 * **Failure here does not fail the build.** The nightly cron builds and deploys
 * the site; losing crawlability for a night is a smaller harm than not
 * deploying, so a missing browser or a hung page prints loudly and exits 0 with
 * the ordinary SPA in `dist/`.
 */
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
 * Every prerendered path, absolute against SITE -- the homepage and the three
 * reference pages. The
 * 609 per-ticker views are deliberately absent: they are hash fragments
 * (`#/analysis/AAPL/data`), which are not distinct URLs to a crawler, so
 * listing them would be listing the homepage four hundred times.
 */
async function writeSitemap() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = ROUTES.map((r) => r.path)
    .map((p) => `  <url>\n    <loc>${SITE}${p}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  await writeFile(path.join(DIST, "sitemap.xml"), xml, "utf8");
  log(`sitemap.xml — ${ROUTES.length} urls, lastmod ${lastmod}`);
}

async function main() {
  await writeSitemap();

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
  const pages = ROUTES.filter((r) => !r.links);
  const home = ROUTES.filter((r) => r.links);
  const headings = new Map();

  try {
    for (const route of [...pages, ...home]) {
      const page = await browser.newPage();
      const problems = [];
      page.on("pageerror", (e) => problems.push(String(e)));
      try {
        await page.goto(`${base}${route.path}`, { waitUntil: "networkidle0", timeout: 30_000 });
        await page.waitForSelector(route.ready, { timeout: 30_000 });

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
                lede: view?.querySelector(sel.lede)?.textContent ?? "",
              };
            },
            { ready: route.ready, lede: route.lede, titleFrom: route.titleFrom ?? null },
          );
          if (route.titleFrom && !meta.heading) {
            throw new Error(`no ${route.titleFrom} inside ${route.ready}`);
          }
          if (!meta.lede.trim()) throw new Error(`no text in ${route.lede}`);
          if (meta.heading) headings.set(route.path, meta.heading);
          title = meta.heading ? `${meta.heading} — ${SITE_NAME}` : null;
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

  if (failures.length) {
    log(`${failures.length} of ${ROUTES.length} routes not prerendered; dist/ still serves the SPA for them.`);
  }
}

// Never take the build down with it -- see the module docstring.
main().catch((error) => {
  log("SKIPPED — unexpected failure:", error?.stack ?? String(error));
});
