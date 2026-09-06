/**
 * Run provenance, from `render_freshness` (app.py:619-629).
 *
 * Three lines, then a fourth **only when `tickers_without_data` is non-empty** —
 * the reference's own comment: "an empty list must render as nothing, not an
 * empty label".
 *
 * `meta.json` is read leniently (see META_SCHEMA), so every field here is
 * optional and a version drift costs the caption, not the app. The version note
 * is shown rather than swallowed: the export in the tree right now declares
 * schema 2 while `main.py` writes 4, and a silent caption would hide that.
 */
import { META_SCHEMA, type Meta } from "../contracts.ts";
import { runDate } from "./provenance.ts";

export default function Freshness({ meta }: { meta: Meta | null }) {
  if (!meta) {
    return <p className="caption">Run provenance unavailable — meta.json was not readable.</p>;
  }
  const date = runDate(meta);
  const stale = meta.schema !== undefined && meta.schema !== META_SCHEMA;
  return (
    <div className="freshness">
      <p className="caption">
        <strong>Data as of {date || "unknown"}</strong>
        <br />
        {meta.tickers_with_data ?? "?"} of {meta.tickers_requested ?? "?"} tickers produced data
        <br />
        period <code>{meta.period ?? "?"}</code>
      </p>
      {meta.tickers_without_data && meta.tickers_without_data.length > 0 && (
        <p className="caption">No data this run: {meta.tickers_without_data.join(", ")}</p>
      )}
      {stale && (
        <p className="caption caption--warn">
        </p>
      )}
    </div>
  );
}
