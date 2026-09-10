/**
 * `figures.py`'s `outlier_points` (figures.py:201) and the two reports built on
 * it — the masking rule, as pure functions.
 *
 * A rendering concern and nothing else, which the reference states first
 * (figures.py:163): *"The values stay in the data, in the exports and in the data
 * tab; what this controls is whether one panel draws them."* So nothing here
 * touches a frame, a mean, or an export — it answers one question, "which points
 * would a masked panel omit", and two callers ask it: the builder, to decide what
 * to draw, and the view, to name what it is about to hide. **One rule, two
 * callers**, for the reason figures.py:235 gives: *"a silent filter would be the
 * wrong thing in a tool whose argument is auditability, and a filter that
 * disagrees with its own description would be worse."*
 *
 * The constants are the whole calibration and each is measured, not chosen
 * round. Three of them are the reference's and their derivations are in
 * figures.py:171-199, not repeated here but cited, because two copies of a
 * calibration is one too many. The fourth, `OUTLIER_MIN_HIDDEN_GROWTH`, has no
 * counterpart there: the reference declined to extend masking to growth at all
 * (figures.py:190), so the branch it calibrates is this port's, and its
 * derivation is here because there is nowhere else it could be.
 */

/**
 * figures.py:179. A point is an outlier above 5× its series' own median.
 *
 * Global, not per chart type: one `k` is used by the valuation grid and by the
 * comparison chart alike, and there is no second value anywhere in the
 * reference. Calibrated against fifteen real series — k=4 additionally hides
 * DAL's 47.2, which does not need hiding; k=6 keeps CRM's 337.8, which does.
 */
export const OUTLIER_MEDIAN_RATIO = 5;

/** figures.py:187. Below this many usable points the rule does not apply at all. */
export const OUTLIER_MIN_POINTS = 8;

/**
 * pandas' `Series.median()`: the average of the two middle values at even
 * length, not the lower of them. Spelled out because that difference is exactly
 * one ULP of divergence away from a mask that disagrees with the reference on a
 * point sitting near 5×.
 *
 * The input must already be free of nulls and non-finite values — `outlierMask`
 * filters before calling, as `np.isfinite` does on the other side.
 */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The smallest value the **scale** branch below can ever hide, as a growth rate.
 *
 * +200%, and it is derived rather than picked. It is the threshold the growth
 * masking cycle already used to call a growth point extreme
 * (`frontend_growth_masking_report.md` §1.6's buckets), and, measured over the
 * 5,877 series this fix reaches, it is **the largest such floor that costs
 * nothing in coverage**: the share of series holding a +200%..+1,000% point that
 * the rule catches is flat at 97.5% for every floor up to +190%, is 96.6% here,
 * and falls away above -- 91.0% at +225%, 84.9% at +250%.
 *
 * What it buys is the failure mode the growth cycle documented and the help text
 * has been warning readers about since: on a signed series centred near zero, a
 * ratio-to-median rule hides ordinary quarters. On the positive-median branch
 * 33.7% of what it hides is a growth rate of +25% or less, and it has hidden
 * +5.00% moves. On this branch **nothing below +200% can be hidden at all**, and
 * every one of the 10,477 points it hides is above it.
 *
 * It is a **growth rate**, and that is not a hidden assumption: the branch that
 * uses it is reachable only by growth series. Measured over the whole export,
 * 0 of 4,283 valuation-grid series and 0 of 4,497 comparison series have a
 * non-positive median, and that is structural rather than lucky -- every
 * published multiple divides by a denominator the pipeline has already guarded
 * to be positive (main.py:1047-1054), and `pe_to_revenue_growth`, the one that
 * could go negative arithmetically, is guarded at main.py:1087. A chart type
 * added later whose values are signed and *not* a growth rate has to revisit
 * this number, which is why it is spelled as what it is.
 */
export const OUTLIER_MIN_HIDDEN_GROWTH = 2;

/**
 * The reference a series is judged against, and which of the two it is.
 *
 * `"median"` is the shipped rule, untouched. `"scale"` is the branch this cycle
 * added, and the two are named apart because the expander prints the number:
 * calling a floored median-of-absolute-values "the median" in the audit trail
 * would be the same kind of quiet inaccuracy the guard clause was.
 */
export type OutlierBasis = "median" | "scale";

export interface OutlierReference {
  centre: number;
  basis: OutlierBasis;
}

/**
 * What `k` multiplies -- **one function, so the mask and the expander cannot
 * disagree about it.**
 *
 * They did before this cycle: `outlierMask` computed `median(usable)` and
 * `outlierReport` computed it again, which was harmless only because both were
 * the same expression. Now that there are two branches it would not be, and a
 * report whose ratios are against a different number than the mask used is
 * exactly the "filter that disagrees with its own description" this module's
 * docstring quotes figures.py refusing to ship.
 *
 * **The positive-median case is untouched, and this is an `else`, not a
 * rewrite.** When `median(usable) > 0` the returned `centre` is that median and
 * nothing else has run -- so every mask, every ratio and every annotation the
 * valuation grid, the comparison chart and two thirds of the growth grid produce
 * is bit-for-bit what it was.
 *
 * The other branch replaces a guard that silently disabled masking:
 *
 *     const centre = median(usable);
 *     if (!(centre > 0)) return mask;      // <- the bug
 *
 * A non-positive median means "this series spends as much time falling as
 * rising", which is the *normal* shape of a growth series and says nothing at
 * all about whether it holds a 9,442% spike. 25.5% of the growth series a reader
 * can reach were inert because of it, 1,508 of them holding a point above
 * +1,000%.
 *
 * The replacement is the size of a typical move, floored:
 *
 *     max(median(|v|), OUTLIER_MIN_HIDDEN_GROWTH / k)
 *
 * `median(|v|)` rather than `|median(v)|` or `median(v > 0)`, all three measured
 * against the same 5,877 series: `|median|` hides 21.1% of drawn points with
 * only 19.4% of them above +200%, `median(v > 0)` reads a majority-negative
 * series off as few as two points, and `median(|v|)` hides 7.1% with 54.4% above
 * +200% while catching 1,463 of the 1,508 blow-ups.
 *
 * **The floor is what makes it total, not a nicety.** The 45 blow-ups
 * `median(|v|)` alone misses are all series where it is *exactly zero* -- a
 * `Goodwill` that is unchanged in 56 of 57 quarters, a flat `DividendsPerShare`
 * -- so the same division-by-a-non-positive-reference reappears one level down,
 * and without the floor `v / 0 = Infinity > k` would hide every non-zero point,
 * including PGR's +0.4%. With it, PGR/Goodwill/yoy hides its four >+27,000%
 * points and nothing else.
 *
 * `k` is passed in so the floor tracks it: the meaningful constant is the
 * smallest hideable growth rate, and the floor is that divided by whatever
 * multiplier is in force. **k = 5 transfers** -- it was re-swept against this
 * reference rather than assumed: k=4 additionally fires on 186 series holding
 * nothing above +200%, k=6 drops blow-up-band coverage from 96.6% to 86.1%.
 */
export function outlierReference(
  usable: readonly number[],
  k: number = OUTLIER_MEDIAN_RATIO,
  minHidden: number = OUTLIER_MIN_HIDDEN_GROWTH,
): OutlierReference {
  const centre = median(usable);
  if (centre > 0) return { centre, basis: "median" };
  return { centre: Math.max(median(usable.map(Math.abs)), minHidden / k), basis: "scale" };
}

/**
 * figures.py `outlier_points`: a boolean per input position, true where the
 * value is a **high** outlier.
 *
 * One-directional, and measured rather than assumed (figures.py:190): *"across
 * the fifteen calibration series not one point sits below 0.2x its median, and
 * the lowest ratio anywhere in the set is 0.29x. A two-sided rule would be
 * machinery for a case that does not occur."* Unchanged here, and it stays
 * meaningful on the scale branch for the same reason it did before: `centre` is
 * positive either way, so `v / centre > k` still selects large **positive**
 * values only. A -98.4% quarter is not an outlier; it is a bad quarter.
 *
 * **All-false -- never all-true** on the median branch, which the reference's own
 * docstring states and which is a property of the rule rather than a guard in
 * it: at least half of any series lies at or below its median. On the scale
 * branch that argument does not carry, so it was measured instead: **0 of 5,877
 * series are fully masked**, and the reason is the floor -- a series every one
 * of whose points exceeds +200% and 5x its own typical move does not exist here.
 *
 * `values` carries the frame's nulls in place; a null stands for NaN or ±∞ in
 * the parquet, which is precisely what `np.isfinite` drops, so filtering on
 * `!== null` reproduces `usable` exactly.
 */
export function outlierMask(
  values: readonly (number | null)[],
  k: number = OUTLIER_MEDIAN_RATIO,
  minPoints: number = OUTLIER_MIN_POINTS,
): boolean[] {
  const mask = values.map(() => false);
  const usable: number[] = [];
  for (const v of values) if (v !== null && Number.isFinite(v)) usable.push(v);
  if (usable.length < minPoints) return mask;
  const { centre } = outlierReference(usable, k);
  // `if not (median > 0)` -- a NaN reference fails this too, which is the point
  // of writing it in the negative on both sides.
  //
  // **Unreachable for any caller that does not override the constants**, and
  // kept anyway: `outlierReference` floors at `minHidden / k`, so `centre` is
  // positive for every finite series. It is reachable through those parameters
  // -- a harness sweeping `k` to `Infinity`, a future `minHidden` of 0 -- and
  // failing closed is what it did before. It is no longer the rule; it is the
  // rule's last resort.
  if (!(centre > 0)) return mask;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v !== null && Number.isFinite(v) && v / centre > k) mask[i] = true;
  }
  return mask;
}

/** One hidden point, as the expander lists it. */
export interface HiddenPoint {
  end: Date;
  /** The value at full precision. The expander must never show a rounded one. */
  value: number;
  /** `Value / reference`, rounded to 1dp — app.py:1011 `.round(1)`. */
  ratio: number;
}

export interface HiddenSeries {
  /** The concept (valuation grid) or the ticker (comparison chart). */
  key: string;
  /**
   * What the ratios are against -- the series' own median, or, where that is not
   * positive, the floored size of its typical move. `basis` says which, and the
   * expander words its heading and its ratio column from it rather than calling
   * both "median".
   */
  reference: number;
  basis: OutlierBasis;
  /** In date order, as `sort_values("end")` leaves them. */
  points: HiddenPoint[];
}

/** app.py:1011 -- the ratio column is rounded to one decimal; the value is not. */
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * `outlier_report` / `comparison_outlier_report`: what a masked view would omit,
 * for the caption, the toggle's presence and the expander.
 *
 * One function for both because the two differ only in what they key by — the
 * valuation grid asks per concept, the comparison chart per ticker
 * (app.py:1047: *"the report is keyed by ticker here rather than by concept,
 * because this chart holds one concept and several lines"*). Series with nothing
 * hidden are left out, so an empty result is exactly the reference's falsy
 * `outliers` and is what hides the toggle.
 */
export function outlierReport(
  series: readonly { key: string; x: readonly Date[]; y: readonly (number | null)[] }[],
): HiddenSeries[] {
  const out: HiddenSeries[] = [];
  for (const { key, x, y } of series) {
    const mask = outlierMask(y);
    if (!mask.some(Boolean)) continue;
    const usable = y.filter((v): v is number => v !== null && Number.isFinite(v));
    // The same call `outlierMask` just made, not a second copy of the
    // expression -- see `outlierReference`.
    const { centre, basis } = outlierReference(usable);
    const points: HiddenPoint[] = [];
    for (let i = 0; i < mask.length; i += 1) {
      if (mask[i]) points.push({ end: x[i], value: y[i]!, ratio: round1(y[i]! / centre) });
    }
    points.sort((a, b) => a.end.getTime() - b.end.getTime());
    out.push({ key, reference: centre, basis, points });
  }
  return out;
}

/** How many points a report hides in total — the expander's label. */
export const hiddenTotal = (report: readonly HiddenSeries[]) =>
  report.reduce((n, s) => n + s.points.length, 0);
