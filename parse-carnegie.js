// ============================================================
// Carnegie holdings reader  —  Extractor step 3 (6th provider)
// ------------------------------------------------------------
// Takes one Carnegie SICAV report PDF (semi-annual or annual) and
// pulls out ONE sub-fund's "Securities portfolio" holdings.
//
// Why a PDF reader: Carnegie publishes full holdings only inside its
// bi-annual SICAV reports (no clean data file). One report PDF holds
// SEVERAL sub-funds, so we scope to the one page-block whose title is
// the sub-fund we want (e.g. "Svenska Aktier").
//
// File shape (confirmed, Carnegie Investment Fund semi-annual,
// "as at 30/06/25"):
//   - Each sub-fund has its own page: title "Carnegie Investment
//     Fund - <sub-fund>", then "Securities portfolio as at DD/MM/YY",
//     then a table grouped by country.
//   - Each holding prints as two text lines that share a row visually
//     but sit on slightly different baselines, so we rebuild lines by
//     their y-position. The numbers line is:  SEK | <qty> | <market
//     value> | <% of net assets>  and the very next line is the
//     company NAME.
//   - The last number on a holding line is the % of net assets, which
//     is ALREADY a real percent within the fund (like SPDR) -> stored
//     as-is, no x100. Country/section subtotal lines (e.g. "Sweden")
//     are skipped (no "SEK", no quantity).
//   - NO ISIN column and NO ticker column -> holding_isin and ticker
//     are left blank; companies merge by cleaned name (like iShares).
//
// Pure JS (pdfjs-dist) -> runs on Render with no system binaries.
// ============================================================

let _pdfjs;
async function pdfjs() {
  if (!_pdfjs) _pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return _pdfjs;
}

// Group a page's text items into visual lines by rounded y-position,
// each line's cells left-to-right by x.
function pageLines(items) {
  const byY = {};
  for (const it of items) {
    if (!it.str || it.str.trim() === "") continue;
    const y = Math.round(it.transform[5]);
    (byY[y] = byY[y] || []).push({ x: it.transform[4], s: it.str });
  }
  return Object.keys(byY)
    .map(Number)
    .sort((a, b) => b - a) // top of page first
    .map((y) => {
      const sorted = byY[y].sort((a, b) => a.x - b.x).map((o) => o.s);
      return {
        cells: sorted.map((s) => s.trim()).filter(Boolean),
        text: sorted.join(" ").replace(/\s+/g, " ").trim(), // spaced (names)
      };
    });
}

async function openDoc(buffer) {
  const { getDocument } = await pdfjs();
  return await getDocument({ data: new Uint8Array(buffer) }).promise;
}

// Read the report's "as at DD/MM/YY(YY)" date from the first few pages.
// Returns YYYY-MM-DD or "".
async function readReportDate(buffer) {
  const doc = await openDoc(buffer);
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const t = tc.items.map((i) => i.str).join(" ").replace(/\s+/g, " ");
    const m = t.match(/as at\s*(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{2,4})/i);
    if (m) {
      let [, dd, mm, yy] = m;
      if (yy.length === 2) yy = "20" + yy;
      return `${yy}-${mm}-${dd}`;
    }
  }
  return "";
}

const COUNTRIES =
  /^(Finland|Sweden|Norway|Denmark|Iceland|Switzerland|United Kingdom|United States|Germany|France|Netherlands|Ireland|Luxembourg|Belgium|Italy|Spain|Austria|Portugal|Poland|Canada|Japan)$/i;
const isNum = (s) => /^-?[\d,]+(\.\d+)?$/.test(s || "");
const OTHER_FUND = /Nordic|Global|Alternativ|All Cap|Beta|Utl(a|ä)ndsk|R(a|ä)nte|H(o|ö)gr(a|ä)nte/i;

// Pull one sub-fund's holdings out of a Carnegie report PDF.
async function parseCarnegie(buffer, sectionLabel) {
  const doc = await openDoc(buffer);
  const asOf = await readReportDateFromDoc(doc);
  const reFund = new RegExp(
    sectionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "i"
  );

  const holdings = [];
  let skipped = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const L = pageLines((await (await doc.getPage(p)).getTextContent()).items);
    const top = L.slice(0, 8).map((l) => l.text).join(" ");

    // Only this sub-fund's own securities-portfolio page.
    if (!/Securities portfolio as at/i.test(top)) continue;
    if (!reFund.test(top)) continue;
    if (OTHER_FUND.test(top)) continue; // skip the contents index / other funds

    for (let i = 0; i < L.length; i++) {
      const c = L[i].cells;
      if (c[0] !== "SEK") continue; // a holding's numbers line starts with the currency
      const pct = parseFloat((c[c.length - 1] || "").replace(/,/g, ""));
      // company name = the next text-only line (no currency, not a number,
      // not a country/section label).
      let name = null;
      for (let j = i + 1; j < L.length; j++) {
        const t = L[j].text;
        const c0 = L[j].cells[0] || "";
        if (c0 === "SEK") break;
        if (
          t &&
          !isNum(c0) &&
          !COUNTRIES.test(t) &&
          !/^(Shares|Total|Transferable|Securities)/i.test(t)
        ) {
          name = t;
          break;
        }
      }
      if (name && !isNaN(pct) && pct > 0) {
        // tidy: rebuilt-from-cells names can gain spaces around hyphens
        // ("ABB LTD - REG"); collapse back to the printed form ("ABB LTD-REG").
        name = name.replace(/\s+/g, " ").replace(/\s*-\s*/g, "-").trim();
        holdings.push({ isin: "", ticker: "", name: name, weight: pct });
      } else {
        skipped++;
      }
    }
  }

  const totalWeight = holdings.reduce((s, h) => s + h.weight, 0);
  return {
    asOf: asOf,
    holdingsCount: holdings.length,
    totalWeight: totalWeight,
    skipped: skipped,
    holdings: holdings,
  };
}

// (internal) same date read but reusing an already-open doc
async function readReportDateFromDoc(doc) {
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const t = tc.items.map((i) => i.str).join(" ").replace(/\s+/g, " ");
    const m = t.match(/as at\s*(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{2,4})/i);
    if (m) {
      let [, dd, mm, yy] = m;
      if (yy.length === 2) yy = "20" + yy;
      return `${yy}-${mm}-${dd}`;
    }
  }
  return "";
}

module.exports = { parseCarnegie, readReportDate };
