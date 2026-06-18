// ============================================================
// Xtrackers / DWS holdings reader  —  Extractor step 3 (5th provider)
// ------------------------------------------------------------
// Takes one Xtrackers "constituent" CSV and turns it into clean
// holding rows for the Fund Holdings table.
//
// This file HAS an ISIN column AND a sector column (like SPDR/Amundi),
// so holding_isin and sector are both filled in.
//
// File shape (confirmed, LU0476289540, fetched 2026-06-18):
//   - SEMICOLON-separated (`;`), CRLF line endings, no metadata block.
//   - Header (row 1):
//       ShareClass ISIN; Constituent ISIN; Constituent Name;
//       Constituent Country; Constituent Currency ISO Code;
//       Constituent Weighting; Constituent Rating;
//       Constituent Main Exchange Name;
//       Constituent Industry Classification Name
//   - Data rows: col 0 is the FUND's own ISIN (repeated every row),
//     col 1 is the HOLDING's ISIN, col 2 the name, col 5 the weight.
//   - Weights are DECIMAL fractions summing to ~1.0 -> x100 to get
//     percent within the fund (like L&G / Amundi).
//   - Cash / currency lines have a Constituent ISIN starting with
//     "_CURRENCY" (e.g. _CURRENCYCAD, often a tiny or negative weight);
//     a stray zero-weight duplicate share class can also appear.
//     We drop any row whose ISIN starts with "_" or whose weight <= 0.
//
// The constituent feed carries NO as-of date in the file, so the
// fetcher stamps asOf with the fetch date (see fetch-xtrackers.js).
// ============================================================

function parseXtrackers(fileText) {
  // strip leading byte-order-mark, normalise line endings
  const txt = fileText.replace(/^\uFEFF+/, "").replace(/\r\n/g, "\n");
  const lines = txt.split("\n");

  // --- find the header row ---
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.startsWith("ShareClass ISIN;") &&
      line.includes("Constituent ISIN") &&
      line.includes("Constituent Weighting")
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error("Xtrackers reader: holdings header row not found");
  }

  // --- read holding rows ---
  // Fixed-column split on ";" (security names don't contain semicolons).
  const holdings = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const c = line.split(";");
    if (c.length < 6) {
      skipped++;
      continue;
    }

    const isin = (c[1] || "").trim();
    const name = (c[2] || "").trim();
    const country = (c[3] || "").trim();
    const currency = (c[4] || "").trim();
    const weight = parseFloat(c[5]); // decimal fraction
    const sector = (c[8] || "").trim();

    // drop cash / currency lines (ISIN "_CURRENCY..."), blanks,
    // non-numeric or non-positive weights (zero-weight dupes too).
    if (!isin || isin.startsWith("_") || !name) {
      skipped++;
      continue;
    }
    if (isNaN(weight) || weight <= 0) {
      skipped++;
      continue;
    }

    holdings.push({
      isin: isin, // Xtrackers provides this
      ticker: "", // not in the file
      name: name,
      sector: sector, // Industry Classification Name
      weight: weight * 100, // decimal fraction -> % within fund
      country: country,
      currency: currency,
    });
  }

  const totalWeight = holdings.reduce((s, h) => s + h.weight, 0);

  return {
    asOf: "", // not in the file; stamped by the fetcher
    holdingsCount: holdings.length,
    totalWeight: totalWeight,
    skipped: skipped,
    holdings: holdings,
  };
}

module.exports = { parseXtrackers };

// --- quick self-test: node parse-xtrackers.js <file> ---
if (require.main === module) {
  const fs = require("fs");
  const path = process.argv[2];
  if (!path) {
    console.log("usage: node parse-xtrackers.js <xtrackers-csv-file>");
    process.exit(1);
  }
  const text = fs.readFileSync(path, "utf8");
  const result = parseXtrackers(text);
  console.log("Holdings read  :", result.holdingsCount);
  console.log("Rows skipped   :", result.skipped);
  console.log("Weights sum to :", result.totalWeight.toFixed(4) + "%");
  console.log("\nFirst 5 holdings:");
  result.holdings.slice(0, 5).forEach((h) =>
    console.log(
      "  " + (h.isin || "------------").padEnd(14) + h.name.padEnd(36) +
        h.weight.toFixed(4) + "%  " + h.sector
    )
  );
  console.log("\nLast 3 holdings:");
  result.holdings.slice(-3).forEach((h) =>
    console.log(
      "  " + (h.isin || "------------").padEnd(14) + h.name.padEnd(36) +
        h.weight.toFixed(4) + "%  " + h.sector
    )
  );
}
