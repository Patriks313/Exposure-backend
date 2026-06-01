// ============================================================
// iShares screener explorer  —  one-off diagnostic
// ------------------------------------------------------------
// We don't yet know the exact address for the FULL iShares fund
// list. Rather than guess one at a time, this tries several
// known address patterns and reports what each returns:
//   - did it load? how many funds? was our test ISIN in it?
// Whichever one returns hundreds of funds AND contains the test
// ISIN is the real full-catalogue address.
//
// This is a diagnostic, not part of the real flow. Once we know
// the right address, the finder uses it and this can be removed.
// ============================================================

const TEST_ISIN = "IE00BHZPJ890";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

// Candidate addresses to try. Each is a [label, url] pair.
const CANDIDATES = [
  [
    "A: uk individual (one-ishares-gb)",
    "https://www.ishares.com/uk/individual/en/product-screener/product-screener-v3.jsn" +
      "?dcrPath=/templatedata/config/product-screener-v3/data/en/one-ishares-gb/product-screener" +
      "&siteEntryPassthrough=true",
  ],
  [
    "B: uk individual (product-screener-gb)",
    "https://www.ishares.com/uk/individual/en/product-screener/product-screener-v3.jsn" +
      "?dcrPath=/templatedata/config/product-screener-v3/data/en/uk-retail/product-screener-gb" +
      "&siteEntryPassthrough=true",
  ],
  [
    "C: uk professional",
    "https://www.ishares.com/uk/professional/en/product-screener/product-screener-v3.jsn" +
      "?dcrPath=/templatedata/config/product-screener-v3/data/en/one-ishares/product-screener" +
      "&siteEntryPassthrough=true",
  ],
  [
    "D: uk individual generic path",
    "https://www.ishares.com/uk/individual/en/product-screener/product-screener-v3.jsn" +
      "?dcrPath=/templatedata/config/product-screener-v3/data/en/uk/product-screener" +
      "&siteEntryPassthrough=true",
  ],
  [
    "E: real params on the etf-investments URL (.jsn)",
    "https://www.ishares.com/uk/individual/en/products/etf-investments.jsn" +
      "?switchLocale=y&siteEntryPassthrough=true" +
      "&productView=all&dataView=keyFacts&keyFacts=all&showAll=true",
  ],
  [
    "F: real params on the etf-investments URL (.ajax)",
    "https://www.ishares.com/uk/individual/en/products/etf-investments.ajax" +
      "?switchLocale=y&siteEntryPassthrough=true" +
      "&productView=all&dataView=keyFacts&keyFacts=all&showAll=true",
  ],
  [
    "G: plain etf-investments page with real params",
    "https://www.ishares.com/uk/individual/en/products/etf-investments" +
      "?switchLocale=y&siteEntryPassthrough=true" +
      "&productView=all&dataView=keyFacts&keyFacts=all&showAll=true",
  ],
];

// Look through whatever shape came back, count funds, and check
// whether our test ISIN appears anywhere in the text.
function summarise(text) {
  const out = { length: text.length, parsed: false, count: 0, hasTestIsin: false, sample: "" };
  out.hasTestIsin = text.toUpperCase().includes(TEST_ISIN);
  try {
    const data = JSON.parse(text);
    out.parsed = true;
    if (Array.isArray(data)) {
      out.count = data.length;
    } else if (data && typeof data === "object") {
      const keys = Object.keys(data);
      out.count = keys.length;
      out.sample = keys.slice(0, 3).join(", ");
    }
  } catch (e) {
    out.parsed = false;
  }
  return out;
}

async function tryOne(label, url) {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    if (!res.ok) {
      return label + "\n   HTTP " + res.status + " " + res.statusText + "\n";
    }
    const text = await res.text();
    const s = summarise(text);
    return (
      label + "\n" +
      "   loaded: " + s.length + " chars" +
      " | parsed as data: " + (s.parsed ? "yes" : "NO") +
      " | items: " + s.count +
      " | test ISIN present: " + (s.hasTestIsin ? "YES" : "no") +
      (s.sample ? "\n   first keys: " + s.sample : "") +
      "\n   body: " + text.slice(0, 400) +
      "\n"
    );
  } catch (err) {
    return label + "\n   ERROR: " + err.message + "\n";
  }
}

async function exploreScreener() {
  const parts = [];
  for (const [label, url] of CANDIDATES) {
    parts.push(await tryOne(label, url));
  }
  return parts.join("\n");
}

module.exports = { exploreScreener };
