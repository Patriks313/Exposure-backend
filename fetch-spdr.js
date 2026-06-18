// ============================================================
// SPDR / State Street holdings fetcher  —  third provider
// ------------------------------------------------------------
// Downloads one SSGA "holdings-daily" .xlsx from the web, then
// hands the bytes to the reader (parse-spdr.js).
//
// Like L&G, SPDR needs NO fund-number lookup: the holdings file
// lives at a stable URL built from the fund's own ticker, e.g.
//   https://www.ssga.com/se/en_gb/institutional/library-content/
//     products/fund-data/etfs/emea/holdings-daily-emea-en-<ticker>-gy.xlsx
// (SPPY: ...-sppy-gy.xlsx). The ticker is the only moving part.
//
// HOST NOTE: the file only lives on www.ssga.com. Bare ssga.com
// 301-redirects to it, and the bare host is NOT whitelisted in the
// build sandbox — so always use the www. host (fetch follows the
// 301 anyway). This is a REAL binary .xlsx, so we read it as an
// arrayBuffer, not text.
// ============================================================

const { parseSPDR } = require("./parse-spdr");

// --- Build the download URL for ANY SPDR fund (by lowercase ticker) ---
function buildSPDRUrl(ticker) {
  return (
    "https://www.ssga.com/se/en_gb/institutional/library-content/" +
    "products/fund-data/etfs/emea/holdings-daily-emea-en-" +
    String(ticker).toLowerCase() +
    "-gy.xlsx"
  );
}

// --- SPDR S&P 500 Leaders (IE00BH4GPZ28, ticker SPPY) ---
const SPDR_SPPY_URL = buildSPDRUrl("sppy");

// Download the .xlsx at `url` and return it as a Node Buffer.
async function fetchSPDRFile(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    redirect: "follow", // the ssga.com -> www.ssga.com 301 is followed here
  });

  if (!res.ok) {
    throw new Error(
      "SPDR fetch failed: HTTP " + res.status + " " + res.statusText
    );
  }

  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  // sanity check: a real .xlsx is a ZIP, so it starts with "PK".
  // an error page / HTML block would not.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error(
      "SPDR fetch: response is not an .xlsx file " +
        "(got " +
        buffer.length +
        " bytes — likely a web page or block)"
    );
  }

  return buffer;
}

// Fetch + read in one go: URL in, clean holdings out.
async function getSPDRHoldings(url) {
  const buffer = await fetchSPDRFile(url);
  return parseSPDR(buffer);
}

module.exports = {
  fetchSPDRFile,
  getSPDRHoldings,
  buildSPDRUrl,
  SPDR_SPPY_URL,
};

// --- run directly to test: node fetch-spdr.js ---
if (require.main === module) {
  (async () => {
    try {
      console.log("Fetching SPDR SPPY from State Street...");
      const result = await getSPDRHoldings(SPDR_SPPY_URL);
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
