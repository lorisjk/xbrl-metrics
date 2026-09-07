## What this is

This project was made in order to provide free and easy accessible data for the biggest US-companies, 
all while providing a data stream as pure as possible. XBRL-tags are quite unorganized and 10ks and 10qs seem distant and abstract. This project tries to lift the veil a bit and grant access for the public to these valuable information. 
Retail investors, who would like to see the latest earnings news or want to fact check a certain thesis at least fundamentally and multiple wise. 

## Disclaimer

**This is not investment advice.** Nothing on this site is a recommendation to buy,
sell, or hold any security, and nothing here is tailored to any individual's
circumstances, objectives, or financial situation. Do your own research and consult a
qualified professional before making any investment decision.

**The figures are computed, not sourced.** Fundamentals are derived from SEC EDGAR
XBRL company facts by an open-source pipeline; market data comes from a third-party
feed. Every number shown is the output of a calculation over filings, not a figure
published by the company or verified by a data vendor. Definitions here may differ
from those used by commercial providers, and from those a company uses in its own
reporting.

**Known limitations are surfaced, not hidden.** Coverage gaps, derivation provenance,
and data-quality flags are shown in the Data view rather than smoothed over. That
transparency is the point — but it also means figures can be missing, stale relative
to the most recent filing, or wrong in ways not yet found. No warranty is given as to
accuracy, completeness, or timeliness.

**Use at your own risk.** No liability is accepted for any loss arising from reliance
on anything presented here.

## Data sources

Everything shown here is derived from two public sources. Nothing comes from a
commercial data vendor, and no figure is an analyst estimate.

**Fundamentals — SEC EDGAR, XBRL company facts.** Filings are read from the SEC's
structured-data API:

- `data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` — every XBRL fact a company has
  filed, which is where all fundamental figures come from. Only the **`us-gaap`**
  namespace is read.
- `data.sec.gov/submissions/CIK{cik}.json` — the filing index, used for filing dates
  and to detect when a cached copy has fallen behind.
- `sec.gov/files/company_tickers.json` — the ticker-to-CIK mapping.

Only **10-K** and **10-Q** filings are used. Because XBRL facts are as-filed, the
figures are the company's own reported numbers, including later restatements: where a
period has been filed more than once, the most recently filed value wins. Quarterly
values are reconstructed from the year-to-date figures companies actually report, and
trailing-twelve-month series are summed from four consecutive quarters only when those
quarters really do cover a year.

**Market data — Yahoo Finance, via the `yfinance` library.** Daily closing prices from
2005 onward, today's price and share count, and the corporate-action feed used to put
historical share counts on the current split basis. Yahoo Finance is an unofficial
source with no service guarantee, and price history is back-adjusted for splits by the
provider rather than by this pipeline.

**What this means for the numbers.** Fundamentals are as good as the filings; where a
company tags something unusually, the pipeline may miss it or read it differently than
a human would. Prices are as good as Yahoo Finance on the day the pipeline ran. All
figures are computed on a schedule, not live — the sidebar shows when the data was
last refreshed.

## Source code

[Github repo link](https://github.com/lorisjk/stock_valuator.git)

## Contact

For buisness inquiries, please contact: kyhestlo.mail@gmail.com

## Legal notice / Impressum

Angaben gemäß § 5 DDG

Loris-Joona Köhn
15831 Mahlow
Deutschland

Kontakt
E-Mail: kyhestlo.mail@gmail.com

Verantwortlich für den Inhalt: Loris-Joona Köhn, 15831 Mahlow

## Privacy

**No accounts, no tracking, no advertising.** This site requires no registration and
sets no tracking or advertising cookies. It does not embed third-party analytics.

**Cookies.** This site sets no cookies. The update notice's dismissal state and any
in-session preferences are kept in your browser's local session storage, which is
never sent to the server and is cleared automatically when you close the tab. No
consent banner is shown because there is nothing here that requires one.

**What the server records.** This site does not keep access logs. The web server is
configured without request logging, so visits are not recorded and no IP addresses are
stored. Operational error messages may be written to the system journal for
troubleshooting; these do not routinely contain visitor data and are rotated by the
operating system.

**Session state.** The application keeps a small amount of state in your browser
session so the interface remembers your selections while you use it. It is discarded
when you close the tab and is not transmitted to any third party.

**Hosting.** The site is operated on infrastructure provided by Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Germany, in a data centre in Helsinki, Finland. No data is transferred outside the EU/EEA. 

**Your rights.** You have the right to information, correction, deletion, restriction
of processing, and to object to processing, as well as the right to lodge a complaint
with a supervisory authority. Contact: kyhestlo.mail@gmail.com.