const http = require("http");
const { getISharesHoldings, TEST_FUND_URL } = require("./fetch-ishares");
const { findISharesFundVerbose } = require("./find-ishares-fund");

const server = http.createServer(async (req, res) => {
  // Special address: find the iShares fund number from an ISIN.
  // Tries a few search engines and reports each. Want 307528.
  if (req.url.startsWith("/find-fund")) {
    const isin = "IE00BHZPJ890"; // the test fund
    try {
      const { fundNumber, report } = await findISharesFundVerbose(isin);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(
        "Find-fund test for " + isin + "\n" +
          "Result: " + (fundNumber ? "FOUND " + fundNumber + " (expected 307528)" : "not found") +
          "\n\n--- per-engine ---\n\n" + report + "\n"
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
