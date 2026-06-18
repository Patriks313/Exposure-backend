// ============================================================
// Xtrackers / DWS holdings fetcher  —  Extractor step 2 (5th provider)
// ------------------------------------------------------------
// Downloads one Xtrackers "constituent" CSV from DWS, then hands
// the text to the reader (parse-xtrackers.js, step 3).
//
// THE EASY ONE: Xtrackers needs NO fund-number, UUID or ticker
// lookup. The holdings CSV lives at a stable URL built from the
// fund's ISIN alone:
//   https://etf.dws.com/etfdata/export/GBR/ENG/csv/product/constituent/<ISIN>
// (The DWS product PAGE is a JS app — but this data-export endpoint
// is plain HTTP and serves the CSV directly to the server.)
//
// The CSV carries no as-of date, so we stamp asOf with today's date
// (UTC, YYYY-MM-DD) — the feed is always the latest published file.
// ============================================================

const { parseXtrackers } = require("./parse-xtrackers");

// --- Build the download URL for ANY Xtrackers fund ----------------
// The ISIN is the only part that changes per fund.
function buildXtrackersUrl(isin) {
  return (
    "https://etf.dws.com/etfdata/export/GBR/ENG/csv/product/constituent/" +
    isin
  );
}

// --- Xtrackers MSCI Canada Screened (LU0476289540) — chosen fund --
const XTRACKERS_CANADA_URL = buildXtrackersUrl("LU0476289540");

// Download the file at `url` and return its text.
async function fetchXtrackersFile(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(
      "Xtrackers fetch failed: HTTP " + res.status + " " + res.statusText
    );
  }

  const text = await res.text();

  // sanity check: did we get the holdings CSV, or a web page / block?
  if (
    !text.includes("ShareClass ISIN") ||
    !text.includes("Constituent Weighting")
  ) {
    throw new Error(
      "Xtrackers fetch: response is not a holdings file " +
        "(got " +
        text.length +
        " chars — likely a web page or block)"
    );
  }

  return text;
}

// Fetch + read in one go: URL in, clean holdings out.
async function getXtrackersHoldings(url) {
  const text = await fetchXtrackersFile(url);
  const result = parseXtrackers(text);
  // the file carries no date — stamp the fetch date as as-of.
  result.asOf = new Date().toISOString().slice(0, 10);
  return result;
}

module.exports = {
  fetchXtrackersFile,
  getXtrackersHoldings,
  buildXtrackersUrl,
  XTRACKERS_CANADA_URL,
};

// --- run directly to test: node fetch-xtrackers.js ---
if (require.main === module) {
  (async () => {
    try {
      console.log("Fetching Xtrackers MSCI Canada Screened from DWS...");
      const result = await getXtrackersHoldings(XTRACKERS_CANADA_URL);
      console.log("OK — file fetched and read.");
      console.log("  Holdings as of :", result.asOf);
      console.log("  Holdings read  :", result.holdingsCount);
      console.log("  Rows skipped   :", result.skipped);
      console.log("  Weights sum to :", result.totalWeight.toFixed(2) + "%");
      console.log("  First holding  :", result.holdings[0].name);
    } catch (err) {
      console.error("FAILED:", err.message);
      process.exit(1);
    }
  })();
}
