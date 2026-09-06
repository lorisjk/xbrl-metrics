/**
 * Where the run's own dates come from, in one expression.
 *
 * A module rather than a named export on `Freshness.tsx`, for the reason
 * `DataContext.ts` is a module rather than an export on `DataProvider.tsx`: a
 * file that exports both a component and a plain function breaks react-refresh,
 * and eslint says so. Two callers need this string -- the sidebar's freshness
 * block and the ticker summary's first sentence -- and the point of having it
 * once is that the two lines cannot disagree about when the data is from.
 */
import type { Meta } from "../contracts.ts";

/**
 * `meta.run_start`'s date, which is what "Data as of" shows.
 *
 * `""` when `meta` is absent or carries no `run_start` -- both callers have a
 * sentence for that case, and neither wants a thrown error or the string
 * "undefined" in the middle of a paragraph.
 */
export const runDate = (meta: Meta | null): string => (meta?.run_start ?? "").slice(0, 10);
