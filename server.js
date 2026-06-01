const http = require("http");
const { getISharesHoldings, TEST_FUND_URL } = require("./fetch-ishares");
const { findISharesFund } = require("./find-ishares-fund");

const server = http.createServer(async (req, res) => {
  // Special address: find the iShares fund number from an ISIN.
  // Test with the known fund — should come back as 307528.
  if (req.url.startsWith("/find-fund")) {
    const isin = "IE00BHZPJ890"; // the test fund
    try {
      const r = await findISharesFund(isin);
      if (!r.fundNumber) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(
          "NO MATCH - no iShares fund number found in the search results.\n\n" +
            "ISIN              : " + isin + "\n" +
            "iShares mentions  : " + r.isharesMentions + "\n" +
            "Looks blocked     : " + (r.looksBlocked ? "YES" : "no") + "\n" +
            "Page size         : " + r.bytes + " chars\n"
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "SUCCESS - found the fund.\n\n" +
          "ISIN          : " + isin + "\n" +
          "Fund number   : " + r.fundNumber + "  (expected 307528)\n" +
          "iShares hits  : " + r.isharesMentions + "\n"
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("FAILED - could not run the search.\n\n" + err.message + "\n");
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
