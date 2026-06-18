// ============================================================
// Carnegie holdings fetcher  —  Extractor step 2 (6th provider)
// ------------------------------------------------------------
// Finds and downloads the LATEST Carnegie SICAV report PDF on its own,
// then hands the bytes to the reader (parse-carnegie.js, step 3).
//
// FULLY AUTOMATIC (no upload): the Carnegie fund-document page is plain
// HTML, so the server reads it, lists the "Carnegie Investment Fund"
// annual/semi-annual report PDFs, opens each just far enough to read
// its "as at" date, and keeps the newest. Carnegie only publishes
// holdings ~twice a year, so the newest report is the freshest data
// available — re-running this route simply re-reads whatever is latest.
//
// Host: www.carnegie.se (the bare carnegie.se 301-redirects to it).
// ============================================================

const { parseCarnegie, readReportDate } = require("./parse-carnegie");

const LISTING_URL =
  "https://www.carnegie.se/private-banking/dokument-och-underlag/fonder-och-portfoljer/";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error("Carnegie listing fetch failed: HTTP " + res.status);
  }
  return await res.text();
}

async function downloadPdf(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return Buffer.from(await res.arrayBuffer());
}

// From the listing HTML, pick the holdings-bearing reports for the
// "Carnegie Investment Fund" SICAV (the one Svenska Aktier belongs to).
function findReportUrls(html) {
  const all = [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => m[1]);
  const seen = new Set();
  return all.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    const f = decodeURIComponent(u);
    return (
      /Carnegie Investment Fund/i.test(f) &&
      /(Annual|Semi)/i.test(f) &&
      /report/i.test(f) &&
      !/Pre-?contractual|Prospectus|disclosure|faktablad|KIID|SFDR/i.test(f)
    );
  });
}

// Fallback date from a filename when the in-PDF date can't be read.
function dateFromFilename(f) {
  let m;
  if ((m = f.match(/(\d{2})[.\-](\d{2})[.\-](\d{4})/)))
    return `${m[3]}-${m[2]}-${m[1]}`;
  if ((m = f.match(/(\d{4})(\d{2})(\d{2})/)))
    return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = f.match(/(\d{2})[.\-](\d{2})[.\-](\d{2})(?!\d)/)))
    return `20${m[3]}-${m[2]}-${m[1]}`;
  if ((m = f.match(/\b(20\d{2})\b/))) return `${m[1]}-12-31`;
  return "";
}

// Find the newest report, download it, read the wanted sub-fund.
async function getCarnegieHoldings(sectionLabel) {
  const html = await fetchHtml(LISTING_URL);
  const urls = findReportUrls(html);
  if (urls.length === 0) {
    throw new Error(
      "Carnegie: no 'Carnegie Investment Fund' report PDFs found on the listing page"
    );
  }

  let best = null; // {url, buf, asOf}
  for (const url of urls) {
    let buf;
    try {
      buf = await downloadPdf(url);
    } catch (e) {
      continue; // skip a report we can't download
    }
    let asOf = "";
    try {
      asOf = await readReportDate(buf);
    } catch (e) {}
    if (!asOf) asOf = dateFromFilename(decodeURIComponent(url));
    if (asOf && (!best || asOf > best.asOf)) best = { url, buf, asOf };
  }
  if (!best) {
    throw new Error("Carnegie: could not determine a date for any report");
  }

  const result = await parseCarnegie(best.buf, sectionLabel);
  if (best.asOf) result.asOf = best.asOf; // report date beats anything else
  result.fileName = decodeURIComponent(best.url.split("/").pop());
  result.sourceUrl = best.url;

  if (result.holdingsCount === 0) {
    throw new Error(
      "Carnegie: found the latest report (" +
        result.fileName +
        ") but read 0 holdings for sub-fund '" +
        sectionLabel +
        "' — check the section label."
    );
  }
  return result;
}

module.exports = { getCarnegieHoldings, findReportUrls, LISTING_URL };

// --- run directly to test: node fetch-carnegie.js [sectionLabel] ---
if (require.main === module) {
  (async () => {
    try {
      const label = process.argv[2] || "Svenska Aktier";
      console.log("Finding latest Carnegie report for:", label, "...");
      const r = await getCarnegieHoldings(label);
      console.log("OK.");
      console.log("  File           :", r.fileName);
      console.log("  Holdings as of :", r.asOf);
      console.log("  Holdings read  :", r.holdingsCount);
      console.log("  Weights sum to :", r.totalWeight.toFixed(2) + "%");
      console.log("  First holding  :", r.holdings[0].name);
    } catch (err) {
      console.error("FAILED:", err.message);
      process.exit(1);
    }
  })();
}
