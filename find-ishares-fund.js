// ============================================================
// iShares fund finder  —  Extractor step 1 (semi-automated)
// ------------------------------------------------------------
// Goal: turn a fund's ISIN/name into the iShares internal fund
// number (the "Provider ref", e.g. 307528) needed to download
// its holdings file.
//
// WHAT WORKS (proven) and WHAT DOESN'T (proven), see handover:
//   - OpenFIGI maps ISIN -> ticker from the server. WORKS.
//   - iShares' own search / screener CANNOT be read by a plain
//     server request: the results are filled in by JavaScript,
//     so the server only ever gets an empty page frame. Three
//     different iShares addresses were tried and all failed the
//     same way. DO NOT retry plain-fetch of iShares search.
//
// THE DESIGN (semi-automation, operator = the app's owner):
//   The fund number is SHARED across all users, so it only ever
//   needs finding ONCE per fund for the whole app. When a brand
//   new fund appears, the app:
//     1. gets its ticker from OpenFIGI (helps confirm identity),
//     2. builds the real iShares search link (confirmed to work
//        in a browser) for the operator to open,
//     3. the operator reads the number off the iShares page and
//        saves it as Provider ref — then it's reused forever.
//   End users never see this step.
//
//   Full server-side automation (a headless browser on the
//   backend) is the future upgrade; it would replace ONLY this
//   one manual read, nothing else changes.
// ============================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// --- ISIN -> ticker(s), via OpenFIGI (free, no key needed) ---
async function isinToTickers(isin) {
  const res = await fetch("https://api.openfigi.com/v3/mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
  });
  if (!res.ok) {
    throw new Error("OpenFIGI HTTP " + res.status + " " + res.statusText);
  }
  const data = await res.json();
  const first = Array.isArray(data) ? data[0] : null;
  const rows = first && first.data ? first.data : [];
  const tickers = [...new Set(rows.map((r) => r.ticker).filter(Boolean))];
  const name = rows.length && rows[0].name ? rows[0].name : "";
  return { tickers, name };
}

// --- Build the real iShares search link (works in a browser) ---
// The operator opens this, reads the fund number from the URL of
// the matching result (.../products/NUMBER/...), saves it.
function isharesSearchLink(searchText) {
  return (
    "https://www.ishares.com/uk/individual/en/search/summary-search-results" +
    "?searchText=" + encodeURIComponent(searchText) +
    "&doTickerSearch=true"
  );
}

// --- The semi-automated lookup: returns what the operator needs ---
// Prefers searching by fund name (cleanest matches); ticker is
// included as a cross-check of identity.
async function prepareFundLookup({ isin, name }) {
  let tickers = [];
  let figiName = "";
  try {
    const r = await isinToTickers(isin);
    tickers = r.tickers;
    figiName = r.name;
  } catch (e) {
    // OpenFIGI is a nice-to-have for confirmation; if it's down,
    // the operator can still use the name search below.
    figiName = "";
  }
  const searchText = name || figiName || (tickers[0] || isin);
  return {
    isin,
    name: name || figiName,
    tickers,                       // for confirming it's the right fund
    searchLink: isharesSearchLink(searchText),
    instructions:
      "Open the search link, find the matching fund, and read its " +
      "number from the result URL (.../products/NUMBER/...). Save that " +
      "number as the fund's Provider ref.",
  };
}

module.exports = { isinToTickers, isharesSearchLink, prepareFundLookup };
