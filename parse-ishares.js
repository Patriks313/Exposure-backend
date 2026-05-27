// ============================================================
// iShares holdings reader  —  Extractor step 3
// ------------------------------------------------------------
// Takes one iShares "Download" file and turns it into clean
// holding rows for the Fund Holdings table.
//
// The iShares file is named .xls but is really a Microsoft
// XML spreadsheet. We read it as plain text — no Excel library.
//
// What it returns per holding:
//   ticker, name, sector, weight, country, currency
//   isin  -> left empty on purpose (decision A); a separate
//            ticker -> ISIN step fills it in later.
// ============================================================

function parseIShares(fileText) {
  // strip the leading byte-order-mark if present
  const txt = fileText.replace(/^\uFEFF+/, "");

  // pull out every <Row>...</Row> block
  const rowBlocks = txt.match(/<ss:Row>[\s\S]*?<\/ss:Row>/g) || [];

  // decode the XML-encoded characters (e.g. &amp; -> &)
  const decode = (s) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&amp;/g, "&"); // &amp; last, so it doesn't re-trigger

  // turn one row block into an array of cell-strings
  const cellsOf = (block) => {
    const cells = block.match(/<ss:Cell[^>]*>[\s\S]*?<\/ss:Cell>/g) || [];
    return cells.map((c) => {
      const d = c.match(/<ss:Data[^>]*>([\s\S]*?)<\/ss:Data>/);
      if (!d) return "";
      // remove any inner tags, trim whitespace/newlines, decode entities
      return decode(d[1].replace(/<[^>]*>/g, "").trim());
    });
  };

  const rows = rowBlocks.map(cellsOf);

  // --- meta lines at the top (label in cell 0, value in cell 1) ---
  const meta = {};
  for (const r of rows) {
    if (r[0] === "Fund Holdings as of") meta.asOf = r[1];
    if (r[0] === "Number of Securities") meta.nSecurities = r[1];
  }

  // --- find the holdings header row ---
  const headerIdx = rows.findIndex(
    (r) => r[0] === "Issuer Ticker" && r.includes("Weight (%)")
  );
  if (headerIdx === -1) {
    throw new Error("iShares reader: holdings header row not found");
  }
  const header = rows[headerIdx];
  const col = (label) => header.indexOf(label);
  const idx = {
    ticker: col("Issuer Ticker"),
    name: col("Name"),
    sector: col("Sector"),
    assetClass: col("Asset Class"),
    weight: col("Weight (%)"),
    country: col("Location"),
    currency: col("Market Currency"),
  };

  // --- read holding rows ---
  // iShares sorts by weight, so cash / derivative lines can appear
  // partway down the list, not only at the end. So we SKIP non-Equity
  // lines and keep going. The real end of the holdings is the
  // disclaimer block — a row with no numeric weight — which stops us.
  const holdings = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const weight = parseFloat(r[idx.weight]);
    if (isNaN(weight)) break; // reached the disclaimer / end of table
    const assetClass = r[idx.assetClass];
    if (assetClass !== "Equity") {
      skipped++; // cash, futures, money-market line — not a holding
      continue;
    }
    if (!r[idx.name]) {
      skipped++;
      continue;
    }
    holdings.push({
      isin: "", // decision A: filled later by ticker -> ISIN step
      ticker: r[idx.ticker] || "",
      name: r[idx.name],
      sector: r[idx.sector] || "",
      weight: weight, // % within the fund
      country: r[idx.country] || "",
      currency: r[idx.currency] || "",
    });
  }

  const totalWeight = holdings.reduce((s, h) => s + h.weight, 0);

  return {
    asOf: meta.asOf || "",
    nSecurities: meta.nSecurities || "",
    holdingsCount: holdings.length,
    totalWeight: totalWeight,
    skipped: skipped,
    holdings: holdings,
  };
}

module.exports = { parseIShares };

// --- quick self-test when run directly: node parse-ishares.js <file> ---
if (require.main === module) {
  const fs = require("fs");
  const path = process.argv[2];
  if (!path) {
    console.log("usage: node parse-ishares.js <ishares-file>");
    process.exit(1);
  }
  const text = fs.readFileSync(path, "utf8");
  const result = parseIShares(text);
  console.log("Fund holdings as of :", result.asOf);
  console.log("Securities (file says):", result.nSecurities);
  console.log("Holdings read         :", result.holdingsCount);
  console.log("Rows skipped          :", result.skipped);
  console.log("Weights sum to        :", result.totalWeight.toFixed(4) + "%");
  console.log("\nFirst 5 holdings:");
  result.holdings.slice(0, 5).forEach((h) =>
    console.log(
      "  " +
        h.ticker.padEnd(6) +
        h.name.padEnd(26) +
        h.weight.toFixed(3) +
        "%  " +
        h.sector
    )
  );
  console.log("\nLast 3 holdings:");
  result.holdings.slice(-3).forEach((h) =>
    console.log(
      "  " +
        h.ticker.padEnd(6) +
        h.name.padEnd(26) +
        h.weight.toFixed(3) +
        "%  " +
        h.sector
    )
  );
}
