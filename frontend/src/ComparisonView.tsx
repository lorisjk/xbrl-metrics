/**
 * The Comparison tab: `app.py`'s `tab_cmp` block (app.py:1021).
 *
 * One metric, one line per ticker. Unlike `ChartView` this is not keyed on the
 * shell's ticker -- it has its own ticker *set*, and the shell's selection is
 * only the seed for it (app.py has no such link at all; here it is what makes
 * arriving on the tab show something about the company you were just looking
 * at). Changing the shell's ticker afterwards does not disturb a set the reader
 * has edited.
 *
 * That last sentence only became true in the state-persistence cycle. This view
 * was rendered conditionally, so leaving the tab unmounted it and coming back
 * re-ran the initialiser below -- reseeding from whatever ticker the shell was
 * on and discarding the reader's set, metric and window. The state here is
 * unchanged; what changed is that `TabPanel` now keeps the component mounted.
 */
import { useMemo, useState, useEffect } from "react";
import Plot from "react-plotly.js";
import type { ChartId, Registry } from "./contracts.ts";
import { useTickersFrames } from "./data/DataContext.ts";
import type { UniverseEntry } from "./data/DataContext.ts";
import {
  COMPARISON_YEARS,
  MIN_COMPARISON_TICKERS,
  SUGGESTED_MAX_COMPARISON_TICKERS,
  buildComparison,
} from "./charts/comparison.ts";
import { YEARS_MAX, YEARS_MIN } from "./charts/defaults.ts";
import OutlierControls, {
  COMPARISON_MASK_HELP,
  COMPARISON_MASKED_NOTE,
} from "./OutlierControls.tsx";
import "./comparison.css";

/** app.py:37 `CHART_LABELS`, for the picker's option prefixes. */
const CHART_LABELS: Record<ChartId, string> = {
  fundamentals: "Fundamentals",
  growth: "Growth",
  valuation: "Valuation",
};

/** app.py:1023 -- fundamentals, then growth, then valuation. Order matters. */
const CATALOGUE_ORDER: ChartId[] = ["fundamentals", "growth", "valuation"];

/**
 * app.py:1023-1029 builds the option list from `get_plottable_metrics(chart)`
 * **without a ticker**, so it is the full registry catalogue, unfiltered by any
 * profile. That is deliberate and it is what makes the exclusion notice the
 * chart's job rather than the picker's: you may ask for `pe_ratio` across a REIT
 * and a bank, and the chart tells you which one cannot answer.
 *
 * The id-namespace split rides along for free: growth ids are XBRL concept names
 * and the other two are metric names, but `registry.charts[chart].metric_ids`
 * already keeps them apart and every id is globally unique, so one flat list
 * cannot collide.
 */
function catalogue(registry: Registry): { id: string; label: string }[] {
  const byId = new Map(registry.metrics.map((m) => [m.id, m]));
  const options: { id: string; label: string }[] = [];
  for (const chart of CATALOGUE_ORDER) {
    for (const id of registry.charts[chart].metric_ids) {
      const metric = byId.get(id);
      if (metric) options.push({ id, label: `${CHART_LABELS[chart]}: ${metric.label}` });
    }
  }
  return options;
}

export default function ComparisonView({
  registry,
  universe,
  seed,
  asOf,
}: {
  registry: Registry;
  universe: UniverseEntry[];
  /** The shell's current ticker, used once to seed the set. */
  seed: string;
  /**
   * The sidebar's as-of date, or null. app.py:1063 passes the same value here as
   * to the valuation grid -- one control, two charts -- so this is a prop rather
   * than state of its own.
   */
  asOf: Date | null;
}) {
  const options = useMemo(() => catalogue(registry), [registry]);
  const [concept, setConcept] = useState(() => options[0]?.id ?? "");
  // This chart holds one concept and several lines, so the outlier report is
  // keyed by ticker and every line describes the *same* metric -- which is why
  // the percent answer below ignores its key. `dividend_yield` is the one
  // valuation metric with `percent: true`, and it is the only concept this
  // chart can mask that reaches the percent branch at all.
  const conceptIsPercent = useMemo(
    () => registry.metrics.find((m) => m.id === concept)?.percent ?? false,
    [registry, concept],
  );

  // app.py:1030 defaults to the first three of the universe. Seeding with the
  // shell's ticker first is this build's one departure and it is a small one:
  // the reader arrived here from that company, and the other two keep the
  // reference's rule.
  const [picked, setPicked] = useState<string[]>(() => {
    const rest = universe.map((u) => u.ticker).filter((t) => t !== seed);
    return [seed, ...rest].slice(0, Math.min(SUGGESTED_MAX_COMPARISON_TICKERS, universe.length));
  });
  const [years, setYears] = useState(COMPARISON_YEARS);
  // app.py:1053 `cmp_mask_outliers` -- its own key, separate from the valuation
  // tab's, so the two toggles do not move together. They are different charts
  // over different data and a reader sets them for different reasons.
  const [masked, setMasked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
    useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
  
      // Plotly nach dem Wechsel auf die neue Größe bringen
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 100);
    };
  
    document.addEventListener("fullscreenchange", handleFullscreenChange);
  
    return () => {
      document.removeEventListener(
        "fullscreenchange",
        handleFullscreenChange,
      );
    };
  }, []);

  const { framesByTicker, pending, errors } = useTickersFrames(picked);

  const result = useMemo(
    () =>
      buildComparison(registry, framesByTicker, picked, concept, {
        years,
        mask: masked,
        anchor: asOf ?? undefined,
      }),
    [registry, framesByTicker, picked, concept, years, masked, asOf],
  );

  const profileOf = useMemo(
    () => new Map(universe.map((u) => [u.ticker, u.profile])),
    [universe],
  );

  const toggle = (ticker: string) =>
    setPicked((current) =>
      current.includes(ticker) ? current.filter((t) => t !== ticker) : [...current, ticker]);

  return (
    <section className="comparison">
      <p>One metric, one line per ticker.</p>

      <label className="comparison__field">
        <span>Metric</span>
        <select value={concept} onChange={(e) => setConcept(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="comparison__field">
        <span>Add a ticker</span>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) toggle(e.target.value);
          }}
        >
          <option value="">Choose…</option>
          {universe
            .filter((u) => !picked.includes(u.ticker))
            .map((u) => (
              <option key={u.ticker} value={u.ticker}>
                {u.ticker} — {u.profile}
              </option>
            ))}
        </select>
      </label>

      {/* The set itself, each entry removable. A multiselect in a native
          <select multiple> hides the current choice behind a scroll; this shows
          it, which matters when the chart's whole subject is which tickers are
          in it. */}
      <ul className="comparison__picked">
        {picked.map((ticker) => (
          <li key={ticker}>
            <button type="button" onClick={() => toggle(ticker)} aria-label={`Remove ${ticker}`}>
              {ticker} <span aria-hidden="true">×</span>
            </button>
            <span className="comparison__profile">{profileOf.get(ticker) ?? ""}</span>
          </li>
        ))}
      </ul>

      <label className="comparison__field">
        <span>Window (years)</span>
        <input
          type="range"
          min={YEARS_MIN}
          max={YEARS_MAX}
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
        />
        <output>{years}</output>
      </label>

      {/* app.py:1033 verbatim. */}
      <p className="caption">
        At least {MIN_COMPARISON_TICKERS} tickers; {SUGGESTED_MAX_COMPARISON_TICKERS} stay
        comfortably readable.
      </p>

      {/* app.py:1054 renders the toggle before the chart and the caption after
          it; one component covers both, and it is the same one the valuation tab
          uses -- see its docstring for why that matters here. Keyed by ticker
          rather than by concept, and empty for a non-valuation metric, which is
          what keeps the control off there. */}
      <OutlierControls
        report={result.outliers}
        masked={masked}
        onMasked={setMasked}
        label={(ticker) => ticker}
        percent={() => conceptIsPercent}
        help={COMPARISON_MASK_HELP}
        maskedNote={COMPARISON_MASKED_NOTE}
        medianLabel="own median"
      />

      {[...errors].map(([ticker, error]) => (
        <p className="notice-inline" key={ticker}>
          <strong>{ticker}</strong> could not be loaded — {error.message}
        </p>
      ))}

      {/* app.py:1064 -- one warning per dropped ticker, above the chart, and the
          wording is the app's job rather than the builder's. `No Data` becomes
          "no values in this window"; a profile exclusion is passed through as
          the builder worded it. The share-history clause app.py adds needs
          `facts_full`, which this view does not fetch -- see the report. */}
      {result.excluded.map((e) => (
        <p className="notice-inline" key={e.ticker}>
          <strong>{e.ticker}</strong> not shown —{" "}
          {e.reason === "No Data" ? "no values in this window" : e.reason}.
        </p>
      ))}

      {result.figure === null ? (
        <p role="status" className="caption">
          {pending.length > 0
            ? `Loading ${pending.join(", ")}…`
            : "Pick at least two tickers that can show this metric."}
        </p>
      ) : (
  <div
    style={{
      width: isFullscreen ? "100vw" : "100%",
      height: isFullscreen
        ? "100vh"
        : `${result.figure.layout.height ?? 600}px`,
      background: "var(--app-bg, #0e1117)",
      position: "relative",
    }}
  >
    <Plot
      data={result.figure.data as never}
      layout={{
        ...result.figure.layout,
        autosize: true,
      } as never}
      style={{
        width: "100%",
        height: "100%",
      }}
      useResizeHandler
      config={{
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToAdd: [
          {
            name: "Fullscreen",
            title: isFullscreen ? "Exit fullscreen" : "Fullscreen",
            icon: {
              width: 24,
              height: 24,
              path: `
                M3 3h7v2H5v5H3V3z
                M21 3v7h-2V5h-5V3h7z
                M3 21v-7h2v5h5v2H3z
                M21 21h-7v-2h5v-5h2v7z
              `,
            },
            click: (gd: HTMLElement) => {
              const chartContainer = gd.parentElement;

              if (!chartContainer) return;

              if (document.fullscreenElement) {
                void document.exitFullscreen();
              } else {
                void chartContainer.requestFullscreen();
              }
            },
          },
        ],
      }}
    />
  </div>
)}
    </section>
  );
}
