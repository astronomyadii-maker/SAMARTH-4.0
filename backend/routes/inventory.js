/* ============================================================
 * /api/inventory — items, stock movements, sales (PostgreSQL)
 * Every query is filtered by the logged-in user's id.
 * ============================================================ */

const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { wrap, httpError } = require("../utils/wrap");
const { moveStock, recordSale } = require("../utils/stock");

const router = express.Router();
router.use(requireAuth);

const toItem = (r) => ({
  id: r.id,
  name: r.name,
  stock: r.stock,
  reorder: r.reorder_level,
  price: r.price,
  lastSale: r.last_sale,
  updatedAt: r.updated_at,
});

const toMove = (r) => ({
  id: r.id,
  itemId: r.item_id,
  itemName: r.item_name,
  type: r.type,
  qty: r.qty,
  before: r.stock_before,
  after: r.stock_after,
  passbookEntryId: r.passbook_entry_id,
  note: r.note,
  date: r.created_at,
});

const idOf = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw httpError(400, "Invalid item.");
  return n;
};

function readItem(body, requireStock) {
  const name = String(body.name || "").trim();
  if (!name || name.length > 80) throw httpError(400, "Enter an item name (up to 80 characters).");
  const reorder = Number(body.reorder);
  if (!Number.isInteger(reorder) || reorder < 0) throw httpError(400, "Enter a reorder level of 0 or more.");
  const price = body.price === undefined || body.price === "" || body.price === null ? 0 : Number(body.price);
  if (!Number.isFinite(price) || price < 0 || price > 1e9) throw httpError(400, "Cost per unit must be 0 or more.");
  let stock = 0;
  if (requireStock) {
    stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0) throw httpError(400, "Enter an opening stock of 0 or more.");
  }
  return { name, reorder, price, stock };
}

const duplicateName = (err) => {
  if (err.code === "23505") throw httpError(409, "An item with this name already exists.");
  throw err;
};

/* ---------- GET /api/inventory — items + latest movements ---------- */
router.get("/", wrap(async (req, res) => {
  const items = await db.query("SELECT * FROM inventory_items WHERE user_id = $1 ORDER BY lower(name)", [req.user.id]);
  const moves = await db.query("SELECT * FROM stock_movements WHERE user_id = $1 ORDER BY id DESC LIMIT 20", [req.user.id]);
  res.json({ items: items.rows.map(toItem), movements: moves.rows.map(toMove) });
}));

/* ---------- POST /api/inventory/items — new item ---------- */
router.post("/items", wrap(async (req, res) => {
  const d = readItem(req.body || {}, true);
  let item;
  try {
    item = await db.tx(async (c) => {
      const { rows } = await c.query(
        "INSERT INTO inventory_items (user_id, name, stock, reorder_level, price) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [req.user.id, d.name, d.stock, d.reorder, d.price]
      );
      if (d.stock > 0) {
        await c.query(
          `INSERT INTO stock_movements (user_id, item_id, item_name, type, qty, stock_before, stock_after, note)
           VALUES ($1, $2, $3, 'restock', $4, 0, $4, 'Opening stock')`,
          [req.user.id, rows[0].id, d.name, d.stock]
        );
      }
      return rows[0];
    });
  } catch (err) { duplicateName(err); }
  res.status(201).json({ item: toItem(item) });
}));

/* ---------- PUT /api/inventory/items/:id — name, reorder level, price ---------- */
router.put("/items/:id", wrap(async (req, res) => {
  const id = idOf(req.params.id);
  const d = readItem(req.body || {}, false);
  let result;
  try {
    result = await db.query(
      `UPDATE inventory_items SET name = $1, reorder_level = $2, price = $3, updated_at = now()
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [d.name, d.reorder, d.price, id, req.user.id]
    );
  } catch (err) { duplicateName(err); }
  if (!result.rowCount) throw httpError(404, "Item not found.");
  res.json({ item: toItem(result.rows[0]) });
}));

/* ---------- DELETE /api/inventory/items/:id ---------- */
router.delete("/items/:id", wrap(async (req, res) => {
  const result = await db.query("DELETE FROM inventory_items WHERE id = $1 AND user_id = $2", [idOf(req.params.id), req.user.id]);
  if (!result.rowCount) throw httpError(404, "Item not found.");
  res.json({ ok: true });
}));

/* ---------- POST /api/inventory/items/:id/restock  { qty, note } ---------- */
router.post("/items/:id/restock", wrap(async (req, res) => {
  const id = idOf(req.params.id);
  const qty = Number(req.body && req.body.qty);
  if (!Number.isInteger(qty) || qty < 1) throw httpError(400, "Enter a quantity of 1 or more.");
  const note = req.body.note ? String(req.body.note).trim().slice(0, 120) : null;
  const result = await db.tx((c) => moveStock(c, req.user.id, id, qty, "restock", { note }));
  res.json(result);
}));

/* ---------- POST /api/inventory/items/:id/adjust  { count, note } ---------- */
router.post("/items/:id/adjust", wrap(async (req, res) => {
  const id = idOf(req.params.id);
  const count = Number(req.body && req.body.count);
  if (!Number.isInteger(count) || count < 0) throw httpError(400, "Enter a count of 0 or more.");
  const note = req.body.note ? String(req.body.note).trim().slice(0, 120) : null;

  const result = await db.tx(async (c) => {
    const cur = await c.query("SELECT stock FROM inventory_items WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, req.user.id]);
    if (!cur.rowCount) throw httpError(404, "Item not found.");
    const delta = count - cur.rows[0].stock;
    if (delta === 0) throw httpError(400, "The count is the same as the current stock.");
    return moveStock(c, req.user.id, id, delta, "adjustment", { note });
  });
  res.json(result);
}));

/* ---------- POST /api/inventory/sale  { lines: [{ itemId, qty }], passbookEntryId } ---------- */
// For selling stock without creating a new passbook entry. The normal route is
// POST /api/transactions with an "items" list.
router.post("/sale", wrap(async (req, res) => {
  const { lines, passbookEntryId } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) throw httpError(400, "Add at least one item.");

  const result = await db.tx(async (c) => {
    let txnId = null;
    if (passbookEntryId !== undefined && passbookEntryId !== null) {
      txnId = Number(passbookEntryId);
      const own = await c.query("SELECT 1 FROM transactions WHERE id = $1 AND user_id = $2", [txnId, req.user.id]);
      if (!Number.isInteger(txnId) || !own.rowCount) throw httpError(400, "That passbook entry was not found.");
    }
    return recordSale(c, req.user.id, lines, txnId);
  });
  res.json({ results: result });
}));

module.exports = router;
