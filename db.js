// ============================================================
// Database layer  —  talks to the Neon Postgres database
// ------------------------------------------------------------
// Reads the connection string from the DATABASE_URL setting on
// Render (the password never lives in this code).
//
//   ensureTables()        — creates the two shared tables if they
//                           don't exist yet. Safe to run any time;
//                           it never wipes anything.
//   saveFund()            — writes one fund + its holdings.
//   getFund()             — reads one fund + its holdings back out.
//   updateHoldingTicker() — fills in the ticker on one holding
//                           (used by the ticker bridge).
//
// Two tables (the two-level shape from the handover, 4.3):
//   fund          — one row per fund
//   fund_holding  — many rows per fund (one per underlying holding)
// ============================================================

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
});

// --- Create the two tables if they aren't there yet ----------
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fund (
      fund_isin    TEXT PRIMARY KEY,
      fund_name    TEXT,
      provider     TEXT,
      provider_ref TEXT,
      file_name    TEXT,
      as_of        TEXT,
      updated_at   TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fund_holding (
      id             SERIAL PRIMARY KEY,
      fund_isin      TEXT REFERENCES fund(fund_isin) ON DELETE CASCADE,
      holding_isin   TEXT,        -- left blank for iShares; filled later
      ticker         TEXT,        -- what the iShares file gives instead
      holding_name   TEXT,
      weight_in_fund DOUBLE PRECISION
    );
  `);
}

// --- Write one fund and its holdings -------------------------
// Replaces any existing holdings for this fund, so re-running a
// fetch gives a clean refresh rather than duplicate rows.
async function saveFund(fund, holdings) {
  await ensureTables();

  await pool.query(
    `INSERT INTO fund (fund_isin, fund_name, provider, provider_ref, file_name, as_of, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (fund_isin) DO UPDATE SET
       fund_name    = EXCLUDED.fund_name,
       provider     = EXCLUDED.provider,
       provider_ref = EXCLUDED.provider_ref,
       file_name    = EXCLUDED.file_name,
       as_of        = EXCLUDED.as_of,
       updated_at   = now()`,
    [fund.isin, fund.name, fund.provider, fund.providerRef, fund.fileName, fund.asOf]
  );

  await pool.query(`DELETE FROM fund_holding WHERE fund_isin = $1`, [fund.isin]);

  for (const h of holdings) {
    await pool.query(
      `INSERT INTO fund_holding (fund_isin, holding_isin, ticker, holding_name, weight_in_fund)
       VALUES ($1, $2, $3, $4, $5)`,
      [fund.isin, h.isin || "", h.ticker || "", h.name, h.weight]
    );
  }
}

// --- Read one fund and its holdings back out -----------------
// Returns { fund, holdings } or null if the fund isn't stored.
async function getFund(isin) {
  const fundRes = await pool.query(`SELECT * FROM fund WHERE fund_isin = $1`, [isin]);
  if (fundRes.rows.length === 0) return null;

  const holdRes = await pool.query(
    `SELECT holding_name, ticker, holding_isin, weight_in_fund
       FROM fund_holding
      WHERE fund_isin = $1
      ORDER BY weight_in_fund DESC`,
    [isin]
  );

  return { fund: fundRes.rows[0], holdings: holdRes.rows };
}

// --- Fill in the ticker on one holding (ticker bridge) -------
// Matches a single holding by its fund + its own ISIN, then writes
// the resolved ticker. Idempotent: running it again just rewrites
// the same value. Leaves everything else untouched.
async function updateHoldingTicker(fundIsin, holdingIsin, ticker) {
  await pool.query(
    `UPDATE fund_holding SET ticker = $3
      WHERE fund_isin = $1 AND holding_isin = $2`,
    [fundIsin, holdingIsin, ticker]
  );
}

module.exports = { pool, ensureTables, saveFund, getFund, updateHoldingTicker };
