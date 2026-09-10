/**
 * `build_growth`, client-side. The third chart over `panel.ts`, and the one
 * that does not go through `plot_metric` at all.
 *
 * **`build_growth` calls neither `plot_metric` nor `plot_metric_dual`.** It
 * inlines its own trace, `_style_axes` call and `add_hline` (figures.py:660-680).
 * That matters more than it looks: every question the brief asks about what
 * `build_growth` *passes* to `plot_metric` has the same answer -- it passes
 * nothing, because it never calls it. In particular there is no `show_mean` to
 * set, so this chart draws no mean line for a different reason than the
 * fundamentals chart does.
 *
 * What the inline drawing does, line by line:
 *
 *   - `_window_frame(facts, years=years, as_of=None)` with `years: int = 15` --
 *     the same window as the fundamentals chart, not the valuation chart's five.
 *   - one trace, `mode="lines + markers"`, `_PRIMARY_COLOR`, `connectgaps=True`,
 *     named for the concept: the valuation chart's trace exactly.
 *   - `_style_axes(fig, r, col, label, percent=True)` -- **percent hardcoded**.
 *   - `fig.add_hline(y=0, ...)` -- **the reference line hardcoded**, inside the
 *     loop and after the `continue`, so a blank panel gets no line.
 *   - `_size(width, height, 500 * cols, 360 * rows)` -- 360, a third distinct
 *     row height.
 *
 * `percent` and `ref_line` are read off the registry here rather than pinned to
 * `true` and `0`, because the registry is this frontend's only source of truth
 * and inferring either from the chart id is exactly the mistake §3.2 of the
 * inventory warns about. The two agree today: all 39 growth metrics carry
 * `percent: true` and `ref_line: 0`, so every figure this produces is identical
 * to the reference. They are nonetheless two independent declarations of the
 * same fact -- see the report.
 *
 * **Two modes, one catalogue.** `options.mode` picks which column of
 * `facts_growth` the same 39 panels are drawn from: `yoy_growth` (a 4-quarter
 * lag) or `qoq_growth` (1). It is a column and not a second set of metrics
 * because `calculate_growth` already took `periods` -- the two series are one
 * computation at two lags, so doubling the catalogue would have doubled every
 * profile's visibility row to express one boolean about the whole chart. The
 * default is the registry's first mode, which is YoY, so an options object
 * without `mode` is the pre-QoQ figure byte for byte.
 */
import type { Frames, GrowthMode, Registry } from "../contracts.ts";
import { PRIMARY_COLOR, createGrid, drawPanel, type FigureSpec, type PanelSpec } from "./panel.ts";
import {
  outlierMask,
  outlierReference,
  outlierReport,
  type HiddenSeries,
  type OutlierBasis,
} from "./outliers.ts";
import { anyValue, seriesFor, selectMetricIds, valuesFrom, windowCutoff } from "./select.ts";

/** figures.py: `_size(width, height, 500 * cols, 360 * rows)`. */
export const GROWTH_ROW_HEIGHT = 360;
/** figures.py: `build_growth(..., years: int = 15, ...)`. */
export const GROWTH_YEARS = 15;

export interface GrowthOptions {
  requested?: readonly string[] | null;
  years?: number;
  anchor?: Date;
  /**
   * `GrowthMode.key`. Defaults to the registry's first mode, which is YoY --
   * `figures.build_growth`'s `growth_column: str = "yoy_growth"` default, so an
   * options object without this reproduces the pre-QoQ figure exactly.
   */
  mode?: string;
  /**
   * Outlier masking, the same `outlierMask` the valuation grid uses.
   *
   * **`build_growth` has no `mask_outliers` parameter**, and that is not an
   * oversight -- figures.py:190 declined to extend the rule here, with a
   * measurement. This chart is therefore the one place the port deliberately
   * goes past the reference, on the operator's instruction; the measured
   * consequence is in `frontend_growth_masking_report.md` §1.6 and it is not
   * flattering to the rule. Absent (the default) reproduces the reference
   * exactly, which is what keeps every existing A/B valid.
   */
  mask?: boolean;
}

export interface GrowthResult {
  figure: FigureSpec | null;
  panels: string[];
  offerable: string[];
  /** The mode actually drawn -- resolved here, so a caller can title on it. */
  mode?: GrowthMode;
  /**
   * What a masked view would omit, per panel, over the **windowed series of the
   * active mode**. Reported whether or not `mask` is on: app.py:939 computes it
   * first and the toggle's presence turns on it being non-empty.
   */
  outliers: HiddenSeries[];
}

/**
 * The registry's mode list, with the pre-QoQ single mode as the fallback.
 *
 * The fallback exists for the same reason `ChartSpec.modes` is optional: a
 * registry that predates the modes block still describes a chart that draws
 * `yoy_growth`, and this file should draw it rather than refuse. It is not
 * reachable from the app -- `REGISTRY_SCHEMA` refuses that bundle first -- and
 * it is reachable from the Node verification harnesses, which is the point.
 */
export const YOY_ONLY: GrowthMode = {
  key: "yoy",
  column: "yoy_growth",
  periods: 4,
  label: "Year over year",
  short: "YoY",
  description: "Each period against the observation closest to four quarters earlier.",
};

export function growthModes(registry: Registry): GrowthMode[] {
  const declared = registry.charts.growth.modes;
  return declared && declared.length > 0 ? declared : [YOY_ONLY];
}

/** The requested mode, or the first declared one. Never throws on an unknown key. */
export function resolveMode(registry: Registry, key?: string): GrowthMode {
  const modes = growthModes(registry);
  return modes.find((m) => m.key === key) ?? modes[0];
}

export function buildGrowth(
  registry: Registry,
  frames: Frames,
  ticker: string,
  options: GrowthOptions = {},
): GrowthResult {
  const { requested = null, years = GROWTH_YEARS, anchor, mask = false } = options;
  const byId = new Map(registry.metrics.map((m) => [m.id, m]));
  const mode = resolveMode(registry, options.mode);

  const offerable = selectMetricIds(registry, "growth", ticker, null);

  // `build_growth` returns None when the growth column is missing, before it
  // looks at the panels at all. Here the column cannot go missing on its own --
  // `reconstructFrame` throws if `facts_growth` arrives without `yoy_growth` --
  // so the whole frame being absent is what is left of that branch.
  const frame = frames.facts_growth;
  if (!frame) return { figure: null, panels: [], offerable, mode, outliers: [] };

  const panels = selectMetricIds(registry, "growth", ticker, requested);
  if (panels.length === 0) return { figure: null, panels: [], offerable, mode, outliers: [] };

  // `Growth (YoY) AAPL` / `Growth (QoQ) AAPL` -- figures.py:697, which now reads
  // the mode's `short` off the same table this does. The mode moved *into* the
  // title as it moved out of the axis labels: 38 of the 39 growth metrics used
  // to carry ", YoY)" in their label, which was true of the only column that
  // existed and false the moment the control is touched.
  const figure = createGrid(panels, GROWTH_ROW_HEIGHT, `Growth (${mode.short}) ${ticker}`);
  const cutoff = windowCutoff(years, anchor);
  /** `{concept: series}` over the windowed values of the active mode, for `outlierReport`. */
  const windowed: { key: string; x: Date[]; y: (number | null)[] }[] = [];

  panels.forEach((id, idx) => {
    const metric = byId.get(id);
    if (!metric) throw new Error(`registry lists ${id} in charts.growth but has no metric for it`);
    // `facts_growth` carries both growth columns and nothing else numeric --
    // `frame.value` is `yoy_growth`, `frame.numeric` also holds `qoq_growth`.
    // The growth ids are XBRL concept names and 33 of the 39 also name rows in
    // `facts_full`, where the same row carries an absolute-dollar `value`; the
    // narrow export does not carry that column at all, so the wrong one cannot
    // be read here in either mode.
    const series = seriesFor(frame, id, cutoff);
    // The mode is a column of the same rows, so it re-reads rather than
    // re-selects: `_window_frame` runs before the emptiness rule in the
    // reference and does not know about `growth_column` either.
    const y = valuesFrom(frame, series, mode.column);

    // `series_values = series.dropna(subset=[growth_column])` then
    // `if series_values.empty`. Same rule as the valuation chart, and note what
    // is drawn when it does not fire: `series`, not `series_values` -- the full
    // windowed series with its nulls in place.
    //
    // Evaluated on the *mode's* column, which is the reference's own reading:
    // `dropna(subset=[growth_column])`. A concept a filer publishes only
    // annually has a YoY value and no QoQ one, so the same panel is drawn in one
    // mode and reads "No Data" in the other. That is the absence of a preceding
    // quarter, and the panel saying so is correct.
    const empty = !anyValue(y);
    windowed.push({ key: id, x: series.x, y });

    // The valuation grid's five lines, unchanged (charts/valuation.ts:178).
    //
    // **Window first, then mask** -- `seriesFor` has already applied the cutoff,
    // so the ratio is against the median of what is on screen and the same `k`
    // keeps meaning the same thing as the slider moves.
    //
    // **On `y`, the active mode's column, never on `frame.value`.** That is the
    // whole of the per-mode decision: YoY and QoQ are different distributions
    // over the same rows, and a median borrowed from the other column would
    // judge these values against a scale they were never on. Because it reads
    // `y`, a mode switch cannot leave a stale mask behind -- there is no mask to
    // go stale, only a recomputation from whichever array is now drawn.
    //
    // Rows are **removed**, not nulled: `filtered.loc[~hidden]` drops them, so
    // `x` shrinks with `y`.
    const hidden = mask && !empty ? outlierMask(y) : null;
    const hiddenCount = hidden ? hidden.filter(Boolean).length : 0;
    // Which of `outlierReference`'s two branches the mask above took, asked
    // rather than re-derived, and only when there is an annotation to word.
    // This is the only chart that can reach the scale branch: a valuation
    // series cannot have a non-positive median, because every published
    // multiple divides by a denominator the pipeline already forced positive.
    let hiddenBasis: OutlierBasis | undefined;
    if (hiddenCount) {
      const usable = y.filter((v): v is number => v !== null && Number.isFinite(v));
      hiddenBasis = outlierReference(usable).basis;
    }
    const drawn = hiddenCount
      ? { x: series.x.filter((_, i) => !hidden![i]), y: y.filter((_, i) => !hidden![i]) }
      : { x: series.x, y };

    const spec: PanelSpec = {
      concept: id,
      ylabel: metric.label,
      percent: metric.percent,
      refLine: metric.ref_line,
      traces: [{
        name: id,
        x: drawn.x,
        y: drawn.y,
        mode: "lines+markers",
        color: PRIMARY_COLOR,
        connectgaps: true,
      }],
      hiddenCount,
      hiddenBasis,
      // Never a mean line: `build_growth` has no `plot_metric` call to pass
      // `show_mean` to. Only `build_valuation` sets it (figures.py:753).
      mean: null,
      empty,
    };
    drawPanel(figure, idx, spec);
  });

  return { figure, panels, offerable, mode, outliers: outlierReport(windowed) };
}
