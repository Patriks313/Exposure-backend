// ============================================================
// iShares holdings fetcher  —  Extractor step 2
// ------------------------------------------------------------
// Downloads one iShares holdings file from the web, then hands
// the text to the reader (parse-ishares.js, step 3).
//
// The download URL is fixed per fund. It has three moving parts:
//   - fundPath : the fund's page path, ends in its iShares
//                fund number  (e.g. .../products/307528/fund)
//   - ajaxId   : a number in the link iShares generates
//   - fileName : the file label
// For the test fund (IE00BHZPJ890) these are filled in below.
//
// Step 1 of the extractor — finding fundPath/ajaxId from an
// ISIN — is a separate job. For now the URL is handed in ready.
// ============================================================

const { parseIShares } = require("./parse-ishares");

// --- the test fund: iShares MSCI USA ESG Enhanced (IE00BHZPJ890) ---
const TEST_FUND_URL =
  "https://www.ishares.com/uk/individual/en/products/307528/fund/" +
  "1535604580409.ajax?fileType=xls" +
  "&fileName=iShares-MSCI-USA-CTB-Enhanced-ESG-UCITS-ETF-USD-Dist_fund" +
  "&dataType=fund";

// Download the file at `url` and return its text.
async function fetchISharesFile(url) {
  const res = await fetch(url, {
    // a normal browser-style header — some iShares endpoints
    // refuse a request that doesn't look like a browser
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
      "iShares fetch failed: HTTP " + res.status + " " + res.statusText
    );
  }

  const text = await res.text();

  // sanity check: did we get the holdings file, or a web page?
  // the real file contains the spreadsheet header; an error page
  // or terms-gate would not.
  if (!text.includes("<ss:Workbook") && !text.includes("Issuer Ticker")) {
    throw new Error(
      "iShares fetch: response is not a holdings file " +
        "(got " +
        text.length +
        " chars — likely a web page or block)"
    );
  }

  return text;
}

// Fetch + read in one go: URL in, clean holdings out.
async function getISharesHoldings(url) {
  const text = await fetchISharesFile(url);
  return parseIShares(text);
}

module.exports = { fetchISharesFile, getISharesHoldings, TEST_FUND_URL };

// --- run directly to test: node fetch-ishares.js ---
if (require.main === module) {
  (async () => {
    try {
      console.log("Fetching test fund from iShares...");
      const result = await getISharesHoldings(TEST_FUND_URL);
      console.log("OK — file fetched and read.");
      console.log("  Holdings as of :", result.asOf);
      console.log("  Holdings read  :", result.holdingsCount);
      console.log("  Weights sum to :", result.totalWeight.toFixed(2) + "%");
      console.log("  First holding  :", result.holdings[0].name);
    } catch (err) {
      console.error("FAILED:", err.message);
      process.exit(1);
    }
  })();
}
