const http = require("http");
const { getISharesHoldings, buildISharesUrl, TEST_FUND_URL } = require("./fetch-ishares");
const { prepareFundLookup } = require("./find-ishares-fund");
const { ensureTables } = require("./db");

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
