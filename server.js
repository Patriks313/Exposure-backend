const http = require("http");
const { getISharesHoldings, TEST_FUND_URL } = require("./fetch-ishares");
const { findISharesFund } = require("./find-ishares-fund");
const { exploreScreener } = require("./explore-ishares");

const server = http.createServer(async (req, res) => {
  // Diagnostic: try several screener addresses and report each.
  if (req.url.startsWith("/explore")) {
    try {
      const report = await exploreScreener();
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("iShares screener explorer\n\n" + report);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Explorer failed:\n\n" + err.message + "\n");
    }
    return;
  }

  // Special address: find the iShares fund number from an ISIN.
  // Test with the known fund — should come back as 307528.
  if (req.url.startsWith("/find-fund")) {
    const isin = "IE00BHZPJ890"; // the test fund
    try {
      const { count, hit } = await findISharesFund(isin);
      if (!hit) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(
          "NO MATCH — searched " + count + " funds, none had ISIN " + isin +
            ".\n(The list loaded fine; the ISIN just wasn't in it — maybe a different region list.)\n"
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SUCCESS - found the fund.\n\n" +
          "ISIN          : " + isin + "\n" +
          "Fund number   : " + hit.fundNumber + "  (expected 307528)\n" +
          "Ticker        : " + hit.localExchangeTicker + "\n" +
          "Fund name     : " + hit.fundName + "\n" +
          "Funds in list : " + count + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not find the fund.\n\n" + err.message + "\n");
    }
    return;
  }

  // Special address: go fetch the real iShares file and report back.
  if (req.url === "/test-ishares") {
    try {
      const result = await getISharesHoldings(TEST_FUND_URL);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SUCCESS — iShares file fetched and read.\n\n" +
          "Holdings as of : " + result.asOf + "\n" +
          "Holdings read  : " + result.holdingsCount + "\n" +
          "Rows skipped   : " + result.skipped + "\n" +
          "Weights sum to : " + result.totalWeight.toFixed(2) + "%\n" +
          "First holding  : " + result.holdings[0].name + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED — could not fetch/read the iShares file.\n\n" + err.message + "\n");
    }
    return;
  }

  // Anything else: the normal "alive" reply.
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Exposure backend is alive");
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log("Server running on port " + port);
});
