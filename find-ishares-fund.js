// ============================================================
// iShares fund finder  —  Extractor step 1
// ------------------------------------------------------------
// ISIN -> iShares internal fund number.
//   Hop 1: ISIN -> ticker, via OpenFIGI (free, no key, proven)
//   Hop 2: search iShares for the ticker, then read the fund
//          number from the result that ALSO carries our ISIN
//          (self-verifying: furniture on the page won't match).
//
// Stored afterwards as "Provider ref" so it never runs again.
// ============================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- Hop 1: ISIN -> ticker(s) (OpenFIGI) -------------------
async function isinToTicker(isin) {
  const res = await fetch("https://api.openfigi.com/v3/mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { return { tickers: [], note: "OpenFIGI not JSON" }; }
  const first = Array.isArray(data) ? data[0] : null;
  const rows = first && first.data ? first.data : [];
  const tickers = [...new Set(rows.map((r) => r.ticker).filter(Boolean))];
  return { tickers, note: "OpenFIGI HTTP " + res.status + " | tickers: " + (tickers.join(", ") || "none") };
}

// ---- Find all /products/NNN/ on a page, with positions -----
function allFundNumbers(text) {
  const out = [];
  const re = /\/products\/(\d{4,7})\//g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ num: m[1], at: m.index });
  return out;
}

// Pick the fund number that sits NEAREST to our ISIN on the page.
// If the ISIN isn't on the page, return null (don't guess).
function numberNearIsin(text, isin) {
  const isinPos = text.toUpperCase().indexOf(isin.toUpperCase());
  if (isinPos === -1) return null;
  const nums = allFundNumbers(text);
  if (nums.length === 0) return null;
  let best = null, bestDist = Infinity;
  for (const n of nums) {
    const d = Math.abs(n.at - isinPos);
    if (d < bestDist) { bestDist = d; best = n.num; }
  }
  return best;
}

// ---- Hop 2: search iShares, verify by ISIN -----------------
async function searchAndVerify(ticker, isin) {
  const urls = [
    "https://www.ishares.com/uk/individual/en/search/all?query=" + encodeURIComponent(ticker),
    "https://www.ishares.com/uk/individual/en/search?query=" + encodeURIComponent(ticker),
  ];
  const lines = [];
  let verified = null, firstAny = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      const text = await res.text();
      const hasIsin = text.toUpperCase().includes(isin.toUpperCase());
      const near = numberNearIsin(text, isin);
      const anyNums = allFundNumbers(text).map((n) => n.num);
      if (near && !verified) verified = near;
      if (anyNums[0] && !firstAny) firstAny = anyNums[0];
      lines.push(
        "   " + url.split("?")[0] + " -> HTTP " + res.status +
        " | ISIN on page: " + (hasIsin ? "YES" : "no") +
        " | number near ISIN: " + (near || "none") +
        " | numbers on page: " + (anyNums.slice(0, 5).join(",") || "none")
      );
    } catch (err) {
      lines.push("   " + url.split("?")[0] + " -> ERROR: " + err.message);
    }
  }
  return { verified, firstAny, report: lines.join("\n") };
}

// ---- Full chain, verbose -----------------------------------
async function findISharesFundVerbose(isin) {
  const out = [];
  out.push("Hop 1 — ISIN -> ticker (OpenFIGI)");
  let tickers = [];
  try {
    const h1 = await isinToTicker(isin);
    out.push("   " + h1.note);
    tickers = h1.tickers;
  } catch (err) { out.push("   ERROR: " + err.message); }

  out.push("\nHop 2 — search iShares, verify number by ISIN on page");
  let fundNumber = null;
  if (tickers.length === 0) {
    out.push("   skipped (no ticker)");
  } else {
    for (const t of tickers.slice(0, 3)) {
      out.push("  ticker " + t + ":");
      const h2 = await searchAndVerify(t, isin);
      out.push(h2.report);
      if (h2.verified && !fundNumber) { fundNumber = h2.verified; break; }
    }
  }
  return { fundNumber, report: out.join("\n") };
}

async function findISharesFund(isin) {
  const { fundNumber } = await findISharesFundVerbose(isin);
  return { fundNumber };
}

module.exports = { findISharesFund, findISharesFundVerbose, isinToTicker, numberNearIsin };
