/* ============================================================
 * PostgreSQL (Supabase) connection + schema.
 * Needs DATABASE_URL. For Supabase use the "Session pooler"
 * connection string (it works from Render, the direct one may not).
 * ============================================================ */

const { Pool, types } = require("pg");

// pg returns BIGINT/NUMERIC as strings and DATE as a Date object.
// Keep them as numbers and "YYYY-MM-DD" strings so the frontend keeps working.
types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT, COUNT(*)
types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC
types.setTypeParser(1082, (v) => v);             // DATE

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is missing. Add it to backend/.env (local) or Render's Environment (live).");
}
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});
pool.on("error", (err) => console.error("Postgres pool error:", err.message));

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id             BIGSERIAL PRIMARY KEY,
    full_name      TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE,
    mobile         TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    dob            DATE NOT NULL,
    business_type  TEXT NOT NULL,
    business_name  TEXT NOT NULL,
    account_type   TEXT NOT NULL,
    address        TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
    amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    category    TEXT NOT NULL DEFAULT 'general',
    note        TEXT,
    txn_date    DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS loan_applications (
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount         NUMERIC(14,2) NOT NULL,
    purpose        TEXT,
    tenure_months  INTEGER NOT NULL,
    interest_rate  NUMERIC(6,2) NOT NULL,
    emi            NUMERIC(14,2) NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    decision_note  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS inventory_items (
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    stock          INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    reorder_level  INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    price          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    last_sale      TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id                 BIGSERIAL PRIMARY KEY,
    user_id            BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id            BIGINT REFERENCES inventory_items(id) ON DELETE SET NULL,
    item_name          TEXT NOT NULL,
    type               TEXT NOT NULL CHECK (type IN ('sale', 'restock', 'adjustment')),
    qty                INTEGER NOT NULL,
    stock_before       INTEGER NOT NULL,
    stock_after        INTEGER NOT NULL,
    passbook_entry_id  BIGINT REFERENCES transactions(id) ON DELETE SET NULL,
    note               TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_name ON inventory_items (user_id, lower(name));
  CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions (user_id, txn_date);
  CREATE INDEX IF NOT EXISTS idx_loans_user ON loan_applications (user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages (user_id);
  CREATE INDEX IF NOT EXISTS idx_items_user ON inventory_items (user_id);
  CREATE INDEX IF NOT EXISTS idx_moves_user ON stock_movements (user_id, id DESC);

  -- Supabase exposes public tables through its own REST API unless RLS is on.
  -- This app talks to Postgres directly, so lock that door.
  ALTER TABLE users             ENABLE ROW LEVEL SECURITY;
  ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE loan_applications ENABLE ROW LEVEL SECURITY;
  ALTER TABLE chat_messages     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE inventory_items   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE stock_movements   ENABLE ROW LEVEL SECURITY;
`;

const query = (text, params) => pool.query(text, params);

// Runs fn(client) inside one transaction: everything saves, or nothing does.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

const init = () => pool.query(SCHEMA);

module.exports = { pool, query, tx, init };
