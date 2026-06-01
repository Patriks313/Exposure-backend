// ============================================================
// iShares fund finder  —  Extractor step 1
// ------------------------------------------------------------
// Turns an ISIN into the iShares internal fund number by
// searching the web for it and reading the number out of the
// iShares result link (e.g. .../products/307528/...).
//
// Stored afterwards as "Provider ref" so it never runs again
// for that fund.
// ============================================================

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

// Several search endpoints to try — different engines / forms.
function candidates(query) {
  const q = encodeURIComponent(query);
  return [
    ["ddg html (post-style host)", "https://html.duckduckgo.com/html/?q=" + q],
    ["ddg lite", "https://lite.duckduckgo.com/lite/?q=" + q],
    ["bing html", "https://www.bing.com/search?q=" + q],
  ];
}

// From page text, pull the first iShares product fund number.
function extractFundNumber(text) {
  const m = text.match(/ishares\.com\/[^"'\s]*\/products\/(\d{4,7})\//i);
  if (m) return m[1];
  const m2 = text.match(/\/products\/(\d{4,7})\/[a-z0-9-]/i);
  if (m2) return m2[1];
  return null;
}

// Try each candidate; report what happened for each.
async function findISharesFundVerbose(isin) {
  const query = isin + " ishares fund";
  const lines = [];
  let fundNumber = null;

  for (const [label, url] of candidates(query)) {
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
      const text = await res.text();
      const num = extractFundNumber(text);
      const isharesHits = (text.match(/ishares\.com/gi) || []).length;
      const blocked =
        text.toLowerCase().includes("captcha") ||
        text.toLowerCase().includes("unusual traffic");
      if (num && !fundNumber) fundNumber = num;
      lines.push(
        label + "\n" +
          "   HTTP " + res.status + " | " + text.length + " chars" +
          " | ishares hits: " + isharesHits +
          " | number: " + (num || "none") +
          (blocked ? " | LOOKS BLOCKED" : "")
      );
    } catch (err) {
      lines.push(label + "\n   ERROR: " + err.message);
    }
  }

  return { fundNumber, report: lines.join("\n\n") };
}

// Simple version for real use later.
async function findISharesFund(isin) {
  const { fundNumber } = await findISharesFundVerbose(isin);
  return { fundNumber };
}

module.exports = { findISharesFund, findISharesFundVerbose, extractFundNumber };
