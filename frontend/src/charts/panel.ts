/**
 * The drawing layer: a subplot grid and the furniture that goes into one panel.
 *
 * This mirrors the split in figures.py, where `build_valuation` decides *which*
 * series to draw and `plot_metric` draws one panel into a figure it is handed.
 * Items 5 (fundamentals, dual TTM/quarterly traces) and 6 (growth, a fixed y=0
 * line) need the same furniture with different selection rules, so the two
 * halves are separate modules rather than one `buildValuation`.
 *
 * Everything here is plain data. Nothing imports React or plotly.js -- the
 * output is a `{data, layout}` figure spec, which is what `<Plot>` takes and
 * what the Python builder serialises, so the two are directly comparable.
 *
 * One rule binds everything below. **An axis that no trace references may only
 * be referenced by a bare id (`"x5"`), never by `"x5 domain"`.** plotly.js
 * registers component-referenced axes through `cleanId(ref, letter, false)`,
 * which rejects domain refs outright, so a domain-only axis is never created and
 * every reference to it silently falls back to the first axis. Panels that carry
 * a trace may use either form. See annotateNoData for the full derivation; the
 * verification enforces it structurally for every axis of every figure.
 */
import { axisNumber, axisSuffix, cellDomain, cellFor, makeGrid } from "./grid.ts";
import type { MeanLine } from "./mean.ts";
import { OUTLIER_MEDIAN_RATIO, type OutlierBasis } from "./outliers.ts";

/** figures.py:19-24 -- pinned, not left to plotly's cycle. */
export const PRIMARY_COLOR = "#1f77b4";
/** The quarterly line on a dual fundamentals panel. */
export const SECONDARY_COLOR = "#ff7f0e";
export const PERCENT_TICKFORMAT = ".1~%";
const REFERENCE_COLOR = "red";

export interface Marker {
  color: string;
  /** Scatter markers carry all three; a bar's `marker_color` carries none. */
  size?: number;
  symbol?: string;
  /** The outline. figures.py:475 gives the snapshot marker a white one. */
  line?: { color: string; width: number };
}

export interface Trace {
  /** `go.Scatter` everywhere except item 16's raw-facts panels, which are `go.Bar`. */
  type: "scatter" | "bar";
  /** Absent on a bar: `go.Bar` has no `mode`. */
  mode?: string;
  name: string;
  x: (Date | string)[];
  y: (number | null)[];
  line?: { color: string; width?: number };
  /** Present instead of `line` on a marker-only trace. */
  marker?: Marker;
  opacity?: number;
  connectgaps?: boolean;
  hovertemplate?: string;
  hoverlabel?: {
    bgcolor?: string;
    bordercolor?: string;
    font?: { color?: string };
  };
  xaxis: string;
  yaxis: string;
  legendgroup?: string;
  showlegend?: boolean;
}

export interface Annotation {
  text: string;
  x: number;
  y: number;
  xref: string;
  yref: string;
  xanchor: string;
  yanchor: string;
  showarrow: false;
  font: { color?: string; size: number };
}

export interface Shape {
  type: "line";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  xref: string;
  yref: string;
  line: { color: string; width: number };
}

export interface Axis {
  anchor: string;
  domain: [number, number];
  dtick?: string;
  tickformat?: string | null;

  title?: {
    text: string;
    font: {
      size: number;
      color?: string;
    };
  };

  showticklabels?: boolean;
  showgrid?: boolean;
  zeroline?: boolean;

  color?: string;
  gridcolor?: string;
  zerolinecolor?: string;
}

export interface FigureSpec {
  data: Trace[];

  layout: {
    title: {
      text: string;
      font?: {
        color?: string;
        size?: number;
        family?: string;
      };
    };

    height: number;

    /**
     * Omitted entirely when the builder does not set one. `build_valuation`,
     * `build_fundamentals`, `build_growth` and `build_ticker_comparison` all pass
     * `hovermode="x unified"`; `build_raw_facts` (figures.py:1144) passes nothing
     * at all, so plotly's own default applies there and this key must be absent
     * rather than set to that default's name.
     */
    hovermode?: string;

    font?: {
      color?: string;
      size?: number;
      family?: string;
    };

    legend: {
      font: {
        size: number;
        color?: string;
        family?: string;
      };
    };

    annotations: Annotation[];

    shapes: Shape[];

    paper_bgcolor?: string;
    plot_bgcolor?: string;

    template?: unknown;

    [axis: string]: unknown;
  };

  rows: number;
  cols: number;
}

/**
 * An empty grid with make_subplots' axes, domains and subplot titles.
 *
 * Titles are the **concept ids**, not the labels -- `_make_subplot_figure` is
 * handed `[c[0] for c in concepts_to_plot]` and the label goes on the y axis
 * instead. Reproduced rather than improved: the brief's table calls the panel
 * title "the metric's label", and the reference implementation disagrees with
 * it. See the report.
 */
export function createGrid(
  titles: string[],
  perRowHeight: number,
  title: string,
  /** `null` omits the key -- see `FigureSpec["layout"]["hovermode"]`. */
  hovermode: string | null = "x unified",
): FigureSpec {
  const n = titles.length;
  const { rows, cols } = makeGrid(n);

  const layout: FigureSpec["layout"] = {
    title: {
      text: title,
      font: {
        color: "#f3f4f6",
      },
    },

    height: perRowHeight * rows,

    ...(hovermode === null ? {} : { hovermode }),

    // App background
    paper_bgcolor: "#rgb(14, 17, 23)",
    plot_bgcolor: "#rgb(14, 17, 23)",

    // Default text color
    font: {
      color: "#9ca3af",
      family: "system-ui, 'Segoe UI', Roboto, sans-serif",
    },

    legend: {
      font: {
        size: 9,
        color: "#9ca3af",
      },
    },

    annotations: [],
    shapes: [],
  };

  for (let idx = 0; idx < n; idx += 1) {
    const { row, col } = cellFor(idx, cols);
    const k = axisNumber(row, col, cols);
    const suffix = axisSuffix(k);
    const domain = cellDomain(row, col, rows, cols);

    layout[`xaxis${suffix}`] = {
      anchor: `y${suffix}`,
      domain: domain.x,

      // Axis text / tick labels
      color: "#9ca3af",

      // Grid + zero line
      gridcolor: "#2e303a",
      zerolinecolor: "#2e303a",
    } satisfies Axis;

    layout[`yaxis${suffix}`] = {
      anchor: `x${suffix}`,
      domain: domain.y,

      // Axis text / tick labels
      color: "#9ca3af",

      // Grid + zero line
      gridcolor: "#2e303a",
      zerolinecolor: "#2e303a",
    } satisfies Axis;

    layout.annotations.push({
      text: titles[idx],
      x: (domain.x[0] + domain.x[1]) / 2,
      y: domain.y[1],
      xref: "paper",
      yref: "paper",
      xanchor: "center",
      yanchor: "bottom",
      showarrow: false,

      // Panel title
      font: {
        size: 16,
        color: "#f3f4f6",
      },
    });
  }

  return { data: [], layout, rows, cols };
}

/** Which axes a cell's traces and panel-relative annotations refer to. */
export function panelRefs(idx: number, cols: number) {
  const { row, col } = cellFor(idx, cols);
  const suffix = axisSuffix(axisNumber(row, col, cols));
  return {
    xaxis: `x${suffix}`,
    yaxis: `y${suffix}`,
    xKey: `xaxis${suffix}`,
    yKey: `yaxis${suffix}`,
  };
}

/**
 * One line in a panel. A panel holds a list of these rather than one x/y pair.
 *
 * The valuation chart draws one; the fundamentals chart draws a TTM line and,
 * where a quarterly counterpart exists and has values, a second thinner one
 * behind it. Item 12's comparison chart is the same shape again -- one entry per
 * ticker, each with its own colour and name -- and item 13's snapshot marker is
 * one more entry with `mode: "markers"`. A sibling `drawDualPanel` would have
 * served this chart and none of those.
 *
 * Every style field is explicit because figures.py:19-36 pins them: an automatic
 * colour cycle would give each subplot a different colour and imply a
 * distinction that is not there.
 */
export interface PanelTrace {
  /** Legend and hover name. `pe_ratio`, `operating_margin · TTM`, ... */
  name: string;
  x: (Date | string)[];
  /** Nulls kept in place. `connectgaps` decides how they render, not a filter. */
  y: (number | null)[];
  mode: string;
  color: string;
  /** Omitted from the emitted trace when undefined, as the reference omits it. */
  width?: number;
  opacity?: number;
  connectgaps?: boolean;
  /**
   * A marker-only trace: item 13's snapshot point. Supplying this swaps `line`
   * for `marker` in the emitted trace and swaps the default per-point hover for
   * `hovertemplate` — figures.py's snapshot Scatter has no `line` kwarg and its
   * own hover text, so the two are one choice rather than three flags.
   *
   * This is what item 5's generalisation of `PanelSpec` to a trace list was for:
   * the marker is *one more entry*, drawn by the same loop, and it lands after
   * the filed series in `fig.data` exactly as it does in `plot_metric`.
   */
  marker?: Marker;
  hovertemplate?: string;
  legendgroup?: string;
  /** figures.py:474 — false on every panel but the first that draws a marker. */
  showlegend?: boolean;
}

export interface PanelSpec {
  /** Subplot title: the metric id. */
  concept: string;
  /** y-axis title: the metric's registry label. */
  ylabel: string;
  percent: boolean;
  refLine: number | null;
  /** Drawn in order. Empty is legal only when `empty` is true. */
  traces: PanelTrace[];
  /**
   * Computed over the selected series, never over any trace's `y`. Null = no
   * line -- which is also what the fundamentals chart always passes, because
   * `build_fundamentals` never sets `show_mean`.
   */
  mean: MeanLine | null;
  /** True when the panel's own empty rule fired: the "No Data" panel. */
  empty: boolean;
  /**
   * How many points masking removed from this panel's filed trace, for the note
   * figures.py:400 draws bottom-right. 0 draws nothing, which is also what an
   * unmasked panel passes.
   *
   * A count rather than the points themselves: the note says how many, and the
   * expander — which needs the values — is built from `outlierReport`, not from
   * the figure. The drawing layer stays a drawing layer.
   */
  hiddenCount?: number;
  /**
   * What those points were judged against, for the annotation's own wording.
   *
   * Absent means `"median"`, which is what every valuation panel passes and
   * what the growth grid passes for two thirds of its own -- so the annotation
   * this figure carries is byte for byte the reference's wherever the
   * reference has one. A growth panel whose median is not positive is judged
   * against the floored size of its typical move instead, and says so: a note
   * that reads `(>5x median)` beside a mask computed from something else is a
   * figure describing itself wrongly, and figures.py:398's whole reason for
   * existing is that the exported file has to be self-describing.
   */
  hiddenBasis?: OutlierBasis;
}

/**
 * figures.py `_annotate_no_data`: the text, and the panel's furniture removed.
 *
 * The references are **bare axis ids** (`"x5"`, `"y5"`), not `"x5 domain"`, and
 * that is load-bearing rather than cosmetic. plotly.js only creates a subplot
 * for an axis it can see, and it can see one in exactly two ways: a trace names
 * it, or a component (annotation, shape, image) names it. The component path
 * runs through `include_components.js`, which calls
 * `axisIds.cleanId(ref, letter, false)` -- and `cleanId` *rejects* a `" domain"`
 * ref when its `domainId` argument is false rather than stripping the suffix
 * (axis_ids.js:35), despite the comment above the call saying otherwise.
 *
 * A "No Data" panel has no trace by definition. So a domain-referenced
 * placeholder makes its axis invisible to plotly.js, and then three things
 * happen at once: the panel is never drawn, `coerceRef` falls back to
 * `_subplots.xaxis[0]` and drops the annotation onto the *first* panel, and
 * because that fallback is a data reference, x = 0.5 is read as 0.5 ms after the
 * epoch and drags the first panel's date axis back to 1970.
 *
 * `plot_metric` reaches the same place from the other direction: it passes
 * `row=`/`col=` to `add_annotation`, and plotly.py resolves that to a bare
 * `"x5"`. x and y are therefore data coordinates on both sides -- 0.5 on an axis
 * with no data, which auto-ranges around it.
 */
function annotateNoData(fig: FigureSpec, idx: number): void {
  const refs = panelRefs(idx, fig.cols);
  fig.layout.annotations.push({
    text: "No Data",
    x: 0.5,
    y: 0.5,
    xref: refs.xaxis,
    yref: refs.yaxis,
    xanchor: "center",
    yanchor: "middle",
    showarrow: false,
    font: { color: "red", size: 14 },
  });
  const blank = { showticklabels: false, showgrid: false, zeroline: false };
  Object.assign(fig.layout[refs.xKey] as Axis, blank);
  Object.assign(fig.layout[refs.yKey] as Axis, blank);
}

/** figures.py `_style_axes`: two-year x ticks, y title, percent tickformat. */
function styleAxes(
  fig: FigureSpec,
  idx: number,
  ylabel: string,
  percent: boolean
): void {
  const refs = panelRefs(idx, fig.cols);

  Object.assign(fig.layout[refs.xKey] as Axis, {
    dtick: "M24",
    tickformat: "%Y",
    color: "#9ca3af",
  });

  Object.assign(fig.layout[refs.yKey] as Axis, {
    title: {
      text: ylabel,
      font: {
        size: 11,
        color: "#9ca3af",
      },
    },
    tickformat: percent ? PERCENT_TICKFORMAT : null,
    color: "#9ca3af",
  });
}

/** A horizontal line spanning the panel: red, width 1 -- mean and ref alike. */
function hline(fig: FigureSpec, idx: number, y: number): void {
  const refs = panelRefs(idx, fig.cols);
  fig.layout.shapes.push({
    type: "line",
    x0: 0,
    x1: 1,
    y0: y,
    y1: y,
    xref: `${refs.xaxis} domain`,
    yref: refs.yaxis,
    line: { color: REFERENCE_COLOR, width: 1 },
  });
}

/**
 * One panel, drawn into `fig` at position `idx` -- `plot_metric` and
 * `plot_metric_dual` in one function, because they differ only in how many
 * traces they push.
 *
 * Order matches both references: every trace, then the axes, then the mean line
 * and its label, then the reference line. It matters, because the comparison
 * against the Python figure reads annotations and shapes in order.
 */
export function drawPanel(fig: FigureSpec, idx: number, panel: PanelSpec): void {
  if (panel.empty) {
    annotateNoData(fig, idx);
    return;
  }
  const refs = panelRefs(idx, fig.cols);
  for (const series of panel.traces) {
    // Conditional spreads rather than assignment after the fact: an absent
    // `opacity` or `connectgaps` must be absent from the emitted trace, exactly
    // as the reference omits it, and the key order has to stay fixed so a
    // single-trace panel still serialises byte-for-byte as it did before this
    // list existed.
    fig.data.push({
      type: "scatter",
      mode: series.mode,
      name: series.name,
      x: series.x,
      y: series.y,
      // A marker-only trace carries `marker` where a line trace carries `line`,
      // and neither carries the other -- figures.py's snapshot Scatter passes no
      // `line` kwarg, and an emitted `line: {color}` on a `mode: "markers"`
      // trace would be a field the reference does not have.
      ...(series.marker === undefined
        ? {
            line: series.width === undefined
              ? { color: series.color }
              : { color: series.color, width: series.width },
          }
        : { marker: series.marker }),
      ...(series.opacity === undefined ? {} : { opacity: series.opacity }),
      ...(series.connectgaps === undefined ? {} : { connectgaps: series.connectgaps }),
      ...(series.legendgroup === undefined ? {} : { legendgroup: series.legendgroup }),
      ...(series.showlegend === undefined ? {} : { showlegend: series.showlegend }),
      hovertemplate:
        series.hovertemplate ?? "Date: %{x|%d.%m.%Y}<br>Value: %{y}<extra></extra>",
      xaxis: refs.xaxis,
      yaxis: refs.yaxis,
    });
  }
  styleAxes(fig, idx, panel.ylabel, panel.percent);

  // figures.py:398 -- between the axes and the mean line, and bottom-right
  // because "the mean label occupies the top-left of the same panel". Its own
  // comment says why it exists at all: the figure is self-describing when
  // exported as a file, where the note beside the toggle would carry this
  // instead. `&gt;` and `&middot;` are the reference's HTML entities, which
  // plotly renders; kept verbatim rather than "improved" to `>` and `·`, so the
  // two annotations compare byte for byte.
  if (panel.hiddenCount) {
    fig.layout.annotations.push({
      text:
        `${panel.hiddenCount} outlier${panel.hiddenCount > 1 ? "s" : ""} hidden ` +
        `(&gt;${OUTLIER_MEDIAN_RATIO}x ${panel.hiddenBasis === "scale" ? "scale" : "median"})` +
        " &middot; Ø unchanged",
      x: 0.98,
      y: 0.02,
      xref: `${refs.xaxis} domain`,
      yref: `${refs.yaxis} domain`,
      xanchor: "right",
      yanchor: "bottom",
      showarrow: false,
      font: { color: "#888888", size: 9 },
    });
  }

  if (panel.mean) {
    hline(fig, idx, panel.mean.value);
    fig.layout.annotations.push({
      text: panel.mean.label,
      x: 0.02,
      y: 0.98,
      xref: `${refs.xaxis} domain`,
      yref: `${refs.yaxis} domain`,
      xanchor: "left",
      yanchor: "top",
      showarrow: false,
      font: { color: "red", size: 10 },
    });
  }

  if (panel.refLine !== null) hline(fig, idx, panel.refLine);
}

/* ---------------------------------------------------------------- raw facts */

/**
 * One raw-facts panel -- `build_raw_facts`'s inner loop (figures.py:1120).
 *
 * A third entry point rather than a `PanelSpec` flag, because this chart uses
 * *less* of the drawing layer than any other and the differences are all
 * absences:
 *
 *   - **`go.Bar`, not `go.Scatter`** (figures.py:1133). A filed fact is a
 *     quantity for a period, not a point on a line, and the reference draws it
 *     that way. So no `mode`, no `line`, no `connectgaps`.
 *   - **no `_style_axes` call.** `build_raw_facts` is the only builder in
 *     figures.py that never calls it, so these panels get no y-axis title, no
 *     two-year `dtick`, no `%Y` tick format and no percent format. Reproduced by
 *     omission -- calling `styleAxes` here would have been the easy mistake, and
 *     an invisible one.
 *   - **no mean line and no reference line.** There is no registry entry behind
 *     a raw XBRL tag to carry a `ref_line`, and a mean of `Assets` across
 *     periods is not a benchmark anything is judged against.
 *
 * What it does share is the grid, the axis references and the "No Data"
 * placeholder -- including that placeholder's bare-axis-id rule, which is what
 * makes an empty panel here render at all.
 */
export function drawBarPanel(
  fig: FigureSpec,
  idx: number,
  panel: { concept: string; x: (Date | string)[]; y: (number | null)[]; empty: boolean },
): void {
  if (panel.empty) {
    annotateNoData(fig, idx);
    return;
  }
  const refs = panelRefs(idx, fig.cols);
  fig.data.push({
    type: "bar",
    name: panel.concept,
    x: panel.x,
    y: panel.y,
    marker: { color: PRIMARY_COLOR },
    hovertemplate: "Date: %{x|%d.%m.%Y}<br>Value: %{y}<extra></extra>",
    hoverlabel: {
      bgcolor: "#16171d",
      bordercolor: "#2e303a",
      font: { color: "#f3f4f6" },
    },
    xaxis: refs.xaxis,
    yaxis: refs.yaxis,
  });
}

/* ------------------------------------------------------------- comparison */

/**
 * figures.py `_COMPARISON_COLORS` (figures.py:31).
 *
 * Indexed by a ticker's position in the **requested** list, never in the
 * plotted one -- the comment above it says why: *"colors assigned by position in
 * the requested list so a ticker keeps its color even when another one drops out
 * of the chart."* Indexing wraps rather than erroring, which is what
 * `SUGGESTED_MAX_COMPARISON_TICKERS` exists to keep rare.
 */
export const COMPARISON_COLORS = [
  "#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e",
  "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#7f7f7f",
];

export interface ComparisonTrace {
  /** The ticker: legend entry and hover name alike. */
  name: string;
  x: Date[];
  y: (number | null)[];
  color: string;
}

export interface ComparisonPanelSpec {
  /** y-axis title: the metric's registry label. */
  ylabel: string;
  percent: boolean;
  refLine: number | null;
  /** One per plotted ticker, in requested order. */
  traces: ComparisonTrace[];
  /** `"Not shown: X (reason), ..."`, or null when nothing was dropped. */
  excludedNote: string | null;
  /**
   * `[ticker, count]` per line that lost points to masking, in plotted order.
   * Empty draws nothing. Separate from `excludedNote` because the two say
   * different things and sit at opposite ends of the figure — a ticker that is
   * *not shown* against one whose line is merely *shorter*.
   */
  hiddenByTicker?: readonly (readonly [string, number])[];
}

/**
 * One panel, N ticker lines -- `build_ticker_comparison`'s drawing half.
 *
 * A separate entry point rather than a `PanelSpec` variant, and the reasons are
 * differences in the reference rather than taste:
 *
 *   - **the hover.** `drawPanel` emits `plot_metric`'s per-point template
 *     (`Date: ... Value: ...`); this chart emits `"%{fullData.name}: %{y}"`
 *     under `hovermode: "x unified"`, so one hover box lists every ticker at
 *     that date. That is the whole point of the view.
 *   - **no mean line, ever.** `build_ticker_comparison` (figures.py:930): *"No
 *     per-ticker mean lines (n of them would bury the data); the metric-level
 *     reference line stays because it does not depend on the ticker."* So there
 *     is no `mean` field to pass and none to forget.
 *   - **an exclusion note**, which no per-ticker panel has.
 *
 * It reuses `panelRefs`, `styleAxes` and `hline` from above, so the axis
 * furniture and the reference line cannot drift from the other three charts.
 */
export function drawComparisonPanel(fig: FigureSpec, spec: ComparisonPanelSpec): void {
  const refs = panelRefs(0, fig.cols);

  for (const trace of spec.traces) {
    fig.data.push({
      type: "scatter",
      mode: "lines+markers",
      name: trace.name,
      x: trace.x,
      y: trace.y,
      line: { color: trace.color },
      connectgaps: true,
      hovertemplate: "%{fullData.name}: %{y}<extra></extra>",
      xaxis: refs.xaxis,
      yaxis: refs.yaxis,
    });
  }

  styleAxes(fig, 0, spec.ylabel, spec.percent);
  // figures.py:997 -- set after `_style_axes`, which does not touch it.
  Object.assign(fig.layout[refs.xKey] as Axis, { hoverformat: "%d.%m.%Y" });

  if (spec.refLine !== null) hline(fig, 0, spec.refLine);

  if (spec.excludedNote !== null) {
    // figures.py:1010 -- paper coordinates, below the plot, red and small.
    fig.layout.annotations.push({
      text: spec.excludedNote,
      x: 0,
      y: -0.16,
      xref: "paper",
      yref: "paper",
      xanchor: "left",
      yanchor: "top",
      showarrow: false,
      font: { color: "red", size: 10 },
    });
  }

  // figures.py:1024 -- above the plot and right-aligned, where the valuation
  // grid's note is inside the panel and bottom-right. The positions differ
  // because the constraints do: there is no mean label competing for the corner
  // here, and one note for the whole figure belongs outside it.
  //
  // **After** the exclusion note, not before. figures.py adds the exclusion
  // annotation at :1010 and this one at :1024, and that order is observable --
  // the harness reads `layout.annotations` positionally, and having these two
  // the wrong way round is exactly what it caught.
  const hidden = spec.hiddenByTicker ?? [];
  if (hidden.length > 0) {
    fig.layout.annotations.push({
      text:
        `Outliers hidden (&gt;${OUTLIER_MEDIAN_RATIO}x each line's own median): ` +
        hidden.map(([ticker, count]) => `${ticker} (${count})`).join(", "),
      x: 1,
      y: 1.04,
      xref: "paper",
      yref: "paper",
      xanchor: "right",
      yanchor: "bottom",
      showarrow: false,
      font: { color: "#888888", size: 10 },
    });
  }

}
