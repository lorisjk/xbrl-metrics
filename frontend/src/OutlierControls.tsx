/**
 * The toggle, the caption and the expander that go with outlier masking — one
 * component for the valuation grid and the comparison chart.
 *
 * One component because app.py:1044 says why in the reference itself: *"Same
 * shape as the valuation tab, and the same rule underneath — so a reader moving
 * between the two tabs does not have to learn a second meaning of 'outlier'."*
 * Three strings differ between the two and are props; nothing else does.
 *
 * **The toggle is absent, not disabled, when nothing would be hidden**
 * (app.py:942 / app.py:1054, both gated on the report being non-empty). The
 * comment there is the rule: *"a toggle that appears on a clean chart teaches
 * the reader to ignore it."* The caller passes an empty report and gets nothing.
 *
 * **The expander is the auditability half and it is not optional**
 * (app.py:1000): *"a silent filter would be the wrong thing in a tool whose
 * argument is auditability, so every hidden number is one click away, with the
 * ratio that got it hidden."* It is present whether or not masking is on — you
 * can read what *would* go before deciding to hide it.
 */
import type { HiddenSeries } from "./charts/outliers.ts";
import {
  OUTLIER_MEDIAN_RATIO,
  OUTLIER_MIN_HIDDEN_GROWTH,
  OUTLIER_MIN_HIDDEN_MEDIAN,
  hiddenTotal,
} from "./charts/outliers.ts";
import { csvNumber } from "./data/csv.ts";
import { formatRatio } from "./data/format.ts";
import "./outliers.css";

/**
 * app.py:1009 `{median:,.2f}` — the heading only; the table never rounds.
 *
 * **Kept, and only for the metrics whose value is a bare number.** It was
 * written for a P/E, whose median reads `65.74`, and it is right for those:
 * `format.ts`'s non-percent branch is a *different* convention — four decimals
 * and no thousands separators — so reusing `formatRatio` for everything would
 * turn that heading into `65.7400` and a large one into `1234.5600`. Measured,
 * not assumed; see the report. A percent metric takes `formatRatio` instead.
 */
const groupedTwo = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `{d.m.Y}`, as every other date in this app renders. */
const day = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;

export default function OutlierControls({
  report,
  masked,
  onMasked,
  label,
  percent,
  help,
  maskedNote,
  medianLabel,
}: {
  /** `outlierReport`'s result. Empty renders nothing at all. */
  report: readonly HiddenSeries[];
  masked: boolean;
  onMasked: (next: boolean) => void;
  /** Turns a report key into what the reader calls it: a metric label, or a ticker. */
  label: (key: string) => string;
  /**
   * Is this series' quantity a percentage?
   *
   * A second lookup beside `label` rather than a new `percent` field on
   * `HiddenSeries`, because it is a **registry** fact about the metric and not
   * a fact about the masking: `outliers.ts` computes a mask and knows nothing
   * about display, which is the split this module has had since item 10. The
   * two callers already resolve the metric to produce `label`, so this costs
   * them one more property of the object they are already holding.
   *
   * It is keyed like `label` is -- by concept in the valuation and growth
   * grids, by ticker in the comparison chart, where the concept is fixed for
   * the whole chart and the caller answers the same for every line.
   */
  percent: (key: string) => boolean;
  /** The toggle's help text — the two tabs word the rule differently. */
  help: string;
  /**
   * The sentence after `**Hidden:** …`. The valuation grid promises the mean did
   * not move; the comparison chart has no mean to promise about and says what it
   * does have instead (app.py:1085).
   */
  maskedNote: string;
  /**
   * `"median"` in the grid, `"own median"` in the comparison chart.
   *
   * **Only for the series whose reference *is* their median.** A growth panel
   * whose median is not positive is judged against the floored size of its
   * typical move instead (`outlierReference`), and printing that number under
   * the word "median" would put a wrong figure in the audit trail -- the
   * precise thing the expander exists to prevent. Those series say `scale`,
   * which is neither of the two tabs' wording because neither tab can reach
   * them: 0 of 4,283 valuation series and 0 of 4,497 comparison series have a
   * non-positive median (see the report), so this prop is unchanged wherever
   * it was ever read.
   */
  medianLabel: string;
}) {
  if (report.length === 0) return null;

  const total = hiddenTotal(report);
  /** What this series' ratios are against, in the reader's words. */
  const basisLabel = (series: HiddenSeries) =>
    series.basis === "median" ? medianLabel : "scale";
  /**
   * The reference, printed the way the rest of the app prints that metric.
   *
   * A growth series' median is a *fraction* -- `0.08` is +8% -- and every other
   * surface in this app renders it through `formatRatio`, which is why the data
   * tab says `8.24%` for the same quantity this heading used to call `0.08`. It
   * is the one number on the panel a reader had to convert by hand.
   *
   * **The ratio column below is untouched and must be**: `Value / reference` is
   * dimensionless whatever the metric is, so a percent sign on it would be a
   * second, wrong claim. Only the heading names a quantity.
   */
  const referenceText = (series: HiddenSeries) =>
    percent(series.key) ? formatRatio(series.reference, true) : groupedTwo(series.reference);
  const summary = report
    .map((s) => `${label(s.key)} (${s.points.length} point${s.points.length > 1 ? "s" : ""})`)
    .join(", ");

  return (
    <div className="outliers">
      <label className="outliers__toggle" title={help}>
        <input type="checkbox" checked={masked} onChange={(e) => onMasked(e.target.checked)} />{" "}
        Hide extreme values
      </label>

      {/* app.py:991 states the invariance at the point of the change, not only in
          the toggle's help: "a reader watching points disappear will otherwise
          assume the average moved with them, which is the one thing that did not
          happen." */}
      <p className="caption">
        {masked ? (
          <>
            <strong>Hidden:</strong> {summary}. {maskedNote}
          </>
        ) : (
          <>Extreme values present in: {summary}.</>
        )}
      </p>

      <details className="outliers__list">
        <summary>
          Show the {total} extreme value{total > 1 ? "s" : ""}
        </summary>
        {report.map((series) => (
          <div key={series.key}>
            <p className="outliers__head">
              <strong>{label(series.key)}</strong> — {basisLabel(series)}{" "}
              {referenceText(series)}
            </p>
            <table className="outliers__table">
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Value</th>
                  <th scope="col">x {basisLabel(series)}</th>
                </tr>
              </thead>
              <tbody>
                {series.points.map((point) => (
                  <tr key={point.end.getTime()}>
                    <td>{day(point.end)}</td>
                    {/* Full precision, deliberately: this is the audit trail for a
                        filter, and item 10's display rounding would defeat it. Same
                        `repr` the CSV downloads use, so a value copied from here
                        matches one copied from there character for character. */}
                    <td>{csvNumber(point.value)}</td>
                    <td>{point.ratio.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </details>
    </div>
  );
}

/** app.py:945 and app.py:1057 — the two help texts, kept next to the component that shows them. */
export const VALUATION_MASK_HELP =
  `Hides points more than ${OUTLIER_MEDIAN_RATIO}x the panel's own median. Applies per panel, ` +
  "only where such points exist, and only to what is drawn — the values stay in the data tab " +
  "and the exports.";

export const COMPARISON_MASK_HELP =
  `Hides points more than ${OUTLIER_MEDIAN_RATIO}x that line's own median. Each ticker is ` +
  "judged against itself, so a company simply trading at a higher multiple than its peers " +
  "loses nothing.";

/** app.py:993 and app.py:1086 — the sentence that follows `Hidden: …`. */
export const VALUATION_MASKED_NOTE =
  "The mean lines are unchanged — they are still computed over the full series, including the " +
  "hidden points.";

export const COMPARISON_MASKED_NOTE =
  "Each line was judged against its own median, so the remaining points are unchanged and still " +
  "on their original scale.";

/**
 * The growth chart's pair. It needs its own because **the valuation note makes a
 * promise this chart cannot make and does not need to**: "the mean lines are
 * unchanged" is true and load-bearing where there are mean lines, and
 * `build_growth` draws none (charts/growth.ts, figures.py:660-690 -- it never
 * calls `plot_metric`, so it has no `show_mean` to pass). Reusing that sentence
 * here would assert the existence of a line the reader cannot see.
 *
 * What replaces it is the invariance that *does* apply: masking changes what is
 * drawn and nothing else. No value shown anywhere else moves -- there is no mean,
 * no caption quoting a number, and the comparison chart reads `facts_growth`
 * through its own builder, which does not mask growth concepts at all.
 *
 * The help text also states the one thing a reader has to know before trusting
 * the control on *this* chart, which §1.6 of the report measures: a growth
 * series centres near zero, so five times its median is a much smaller number
 * than five times a P/E's.
 */
export const GROWTH_MASK_HELP =
  `Hides points more than ${OUTLIER_MEDIAN_RATIO}x the panel's own median, and never anything ` +
  `below +${100 * OUTLIER_MIN_HIDDEN_MEDIAN}%. Growth rates centre near zero, so a median can be ` +
  "a fraction of a percent — five times that is still nothing, and the floor is what stops an " +
  "ordinary quarter being called extreme. Where the median is not positive — a series that falls " +
  `as often as it rises — the threshold is ${OUTLIER_MEDIAN_RATIO}x the size of a typical move ` +
  `and never less than +${100 * OUTLIER_MIN_HIDDEN_GROWTH}%. Either way the list below names ` +
  "every hidden value, and the heading says which number the ratios are against. Applies per " +
  "panel, per mode, and only to what is drawn: the values stay in the data tab and the exports.";

export const GROWTH_MASKED_NOTE =
  "Nothing else moved: this chart draws no mean line, and no figure shown elsewhere is computed " +
  "from these points. The hidden values are listed below and are still in the data tab and the " +
  "exports.";
