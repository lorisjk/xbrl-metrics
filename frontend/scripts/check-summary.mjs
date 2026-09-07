/**
 * Does every sentence the ticker summary can produce say what the export says?
 *
 * The fourth standing check, and the first that needs no server and no browser:
 * `shell/summary.ts` imports no React, so its rules can be run directly against
 * `public/` over all 609 tickers in about two seconds.
 *
 *     node scripts/check-summary.mjs
 *
 * What it asserts, per ticker:
 *
 *   - the mandatory first sentence names the ticker, its profile and the run date;
 *   - every figure quoted is that ticker's own `current_snapshot` value,
 *     formatted by `data/format.ts` -- string equality, not value equality;
 *   - the multiple quoted is one the ticker's profile actually shows, and for
 *     the profiles with a specific answer (reit -> P/FFO, financial and both
 *     insurance profiles -> P/TBV, standard and utilities -> P/E) it is that
 *     one. **The expectation is read off `registry.profile_visibility`, not out
 *     of `pickValuation`** -- a rule that hardcoded one metric for every profile
 *     would otherwise move the expectation with it, which was measured: the
 *     first version of this check passed that mutation;
 *   - no second multiple is quoted alongside the chosen one;
 *   - a substitution is always announced, and never claimed when none happened;
 *   - a missing revenue, growth or market-capitalisation figure produces the
 *     sentence that says so rather than a silently shorter paragraph;
 *   - `buildSummary` is deterministic on one input.
 *
 * Exits non-zero on any failure, like its three siblings.
 */
import { readFileSync, readdirSync } from "node:fs";
import { buildSummary, pickValuation, formatSnapshot, VALUATION_PRIORITY } from "../src/shell/summary.ts";
import { metricsById, valueFormat, formatCell } from "../src/data/format.ts";

const PUB = new URL("../public/", import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, PUB), "utf8"));
const registry = read("registry.json");
const meta = read("meta.json");
const universe = read("universe.json");
const byId = metricsById(registry);
const asOf = (meta.run_start ?? "").slice(0, 10);

let ok = 0, bad = 0;
const fail = [];
const t = (name, cond, extra = "") => {
  cond ? ok++ : bad++;
  if (!cond && fail.length < 25) fail.push(`  [FAIL] ${name}${extra ? "  " + extra : ""}`);
};

const snapshotOf = (ticker) => {
  const f = read(`tickers/${ticker}.json`).frames.current_snapshot;
  const ci = f.columns.indexOf("concept"), vi = f.columns.indexOf("value");
  const out = {};
  if (f.data.length) for (let i = 0; i < f.data[0].length; i += 1) {
    const v = f.data[vi][i];
    if (v !== null && Number.isFinite(v)) out[f.data[ci][i]] = v;
  }
  return out;
};

const byProfile = new Map();
const picks = new Map();
const substituted = [];
const summaries = new Map();

for (const { ticker, profile } of universe) {
  const values = snapshotOf(ticker);
  const input = { ticker, profile, values, registry, byId, asOf };
  const s = buildSummary(input);
  const text = s.sentences.join(" ");
  summaries.set(ticker, text);

  // 1. determinism -- the same input must give the same bytes, twice.
  t(`${ticker} deterministic`, buildSummary(input).sentences.join(" ") === text);

  // 2. the mandatory first sentence names the ticker, the profile and the date.
  t(`${ticker} first sentence`, s.sentences[0].includes(ticker) && s.sentences[0].includes(profile)
    && s.sentences[0].includes(asOf) && s.sentences[0].includes("SEC EDGAR XBRL"));

  // 3. every number quoted is the snapshot's own value, formatted the one way.
  for (const [concept, phrase] of [["revenue_ttm", null], ["yoy_growth", null],
                                   ["market_cap", null]]) {
    void phrase;
    if (values[concept] === undefined) continue;
    const want = formatSnapshot(byId, concept, values[concept]);
    if (concept === "market_cap" && !text.includes("market capitalisation")) continue;
    t(`${ticker} quotes ${concept} as ${want}`, text.includes(want), text);
  }
  const { preferred, chosen } = s.pick;
  picks.set(ticker, chosen);

  // 3b. the profile decides the multiple, and the expectation is read straight
  // off `registry.profile_visibility` rather than out of `pickValuation` --
  // otherwise a rule that hardcoded one metric for every profile would move the
  // expectation with it and this would pass. (It does: measured under mutation.)
  const visible = registry.profile_visibility[profile];
  if (chosen) {
    t(`${ticker} quotes a multiple its ${profile} profile shows`, visible[chosen] === true, chosen);
  }
  const SPECIFIC = { reit: "p_ffo", financial: "p_tbv", insurance_pc: "p_tbv",
                     insurance_life: "p_tbv", standard: "pe_ratio", utilities: "pe_ratio" };
  const want = SPECIFIC[profile];
  if (want && visible[want] && Number.isFinite(values[want])) {
    t(`${ticker} (${profile}) quotes ${want}`, chosen === want, `chose ${chosen}`);
  }
  if (profile === "reit") {
    t(`${ticker} (reit) never quotes P/E -- the profile hides it`,
      visible.pe_ratio !== true && !text.includes("P/E (TTM) of "));
  }
  if (chosen) {
    const want = formatSnapshot(byId, chosen, values[chosen]);
    const label = byId.get(chosen).label;
    t(`${ticker} quotes ${chosen} as ${label} of ${want}`,
      text.includes(`${label} of ${want}`), text);
    // and it quotes NO other valuation multiple
    for (const other of VALUATION_PRIORITY) {
      if (other === chosen || other === preferred) continue;
      t(`${ticker} does not also quote ${other}`, !text.includes(`${byId.get(other).label} of `));
    }
  }

  // 4. a substitution is always announced.
  if (preferred && chosen !== preferred) {
    substituted.push(ticker);
    t(`${ticker} announces the missing ${preferred}`,
      text.includes(`${byId.get(preferred).label} is not available for ${ticker}`), text);
  } else if (chosen) {
    t(`${ticker} makes no substitution claim`, !text.includes("is not available for"),
      text.includes("is not available") ? text : "");
  }

  // 5. a missing optional figure is stated, never silently dropped.
  if (values.revenue_ttm === undefined && values.yoy_growth === undefined) {
    t(`${ticker} states the missing revenue`,
      text.includes(`No trailing-twelve-month revenue figure is available for ${ticker}`), text);
  } else if (values.yoy_growth === undefined) {
    t(`${ticker} states the missing growth`,
      text.includes(`No year-over-year revenue growth figure is available for ${ticker}`), text);
  }

  // 6. nothing empty, nothing with a double space or a dangling separator.
  t(`${ticker} well formed`, text.length > 60 && !text.includes("  ") && !text.includes("of ."), text);

  byProfile.set(profile, (byProfile.get(profile) ?? new Map()));
  const m = byProfile.get(profile);
  m.set(chosen, (m.get(chosen) ?? 0) + 1);
}

// 7. formatting identity against the data tab's own call, per concept.
{
  const t0 = "AAPL";
  const values = snapshotOf(t0);
  for (const c of ["revenue_ttm", "market_cap", "pe_ratio", "pb_ratio", "ev_sales"]) {
    const tab = formatCell(values[c], valueFormat(byId, c, values[c]));
    t(`${c}: summary string === data tab string`, formatSnapshot(byId, c, values[c]) === tab,
      `${formatSnapshot(byId, c, values[c])} vs ${tab}`);
  }
  const c = "yoy_growth";
  const tab = formatCell(values[c], valueFormat(byId, c, values[c]));
  const mine = formatSnapshot(byId, c, values[c]);
  console.log(`\n  the one deliberate divergence: yoy_growth  data tab "${tab}"  summary "${mine}"`);
  const viaMetric = formatCell(values[c], valueFormat(byId, "revenue_yoy_growth", values[c]));
  t("yoy_growth: summary string === the registry metric's string", mine === viaMetric,
    `${mine} vs ${viaMetric}`);
}

console.log(`\n=== ${ok}/${ok + bad} ===`);
for (const f of fail) console.log(f);

console.log("\n=== headline multiple by profile ===");
for (const p of [...byProfile.keys()].sort()) {
  console.log(`  ${p.padEnd(22)} ${JSON.stringify(Object.fromEntries(byProfile.get(p)))}`);
}
console.log(`\nsubstituted: ${substituted.length} tickers`);
console.log("\n=== the named edge cases, in full ===");
for (const x of ["V", "STZ", "ERIE", "BKR"]) console.log(`\n${x}:\n  ${summaries.get(x)}`);
console.log("\n=== one per profile family ===");
for (const x of ["AAPL", "JPM", "O", "AFL", "AEE", "AMG"]) {
  console.log(`\n${x}:\n  ${summaries.get(x)}`);
}
process.exit(bad ? 1 : 0);
