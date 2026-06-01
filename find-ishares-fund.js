// ============================================================
// iShares fund finder  —  Extractor step 1
// ------------------------------------------------------------
// ISIN -> iShares internal fund number, via two hops, both
// using server-friendly services (no flaky search engines):
//   Hop 1: ISIN -> ticker, via OpenFIGI (free, no key)
//   Hop 2: ticker -> iShares fund number, via iShares' own
//          search-suggestion feed
//
// Stored afterwards as "Provider ref" so it never runs again.
// ============================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- Hop 1: ISIN -> ticker (OpenFIGI) ----------------------
async function isinToTicker(isin) {
  const res = await fetch("https://api.openfigi.com/v3/mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    return { ok: false, note: "OpenFIGI: not JSON (HTTP " + res.status + ")", raw: text.slice(0, 200) };
  }
  const first = Array.isArray(data) ? data[0] : null;
  const rows = first && first.data ? first.data : [];
  const tickers = [...new Set(rows.map((r) => r.ticker).filter(Boolean))];
  return {
    ok: tickers.length > 0,
    note: "OpenFIGI HTTP " + res.status + " | rows: " + rows.length + " | tickers: " + (tickers.join(", ") || "none"),
    tickers,
  };
}

// ---- Hop 2: ticker -> iShares fund number ------------------
// iShares' site search-suggestion feed. We read any
// /products/NUMBER/ path out of whatever it returns.
function extractFundNumber(text) {
  const m = text.match(/\/products\/(\d{4,7})\//);
  return m ? m[1] : null;
}

async function tickerToFundNumber(ticker) {
  // a couple of plausible iShares search endpoints
  const urls = [
    "https://www.ishares.com/uk/individual/en/search/all?query=" + encodeURIComponent(ticker),
    "https://www.ishares.com/uk/individual/en/search?query=" + encodeURIComponent(ticker),
  ];
  const lines = [];
  let fundNumber = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      const text = await res.text();
      const num = extractFundNumber(text);
      if (num && !fundNumber) fundNumber = num;
      lines.push("   " + url.split("?")[0] + " -> HTTP " + res.status + ", " + text.length + " chars, number: " + (num || "none"));
    } catch (err) {
      lines.push("   " + url.split("?")[0] + " -> ERROR: " + err.message);
    }
  }
  return { fundNumber, report: lines.join("\n") };
}

// ---- Full chain, verbose (for testing) ---------------------
async function findISharesFundVerbose(isin) {
  const out = [];
  out.push("Hop 1 — ISIN -> ticker (OpenFIGI)");
  let tickers = [];
  try {
    const h1 = await isinToTicker(isin);
    out.push("   " + h1.note);
    if (h1.raw) out.push("   raw: " + h1.raw);
    tickers = h1.tickers || [];
  } catch (err) {
    out.push("   ERROR: " + err.message);
  }

  out.push("\nHop 2 — ticker -> iShares fund number");
  let fundNumber = null;
  if (tickers.length === 0) {
    out.push("   skipped (no ticker from hop 1)");
  } else {
    for (const t of tickers.slice(0, 2)) {
      out.push("  ticker " + t + ":");
      const h2 = await tickerToFundNumber(t);
      out.push(h2.report);
      if (h2.fundNumber && !fundNumber) fundNumber = h2.fundNumber;
    }
  }

  return { fundNumber, report: out.join("\n") };
}

async function findISharesFund(isin) {
  const { fundNumber } = await findISharesFundVerbose(isin);
  return { fundNumber };
}

module.exports = { findISharesFund, findISharesFundVerbose, isinToTicker, extractFundNumber };
