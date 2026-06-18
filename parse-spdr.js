// ============================================================
// SPDR / State Street holdings reader  —  third provider
// ------------------------------------------------------------
// Takes one SSGA "holdings-daily" .xlsx and turns it into clean
// holding rows for the Fund Holdings table.
//
// UNLIKE iShares/L&G (plain text), this is a REAL .xlsx (modern
// Office Open XML), so it needs an Excel library (SheetJS "xlsx").
//
// File shape (confirmed, SPPY 2026-06-17):
//   one sheet ("holdings"), 11 columns.
//   rows 0-3 : fund info, label in col A, value in col B:
//                "Fund Name:"  / "ISIN:" / "Ticker Symbol:"
//                "Holdings As Of:"  -> we read the date off this
//   row 4    : blank
//   row 5    : column header row:
//                ISIN | SEDOL | Security Name | Currency |
//                Number of Shares | Percent of Fund |
//                Trade Country Name | Local Price |
//                Sector Classification | Industry Classification |
//                Base Market Value
//   rows 6+  : data. Equities first, then a futures line and two
//              cash lines (Euro, U.S. Dollar) whose ISIN reads
//              "Unassigned" and whose Percent of Fund is "-".
//   last     : a blank row, then a legal disclaimer paragraph.
//
// We HAVE an ISIN column (so holding_isin is filled), AND a Sector
// column. Weights are ALREADY real percentages (NVIDIA ~12, summing
// to 100) — NOT decimal fractions like L&G — so we store them as-is.
//
// Columns are matched BY HEADER NAME (not fixed positions), so a
// future column reorder won't break the reader. Any row without a
// real ISIN, a name, and a numeric weight is skipped — that quietly
// drops the cash/futures lines, the blank row and the disclaimer.
// ============================================================

const XLSX = require("xlsx");

function parseSPDR(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // array-of-arrays, blank cells as null
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // --- read the as-of date from the top fund-info block ---
  const meta = {};
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const label = rows[i] && rows[i][0];
    if (typeof label === "string" && label.startsWith("Holdings As Of")) {
      meta.asOf = String(rows[i][1] || "").trim();
    }
  }

  // --- find the column-header row (first cell "ISIN") ---
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r[0] === "ISIN" && r.indexOf("Percent of Fund") !== -1) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error("SPDR reader: holdings header row not found");
  }

  // --- map header names -> column indexes ---
  const hdr = rows[headerIdx];
  const col = {};
  hdr.forEach((name, j) => {
    if (typeof name === "string") col[name.trim()] = j;
  });
  const iISIN = col["ISIN"];
  const iName = col["Security Name"];
  const iWeight = col["Percent of Fund"];
  const iSector = col["Sector Classification"];
  const iCountry = col["Trade Country Name"];
  const iCurrency = col["Currency"];
  if (iISIN == null || iName == null || iWeight == null) {
    throw new Error("SPDR reader: expected columns not found in header");
  }

  // --- read holding rows ---
  const holdings = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const isin = r[iISIN];
    const name = r[iName];
    const weight = parseFloat(r[iWeight]); // already a percentage

    // skip anything that isn't a real priced holding:
    // cash/futures (isin "Unassigned", weight "-"), blanks, disclaimer.
    if (
      !isin ||
      String(isin).trim() === "Unassigned" ||
      !name ||
      isNaN(weight)
    ) {
      skipped++;
      continue;
    }

    holdings.push({
      isin: String(isin).trim(), // SPDR provides this
      ticker: "", // resolved later on the backend (US fund)
      name: String(name).trim(),
      sector: iSector != null && r[iSector] ? String(r[iSector]).trim() : "",
      weight: weight, // already % within fund — stored as-is
      country: iCountry != null && r[iCountry] ? String(r[iCountry]).trim() : "",
      currency:
        iCurrency != null && r[iCurrency] ? String(r[iCurrency]).trim() : "",
    });
  }

  const totalWeight = holdings.reduce((s, h) => s + h.weight, 0);

  return {
    asOf: meta.asOf || "",
    nSecurities: "", // SPDR file carries no record-count line
    holdingsCount: holdings.length,
    totalWeight: totalWeight,
    skipped: skipped,
    holdings: holdings,
  };
}

module.exports = { parseSPDR };

// --- quick self-test: node parse-spdr.js <file.xlsx> ---
if (require.main === module) {
  const fs = require("fs");
  const path = process.argv[2];
  if (!path) {
    console.log("usage: node parse-spdr.js <spdr-xlsx-file>");
    process.exit(1);
  }
  const buffer = fs.readFileSync(path);
  const result = parseSPDR(buffer);
  console.log("Fund holdings as of :", result.asOf);
  console.log("Holdings read       :", result.holdingsCount);
  console.log("Rows skipped        :", result.skipped);
  console.log("Weights sum to      :", result.totalWeight.toFixed(4) + "%");
  console.log("\nFirst 5 holdings:");
  result.holdings.slice(0, 5).forEach((h) =>
    console.log(
      "  " + (h.isin || "------------").padEnd(14) + h.name.padEnd(40) + h.weight.toFixed(4) + "%"
    )
  );
  console.log("\nLast 3 holdings:");
  result.holdings.slice(-3).forEach((h) =>
    console.log(
      "  " + (h.isin || "------------").padEnd(14) + h.name.padEnd(40) + h.weight.toFixed(4) + "%"
    )
  );
}
