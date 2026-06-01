// ============================================================
// iShares fund finder  —  Extractor step 1
// ------------------------------------------------------------
// Turns an ISIN (what the user gives us) into the iShares
// internal fund number (what the download link needs).
//
// How: iShares' own fund list — the data feed behind their
// product screener — lists every fund, each with its ISIN and
// its product-page path (which ends in the fund number).
// We pull that list once, find the row whose ISIN matches, and
// read off the number.
//
// The number is then stored as "Provider ref" so this lookup
// never has to run again for that fund.
// ============================================================

// The iShares product-screener data feed (returns ALL funds).
const SCREENER_URL =
  "https://www.ishares.com/uk/individual/en/product-screener/" +
  "product-screener-v3.1.jsn?type=requestData&disclosureContentDispatcher=excludeNothing" +
  "&dcrPath=/templatedata/config/product-screener-v3/data/en/one-ishares-gb/product-screener" +
  "&siteEntryPassthrough=true";

// Download the fund list and return it as parsed data.
async function fetchScreener() {
  const res = await fetch(SCREENER_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(
      "iShares screener fetch failed: HTTP " + res.status + " " + res.statusText
    );
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      "iShares screener: response was not the expected data " +
        "(got " + text.length + " chars — likely a web page or block)"
    );
  }
}

// Search the fund list for one ISIN. Returns the fund number
// (and a few useful bits) or null if not found.
function findByIsin(screenerData, isin) {
  const target = String(isin).trim().toUpperCase();

  // The feed is an object keyed by each fund's internal number.
  // Each value is one fund's details, including its ISIN(s).
  for (const key of Object.keys(screenerData)) {
    const fund = screenerData[key];
    if (!fund || typeof fund !== "object") continue;

    // ISIN can sit under a few possible field names; gather any.
    const isins = [];
    const grab = (v) => {
      if (!v) return;
      if (typeof v === "string") isins.push(v.toUpperCase());
      else if (v.r !== undefined) isins.push(String(v.r).toUpperCase());
      else if (Array.isArray(v)) v.forEach(grab);
    };
    grab(fund.isin);
    grab(fund.isins);

    if (isins.some((x) => x === target)) {
      return {
        fundNumber: key,          // the iShares internal number we need
        localExchangeTicker: fund.localExchangeTicker || "",
        fundName: (fund.fundName && fund.fundName.r) || fund.fundName || "",
        productPageUrl: fund.productPageUrl || "",
      };
    }
  }
  return null;
}

// One call: ISIN in -> fund details out.
async function findISharesFund(isin) {
  const data = await fetchScreener();
  const count = Object.keys(data).length;
  const hit = findByIsin(data, isin);
  return { count, hit };
}

module.exports = { fetchScreener, findByIsin, findISharesFund, SCREENER_URL };
