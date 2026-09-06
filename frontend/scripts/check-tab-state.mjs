/**
 * Does a tab remember what you set on it, and does a fresh load land on Data?
 *
 * Two questions the other three harnesses structurally cannot answer. The item-8
 * harness and item 12's comparison harness both compare *figure specs* built in
 * Node, where there are no tabs and nothing is ever unmounted;
 * `check-chart-width` drives a real browser but only ever reads a width.
 * Selection state surviving a tab switch is a property of the React tree's
 * *mount lifetime*, which is visible only from a page that is being clicked
 * around.
 *
 * The invariant, for every tab that holds state a reader set:
 *
 *     fingerprint(tab) after leaving and returning === fingerprint(tab) before
 *
 * and, separately, that the shell's own default route is Data.
 *
 * Run it: start the dev server, then
 *
 *     node scripts/check-tab-state.mjs                 # http://localhost:5173
 *     APP_URL=http://localhost:5185 node scripts/check-tab-state.mjs
 *
 * Same shape as `check-chart-width.mjs`, deliberately: it launches its own
 * headless browser, exits non-zero on a mismatch, and is not wired into CI for
 * the same reason -- it needs a running server and a real Edge/Chrome.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const TICKER = process.env.TICKER ?? "AAPL";
const PORT = Number(process.env.CDP_PORT ?? 9223);
const BROWSER =
  process.env.BROWSER_PATH ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/** navigation.ts `TAB_LABELS`, as the page renders them. */
const TAB_LABELS = {
  data: "Data",
  raw: "Raw Facts",
  growth: "Growth",
  fundamentals: "Fundamentals",
  valuation: "Valuation",
  comparison: "Comparison",
};

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const profile = mkdtempSync(join(tmpdir(), "tab-state-"));
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

/**
 * Helpers injected into the page rather than repeated in every expression.
 *
 * `__set` goes through the prototype's value setter before dispatching, because
 * React keeps its own record of the last value it wrote on the DOM node:
 * assigning `el.value` directly updates that record too, React then sees no
 * change and drops the event. This is the standard way to drive a controlled
 * input from outside React, and it is the only reason those are two lines.
 */
const HELPERS = String.raw`
window.__field = (label) => [...document.querySelectorAll('.comparison__field')]
  .find((f) => f.querySelector('span')?.textContent.trim() === label);
window.__set = (el, value, kind) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
  el.dispatchEvent(new Event(kind, { bubbles: true }));
};
window.__clickTab = (label) => [...document.querySelectorAll('.tabs .tab')]
  .find((b) => b.textContent.trim() === label)?.click();
window.__activeTab = () => document.querySelector('.tabs .tab--active')?.textContent.trim() ?? null;
true`;

/**
 * What a tab's state looks like from outside. Each entry names how to wait for
 * the tab, how to put it into a non-default state, and what to read back -- the
 * three things that differ per tab, with the leave-and-return loop shared.
 */
const VIEWS = {
  comparison: {
    ready: "!!document.querySelector('.comparison__picked li')",
    disturb: String.raw`(() => {
      const metric = __field('Metric').querySelector('select');
      __set(metric, metric.options[metric.options.length - 1].value, 'change');
      document.querySelector('.comparison__picked li button').click();
      __set(__field('Window (years)').querySelector('input'), 7, 'input');
      return true;
    })()`,
    read: String.raw`JSON.stringify({
      metric: __field('Metric').querySelector('select').value,
      picked: [...document.querySelectorAll('.comparison__picked li')].map((li) => li.textContent.trim()),
      years: __field('Window (years)').querySelector('input').value,
    })`,
  },
  data: {
    ready: "!!document.querySelector('.data-tab .controls input[type=checkbox]')",
    disturb: String.raw`(() => {
      document.querySelector('.data-tab .controls input[type=checkbox]').click();
      document.querySelectorAll('.data-tab input[name=fact-filter]')[2].click();
      return true;
    })()`,
    read: String.raw`JSON.stringify({
      showAll: document.querySelector('.data-tab .controls input[type=checkbox]').checked,
      filter: [...document.querySelectorAll('.data-tab input[name=fact-filter]')].findIndex((r) => r.checked),
    })`,
  },
  // The chart tabs are the control: item 7's report says their state already
  // survives a tab switch, and this asserts it rather than trusting it.
  fundamentals: {
    ready: "!!document.querySelector('#years-fundamentals')",
    disturb: String.raw`(() => {
      __set(document.querySelector('#years-fundamentals'), 6, 'input');
      document.querySelectorAll('fieldset input[type=checkbox]')[0].click();
      return true;
    })()`,
    read: String.raw`JSON.stringify({
      years: document.querySelector('#years-fundamentals').value,
      checked: [...document.querySelectorAll('fieldset input[type=checkbox]')].map((c) => c.checked),
    })`,
  },
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
  const load = async (hash, label) => {
    run += 1;
    await send("Page.navigate", { url: `${APP}/?ts=${run}${hash}` });
    await waitFor("!!document.querySelector('.tabs')", `the shell on ${label}`);
    await evaluate(HELPERS);
    await sleep(900);
  };
  const expect = (ok, message) => {
    checked += 1;
    if (!ok) failures.push(message);
  };

  // --- the default route --------------------------------------------------
  const ROUTES = [
    ["", "no hash at all"],
    [`#/analysis/${TICKER}`, "no tab segment"],
    [`#/analysis/${TICKER}/`, "an empty tab segment"],
    [`#/analysis/${TICKER}/nonsense`, "an unknown tab"],
  ];
  for (const [hash, label] of ROUTES) {
    await load(hash, label);
    const active = await evaluate("__activeTab()");
    expect(active === TAB_LABELS.data, `default route with ${label}: landed on ${active}, expected Data`);
  }

  // --- an explicit tab still wins ----------------------------------------
  for (const [tab, label] of Object.entries(TAB_LABELS)) {
    await load(`#/analysis/${TICKER}/${tab}`, tab);
    const active = await evaluate("__activeTab()");
    expect(active === label, `direct link to ${tab}: landed on ${active}, expected ${label}`);
  }

  // --- state survives leaving and returning ------------------------------
  for (const [tab, view] of Object.entries(VIEWS)) {
    const away = tab === "fundamentals" ? "data" : "fundamentals";
    await load(`#/analysis/${TICKER}/${tab}`, tab);
    await waitFor(view.ready, `${tab}'s controls`);
    await evaluate(view.disturb);
    await sleep(700);
    const before = await evaluate(view.read);

    await evaluate(`__clickTab(${JSON.stringify(TAB_LABELS[away])})`);
    await sleep(1200);
    await evaluate(`__clickTab(${JSON.stringify(TAB_LABELS[tab])})`);
    await waitFor(view.ready, `${tab}'s controls on return`);
    await sleep(700);
    const after = await evaluate(view.read);

    expect(before === after, `${tab} after a round trip via ${away}: was ${before}, is now ${after}`);
  }

  for (const f of failures) console.error(`FAIL ${f}`);
  console.log(`${checked - failures.length}/${checked} tab-state and default-route checks pass`);
  process.exitCode = failures.length ? 1 : 0;
} finally {
  stop();
}
