// ============================================================
// iShares fund finder  —  Extractor step 1
// ------------------------------------------------------------
// ISIN/name -> iShares internal fund number.
//
// Uses iShares' REAL search address (confirmed working in a
// browser):
//   /search/summary-search-results?searchText=NAME&doTickerSearch=true
//
// We search by the fund NAME (which we already have from the
// user's portfolio), then read the fund number from the result
// that carries our ISIN — or, if the page is JS-filled, report
// that so we know to use a browser instead.
//
// Stored afterwards as "Provider ref" so it never runs again.
// ============================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// The confirmed real iShares search address.
function searchUrl(name) {
  return (
    "https://www.ishares.com/uk/individual/en/search/summary-search-results" +
    "?searchText=" + encodeURIComponent(name) +
    "&doTickerSearch=true"
  );
}

function allFundNumbers(text) {
  const out = [];
  const re = /\/products\/(\d{4,7})\//g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return [...new Set(out)];
}

function numberNearIsin(text, isin) {
  const pos = text.toUpperCase().indexOf(isin.toUpperCase());
  if (pos === -1) return null;
  const re = /\/products\/(\d{4,7})\//g;
  let m, best = null, bestDist = Infinity;
  while ((m = re.exec(text)) !== null) {
    const d = Math.abs(m.index - pos);
    if (d < bestDist) { bestDist = d; best = m[1]; }
  }
  return best;
}

// Search by name, report what the server actually receives.
async function findISharesFundVerbose(isin, name) {
  const out = [];
  const url = searchUrl(name);
  out.push("Search (by name): " + name);
  out.push("URL: " + url.split("?")[0] + "?searchText=...");

  let fundNumber = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    const text = await res.text();
    const hasIsin = text.toUpperCase().includes(isin.toUpperCase());
    const hasName = text.toUpperCase().includes(name.toUpperCase().slice(0, 20));
    const nums = allFundNumbers(text);
    const near = numberNearIsin(text, isin);
    if (near) fundNumber = near;

    out.push("");
    out.push("HTTP " + res.status + " | page size: " + text.length + " chars");
    out.push("Our ISIN on page : " + (hasIsin ? "YES" : "no"));
    out.push("Fund name on page: " + (hasName ? "YES" : "no"));
    out.push("Product numbers found: " + (nums.slice(0, 8).join(", ") || "none"));
    out.push("Number near our ISIN : " + (near || "none"));
  } catch (err) {
    out.push("ERROR: " + err.message);
  }

  return { fundNumber, report: out.join("\n") };
}

async function findISharesFund(isin, name) {
  const { fundNumber } = await findISharesFundVerbose(isin, name);
  return { fundNumber };
}

module.exports = { findISharesFund, findISharesFundVerbose, searchUrl, numberNearIsin };
