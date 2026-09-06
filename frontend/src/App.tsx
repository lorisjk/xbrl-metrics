/**
 * The application shell: sidebar, four views, six Analysis tabs.
 *
 * As of item 22 every view and every tab is built, so this file holds no
 * `Placeholder` any more -- that component's only job was to make an unbuilt
 * surface read as deliberately pending, and there is none left. It was deleted
 * with its last call site rather than left orphaned.
 *
 * This is `app.py`'s `main()` and `render_analysis()` (app.py:815-900) as one
 * component. It wraps and routes; it does not compute anything a view needs.
 *
 * **The three chart tabs are one `ChartView`** with a different `chart` prop,
 * which is what it was already built for — so switching between Growth,
 * Fundamentals and Valuation does not unmount it, and the per-chart metric
 * selections and window values survive for free.
 *
 * **Every other tab keeps its state by staying mounted too**, which is
 * `TabPanel`'s whole job — see its docstring for why that is a mounting rule
 * rather than a store. Streamlit's session state kept a control across a tab
 * switch for free; here it costs one component, applied to every tab so that no
 * tab added later has to remember to ask for it.
 *
 * A **view** switch does unmount all of it. That is the boundary, and it is
 * where the reference's own boundary is: leaving Analysis in `app.py` drops the
 * ticker controls entirely.
 */
import { useEffect, useState } from "react";
import About from "./About.tsx";
import ChartView from "./ChartView.tsx";
import DataTab from "./data/DataTab.tsx";
import ComparisonView from "./ComparisonView.tsx";
import Coverage from "./Coverage.tsx";
import Encyclopedia from "./Encyclopedia.tsx";
import { useData } from "./data/DataContext.ts";
import { DataProvider } from "./data/DataProvider.tsx";
import Sidebar from "./shell/Sidebar.tsx";
import RawFactsView from "./RawFactsView.tsx";
import TabPanel from "./shell/TabPanel.tsx";
import UpdateNotice from "./shell/UpdateNotice.tsx";
import GuardScreen from "./shell/GuardScreen.tsx";
import {
  DEFAULT_LOCATION,
  TABS,
  TAB_LABELS,
  formatHash,
  isChartTab,
  locationFrom,
  parseHash,
  tabDrawsFigure,
  withTab,
  withTicker,
  withView,
  type Location,
} from "./shell/navigation.ts";
import "./shell/shell.css";

/** app.py:816 — the page name, carried so the two apps answer to one thing. */
const APP_TITLE = "Kyhestlo";

/** app.py:837-841, verbatim. */
const INTRO =
  "This pipeline fetches SEC EDGAR 10k and 10q filings of more than 600 companies, extracts " +
  "the XBRL facts, computes derived metrics, and links them to yfinance course data. " +
  "This data stream is as pure as possible.";

/**
 * The URL hash is the single source of truth for where you are.
 *
 * With one addition, and only at startup: three of the four views are also
 * **prerendered at real paths** (`/about`, `/encyclopedia`, `/coverage`), so a
 * visitor can arrive from a search result with a pathname and no hash. Reading
 * the pathname once, through `locationFrom`, is what stops that visitor seeing
 * the static About content and then being thrown to the Analysis view the
 * moment the bundle boots. The hash still wins whenever it names anything, and
 * nothing below writes a path -- see `locationFrom`.
 */
function useLocation(): [Location, (next: Location) => void] {
  const read = () =>
    typeof window === "undefined"
      ? DEFAULT_LOCATION
      : locationFrom(window.location.hash, window.location.pathname);
  const [location, setLocation] = useState<Location>(read);

  // Back/forward, and a hash pasted into the bar, both arrive here.
  useEffect(() => {
    const onHash = () => setLocation(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (next: Location) => {
    const hash = formatHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    setLocation(next);
  };
  return [location, go];
}

function Workspace() {
  const { registry, meta, notice, universe, error, loading } = useData();
  const [location, go] = useLocation();
const [sidebarOpen, setSidebarOpen] = useState(() => {
  if (typeof window === "undefined") return true;
  return window.innerWidth > 860;
});
  // app.py:867's `as_of`, and it lives here for the reason it lives in the
  // sidebar there: one date reaches two tabs. Unchecking sets it back to null
  // and forgets the date, which is what Streamlit's unkeyed `st.date_input`
  // does -- a widget that is not rendered in a run loses its state, so ticking
  // the box again offers today rather than the previous pick.
  //
  // Deliberately **not** in the URL hash. The hash carries view, ticker and tab
  // (navigation.ts's docstring says why the per-chart selections stay out of
  // it), and an as-of date has the same property: it is a reading mode, not a
  // place. Adding it later is a change to `parseHash`/`formatHash` and to this
  // line, nothing else.
  const [asOf, setAsOf] = useState<Date | null>(null);

  // `.content`'s width changes for two reasons that are not window resizes, and
  // react-plotly.js's `useResizeHandler` listens for exactly one thing: a native
  // `resize` event on `window` (dist/create-plotly-component.min.js's `Q()` is a
  // plain `window.addEventListener("resize", ...)`, not a ResizeObserver on the
  // Plot's own container). So both reasons have to be announced by hand.
  //
  //   1. **The sidebar collapsing**, which reflows the CSS grid. Measured: the
  //      chart's SVG otherwise keeps the pixel width it had before the click.
  //
  //   2. **A tab holding a figure being revealed**, which is the same failure
  //      one step earlier and was live in the shell from the moment tab
  //      switching was built. `ChartView` is mounted for every tab and merely
  //      hidden, so landing on a *non*-chart tab mounts `<Plot>` inside a
  //      `display: none` box: its container measures 0, plotly falls back to
  //      `layout.width = 700`, and revealing the tab grows the container to
  //      1204px while the SVG stays at 700. Measured on both this tree and a
  //      pre-item-9 one -- identical, so this is a latent shell defect rather
  //      than anything the data tab introduced. Landing straight on a chart tab
  //      always looked right, which is why it survived three cycles.
  //
  //      **The comparison tab joined this case when it stopped being
  //      unmounted.** While it was conditionally rendered its `<Plot>` mounted
  //      at the moment it became visible, so it measured correctly every time;
  //      now that it persists, a sidebar toggle taken while it is hidden
  //      reaches it exactly as it reaches `ChartView`. Hence `tabDrawsFigure`
  //      rather than `isChartTab` -- the one part of the persistence fix that
  //      is not mechanical, and the reason the width harness gained a
  //      comparison round trip.
  //
  // Gated on the destination drawing a figure: firing while it is still hidden
  // would resize it against a 0-width container, which is the failure rather
  // than the fix. One synthetic event reaches the same handler a real resize
  // would, so this stays entirely outside ChartView, ComparisonView, `<Plot>`
  // and the figure spec.
  const activeTab = location.tab;
  useEffect(() => {
    if (!tabDrawsFigure(activeTab)) return;
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    return () => cancelAnimationFrame(id);
  }, [sidebarOpen, activeTab]);

  // The registry and the universe are the two files nothing can run without.
  if (error) return <GuardScreen error={error} what="The export" />;
  if (loading || !registry) {
    return (
      <main className="loading">
        <h1>{APP_TITLE}</h1>
        <p>Loading the export…</p>
      </main>
    );
  }

  // A hash naming a ticker that is not in this bundle keeps the ticker: the
  // per-ticker fetch is what knows whether it exists, and it already has a
  // message for the answer. Falling back here would silently rewrite the URL
  // someone shared.
 const ticker =
  location.ticker ??
  (universe.some((u) => u.ticker === "AAPL") ? "AAPL" : universe[0]?.ticker) ??
  "AAPL"; 
  const profile = registry.ticker_profile[ticker] ?? registry.default_profile;
  const { view, tab } = location;


  return (
    <div className={`app${sidebarOpen ? "" : " app--collapsed"}`}>
      <Sidebar
        meta={meta}
        view={view}
        onView={(next) => go(withView(location, next))}
        ticker={ticker}
        profile={profile}
        universe={universe}
        onTicker={(next) => go(withTicker(location, next))}
        asOf={asOf}
        onAsOf={setAsOf}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="content">
        <div className="content__sticky">
          <header className="content__head">
            {!sidebarOpen && (
              <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Show sidebar">
                ☰
              </button>
            )}
            <h1>{APP_TITLE}</h1>
          </header>

          <UpdateNotice raw={notice} />
          <p className="intro">{INTRO} 
          </p>

          {view === "analysis" && (
            <nav className="tabs" aria-label="Analysis sections">
              {TABS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={id === tab ? "tab tab--active" : "tab"}
                  aria-current={id === tab ? "page" : undefined}
                  onClick={() => go(withTab(location, id))}
                >
                  {TAB_LABELS[id]}
                </button>
              ))}
            </nav>
          )}
        </div>

        <div className="content__body">
          {view === "analysis" ? (
            <>
              <div hidden={!isChartTab(tab)}>
                <ChartView registry={registry} ticker={ticker} chart={isChartTab(tab) ? tab : "valuation"} asOf={asOf} />
              </div>
              <TabPanel id="data" active={tab}><DataTab ticker={ticker} /></TabPanel>
              <TabPanel id="raw" active={tab}><RawFactsView ticker={ticker} /></TabPanel>
              <TabPanel id="comparison" active={tab}>
                <ComparisonView registry={registry} universe={universe} seed={ticker} asOf={asOf} />
              </TabPanel>
            </>
          ) : view === "encyclopedia" ? (
            <Encyclopedia registry={registry} />
          ) : view === "coverage" ? (
            <Coverage registry={registry} />
          ) : (
            <About />
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <DataProvider>
      <Workspace />
    </DataProvider>
  );
}
