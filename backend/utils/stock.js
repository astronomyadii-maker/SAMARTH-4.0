/* Stock changes. Always call these inside db.tx() so a failed sale rolls back fully. */

const { httpError } = require("./wrap");

// Changes one item's stock by `delta` (negative = sale) and logs the movement.
// The row is locked first, so two sales at the same moment cannot both pass the stock check.
async function moveStock(c, userId, itemId, delta, type, meta) {
  const { note = null, txnId = null } = meta || {};

  const sel = await c.query(
    "SELECT id, name, stock, reorder_level FROM inventory_items WHERE id = $1 AND user_id = $2 FOR UPDATE",
    [itemId, userId]
  );
  if (!sel.rowCount) throw httpError(404, "Item not found.");

  const item = sel.rows[0];
  const after = item.stock + delta;
  if (after < 0) throw httpError(409, "Only " + item.stock + " unit(s) of " + item.name + " in stock.");

  await c.query(
    "UPDATE inventory_items SET stock = $1, updated_at = now()" + (type === "sale" ? ", last_sale = now()" : "") + " WHERE id = $2",
    [after, itemId]
  );
  await c.query(
    `INSERT INTO stock_movements (user_id, item_id, item_name, type, qty, stock_before, stock_after, passbook_entry_id, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, itemId, item.name, type, delta, item.stock, after, txnId, note]
  );

  return { id: item.id, name: item.name, before: item.stock, after: after, belowReorder: after < item.reorder_level || after <= 0 };
}

// lines: [{ itemId, qty }]. All lines succeed together or the whole sale fails.
async function recordSale(c, userId, lines, txnId) {
  const need = new Map();
  for (const l of lines) {
    const id = Number(l && l.itemId);
    const qty = Number(l && l.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1) {
      throw httpError(400, "Each sold item needs an item and a whole quantity of 1 or more.");
    }
    need.set(id, (need.get(id) || 0) + qty);
  }
  const results = [];
  // Fixed order avoids deadlocks when two sales touch the same items.
  for (const id of [...need.keys()].sort((a, b) => a - b)) {
    results.push(await moveStock(c, userId, id, -need.get(id), "sale", { txnId: txnId }));
  }
  return results;
}

module.exports = { moveStock, recordSale };
