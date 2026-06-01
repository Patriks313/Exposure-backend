const http = require("http");
const { getISharesHoldings, TEST_FUND_URL } = require("./fetch-ishares");
const { prepareFundLookup } = require("./find-ishares-fund");

const server = http.createServer(async (req, res) => {
  // --- Extractor step 1 (semi-automated): prepare a fund lookup ---
  // Shows the operator the iShares search link + ticker cross-check
  // so they can read the fund number once and save it as Provider ref.
  // Test fund: iShares MSCI USA ESG Enhanced (number should be 307528).
  if (req.url.startsWith("/find-fund")) {
    try {
      const info = await prepareFundLookup({
        isin: "IE00BHZPJ890",
        name: "MSCI USA ESG Enhanced",
      });
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
