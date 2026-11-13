/* ============================================================
 * /api/transactions — the passbook (PostgreSQL version)
 * A credit entry can also carry sold items, which reduces stock
 * in the same database transaction.
 * ============================================================ */

const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { wrap, httpError } = require("../utils/wrap");
const { recordSale } = require("../utils/stock");

const router = express.Router();
router.use(requireAuth);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

const toTxn = (r) => ({
  id: r.id,
  type: r.type,
  amount: r.amount,
  category: r.category,
  note: r.note,
  date: r.txn_date,
});

/* ---------- GET /api/transactions/summary ---------- */
router.get("/summary", wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance,
       COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS credit,
       COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0)  AS debit,
       COUNT(*) AS count
     FROM transactions WHERE user_id = $1`,
    [req.user.id]
  );
  const r = rows[0];
  res.json({ balance: r.balance, totalCredit: r.credit, totalDebit: r.debit, count: r.count });
}));

/* ---------- GET /api/transactions?type=credit|debit ---------- */
router.get("/", wrap(async (req, res) => {
  const params = [req.user.id];
  let where = "user_id = $1";
  if (req.query.type === "credit" || req.query.type === "debit") {
    params.push(req.query.type);
    where += " AND type = $2";
  }
  const { rows } = await db.query(
    "SELECT * FROM transactions WHERE " + where + " ORDER BY txn_date DESC, id DESC LIMIT 1000",
    params
  );
  res.json({ transactions: rows.map(toTxn) });
}));

/* ---------- POST /api/transactions ---------- */
// body: { type, amount, category, note, date, items?: [{ itemId, qty }] }
router.post("/", wrap(async (req, res) => {
  const { type, amount, category, note, date, items } = req.body || {};

  if (type !== "credit" && type !== "debit") throw httpError(400, "Choose credit or debit.");
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1e11) throw httpError(400, "Enter an amount greater than zero.");

  const when = date ? String(date) : new Date().toISOString().slice(0, 10);
  if (!isDate(when)) throw httpError(400, "Enter a valid date.");

  const cat = String(category || "general").trim().slice(0, 50) || "general";
  const memo = note ? String(note).trim().slice(0, 200) : null;
  const lines = type === "credit" && Array.isArray(items) ? items : [];

  const out = await db.tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO transactions (user_id, type, amount, category, note, txn_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, type, amt, cat, memo, when]
    );
    const stock = lines.length ? await recordSale(c, req.user.id, lines, rows[0].id) : [];
    return { row: rows[0], stock: stock };
  });

  res.status(201).json({ transaction: toTxn(out.row), stock: out.stock });
}));

/* ---------- DELETE /api/transactions/:id ---------- */
// Deleting a sale entry does not put the stock back. Use Adjust stock for that.
router.delete("/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw httpError(400, "Invalid entry.");
  const result = await db.query("DELETE FROM transactions WHERE id = $1 AND user_id = $2", [id, req.user.id]);
  if (!result.rowCount) throw httpError(404, "Entry not found.");
  res.json({ ok: true });
}));

module.exports = router;
