// ============================================================
// Database layer  —  talks to the Neon Postgres database
// ------------------------------------------------------------
// Reads the connection string from the DATABASE_URL setting on
// Render (the password never lives in this code).
//
//   ensureTables() — creates the two shared tables if they don't
//                    exist yet. Safe to run as many times as you
//                    like; it never wipes anything.
//   saveFund()     — writes one fund + its holdings (used in the
//                    next step).
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

module.exports = { pool, ensureTables, saveFund };
