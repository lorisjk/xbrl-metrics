/**
 * The ticker summary's rules, as pure functions.
 *
 * A rules module next to `about.ts` and `notice.ts`, for the reason those are
 * modules: the interesting part of this feature is *which sentences are absent*,
 * and there are five separate ways for a clause to drop. Each is checkable from
 * Node against the real export, over all 609 tickers, without a browser — which
 * is what §4 of the report does.
 *
 * **Nothing here computes a figure.** Every number comes out of
 * `current_snapshot` exactly as the pipeline published it, formatted by
 * `data/format.ts` — the same `valueFormat`/`formatCell` pair the data tab's
 * snapshot section uses, so the sentence and the table below it cannot state
 * two different strings for one fact. There is no second lookup, no second
 * rounding rule and no arithmetic.
 *
 * **And nothing here invents text about a company.** The export carries no
 * company names — `universe.json` is `{ticker, profile, n_metrics,
 * n_valuation, n_growth}` — so the subject of every sentence is the ticker, and
 * the profile is spelled the way the sidebar already spells it. The valuation
 * multiple is named by `registry.metrics[].label` ("P/E (TTM)", "P/TBV",
 * "P/FFO (TTM)"), not by a second table of names kept here.
 */
import { formatCell, valueFormat, type CellFormat } from "../data/format.ts";
import type { Metric, Registry } from "../contracts.ts";

/**
 * Which multiple the summary quotes, most profile-specific first.
 *
 * **Filtered by `registry.profile_visibility`, never hardcoded per profile.**
 * The registry already says which multiples a profile shows — a REIT is not
 * valued on earnings and `pe_ratio` is hidden for it outright — so the rule is
 * one priority order intersected with what that profile publishes. Measured
 * over the whole universe, that produces exactly the split the encyclopedia
 * makes: `p_ffo` for all 27 reits, `p_tbv` for 40 of the 43 financial and
 * insurance tickers, `pe_ratio` for 477 of the rest.
 *
 * The tail after the first three is the fallback, and it is what makes this
 * total: **0 of 609 tickers end with no multiple at all**. It is ordered
 * earnings → cash flow → sales → book, which is the order the valuation chart
 * itself lists them in.
 */
export const VALUATION_PRIORITY = [
  "p_ffo",
  "p_tbv",
  "pe_ratio",
  "p_ppnr",
  "p_core_earnings",
  "ev_ebitda",
  "pfcf_ratio",
  "ev_sales",
  "pb_ratio",
] as const;

/**
 * Snapshot concept -> the registry id that describes how to format it.
 *
 * One entry, and it is a real defect it works around rather than a convenience.
 * The snapshot publishes revenue growth as the concept `yoy_growth`, which is
 * not a registry id, so `valueFormat` finds no metric, falls through to the
 * magnitude rule and prints `0.1424`. The identical quantity in `metrics_long`
 * is `revenue_yoy_growth`, which the registry marks `percent: true`, and prints
 * `14.24%`. **The data tab shows both spellings today**, for the same ticker,
 * on the same screen. The alias makes the summary say `14.24%` — which is what
 * the registry says the metric is — and the disagreement is recorded as a
 * follow-up rather than fixed here, because fixing it means renaming a
 * published snapshot concept.
 *
 * Every other concept the summary quotes needs no entry: the valuation ids
 * *are* registry ids, and `revenue_ttm`/`market_cap` reach `absolute` on their
 * magnitude, which is what the table does with them too.
 */
export const FORMAT_ALIASES: Readonly<Record<string, string>> = {
  yoy_growth: "revenue_yoy_growth",
};

/** One snapshot value, formatted exactly as the data tab's snapshot section formats it. */
export function formatSnapshot(
  byId: ReadonlyMap<string, Metric>,
  concept: string,
  value: number | null,
): string {
  const id = FORMAT_ALIASES[concept] ?? concept;
  const kind: CellFormat = valueFormat(byId, id, value);
  return formatCell(value, kind);
}

export interface ValuationPick {
  /** The first multiple in `VALUATION_PRIORITY` this profile shows at all. */
  preferred: string | null;
  /** The first one it shows *and* has a value for. `null` when there is none. */
  chosen: string | null;
}

/**
 * Which multiple this ticker's summary quotes, and which one it would have
 * preferred.
 *
 * The pair is the point: when they differ the summary says so (§4 of the
 * report), because substituting a different multiple silently is the version of
 * this that reads fine and is dishonest. 68 of 609 tickers land there, and all
 * four of the named share-count cases are among them.
 */
export function pickValuation(
  registry: Registry,
  profile: string,
  values: Readonly<Record<string, number>>,
): ValuationPick {
  const visible = registry.profile_visibility[profile] ?? {};
  const shown = VALUATION_PRIORITY.filter((id) => visible[id]);
  return {
    preferred: shown[0] ?? null,
    chosen: shown.find((id) => Number.isFinite(values[id])) ?? null,
  };
}

export interface SummaryInput {
  ticker: string;
  profile: string;
  /** `current_snapshot`'s concept -> value, nulls already dropped. */
  values: Readonly<Record<string, number>>;
  registry: Registry;
  byId: ReadonlyMap<string, Metric>;
  /**
   * The date the sidebar's "Data as of" line shows, `""` when unknown.
   *
   * Passed in rather than derived here: `shell/provenance.ts` owns the one
   * expression that turns `meta.run_start` into a date, and both this and the
   * sidebar's freshness block read it from there.
   */
  asOf: string;
}

export interface Summary {
  sentences: string[];
  /** Which multiple was quoted, for the report's per-profile check. */
  pick: ValuationPick;
}

const labelFor = (byId: ReadonlyMap<string, Metric>, id: string) => byId.get(id)?.label ?? id;

/**
 * "a P/E (TTM)" but "an EV/EBITDA".
 *
 * A rule on the label's first token rather than a vowel test, because a vowel
 * test gets this exactly backwards: every label here that *starts* with a vowel
 * letter is an EV multiple, and every one that starts with a consonant letter
 * is a P/ multiple read as "pee". The nine labels the priority list can produce
 * are P/E (TTM), P/TBV, P/FFO (TTM), P/PPNR, P/Core Earnings, P/FCF (TTM),
 * P/B, EV/EBITDA and EV/Sales -- so the split is exactly "EV/" against the rest.
 */
const article = (label: string) => (label.startsWith("EV/") ? "an" : "a");

/**
 * The summary, as sentences.
 *
 * **Mandatory** — the first sentence, which needs only the ticker and the
 * profile, both of which exist for every ticker in the registry by
 * construction. Everything after it is a clause that drops on its own if its
 * figure is absent, and every drop that a reader could mistake for "this
 * company has no such figure" is replaced by a sentence that says so.
 *
 * The measured coverage of the optional halves, over 609 tickers:
 * `revenue_ttm` 607, `yoy_growth` 597, `market_cap` 591, a valuation multiple
 * 609. So the two-clause revenue sentence is the common case and the fallbacks
 * are not theoretical: 12 tickers publish revenue with no growth figure beside
 * it, and 18 have no market capitalisation.
 *
 * **Year over year, not quarter over quarter, and the figure is TTM-based.**
 * The growth cycle measured what QoQ costs in a single number: it is not
 * seasonally adjusted, so a seasonal filer shows a regular yearly cycle that is
 * the calendar and not the trend — DECK's QoQ amplitude is 32x its YoY. A
 * one-sentence lede cannot carry that caveat, so it quotes the rate that does
 * not need it. `yoy_growth` compares trailing-twelve-month revenue against the
 * same window a year earlier, which removes seasonality twice over.
 */
export function buildSummary(input: SummaryInput): Summary {
  const { ticker, profile, values, registry, byId, asOf } = input;
  const money = (concept: string) => formatSnapshot(byId, concept, values[concept] ?? null);

  const sentences: string[] = [];
  sentences.push(
    asOf
      ? `${ticker} is covered here under the ${profile} profile. Every figure below is ` +
        `computed from ${ticker}'s own SEC EDGAR XBRL filings, as of ${asOf}.`
      : `${ticker} is covered here under the ${profile} profile. Every figure below is ` +
        `computed from ${ticker}'s own SEC EDGAR XBRL filings.`,
  );

  const hasRevenue = Number.isFinite(values.revenue_ttm);
  const hasGrowth = Number.isFinite(values.yoy_growth);
  if (hasRevenue && hasGrowth) {
    sentences.push(
      `Trailing-twelve-month revenue is ${money("revenue_ttm")}; year-over-year ` +
        `revenue growth is ${money("yoy_growth")}.`,
    );
  } else if (hasRevenue) {
    sentences.push(
      `Trailing-twelve-month revenue is ${money("revenue_ttm")}. No year-over-year ` +
        `revenue growth figure is available for ${ticker} in this export.`,
    );
  } else if (hasGrowth) {
    sentences.push(`Year-over-year revenue growth is ${money("yoy_growth")}.`);
  } else {
    sentences.push(`No trailing-twelve-month revenue figure is available for ${ticker} in this export.`);
  }

  const pick = pickValuation(registry, profile, values);
  if (pick.chosen) {
    const label = labelFor(byId, pick.chosen);
    const multiple = `${article(label)} ${label} of ${money(pick.chosen)}`;
    sentences.push(
      Number.isFinite(values.market_cap)
        ? `${ticker} trades at ${multiple}, on a market capitalisation of ${money("market_cap")}.`
        : `${ticker} trades at ${multiple}.`,
    );
  }

  // The honest gap, and the reason this function returns `pick` at all. Naming
  // the multiple that is missing *and* the one that replaced it is what keeps a
  // substitution from reading as the profile's normal answer.
  if (pick.chosen === null) {
    sentences.push(`No valuation multiple is available for ${ticker} in this export.`);
  } else if (pick.preferred && pick.preferred !== pick.chosen) {
    sentences.push(
      `${labelFor(byId, pick.preferred)} is not available for ${ticker} in this export, so the ` +
        `multiple above is the next one the ${profile} profile shows.`,
    );
  }

  return { sentences, pick };
}
