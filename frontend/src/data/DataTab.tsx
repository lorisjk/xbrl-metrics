/**
 * The Data tab: `app.py`'s `render_data_tab` (app.py:552), five sections in
 * pipeline order.
 *
 * This replaces the shell's item-9 placeholder. It is the first view built from
 * tables rather than figures, and the first one that needs the second per-ticker
 * file -- `facts_full` lives in `{TICKER}.facts.json` and no chart tab reads it,
 * so it is fetched when this tab is opened and never before.
 *
 * **Ticker-dependent, like the chart tabs and unlike the reference views.** The
 * ticker arrives as a prop from the shell, the two loads are keyed on it, and
 * the pivots are `useMemo`'d over exactly the inputs that change them. Nothing
 * here holds a copy of the ticker.
 *
 * Display formatting arrived with item 10 and lives entirely in `format.ts`:
 * this file decides *which* treatment each column gets and hands it to the
 * table as a string-producing rule. No value is ever formatted in place, which
 * is what keeps the CSV path on the numbers.
 *
 * What is deliberately *not* here, so the boundary is legible from the code as
 * well as from the report: no copy blocks (item 11), no cadence markers
 * (item 19 -- `ttm_source` is not even reconstructed). The quality-flag
 * summary arrived with item 18 and is the one section whose shape changed
 * afterwards: item 9 showed the per-period 0/1 grid at the top level and hid
 * nothing, which is the reference's prominence inverted, and item 18 put the
 * summary above it and the grid into a disclosure.
 */
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Metric } from "../contracts.ts";
import { useConceptCandidates, useData, useTickerFacts, useTickerFrames } from "./DataContext.ts";
import DataTable, { FlagSummaryTable, PairTable } from "./DataTable.tsx";
import SectionActions from "./SectionActions.tsx";
import { cadenceMarkers } from "./cadence.ts";
import { DEFAULT_COPY_PERIODS, pairsToCsv, pivotToCsv } from "./csv.ts";
import { flagSummary } from "./flags.ts";
import { columnFormat, metricsById, valueFormat, type CellFormat } from "./format.ts";
import {
  DEFAULT_TABLE_PERIODS,
  FACT_FILTERS,
  allNullColumns,
  columnMagnitudes,
  filterFactColumns,
  headPeriods,
  isQualityFlag,
  isoDate,
  pivotTicker,
  selectColumns,
  type FactFilter,
  type Pivot,
} from "./pivot.ts";
import "./data-tab.css";
import TickerSummary from "../TickerSummary.tsx";

/**
 * One section: heading, its caption, the count line, the table, the download.
 *
 * The count line is `render_data_section`'s (app.py:405), including the clause
 * that only appears when a column is null in every period shown -- the sentence
 * is quoted rather than paraphrased, because it is the tab's own statement about
 * what an empty column means.
 */
function Section({
  title,
  caption,
  pivot,
  periods,
  byId,
  file,
  cadence,
}: {
  title: string;
  caption: string;
  /** The whole pivot; `periods` decides how much of it is shown. */
  pivot: Pivot;
  periods: number;
  byId: ReadonlyMap<string, Metric>;
  /** Download file name, or null for a section that offers no download. */
  file: string | null;
  /**
   * Cadence markers and their legend, for the one section that has them.
   *
   * `render_data_section` takes both as optional arguments and four of the five
   * calls pass neither (app.py:587 is the only one that does), so they are
   * optional here for the same reason rather than as a generalisation.
   */
  cadence?: { markers: ReadonlyMap<string, string>; legend: string };
}) {
  const shown = useMemo(() => headPeriods(pivot, periods), [pivot, periods]);
  const empty = useMemo(() => allNullColumns(shown), [shown]);
  // app.py:431 takes the copy block from `wide`, not from `shown` -- so it is
  // eight periods whether or not "Show all periods" is on. That is the
  // reference's decision and it is reproduced: the download is the unbounded
  // path, the copy block is the one sized for pasting.
  const copied = useMemo(() => headPeriods(pivot, DEFAULT_COPY_PERIODS), [pivot]);
  // Decided from the rows on screen, not the whole pivot -- app.py:373 formats
  // `wide.head(periods)`, so "Show all periods" can genuinely move a column
  // between treatments. Recomputed with `shown` for that reason.
  const formats = useMemo<CellFormat[]>(
    () =>
      shown.concepts.map((concept, column) =>
        columnFormat(byId, concept, columnMagnitudes(shown, column)),
      ),
    [shown, byId],
  );
  // `shown.concepts` rather than the whole pivot's: the reference gates on
  // `shown.columns` (app.py:423), and those are the filtered columns. The row
  // count never enters it -- `head(periods)` drops rows, not columns -- so
  // "Show all periods" cannot make the legend appear or vanish.
  const legend = useMemo(() => {
    if (!cadence || cadence.legend === "") return null;
    return shown.concepts.some((c) => cadence.markers.has(c)) ? cadence.legend : null;
  }, [cadence, shown]);

  return (
    <section className="section">
      <h2>{title}</h2>
      <p className="caption" style= {{fontSize: "14px"}}>{caption}</p>
      {pivot.ends.length === 0 ? (
        <p className="notice-inline">No rows for this ticker in this frame.</p>
      ) : (
        <>
          <p className="caption">
            {shown.ends.length} of {pivot.ends.length} periods · {shown.concepts.length} concepts
            {empty > 0 && (
              <>
                {" · "}
                {empty} null in every period shown — kept on purpose, an empty column is a finding
              </>
            )}
          </p>
          <DataTable
            pivot={shown}
            formats={formats}
            caption={`${title} for the selected ticker`}
            markers={cadence?.markers}
          />
          {/* app.py:423 -- the legend renders only when at least one *marked*
              concept is among the columns on screen, so switching the facts
              filter to "Raw only" takes it away with the columns it describes.
              It still names every marked concept, including ones the current
              filter hides: it is the ticker's provenance, not the view's. */}
          {legend !== null && (
            <div className="caption cadence-legend">
              <ReactMarkdown>{legend}</ReactMarkdown>
            </div>
          )}
          {file && (
            <SectionActions
              file={file}
              csv={pivotToCsv(shown)}
              copy={{ text: pivotToCsv(copied), periods: copied.ends.length }}
            />
          )}
        </>
      )}
    </section>
  );
}

export default function DataTab({ ticker }: { ticker: string }) {
  const { registry } = useData();
  const { frames, error } = useTickerFrames(ticker);
  const { facts, error: factsError } = useTickerFacts(ticker);
  const { candidates } = useConceptCandidates(ticker);

  // `METRICS_BY_ID` (app.py:349), from the registry the shell already holds.
  // The same object the chart path reads its percent flags from -- there is no
  // second table of per-concept formatting anywhere, which is the thing that
  // would go stale.
  const byId = useMemo(() => (registry ? metricsById(registry) : new Map()), [registry]);

  const [showAll, setShowAll] = useState(false);
  const [factFilter, setFactFilter] = useState<FactFilter>("All");
  // app.py:577 -- "all" is a number large enough to mean it, so one code path
  // serves both settings instead of a second branch that could drift.
  const periods = showAll ? Number.MAX_SAFE_INTEGER : DEFAULT_TABLE_PERIODS;

  const factsPivot = useMemo(() => pivotTicker(facts ?? undefined), [facts]);
  const metricsPivot = useMemo(() => pivotTicker(frames?.metrics_long), [frames]);
  const valuationPivot = useMemo(() => pivotTicker(frames?.valuation_history), [frames]);

  // The facts filter narrows the columns and `order_fact_columns` regroups what
  // is left, so a concept always sits next to its own derivations -- which is
  // what makes the TTM derivation auditable by eye. Without the candidates file
  // there is no split to apply, so the pivot's own alphabetical order stands.
  const factsShown = useMemo(
    () =>
      candidates
        ? selectColumns(factsPivot, filterFactColumns(candidates, factsPivot.concepts, factFilter))
        : factsPivot,
    [factsPivot, candidates, factFilter],
  );

  // app.py:587 -- computed from the whole `facts_full` frame, **before** the
  // raw/derived filter narrows anything, because provenance is a property of the
  // series and not of the current view. The filter then decides which of these
  // markers is on screen, in `Section`.
  const cadence = useMemo(() => cadenceMarkers(facts), [facts]);

  // app.py:596 -- the flags come out of metrics_long and are shown apart from
  // it, so a 0/1 column never sits between two ratios.
  const flagsPivot = useMemo(
    () => selectColumns(metricsPivot, metricsPivot.concepts.filter(isQualityFlag)),
    [metricsPivot],
  );
  // Unformatted, on purpose -- see CellFormat's "raw". A flag is a 0 or a 1 and
  // `format_for_display` never touches this section.
  const flagFormats = useMemo<CellFormat[]>(
    () => flagsPivot.concepts.map(() => "raw"),
    [flagsPivot],
  );
  // app.py:445 -- the summary, from the same pivot the table below renders and
  // over **every** period rather than the ones on screen: `render_flag_section`
  // builds its rows from `wide` and applies `.head(periods)` only inside the
  // expander, so "Show all periods" moves the table and leaves this alone.
  const flagRows = useMemo(() => flagSummary(flagsPivot), [flagsPivot]);
  const metricsShown = useMemo(
    () => selectColumns(metricsPivot, metricsPivot.concepts.filter((c) => !isQualityFlag(c))),
    [metricsPivot],
  );

  // app.py:468 -- the snapshot is long with one row per (ticker, concept) and a
  // single constant `end`, so the ticker's slice already *is* the transposed
  // view. Pivoting it would produce one row and ~46 columns that scroll
  // sideways, and would add nothing: there is no second period to compare
  // against. Sorted by concept, exactly as `render_snapshot_section` does.
  const snapshot = useMemo(() => {
    const frame = frames?.current_snapshot;
    if (!frame || frame.rowCount === 0) return null;
    const rows = Array.from({ length: frame.rowCount }, (_, i) => ({
      concept: frame.concept[i],
      value: frame.value[i],
      format: valueFormat(byId, frame.concept[i], frame.value[i]),
    })).sort((a, b) => (a.concept < b.concept ? -1 : a.concept > b.concept ? 1 : 0));
    return { rows, asOf: isoDate(frame.end[0]) };
  }, [frames, byId]);

  if (error) {
    return <p className="notice-inline">Could not load {ticker}: {error.message}</p>;
  }
  if (!frames) return <p className="caption">Loading {ticker}…</p>;

  return (
    <div className="data-tab">
      <p>
        Everything the charts are drawn from, for <strong style={{color : "#e01e37"}}>{ticker}</strong>, in pipeline order: what
        EDGAR returned, what was derived from it, what was computed, and the latest state. Every
        table downloads at full precision.
      </p>
      <p className="ticker-summary" data-ticker={ticker} style = {{fontSize : "14px", fontStyle: "oblique"}}>
      {registry && <TickerSummary registry={registry} ticker={ticker} />}
      </p>
      <div className="controls">
        <label className="control">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />{" "}
          Show all periods
        </label>

        <fieldset className="control control--radio">
          <legend>Facts</legend>
          {FACT_FILTERS.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="fact-filter"
                checked={factFilter === option}
                onChange={() => setFactFilter(option)}
              />{" "}
              {option}
            </label>
          ))}
        </fieldset>
      </div>
      <p className="caption" style = {{fontSize : "13px"}}>
        {showAll
          ? "Showing every period on file."
          : `Showing the most recent ${DEFAULT_TABLE_PERIODS} periods.`}{" "}
        Raw is what EDGAR returned; derived is what the pipeline computed from it. Columns are
        grouped so a concept sits next to its own derivations.
      </p>

      {factsError ? (
        <section className="section">
          <h2>Raw &amp; derived facts</h2>
          <p className="notice-inline">Could not load the facts frame: {factsError.message}</p>
        </section>
      ) : !facts ? (
        <section className="section">
          <h2>Raw &amp; derived facts</h2>
          <p className="caption">Loading the facts frame…</p>
        </section>
      ) : (
        <Section
          title="Raw & derived facts"
          caption="Straight from EDGAR, plus what the pipeline built on top. Revenue next to Revenue_TTM is the TTM derivation, auditable."
          pivot={factsShown}
          periods={periods}
          byId={byId}
          file={`${ticker}_facts.csv`}
          cadence={cadence}
        />
      )}

      <Section
        title="Calculated metrics"
        caption="What the pipeline computes from the facts above. Quality flags are pulled out below rather than left as 0/1 columns between the ratios."
        pivot={metricsShown}
        periods={periods}
        byId={byId}
        file={`${ticker}_metrics.csv`}
      />

      <section className="section">
        <h2>Quality flags</h2>
        <p className="caption">Distortion of data.</p>
        {flagsPivot.concepts.length === 0 ? (
          <p className="notice-inline">No quality flags recorded for this ticker.</p>
        ) : (
          <>
            <FlagSummaryTable rows={flagRows} caption="Quality flags, how often and how recently" />
            {/* app.py:457's expander, and the prominence it gives the two
                tables is the point rather than an inherited detail: the
                summary is the answer and the 0/1 grid is the working. Item 9
                had the grid at the top level with a sentence of its own
                explaining how to read it; that sentence is gone, because the
                row above now says `raised` and `periods evaluated` in words.

                The download sits inside, where the reference puts it
                (app.py:462), and still carries the grid rather than the
                summary -- the numeric periods are the exportable thing. */}
            <details className="flag-periods">
              <summary>Per-period flag values</summary>
              <DataTable
                pivot={headPeriods(flagsPivot, periods)}
                formats={flagFormats}
                caption="Quality flags per period"
              />
              {/* Download only. `render_flag_section` offers a CSV inside its
                  expander and no copy block. */}
              <SectionActions
                file={`${ticker}_flags.csv`}
                csv={pivotToCsv(headPeriods(flagsPivot, periods))}
                copy={null}
              />
            </details>
          </>
        )}
      </section>

      <Section
        title="Valuation history"
        caption="Multiples over time, priced off the closing price nearest each period end."
        pivot={valuationPivot}
        periods={periods}
        byId={byId}
        file={`${ticker}_valuation.csv`}
      />

      <section className="section">
        <h2>Current snapshot</h2>
        {!snapshot ? (
          <p className="notice-inline">No snapshot row for this ticker.</p>
        ) : (
          <>
            <p className="caption">
              {snapshot.rows.length} concepts · as of {snapshot.asOf} · one row per concept, so a
              profile that does not apply is simply absent
            </p>
            <PairTable rows={snapshot.rows} caption={`Current snapshot for ${ticker}`} />
            {/* app.py:499 copies the whole snapshot: it is one row per concept
                with no second period, so there is no window to narrow and the
                period count in the label would be meaningless. */}
            <SectionActions
              file={`${ticker}_snapshot.csv`}
              csv={pairsToCsv(snapshot.rows)}
              copy={{ text: pairsToCsv(snapshot.rows), periods: null }}
            />
          </>
        )}
      </section>
    </div>
  );
}
