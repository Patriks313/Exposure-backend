const http = require("http");
const { getISharesHoldings, buildISharesUrl, TEST_FUND_URL } = require("./fetch-ishares");
const { prepareFundLookup } = require("./find-ishares-fund");
const { getLGHoldings, buildLGUrl } = require("./fetch-lg");
const { getSPDRHoldings, buildSPDRUrl } = require("./fetch-spdr");
const { getXtrackersHoldings, buildXtrackersUrl } = require("./fetch-xtrackers");
const { getCarnegieHoldings } = require("./fetch-carnegie");
const { parseAmundi } = require("./parse-amundi");
const { ensureTables, saveFund, getFund, updateHoldingTicker } = require("./db");

// ============================================================
// Ticker bridge helper: ISIN -> US-listed ticker (via OpenFIGI)
// ------------------------------------------------------------
// Some funds (L&G) give an ISIN but no ticker; others (iShares)
// give a ticker but no ISIN. To merge a company that sits in BOTH,
// we resolve the ISIN-only side to the SAME ticker the iShares side
// already carries. OpenFIGI maps ISIN -> ticker (never the reverse).
//
// THE GOTCHA: one ISIN returns a long ticker list across many
// exchanges (Adobe: ADBE, ADB, ADBECHF, 4ADBE...). The US one is
// NOT always first. So we pick the row whose exchange is the US
// composite ("US") AND which is common-stock equity. If we can't
// pick exactly one confidently, we leave it blank and let the
// name-cleaner handle that holding instead (no guessing).
// ============================================================
const FIGI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Resolve up to 10 ISINs in one OpenFIGI request (no-key batch limit).
// Returns a Map: isin -> { ticker, candidates }.
async function isinToUsTickerBatch(isins) {
  const jobs = isins.map((isin) => ({ idType: "ID_ISIN", idValue: isin }));
  const res = await fetch("https://api.openfigi.com/v3/mapping", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": FIGI_UA },
    body: JSON.stringify(jobs),
  });
  if (!res.ok) {
    throw new Error("OpenFIGI HTTP " + res.status + " " + res.statusText);
  }
  const data = await res.json(); // array, same order as the jobs we sent
  const out = new Map();
  isins.forEach((isin, i) => {
    const entry = data[i] || {};
    const rows = Array.isArray(entry.data) ? entry.data : [];
    const candidates = [...new Set(rows.map((r) => r.ticker).filter(Boolean))];

    // US-exchange equity rows only.
    const usEquity = rows.filter(
      (r) => r.exchCode === "US" && r.marketSector === "Equity"
    );
    // Prefer common stock if the security type tells us.
    const common = usEquity.filter(
      (r) =>
        (r.securityType2 || r.securityType || "")
          .toLowerCase()
          .indexOf("common") !== -1
    );
    const pickFrom = common.length ? common : usEquity;
    const distinct = [...new Set(pickFrom.map((r) => r.ticker).filter(Boolean))];

    // Confident only if exactly one US ticker remains.
    const ticker = distinct.length === 1 ? distinct[0] : "";
    out.set(isin, { ticker, candidates });
  });
  return out;
}

const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

// Read a request's raw body into a Buffer (used by the Amundi upload
// route — Amundi has no download URL, so its .xlsx is POSTed in).
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // --- Database check: connect to Neon and create the tables ---
  // Visit this once to set up the two shared tables. Safe to
  // re-run any time; it never deletes anything.
  if (req.url === "/db-check") {
    try {
      await ensureTables();
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SUCCESS - database connected and tables are ready.\n\n" +
          "Tables: fund, fund_holding\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not reach the database.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Show a stored fund: read it back OUT of the tables ---
  // Proof the save was real, e.g.:
  //   /show-fund?isin=IE00BHZPJ890
  if (req.url.startsWith("/show-fund")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const isin = (params.get("isin") || "").trim();
      if (!isin) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Please pass a fund ISIN, e.g.\n  /show-fund?isin=IE00BHZPJ890\n");
        return;
      }
      const data = await getFund(isin);
      if (!data) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("No fund stored with ISIN " + isin + "\n");
        return;
      }
      const f = data.fund;
      let totalW = 0;
      let lines = "";
      data.holdings.forEach((h, i) => {
        totalW += h.weight_in_fund || 0;
        lines +=
          String(i + 1).padStart(3) + ". " +
          (h.holding_name || "").padEnd(34) +
          (h.ticker || "").padEnd(8) +
          (h.weight_in_fund || 0).toFixed(3) + "%\n";
      });
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "STORED FUND (read back from the database)\n\n" +
          "Fund            : " + (f.fund_name || "(no name)") + "\n" +
          "Fund ISIN       : " + f.fund_isin + "\n" +
          "Provider        : " + (f.provider || "") + "\n" +
          "Fund number     : " + (f.provider_ref || "") + "\n" +
          "Holdings as of  : " + (f.as_of || "") + "\n" +
          "Holdings stored : " + data.holdings.length + "\n" +
          "Weights sum to  : " + totalW.toFixed(2) + "%\n\n" +
          "Holdings (top to bottom by weight):\n" + lines
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not read the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Hand out a stored fund as clean JSON (for the roll-up) ---
  // Same data as /show-fund, but machine-readable so the frontend
  // roll-up can read it. The Access-Control header lets a browser
  // page (the roll-up) read this from another address. e.g.:
  //   /fund-json?isin=IE00BHZPJ890
  if (req.url.startsWith("/fund-json")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const isin = (params.get("isin") || "").trim();
      if (!isin) {
        res.writeHead(400, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ error: "Please pass a fund ISIN" }));
        return;
      }
      const data = await getFund(isin);
      if (!data) {
        res.writeHead(404, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ error: "No fund stored with ISIN " + isin }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({
          fund: {
            isin: data.fund.fund_isin,
            name: data.fund.fund_name,
            provider: data.fund.provider,
            providerRef: data.fund.provider_ref,
            asOf: data.fund.as_of,
          },
          holdings: data.holdings.map((h) => ({
            isin: h.holding_isin || "",
            ticker: h.ticker || "",
            name: h.holding_name,
            weight: h.weight_in_fund,
          })),
        })
      );
    } catch (err) {
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- Store an iShares fund: fetch + read + WRITE to the tables ---
  // Pass the fund's number + filename (from step 1), plus its ISIN
  // and name (which the file itself doesn't contain), e.g.:
  //   /store-ishares?number=307528
  //     &fileName=iShares-MSCI-USA-CTB-Enhanced-ESG-UCITS-ETF-USD-Dist_fund
  //     &isin=IE00BHZPJ890
  //     &name=iShares MSCI USA ESG Enhanced UCITS ETF
  if (req.url.startsWith("/store-ishares")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const number = (params.get("number") || "").trim();
      const fileName = (params.get("fileName") || "").trim();
      const isin = (params.get("isin") || "").trim();
      const name = (params.get("name") || "").trim();
      if (!number || !fileName || !isin) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Please pass number, fileName and isin (name optional), e.g.\n" +
            "  /store-ishares?number=307528" +
            "&fileName=iShares-MSCI-USA-CTB-Enhanced-ESG-UCITS-ETF-USD-Dist_fund" +
            "&isin=IE00BHZPJ890" +
            "&name=iShares MSCI USA ESG Enhanced UCITS ETF\n"
        );
        return;
      }
      const url = buildISharesUrl(number, fileName);
      const result = await getISharesHoldings(url);
      await saveFund(
        {
          isin: isin,
          name: name,
          provider: "iShares",
          providerRef: number,
          fileName: fileName,
          asOf: result.asOf,
        },
        result.holdings
      );
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SAVED to the database.\n\n" +
          "Fund            : " + (name || "(no name)") + "\n" +
          "Fund ISIN       : " + isin + "\n" +
          "Fund number     : " + number + "\n" +
          "Holdings as of  : " + result.asOf + "\n" +
          "Holdings stored : " + result.holdingsCount + "\n" +
          "Weights sum to  : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding   : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not store the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Store an L&G fund: fetch + read + WRITE to the tables ---
  // L&G needs no fund-number lookup — the holdings file has its own
  // stable "documents-id" URL. Pass that UUID plus the fund's ISIN
  // and name (the file metadata has them, but we keep it explicit
  // like /store-ishares), e.g.:
  //   /store-lg?documentsId=818cf8a4-4320-4ca9-bb43-ef756a35f43a
  //     &isin=IE00BKLWY790
  //     &name=L&G US ESG Paris Aligned UCITS ETF
  if (req.url.startsWith("/store-lg")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const documentsId = (params.get("documentsId") || "").trim();
      const isin = (params.get("isin") || "").trim();
      const name = (params.get("name") || "").trim();
      if (!documentsId || !isin) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Please pass documentsId and isin (name optional), e.g.\n" +
            "  /store-lg?documentsId=818cf8a4-4320-4ca9-bb43-ef756a35f43a" +
            "&isin=IE00BKLWY790" +
            "&name=L&G US ESG Paris Aligned UCITS ETF\n"
        );
        return;
      }
      const url = buildLGUrl(documentsId);
      const result = await getLGHoldings(url);
      await saveFund(
        {
          isin: isin,
          name: name,
          provider: "L&G",
          providerRef: documentsId,
          fileName: "Fundholdings.csv",
          asOf: result.asOf,
        },
        result.holdings
      );
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SAVED to the database.\n\n" +
          "Fund            : " + (name || "(no name)") + "\n" +
          "Fund ISIN       : " + isin + "\n" +
          "Documents ID    : " + documentsId + "\n" +
          "Holdings as of  : " + result.asOf + "\n" +
          "Holdings stored : " + result.holdingsCount + "\n" +
          "Weights sum to  : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding   : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not store the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Store a SPDR / State Street fund: fetch + read + WRITE ---
  // SPDR needs no fund-number lookup — the holdings .xlsx lives at a
  // stable URL built from the fund's own ticker. Pass that ticker plus
  // the fund's ISIN and name (kept explicit, like the other stores),
  // e.g.:
  //   /store-spdr?ticker=sppy
  //     &isin=IE00BH4GPZ28
  //     &name=SPDR S&P 500 Leaders UCITS ETF
  if (req.url.startsWith("/store-spdr")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const ticker = (params.get("ticker") || "").trim();
      const isin = (params.get("isin") || "").trim();
      const name = (params.get("name") || "").trim();
      if (!ticker || !isin) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Please pass ticker and isin (name optional), e.g.\n" +
            "  /store-spdr?ticker=sppy" +
            "&isin=IE00BH4GPZ28" +
            "&name=SPDR S&P 500 Leaders UCITS ETF\n"
        );
        return;
      }
      const url = buildSPDRUrl(ticker);
      const result = await getSPDRHoldings(url);
      await saveFund(
        {
          isin: isin,
          name: name,
          provider: "SPDR",
          providerRef: ticker,
          fileName: "holdings-daily-emea-en-" + ticker.toLowerCase() + "-gy.xlsx",
          asOf: result.asOf,
        },
        result.holdings
      );
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SAVED to the database.\n\n" +
          "Fund            : " + (name || "(no name)") + "\n" +
          "Fund ISIN       : " + isin + "\n" +
          "Ticker          : " + ticker + "\n" +
          "Holdings as of  : " + result.asOf + "\n" +
          "Holdings stored : " + result.holdingsCount + "\n" +
          "Weights sum to  : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding   : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not store the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Store an Xtrackers / DWS fund: fetch + read + WRITE ---
  // The easiest provider yet: no fund-number, UUID or ticker lookup.
  // The holdings CSV lives at a stable URL built from the fund's ISIN
  // alone. Pass the ISIN and (optional) name, e.g.:
  //   /store-xtrackers?isin=LU0476289540
  //     &name=Xtrackers MSCI Canada Screened UCITS ETF
  if (req.url.startsWith("/store-xtrackers")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const isin = (params.get("isin") || "").trim();
      const name = (params.get("name") || "").trim();
      if (!isin) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Please pass an isin (name optional), e.g.\n" +
            "  /store-xtrackers?isin=LU0476289540" +
            "&name=Xtrackers MSCI Canada Screened UCITS ETF\n"
        );
        return;
      }
      const url = buildXtrackersUrl(isin);
      const result = await getXtrackersHoldings(url);
      await saveFund(
        {
          isin: isin,
          name: name,
          provider: "Xtrackers",
          providerRef: isin, // URL is built from the ISIN; no separate ref
          fileName: "constituent-" + isin + ".csv",
          asOf: result.asOf,
        },
        result.holdings
      );
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SAVED to the database.\n\n" +
          "Fund            : " + (name || "(no name)") + "\n" +
          "Fund ISIN       : " + isin + "\n" +
          "Provider        : Xtrackers (DWS)\n" +
          "Holdings as of  : " + result.asOf + "\n" +
          "Holdings stored : " + result.holdingsCount + "\n" +
          "Rows skipped    : " + result.skipped + "\n" +
          "Weights sum to  : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding   : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not store the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Store a Carnegie fund: AUTO-FETCH latest report + read + WRITE ---
  // Carnegie publishes full holdings only inside its bi-annual SICAV
  // report PDFs (no clean data file, no stable single URL). This route
  // is FULLY AUTOMATIC: the server reads Carnegie's document page, finds
  // the newest "Carnegie Investment Fund" report, and reads one sub-fund
  // out of it. Pass the fund ISIN, an optional display name, and the
  // sub-fund's section label as it appears in the report, e.g.:
  //   /store-carnegie?isin=LU2122479103
  //     &name=Carnegie Investment Fund - Svenska Aktier
  //     &section=Svenska Aktier
  // (section defaults to the part of name after the last " - ".)
  if (req.url.startsWith("/store-carnegie")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const isin = (params.get("isin") || "").trim();
      const name = (params.get("name") || "").trim();
      let section = (params.get("section") || "").trim();
      if (!section && name.includes(" - ")) {
        section = name.split(" - ").pop().trim();
      }
      if (!isin || !section) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Please pass an isin and a section (the sub-fund's name in the\n" +
            "Carnegie report). name is optional. Example:\n" +
            "  /store-carnegie?isin=LU2122479103" +
            "&name=Carnegie Investment Fund - Svenska Aktier" +
            "&section=Svenska Aktier\n"
        );
        return;
      }
      const result = await getCarnegieHoldings(section);
      await saveFund(
        {
          isin: isin,
          name: name || "Carnegie Investment Fund - " + section,
          provider: "Carnegie",
          providerRef: isin, // no separate provider ID; report is auto-found
          fileName: result.fileName,
          asOf: result.asOf,
        },
        result.holdings
      );
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SAVED to the database.\n\n" +
          "Fund            : " + (name || "(no name)") + "\n" +
          "Fund ISIN       : " + isin + "\n" +
          "Sub-fund        : " + section + "\n" +
          "Provider        : Carnegie\n" +
          "Source file     : " + result.fileName + "\n" +
          "Holdings as of  : " + result.asOf + "\n" +
          "Holdings stored : " + result.holdingsCount + "\n" +
          "Rows skipped    : " + result.skipped + "\n" +
          "Weights sum to  : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding   : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not store the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Store an Amundi fund: UPLOAD + read + WRITE to the tables ---
  // Amundi publishes NO stable download URL — the holdings .xlsx is
  // built inside the browser. So unlike the other providers, the file
  // is UPLOADED: POST the .xlsx as the request body, with the ISIN
  // (and optional name) in the query string, e.g.:
  //   curl --data-binary @holdings.xlsx \
  //     "<backend>/store-amundi?isin=LU1940199711&name=Amundi MSCI Europe ESG Selection UCITS ETF"
  if (req.url.startsWith("/store-amundi")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const isin = (params.get("isin") || "").trim();
      const name = (params.get("name") || "").trim();
      const fileName =
        (params.get("fileName") || "").trim() || "Fund_Holdings_Amundi.xlsx";
      if (req.method !== "POST" || !isin) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Amundi has no stable download URL, so its holdings .xlsx is UPLOADED.\n" +
            "POST the .xlsx as the request body, with isin in the query string\n" +
            "(name optional), e.g.:\n" +
            "  curl --data-binary @holdings.xlsx \\\n" +
            '    "<backend>/store-amundi?isin=LU1940199711' +
            '&name=Amundi MSCI Europe ESG Selection UCITS ETF"\n'
        );
        return;
      }
      const buffer = await readBody(req);
      // a real .xlsx is a zip — it must start with the "PK" signature.
      if (!buffer || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "FAILED - the POST body is not a .xlsx file (missing PK zip signature).\n" +
            "Send the file with  curl --data-binary @yourfile.xlsx ...\n"
        );
        return;
      }
      const result = parseAmundi(buffer);
      await saveFund(
        {
          isin: isin,
          name: name,
          provider: "Amundi",
          providerRef: isin, // Amundi has no fund-number / UUID / ticker
          fileName: fileName,
          asOf: result.asOf,
        },
        result.holdings
      );
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SAVED to the database.\n\n" +
          "Fund            : " + (name || "(no name)") + "\n" +
          "Fund ISIN       : " + isin + "\n" +
          "Provider        : Amundi (uploaded file)\n" +
          "Holdings as of  : " + result.asOf + "\n" +
          "Holdings stored : " + result.holdingsCount + "\n" +
          "Rows skipped    : " + result.skipped + "\n" +
          "Weights sum to  : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding   : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not store the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Store a MANUAL fund: user-supplied holdings (no fetch, no file) ---
  // Some funds publish no machine-readable holdings we can fetch (e.g. the
  // Swedish active funds). For these the USER reads the holdings off their
  // own broker screen and supplies them by hand. We store ONLY the name and
  // the weight (%) of each holding — never any market value. There is no
  // value field anywhere in this path, so a portfolio's size can never be
  // recorded or reconstructed from what we keep.
  //
  // POST a JSON body, with isin (and optional name / asOf) in the query:
  //   curl -X POST -H "Content-Type: application/json" \
  //     --data @holdings.json \
  //     "<backend>/store-manual?isin=LU2122479103&name=Carnegie Svenska Aktier&asOf=2026-06-21"
  // where holdings.json is:
  //   { "holdings": [ { "name": "Investor B", "weight": 7.86 }, ... ] }
  //
  // Re-running replaces the fund's holdings cleanly (saveFund deletes the
  // old rows first), so this is the normal way to refresh a manual fund.
  if (req.url.startsWith("/store-manual")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const isin = (params.get("isin") || "").trim();
      const name = (params.get("name") || "").trim();
      const asOf = (params.get("asOf") || "").trim();
      if (req.method !== "POST" || !isin) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Manual funds are supplied by hand: POST a JSON body of name+weight\n" +
            "pairs, with isin in the query string (name/asOf optional), e.g.:\n" +
            '  curl -X POST -H "Content-Type: application/json" --data @holdings.json \\\n' +
            '    "<backend>/store-manual?isin=LU2122479103&name=Carnegie Svenska Aktier&asOf=2026-06-21"\n' +
            "  holdings.json = { \"holdings\": [ { \"name\": \"Investor B\", \"weight\": 7.86 }, ... ] }\n" +
            "Only name and weight are stored. Market values are never accepted.\n"
        );
        return;
      }

      const raw = (await readBody(req)).toString("utf8");
      let body;
      try {
        body = JSON.parse(raw);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("FAILED - the POST body is not valid JSON.\n");
        return;
      }

      const list = Array.isArray(body) ? body : body.holdings;
      if (!Array.isArray(list) || list.length === 0) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          'FAILED - expected a "holdings" array of { name, weight } objects.\n'
        );
        return;
      }

      // Keep ONLY name + weight. Any other field (e.g. a value) is ignored
      // and never written, by design.
      const holdings = [];
      let skipped = 0;
      for (const row of list) {
        const hName = (row && row.name ? String(row.name) : "").trim();
        const w = row ? Number(row.weight) : NaN;
        if (!hName || !isFinite(w)) {
          skipped++;
          continue;
        }
        holdings.push({ name: hName, weight: w, isin: "", ticker: "" });
      }

      if (holdings.length === 0) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("FAILED - no usable { name, weight } rows in the body.\n");
        return;
      }

      const totalWeight = holdings.reduce((s, h) => s + h.weight, 0);

      await saveFund(
        {
          isin: isin,
          name: name,
          provider: "Manual (user upload)",
          providerRef: "manual",
          fileName: "",
          asOf: asOf,
        },
        holdings
      );

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SAVED to the database.\n\n" +
          "Fund            : " + (name || "(no name)") + "\n" +
          "Fund ISIN       : " + isin + "\n" +
          "Provider        : Manual (user upload)\n" +
          "Holdings as of  : " + (asOf || "(not given)") + "\n" +
          "Holdings stored : " + holdings.length + "\n" +
          "Rows skipped    : " + skipped + "\n" +
          "Weights sum to  : " + totalWeight.toFixed(2) + "%\n" +
          "First holding   : " + holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not store the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Ticker bridge: fill in US tickers on a stored fund's holdings ---
  // For every holding that has an ISIN but no ticker yet, look up its
  // US-listed ticker via OpenFIGI and (optionally) save it. This lets a
  // company that sits in an ISIN-only fund (L&G) merge with the same
  // company in a ticker-only fund (iShares).
  //
  //   /resolve-tickers?isin=IE00BKLWY790            -> DRY RUN (shows
  //                                                    what it would do)
  //   /resolve-tickers?isin=IE00BKLWY790&write=1    -> save the tickers
  //   ...&max=40                                    -> only the first 40
  //                                                    (handy for a quick
  //                                                    look)
  // Idempotent and safe to re-run. OpenFIGI is rate-limited, so this
  // throttles itself; a full fund can take a couple of minutes.
  if (req.url.startsWith("/resolve-tickers")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const isin = (params.get("isin") || "").trim();
      const write = params.get("write") === "1";
      const max = parseInt(params.get("max") || "0", 10); // 0 = all
      if (!isin) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Please pass a fund ISIN, e.g.\n" +
            "  /resolve-tickers?isin=IE00BKLWY790\n" +
            "Dry run by default. Add &write=1 to save; &max=40 to limit.\n"
        );
        return;
      }
      const data = await getFund(isin);
      if (!data) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("No fund stored with ISIN " + isin + "\n");
        return;
      }

      // Holdings that need a ticker: have their own ISIN, ticker still blank.
      let todo = data.holdings.filter(
        (h) => (h.holding_isin || "").trim() && !(h.ticker || "").trim()
      );
      if (max > 0) todo = todo.slice(0, max);

      let resolved = 0;
      let blank = 0;
      let lines = "";
      const BATCH = 10;
      for (let i = 0; i < todo.length; i += BATCH) {
        const chunk = todo.slice(i, i + BATCH);
        const map = await isinToUsTickerBatch(
          chunk.map((h) => h.holding_isin.trim())
        );
        for (const h of chunk) {
          const r = map.get(h.holding_isin.trim()) || { ticker: "", candidates: [] };
          if (r.ticker) {
            resolved++;
            if (write) {
              await updateHoldingTicker(isin, h.holding_isin.trim(), r.ticker);
            }
            lines += (h.holding_name || "").padEnd(36) + " -> " + r.ticker + "\n";
          } else {
            blank++;
            lines +=
              (h.holding_name || "").padEnd(36) +
              " -> (blank)  candidates: " +
              (r.candidates.join(", ") || "none") + "\n";
          }
        }
        // Stay under OpenFIGI's no-key rate limit (~25 requests/minute).
        if (i + BATCH < todo.length) await sleep(2600);
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        (write
          ? "RESOLVE + WRITE (tickers saved to the database)"
          : "DRY RUN — nothing saved. Add &write=1 to save.") + "\n\n" +
          "Fund                          : " + (data.fund.fund_name || "") +
          " (" + isin + ")\n" +
          "Holdings processed            : " + todo.length + "\n" +
          "Resolved to a US ticker       : " + resolved + "\n" +
          "Left blank (name fallback)    : " + blank + "\n\n" +
          lines
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("resolve-tickers failed:\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Extractor step 1 (semi-automated): prepare a fund lookup ---
  // Shows the operator the iShares search link + ticker cross-check
  // so they can read the fund number once and save it as Provider ref.
  // The fund to look up is passed in the web address, e.g.:
  //   /find-fund?isin=IE00BFNM3L97&name=iShares MSCI Japan ESG Screened
  // Nothing is hardcoded — the fund comes from the request, not the code.
  if (req.url.startsWith("/find-fund")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const isin = (params.get("isin") || "").trim();
      const name = (params.get("name") || "").trim();
      if (!isin && !name) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Please pass a fund to look up, e.g.\n" +
            "  /find-fund?isin=IE00BFNM3L97&name=iShares MSCI Japan ESG Screened\n"
        );
        return;
      }
      const info = await prepareFundLookup({ isin, name });
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "Fund lookup (operator step)\n\n" +
          "ISIN        : " + info.isin + "\n" +
          "Name        : " + info.name + "\n" +
          "Tickers     : " + (info.tickers.join(", ") || "(none)") + "\n\n" +
          "Search link :\n" + info.searchLink + "\n\n" +
          info.instructions + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("find-fund failed:\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Extractor steps 2+3 (general): fetch + read ANY iShares fund ---
  // Pass the fund number + filename read off in step 1, e.g.:
  //   /fetch-ishares?number=305412&fileName=iShares-MSCI-Japan-Screened-UCITS-ETF-USD-Acc_fund
  if (req.url.startsWith("/fetch-ishares")) {
    try {
      const params = new URL(req.url, "http://localhost").searchParams;
      const number = (params.get("number") || "").trim();
      const fileName = (params.get("fileName") || "").trim();
      if (!number || !fileName) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(
          "Please pass a fund number and filename, e.g.\n" +
            "  /fetch-ishares?number=305412&fileName=iShares-MSCI-Japan-Screened-UCITS-ETF-USD-Acc_fund\n"
        );
        return;
      }
      const url = buildISharesUrl(number, fileName);
      const result = await getISharesHoldings(url);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SUCCESS - iShares file fetched and read.\n\n" +
          "Fund number    : " + number + "\n" +
          "Holdings as of : " + result.asOf + "\n" +
          "Holdings read  : " + result.holdingsCount + "\n" +
          "Rows skipped   : " + result.skipped + "\n" +
          "Weights sum to : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding  : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not fetch/read the iShares file.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Extractor steps 2+3 (proven): fetch + read a holdings file ---
  if (req.url === "/test-ishares") {
    try {
      const result = await getISharesHoldings(TEST_FUND_URL);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SUCCESS - iShares file fetched and read.\n\n" +
          "Holdings as of : " + result.asOf + "\n" +
          "Holdings read  : " + result.holdingsCount + "\n" +
          "Rows skipped   : " + result.skipped + "\n" +
          "Weights sum to : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding  : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not fetch/read the iShares file.\n\n" + err.message + "\n");
    }
    return;
  }

  // --- Anything else: the normal "alive" reply ---
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Exposure backend is alive");
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log("Server running on port " + port);
});
