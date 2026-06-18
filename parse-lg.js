// ============================================================
// L&G holdings reader  —  Extractor step 3 (second provider)
// ------------------------------------------------------------
// Takes one L&G "Fundholdings" CSV and turns it into clean
// holding rows for the Fund Holdings table.
//
// CRUCIAL DIFFERENCE FROM iSHARES: this file HAS an ISIN column.
// So holding_isin is filled in (iShares left it blank).
//
// File shape (confirmed):
//   line 1 : "sep=,"                          -> skip
//   then   : a few metadata lines where label and value run
//            together with no comma, e.g.
//              "Basket NameL&G US ESG ..."
//              "ETF Trading IDIE00BKLWY790"
//              "Basket Trade Date2026-06-16"  -> we read the date
//   header : "Security Description,ISIN,Trading Currency,Constituent Weight (Base)"
//   data   : name, isin, currency, weight   (weight = DECIMAL fraction)
//   footer : a blank line, then a "Cash Component" note, a quoted
//            disclaimer, and "Record Count<N>"  -> stop at first blank
//
// Weights are decimal fractions summing to ~1.0; we store them as
// PERCENT within the fund (x100) to match the iShares reader.
// ============================================================

function parseLG(fileText) {
  // strip leading byte-order-mark, normalise line endings
  const txt = fileText.replace(/^\uFEFF+/, "").replace(/\r\n/g, "\n");
  const lines = txt.split("\n");

  // --- read metadata + find the header row ---
  const meta = {};
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("Basket Trade Date")) {
      meta.asOf = line.slice("Basket Trade Date".length).trim();
    }
    if (
      line.startsWith("Security Description,") &&
      line.includes("ISIN") &&
      line.includes("Constituent Weight")
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error("L&G reader: holdings header row not found");
  }

  // --- read holding rows until the first blank / non-data line ---
  // Each data row is: name, isin, currency, weight.
  // The name MIGHT contain commas, so we peel the last 3 fields off
  // the end (isin, currency, weight never contain commas) and treat
  // everything before them as the name.
  const holdings = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") break; // blank line -> start of footer junk

    const parts = line.split(",");
    if (parts.length < 4) {
      skipped++;
      continue;
    }
    const weight = parseFloat(parts[parts.length - 1]); // decimal fraction
    const currency = parts[parts.length - 2].trim();
    const isin = parts[parts.length - 3].trim();
    const name = parts.slice(0, parts.length - 3).join(",").trim();

    if (isNaN(weight) || !name) {
      skipped++;
      continue;
    }

    holdings.push({
      isin: isin, // L&G provides this
      ticker: "", // not in the L&G file
      name: name,
      sector: "", // not in the L&G file
      weight: weight * 100, // decimal fraction -> % within fund
      country: "", // not in the L&G file
      currency: currency || "",
    });
  }

  // --- pull the file's own Record Count from the footer (sanity) ---
  for (const line of lines) {
    if (line.startsWith("Record Count")) {
      meta.nSecurities = line.slice("Record Count".length).trim();
    }
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

module.exports = { parseLG };

// --- quick self-test when run directly: node parse-lg.js <file> ---
if (require.main === module) {
  const fs = require("fs");
  const path = process.argv[2];
  if (!path) {
    console.log("usage: node parse-lg.js <lg-csv-file>");
    process.exit(1);
  }
  const text = fs.readFileSync(path, "utf8");
  const result = parseLG(text);
  console.log("Fund holdings as of :", result.asOf);
  console.log("Record Count (file) :", result.nSecurities);
  console.log("Holdings read       :", result.holdingsCount);
  console.log("Rows skipped        :", result.skipped);
  console.log("Weights sum to      :", result.totalWeight.toFixed(4) + "%");
  console.log("\nFirst 5 holdings:");
  result.holdings.slice(0, 5).forEach((h) =>
    console.log(
      "  " + (h.isin || "------------").padEnd(14) + h.name.padEnd(36) + h.weight.toFixed(4) + "%"
    )
  );
  console.log("\nLast 3 holdings:");
  result.holdings.slice(-3).forEach((h) =>
    console.log(
      "  " + (h.isin || "------------").padEnd(14) + h.name.padEnd(36) + h.weight.toFixed(4) + "%"
    )
  );
}
