// ============================================================
// L&G holdings fetcher  —  Extractor step 2 (second provider)
// ------------------------------------------------------------
// Downloads one L&G "Fundholdings" CSV from the web, then hands
// the text to the reader (parse-lg.js, step 3).
//
// Unlike iShares, L&G needs NO fund-number lookup. Each fund's
// holdings file has its own stable "documents-id" URL, e.g.
//   https://fundcentres.lgim.com/srp/documents-id/<UUID>/Fundholdings.csv
// The UUID is the only moving part per fund (read off once by the
// operator, stored, reused). The URL 301-redirects from
// fundcentres.lgim.com to fundcentres.landg.com — fetch follows it.
//
// Confirmed stable day-to-day: the same URL served a fresh file
// dated 2026-06-18 two days after the 2026-06-16 sample.
// ============================================================

const { parseLG } = require("./parse-lg");

// --- Build the download URL for ANY L&G fund ----------------------
// The documents-id UUID is the only part that changes per fund.
function buildLGUrl(documentsId) {
  return (
    "https://fundcentres.lgim.com/srp/documents-id/" +
    documentsId +
    "/Fundholdings.csv"
  );
}

// --- L&G US ESG Paris Aligned (IE00BKLWY790) — the chosen fund ---
const LG_US_ESG_URL = buildLGUrl(
  "818cf8a4-4320-4ca9-bb43-ef756a35f43a"
);

// Download the file at `url` and return its text.
async function fetchLGFile(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    redirect: "follow", // the lgim.com -> landg.com 301 is followed here
  });

  if (!res.ok) {
    throw new Error(
      "L&G fetch failed: HTTP " + res.status + " " + res.statusText
    );
  }

  const text = await res.text();

  // sanity check: did we get the holdings CSV, or a web page / block?
  // the real file contains the CSV header row; an error page would not.
  if (
    !text.includes("Security Description") ||
    !text.includes("Constituent Weight")
  ) {
    throw new Error(
      "L&G fetch: response is not a holdings file " +
        "(got " +
        text.length +
        " chars — likely a web page or block)"
    );
  }

  return text;
}

// Fetch + read in one go: URL in, clean holdings out.
async function getLGHoldings(url) {
  const text = await fetchLGFile(url);
  return parseLG(text);
}

module.exports = { fetchLGFile, getLGHoldings, buildLGUrl, LG_US_ESG_URL };

// --- run directly to test: node fetch-lg.js ---
if (require.main === module) {
  (async () => {
    try {
      console.log("Fetching L&G US ESG from L&G...");
      const result = await getLGHoldings(LG_US_ESG_URL);
      console.log("OK — file fetched and read.");
      console.log("  Holdings as of :", result.asOf);
      console.log("  Record Count   :", result.nSecurities);
      console.log("  Holdings read  :", result.holdingsCount);
      console.log("  Weights sum to :", result.totalWeight.toFixed(2) + "%");
      console.log("  First holding  :", result.holdings[0].name);
    } catch (err) {
      console.error("FAILED:", err.message);
      process.exit(1);
    }
  })();
}
