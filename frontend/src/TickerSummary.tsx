/**
 * The written lede above the Analysis tabs — the page's only prose about the
 * company it is showing.
 *
 * A chart is an SVG and a table is numbers with no stated meaning; neither is
 * something a search engine, or a person skimming a result, can read to decide
 * the page answers their question. This states the same values in sentences.
 *
 * **It computes nothing.** Every figure is a `current_snapshot` value the
 * pipeline already published, read out of the frames `ChartView` and `DataTab`
 * are already given, formatted by the same `valueFormat`/`formatCell` pair the
 * data tab's snapshot section uses. The rules — which multiple, which clauses,
 * which sentence when a figure is absent — are in `shell/summary.ts`, which
 * imports no React and is therefore checkable from Node over all 609 tickers.
 *
 * **No second fetch.** `useTickerFrames(ticker)` is the same call `ChartView`
 * makes, behind the same promise cache in `DataProvider`, so mounting this
 * component costs zero additional requests: whichever of the two mounts first
 * makes the request and the other gets the same promise.
 *
 * **`p.ticker-summary` exists only in the loaded state**, deliberately, and it
 * is the marker the per-ticker prerendering task should wait on — the same
 * shape `section.about` already gives that step. While the frames are in
 * flight this renders a plain caption with no such class, so a prerender that
 * waited on it cannot capture a half-loaded page. `data-ticker` carries the
 * company the sentences are about, so the wait can also assert it is the right
 * one.
 */
import { useMemo } from "react";
import type { Registry } from "./contracts.ts";
import { useData, useTickerFrames } from "./data/DataContext.ts";
import { metricsById } from "./data/format.ts";
import { runDate } from "./shell/provenance.ts";
import { buildSummary } from "./shell/summary.ts";
import "./ticker-summary.css";

export default function TickerSummary({
  registry,
  ticker,
}: {
  registry: Registry;
  ticker: string;
}) {
  const { meta } = useData();
  const { frames, error } = useTickerFrames(ticker);
  const byId = useMemo(() => metricsById(registry), [registry]);

  const summary = useMemo(() => {
    const frame = frames?.current_snapshot;
    if (!frame) return null;
    // `current_snapshot` is one row per (ticker, concept) with a single
    // constant `end`, so the ticker's slice already *is* a concept -> value
    // map -- the same shape `render_snapshot_section` and `DataTab` read it in.
    // Nulls are dropped here rather than tested at every use: the pipeline's
    // own melt drops them too, so a null in this frame is a value that was
    // never published.
    const values: Record<string, number> = {};
    for (let i = 0; i < frame.rowCount; i += 1) {
      const value = frame.value[i];
      if (value !== null && Number.isFinite(value)) values[frame.concept[i]] = value;
    }
    return buildSummary({
      ticker,
      profile: registry.ticker_profile[ticker] ?? registry.default_profile,
      values,
      registry,
      byId,
      asOf: runDate(meta),
    });
  }, [frames, ticker, registry, byId, meta]);

  // A failed per-ticker fetch is the guard screen's business, not this
  // component's: `ChartView` and `DataTab` report it, and a second copy of the
  // message above them would say the same thing twice. Rendering nothing is
  // right here -- there is no sentence to write about a company whose file did
  // not arrive.
  if (error) return null;
  if (!summary) return <p className="caption">Loading {ticker}…</p>;

  return (
    <p className="ticker-summary" data-ticker={ticker}>
      {summary.sentences.join(" ")}
    </p>
  );
}
