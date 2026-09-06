/**
 * Does every chart render at the width of the box it is in?
 *
 * This exists because the item-8 harness cannot answer that question and never
 * could. That harness compares *figure specs* -- `fig.data`, `fig.layout`,
 * every trace and annotation -- and a byte-identical spec still renders at
 * 700px inside a 1204px container if nothing tells plotly the container
 * changed size. Three cycles closed a width defect and the fourth reopened one,
 * each time found only by someone looking at a screenshot.
 *
 * The invariant is deliberately **not** a golden pixel number. The last two
 * cycles recorded `1189px expanded / 1531px collapsed` as the baseline, and
 * those turned out to be the content box *with a vertical scrollbar present* --
 * correct, but 15px off the same page without one, which makes them a poor
 * thing to assert. What is actually invariant, at any viewport and either
 * scrollbar state, is:
 *
 *     the plot's container width === the rendered <svg>'s width
 *
 * Three sweeps assert it: every landing tab into every chart tab, and -- since
 * the persistence cycle made those tabs survive a tab switch instead of
 * remounting -- the comparison and raw-facts charts being *revealed* rather than
 * mounted, with the sidebar toggled while they are out of sight.
 *
 * Run it: start the dev server, then
 *
 *     node scripts/check-chart-width.mjs                 # http://localhost:5173
 *     APP_URL=http://localhost:5185 node scripts/check-chart-width.mjs
 *
 * It launches its own headless browser and exits non-zero on a mismatch.
 * Deliberately not wired into `npm test` or CI: it needs a running server and a
 * real Edge/Chrome, and a check that cannot run is worse than one that is asked
 * for by name.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const TICKER = process.env.TICKER ?? "AAPL";
const PORT = Number(process.env.CDP_PORT ?? 9222);
const BROWSER =
  process.env.BROWSER_PATH ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/** Landing tab -> chart tab. The first three are the ones that mount a chart hidden. */
const ENTRY_TABS = ["data", "raw", "comparison", "valuation"];
const CHART_TABS = ["Growth", "Fundamentals", "Valuation"];

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const profile = mkdtempSync(join(tmpdir(), "chart-width-"));
const browser = spawn(BROWSER, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1600,1100",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let ws;
// Best-effort, all of it: on Windows the browser still holds files in its
// profile directory for a moment after `kill()`, and an EPERM from the cleanup
// must never be what this script reports instead of the result it came for.
const stop = () => {
  try { ws?.close(); } catch { /* already gone */ }
  try { browser.kill(); } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { /* the OS will collect it */ }
};

let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((ok) => { id += 1; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }))
    .result?.result?.value;
const waitFor = async (expression, label) => {
  for (let i = 0; i < 200; i += 1) { if (await evaluate(expression)) return; await sleep(200); }
  throw new Error(`timed out waiting for ${label}`);
};

try {
  // The browser needs a moment before its debugging port answers.
  let page = null;
  for (let i = 0; page === null; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = targets.find((t) => t.type === "page") ?? null;
    } catch (e) {
      if (i > 40) throw e;
    }
    if (page === null) await sleep(250);
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.addEventListener("open", ok); ws.addEventListener("error", no); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await send("Page.enable");

  const failures = [];
  let checked = 0;
  let run = 0;

  // A distinct query string forces a real reload; a hash-only change does not.
  const load = async (tab) => {
    run += 1;
    await send("Page.navigate", { url: `${APP}/?cw=${run}#/analysis/${TICKER}/${tab}` });
    await waitFor("!!document.querySelector('.tabs')", `the shell on ${tab}`);
  };
  const clickTab = (label) =>
    evaluate(`[...document.querySelectorAll('.tabs .tab')].find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
  /**
   * Container width against rendered width, for one plot on the page.
   *
   * `scope` picks *which* plot, and it has to: since the persistence cycle the
   * comparison tab stays mounted after its first visit, so a page can hold two
   * `.js-plotly-plot` nodes at once. `ChartView`'s renders first in the DOM, so
   * an unscoped `querySelector` still happened to find it -- exactly the kind of
   * accident a check should not be resting on.
   */
  const measure = (scope) =>
    evaluate(`(() => {
      const plot = ${scope};
      if (!plot) return null;
      const svg = plot.querySelector('.main-svg');
      return JSON.stringify({
        container: Math.round(plot.getBoundingClientRect().width),
        svg: Number(svg.getAttribute('width')),
      });
    })()`);
  // Scoped by the view each plot lives in, not by DOM order. Three tabs now hold
  // a figure at once -- ChartView, the comparison chart and, since item 16, the
  // raw-facts chart -- and all three can be mounted-and-hidden simultaneously.
  const CHART_PLOT =
    "[...document.querySelectorAll('.js-plotly-plot')].find(p => !p.closest('.comparison, .raw-facts'))";
  const COMPARISON_PLOT = "document.querySelector('.comparison .js-plotly-plot')";
  const RAW_PLOT = "document.querySelector('.raw-facts .js-plotly-plot')";

  for (const entry of ENTRY_TABS) {
    for (const chart of CHART_TABS) {
      await load(entry);
      await sleep(1800);
      await clickTab(chart);
      await waitFor("!!document.querySelector('.js-plotly-plot .main-svg')", `${chart} after ${entry}`);
      await sleep(1600);

      for (const sidebar of ["expanded", "collapsed"]) {
        if (sidebar === "collapsed") {
          await evaluate("document.querySelector('.sidebar__close')?.click()");
          await sleep(1200);
        }
        const seen = JSON.parse(await measure(CHART_PLOT));
        checked += 1;
        if (seen.container !== seen.svg) {
          failures.push(`${entry} -> ${chart}, sidebar ${sidebar}: container ${seen.container}px, svg ${seen.svg}px`);
        }
      }
    }
  }

  /**
   * The raw-facts chart, revealed rather than mounted -- item 16's version of
   * the case below, and it arrived by the route the state-persistence report
   * predicted: a fourth figure-bearing tab, added to `tabDrawsFigure` rather
   * than to `isChartTab`.
   */
  for (const chart of CHART_TABS) {
    for (const sidebar of ["expanded", "collapsed"]) {
      await load("raw");
      await waitFor(`!!${RAW_PLOT}?.querySelector('.main-svg')`, "the raw-facts chart");
      await sleep(1800);
      await clickTab(chart);
      await sleep(1400);
      if (sidebar === "collapsed") {
        await evaluate("document.querySelector('.sidebar__close')?.click()");
        await sleep(1200);
      }
      await clickTab("Raw Facts");
      await sleep(1600);

      const seen = JSON.parse(await measure(RAW_PLOT));
      checked += 1;
      if (seen.container !== seen.svg) {
        failures.push(`raw -> ${chart} -> raw, sidebar ${sidebar}: container ${seen.container}px, svg ${seen.svg}px`);
      }
    }
  }

  /**
   * The comparison chart, revealed rather than mounted.
   *
   * Its own figure was never at risk while the tab was conditionally rendered:
   * it mounted at the moment it became visible, so it measured a real container
   * every time. Keeping it mounted between visits -- which is what makes its
   * ticker set survive a tab switch -- put it in exactly the position
   * `ChartView` has always been in, and the sidebar variant is the one that
   * bites: the toggle happens while the figure is hidden, so nothing but the
   * shell's synthetic resize can tell it the page got wider. That event is gated
   * on `tabDrawsFigure`, and this is the gate's test.
   */
  for (const chart of CHART_TABS) {
    for (const sidebar of ["expanded", "collapsed"]) {
      await load("comparison");
      await waitFor(`!!${COMPARISON_PLOT}?.querySelector('.main-svg')`, "the comparison chart");
      await sleep(1800);
      await clickTab(chart);
      await sleep(1400);
      if (sidebar === "collapsed") {
        await evaluate("document.querySelector('.sidebar__close')?.click()");
        await sleep(1200);
      }
      await clickTab("Comparison");
      await sleep(1600);

      const seen = JSON.parse(await measure(COMPARISON_PLOT));
      checked += 1;
      if (seen.container !== seen.svg) {
        failures.push(`comparison -> ${chart} -> comparison, sidebar ${sidebar}: container ${seen.container}px, svg ${seen.svg}px`);
      }
    }
  }

  for (const f of failures) console.error(`FAIL ${f}`);
  console.log(`${checked - failures.length}/${checked} chart renders fill their container`);
  process.exitCode = failures.length ? 1 : 0;
} finally {
  stop();
}
