// ============================================================
// iShares fund finder  —  Extractor step 1
// ------------------------------------------------------------
// Turns an ISIN (what the user gives us) into the iShares
// internal fund number (what the download link needs).
//
// How a human does it: search the web for the ISIN, click the
// iShares result, read the number out of the page address
// (e.g. .../products/307528/...). We do exactly that:
//   1. search DuckDuckGo's plain HTML page for the ISIN
//   2. find an iShares product link in the results
//   3. read the fund number out of that link
//
// The number is then stored as "Provider ref" so this lookup
// never has to run again for that fund.
// ============================================================

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

// DuckDuckGo's no-JavaScript HTML results page. Free, no key.
function searchUrl(query) {
  return "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
}

// From a blob of text, pull the first iShares product fund number.
// iShares product links look like:  /products/307528/some-fund-name
function extractFundNumber(text) {
  // DuckDuckGo wraps result links in redirects, but the real URL
  // still appears in the text. Look for the iShares products path.
  const m = text.match(/ishares\.com\/[^"'\s]*\/products\/(\d{4,7})\//i);
  if (m) return m[1];
  // Fallback: sometimes the path appears without the domain.
  const m2 = text.match(/\/products\/(\d{4,7})\/[a-z0-9-]/i);
  if (m2) return m2[1];
  return null;
}

// One call: ISIN in -> fund number out (or null).
async function findISharesFund(isin) {
  const query = isin + " ishares";
  const res = await fetch(searchUrl(query), { headers: HEADERS, redirect: "follow" });
  if (!res.ok) {
    throw new Error("search failed: HTTP " + res.status + " " + res.statusText);
  }
  const text = await res.text();

  const fundNumber = extractFundNumber(text);

  // a little context for the test report
  const isharesLinkCount = (text.match(/ishares\.com/gi) || []).length;
  const looksBlocked =
    text.toLowerCase().includes("captcha") ||
    text.toLowerCase().includes("unusual traffic");

  return {
    fundNumber,                 // the number we need, or null
    isharesMentions: isharesLinkCount,
    looksBlocked,
    bytes: text.length,
  };
}

module.exports = { findISharesFund, extractFundNumber, searchUrl };
