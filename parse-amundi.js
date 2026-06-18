// ============================================================
// Amundi holdings reader  —  fourth provider
// ------------------------------------------------------------
// Takes one Amundi ETF "Fund Holdings" .xlsx and turns it into
// clean holding rows for the Fund Holdings table.
//
// Like SPDR, this is a REAL .xlsx, so it needs the Excel library
// (SheetJS "xlsx"). (openpyxl-style strict readers choke on
// Amundi's non-standard stylesheet; SheetJS reads it fine.)
//
// UNLIKE the other providers, Amundi publishes NO stable download
// URL — the file is built inside the browser. So there is no
// fetch-amundi.js: the .xlsx is uploaded to /store-amundi instead.
//
// File shape (confirmed, LU1940199711, 2026-06-16):
//   one sheet. Column A is a BLANK spacer; everything sits from
//   column B onward.
//   top block (rows ~5-13): "Name of the fund", "ISIN code",
//     "Replication method" (Physical), AUM, currency, and a NOTE
//     line "... Data correct as at DD/MM/YYYY ..." -> we read the
//     as-of date off that note.
//   column header row: blank | "ISIN code" | "Name" |
//     "Asset class" | "Currency" | "Weight" | "Sector" | "Country"
//   data rows: equities (Asset class "EQUITY"), then a single
//     futures line (Asset class "FUTURE", tiny negative weight),
//     then "Source: Amundi..." and several disclaimer paragraphs.
//
// We HAVE an ISIN column (so holding_isin is filled), AND Sector
// and Country columns. Weights are DECIMAL FRACTIONS summing to
// ~1.0 (ASML 0.0607) — like L&G — so we multiply by 100 to store
// a real percent within the fund.
//
// Columns are matched BY HEADER NAME (not fixed positions). Only
// rows whose Asset class is "EQUITY" with a real ISIN, a name and
// a numeric weight are kept — that cleanly drops the futures line,
// the "Source:" line and every disclaimer paragraph.
// ============================================================

const XLSX = require("xlsx");

function parseAmundi(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // --- read the as-of date from the "Data correct as at ..." note ---
  let asOf = "";
  const dateRe = /Data correct as at\s+(\d{2}\/\d{2}\/\d{4})/i;
  for (const r of rows) {
    if (!r) continue;
    for (const cell of r) {
      if (typeof cell === "string") {
        const m = cell.match(dateRe);
        if (m) { asOf = m[1]; break; }
      }
    }
    if (asOf) break;
  }

  // --- find the column-header row (has "ISIN code" and "Weight") ---
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = (rows[i] || []).map((c) => (typeof c === "string" ? c.trim() : c));
    if (r.indexOf("ISIN code") !== -1 && r.indexOf("Weight") !== -1) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error("Amundi reader: holdings header row not found");
  }

  // --- map header names -> column indexes ---
  const hdr = rows[headerIdx];
  const col = {};
  hdr.forEach((name, j) => {
    if (typeof name === "string") col[name.trim()] = j;
  });
  const iISIN = col["ISIN code"];
  const iName = col["Name"];
  const iClass = col["Asset class"];
  const iWeight = col["Weight"];
  const iSector = col["Sector"];
  const iCountry = col["Country"];
  const iCurrency = col["Currency"];
  if (iISIN == null || iName == null || iWeight == null || iClass == null) {
    throw new Error("Amundi reader: expected columns not found in header");
  }

  // --- read holding rows ---
  const holdings = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const assetClass = r[iClass] != null ? String(r[iClass]).trim() : "";
    const isin = r[iISIN] != null ? String(r[iISIN]).trim() : "";
    const name = r[iName] != null ? String(r[iName]).trim() : "";
    const wRaw = parseFloat(r[iWeight]); // decimal fraction (0.0607)

    // keep only real priced equity lines; drops futures, the
    // "Source:" line, blanks and disclaimer paragraphs.
    if (assetClass !== "EQUITY" || !isin || !name || isNaN(wRaw)) {
      skipped++;
      continue;
    }

    holdings.push({
      isin: isin,             // Amundi provides this
      ticker: "",             // non-US fund: no ticker resolve needed
      name: name,
      sector: iSector != null && r[iSector] ? String(r[iSector]).trim() : "",
      weight: wRaw * 100,     // decimal fraction -> percent within fund
      country: iCountry != null && r[iCountry] ? String(r[iCountry]).trim() : "",
      currency:
        iCurrency != null && r[iCurrency] ? String(r[iCurrency]).trim() : "",
    });
  }

  const totalWeight = holdings.reduce((s, h) => s + h.weight, 0);

  return {
    asOf: asOf,
    nSecurities: "",
    holdingsCount: holdings.length,
    totalWeight: totalWeight,
    skipped: skipped,
    holdings: holdings,
  };
}

module.exports = { parseAmundi };

// --- quick self-test: node parse-amundi.js <file.xlsx> ---
if (require.main === module) {
  const fs = require("fs");
  const path = process.argv[2];
  if (!path) {
    console.log("usage: node parse-amundi.js <amundi-xlsx-file>");
    process.exit(1);
  }
  const buffer = fs.readFileSync(path);
  const result = parseAmundi(buffer);
  console.log("Fund holdings as of :", result.asOf);
  console.log("Holdings read       :", result.holdingsCount);
  console.log("Rows skipped        :", result.skipped);
  console.log("Weights sum to      :", result.totalWeight.toFixed(4) + "%");
  console.log("\nFirst 5 holdings:");
  result.holdings.slice(0, 5).forEach((h) =>
    console.log(
      "  " + (h.isin || "------------").padEnd(14) + h.name.padEnd(36) + h.weight.toFixed(4) + "%  " + h.sector
    )
  );
  console.log("\nLast 3 holdings:");
  result.holdings.slice(-3).forEach((h) =>
    console.log(
      "  " + (h.isin || "------------").padEnd(14) + h.name.padEnd(36) + h.weight.toFixed(4) + "%  " + h.sector
    )
  );
}
