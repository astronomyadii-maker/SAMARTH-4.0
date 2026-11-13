/* VittaSetu — Inventory tracker
 *
 * Two parts in one file:
 *   1. A small data layer, exposed as window.VittaInventory (usable from ANY page).
 *   2. The UI for inventory.html (runs only when that page's elements exist).
 *
 * Storage: this version keeps data in the browser (localStorage) so the page
 * works on its own. To use your real backend, replace load() and save() below
 * with fetch() calls; everything else can stay as it is.
 *
 * From the Passbook page, after a credit (sale) entry is saved:
 *   <script src="inventory.js"></script>
 *   VittaInventory.recordSale([{ itemId: "...", qty: 2 }], passbookEntryId);
 */
(function () {
  "use strict";

  const STORAGE_KEY = "vittasetu.inventory.v1";
  const CHANGE_EVENT = "vittasetu:inventory-changed";
  const MAX_MOVEMENTS = 500;

  /* ================= Helpers ================= */

  const uid = () =>
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const units = (n) => n + " unit" + (n === 1 ? "" : "s");
  const round2 = (n) => Math.round(n * 100) / 100;
  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  const shortDate = (iso) =>
    iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";
  const dateTime = (iso) =>
    new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  // "" -> NaN, "12" -> 12, "1.5" -> NaN
  function toInt(v) {
    if (typeof v === "string" && v.trim() === "") return NaN;
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
  }

  /* ================= Status rules ================= */

  const isOut = (i) => i.stock <= 0;
  const isBelow = (i) => i.stock < i.reorder || i.stock <= 0;
  const statusOf = (i) => (isOut(i) ? "out" : isBelow(i) ? "low" : "ok");

  /* ================= Data layer ================= */

  function seed() {
    const ago = (d) => {
      const t = new Date();
      t.setDate(t.getDate() - d);
      return t.toISOString();
    };
    const now = new Date().toISOString();
    const rows = [
      ["Sugar 1kg", 6, 10, 48, 1],
      ["Cooking oil 1L", 4, 8, 165, 1],
      ["Rice 5kg", 38, 15, 340, 2],
      ["Detergent 500g", 0, 5, 95, 3],
      ["Tea 250g", 52, 20, 130, 1],
    ];
    const s = {
      items: rows.map((r) => ({
        id: uid(),
        name: r[0],
        stock: r[1],
        reorder: r[2],
        price: r[3],
        lastSale: ago(r[4]),
        updatedAt: now,
      })),
      movements: [],
      alerts: [],
    };
    s.items.forEach((i) => syncAlerts(s, i));
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.items)) {
          s.movements = Array.isArray(s.movements) ? s.movements : [];
          s.alerts = Array.isArray(s.alerts) ? s.alerts : [];
          return s;
        }
      }
    } catch (e) {
      /* unreadable or blocked storage: fall through to sample data */
    }
    const s = seed();
    save(s);
    return s;
  }

  function save(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
      /* storage full or blocked: data stays in memory for this visit */
    }
  }

  let state = load();

  function commit() {
    save(state);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }

  const find = (id) => state.items.find((i) => i.id === id);

  // Keeps one "active" alert per item that is below its reorder level.
  function syncAlerts(s, item) {
    const active = s.alerts.find((a) => a.itemId === item.id && a.status === "active");
    const now = new Date().toISOString();
    if (isBelow(item) && !active) {
      s.alerts.push({ id: uid(), itemId: item.id, triggeredAt: now, status: "active", clearedAt: null });
    } else if (!isBelow(item) && active) {
      active.status = "cleared";
      active.clearedAt = now;
    }
  }

  // The one place stock changes. delta < 0 for sales, > 0 for restocks.
  function move(itemId, delta, type, meta) {
    const item = find(itemId);
    if (!item) throw new Error("Item not found.");
    const before = item.stock;
    const after = before + delta;
    if (after < 0) throw new Error("Only " + units(before) + " of " + item.name + " in stock.");

    const now = new Date().toISOString();
    item.stock = after;
    item.updatedAt = now;
    if (type === "sale") item.lastSale = now;

    state.movements.unshift({
      id: uid(),
      itemId: item.id,
      itemName: item.name,
      type: type,
      qty: delta,
      before: before,
      after: after,
      passbookEntryId: (meta && meta.passbookEntryId) || null,
      note: (meta && meta.note) || "",
      date: now,
    });
    if (state.movements.length > MAX_MOVEMENTS) state.movements.length = MAX_MOVEMENTS;

    syncAlerts(state, item);
    return { name: item.name, before: before, after: after, belowReorder: isBelow(item) };
  }

  // Plain-language preview, e.g. for the Passbook form:
  // "Sugar 1kg will drop from 8 → 6 units (below reorder level of 10)"
  function describeImpact(itemId, delta) {
    const item = find(itemId);
    if (!item) return null;
    const before = item.stock;
    const after = before + delta;
    if (after < 0) {
      return { ok: false, before: before, after: after, text: "Only " + units(before) + " of " + item.name + " in stock." };
    }
    let text;
    if (delta === 0) {
      text = item.name + " stays at " + units(before) + ".";
    } else {
      text = item.name + " will " + (delta < 0 ? "drop" : "rise") + " from " + before + " → " + after + " units";
      const willBeBelow = after < item.reorder || after <= 0;
      if (after <= 0) text += " (out of stock)";
      else if (willBeBelow) text += " (below reorder level of " + item.reorder + ")";
      else if (isBelow(item)) text += ". The low-stock alert will clear";
    }
    return { ok: true, before: before, after: after, text: text + "." };
  }

  const api = {
    getItems: () => state.items.map((i) => Object.assign({}, i)),
    getActiveAlerts: () => state.alerts.filter((a) => a.status === "active").map((a) => Object.assign({}, a)),
    describeImpact: describeImpact,

    // Passbook sale: all lines succeed together, or nothing changes.
    recordSale: function (lines, passbookEntryId) {
      const need = new Map();
      (lines || []).forEach(function (l) {
        const qty = Number(l.qty);
        if (!Number.isInteger(qty) || qty < 1) throw new Error("Sale quantity must be a whole number, 1 or more.");
        need.set(l.itemId, (need.get(l.itemId) || 0) + qty);
      });
      need.forEach(function (qty, id) {
        const it = find(id);
        if (!it) throw new Error("Item not found.");
        if (it.stock < qty) throw new Error("Only " + units(it.stock) + " of " + it.name + " in stock.");
      });
      const results = [];
      need.forEach(function (qty, id) {
        results.push(move(id, -qty, "sale", { passbookEntryId: passbookEntryId }));
      });
      commit();
      return results;
    },

    addStock: function (itemId, qty, note) {
      if (!Number.isInteger(qty) || qty < 1) throw new Error("Enter a quantity of 1 or more.");
      const r = move(itemId, qty, "restock", { note: note });
      commit();
      return r;
    },

    adjustStock: function (itemId, newCount, note) {
      const item = find(itemId);
      if (!item) throw new Error("Item not found.");
      if (!Number.isInteger(newCount) || newCount < 0) throw new Error("Enter a count of 0 or more.");
      if (newCount === item.stock) throw new Error("The count is the same as the current stock.");
      const r = move(itemId, newCount - item.stock, "adjustment", { note: note });
      commit();
      return r;
    },

    // Create (no d.id) or edit (d.id) an item.
    saveItem: function (d) {
      const name = String(d.name || "").trim();
      if (!name) throw new Error("Enter an item name.");
      if (!Number.isInteger(d.reorder) || d.reorder < 0) throw new Error("Enter a reorder level of 0 or more.");
      const price = d.price === "" || d.price == null ? 0 : Number(d.price);
      if (!Number.isFinite(price) || price < 0) throw new Error("Cost per unit must be 0 or more.");
      const dup = state.items.some((i) => i.id !== d.id && i.name.toLowerCase() === name.toLowerCase());
      if (dup) throw new Error("An item with this name already exists.");

      const now = new Date().toISOString();
      let item;
      if (d.id) {
        item = find(d.id);
        if (!item) throw new Error("Item not found.");
        item.name = name;
        item.reorder = d.reorder;
        item.price = price;
        item.updatedAt = now;
      } else {
        if (!Number.isInteger(d.stock) || d.stock < 0) throw new Error("Enter an opening stock of 0 or more.");
        item = { id: uid(), name: name, stock: d.stock, reorder: d.reorder, price: price, lastSale: null, updatedAt: now };
        state.items.push(item);
        if (d.stock > 0) {
          state.movements.unshift({
            id: uid(), itemId: item.id, itemName: name, type: "restock", qty: d.stock,
            before: 0, after: d.stock, passbookEntryId: null, note: "Opening stock", date: now,
          });
        }
      }
      syncAlerts(state, item);
      commit();
      return Object.assign({}, item);
    },

    deleteItem: function (id) {
      state.items = state.items.filter((i) => i.id !== id);
      state.alerts = state.alerts.filter((a) => a.itemId !== id);
      commit();
    },

    resetSampleData: function () {
      state = seed();
      commit();
    },
  };

  window.VittaInventory = api;

  // Another tab (e.g. the Passbook) changed the data.
  window.addEventListener("storage", function (e) {
    if (e.key === STORAGE_KEY) {
      state = load();
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }
  });

  /* ================= Page UI ================= */

  // Builds elements safely: text is never parsed as HTML.
  function h(tag, props) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === false || v == null) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      if (arguments[i] != null) node.append(arguments[i]);
    }
    return node;
  }

  function initUI() {
    const $ = (id) => document.getElementById(id);
    let filter = "all";
    let query = "";

    /* ---- Account area (hook into your existing login data if you have it) ---- */
    try {
      const u = JSON.parse(localStorage.getItem("user") || "null");
      if (u && u.name) $("user-name").textContent = u.name;
    } catch (e) { /* keep the default text */ }

    $("logout-btn").addEventListener("click", function () {
      // Uses your site's own logout() if one is already loaded on this page.
      if (typeof window.logout === "function") window.logout();
      else window.location.href = "index.html";
    });

    /* ---- Toast ---- */
    let toastTimer;
    function toast(msg) {
      const t = $("toast");
      t.textContent = msg;
      t.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3200);
    }

    /* ---- Rendering ---- */
    const STATUS_LABEL = { ok: "In stock", low: "Low stock", out: "Out of stock" };
    const TYPE_LABEL = { sale: "Sale", restock: "Restock", adjustment: "Adjustment" };
    const SEVERITY = { out: 0, low: 1, ok: 2 };

    function renderSummary() {
      const items = state.items;
      $("stat-items").textContent = items.length;
      $("stat-low").textContent = items.filter(isBelow).length;
      $("stat-out").textContent = items.filter(isOut).length;
      $("stat-value").textContent = inr.format(round2(items.reduce((s, i) => s + i.stock * i.price, 0)));

      const below = items.filter(isBelow);
      const banner = $("alert-banner");
      banner.hidden = below.length === 0;
      if (below.length) {
        const names = below.slice(0, 5).map((i) => i.name).join(", ") +
          (below.length > 5 ? " and " + (below.length - 5) + " more" : "");
        banner.textContent = below.length + (below.length === 1 ? " item is" : " items are") +
          " below reorder level — " + names;
      }
    }

    function renderStock() {
      const body = $("stock-body");
      body.replaceChildren();
      const q = query.trim().toLowerCase();

      const rows = state.items
        .filter((i) => !q || i.name.toLowerCase().includes(q))
        .filter((i) => filter === "all" || (filter === "below" ? isBelow(i) : isOut(i)))
        .sort((a, b) => SEVERITY[statusOf(a)] - SEVERITY[statusOf(b)] || a.name.localeCompare(b.name));

      if (rows.length === 0) {
        const msg = state.items.length === 0
          ? "No items yet. Add your first item to start tracking stock."
          : "No items match your search.";
        body.append(h("tr", null, h("td", { colspan: "6", class: "empty", text: msg })));
        return;
      }

      rows.forEach(function (i) {
        const st = statusOf(i);
        const edit = h("button", { type: "button", class: "link-btn", "aria-label": "Edit " + i.name, text: "Edit" });
        edit.addEventListener("click", function () { openItemDialog(i); });
        body.append(
          h("tr", null,
            h("td", { class: "col-name", text: i.name }),
            h("td", { class: "num", text: units(i.stock) }),
            h("td", { class: "num", text: units(i.reorder) }),
            h("td", { text: shortDate(i.lastSale) }),
            h("td", null, h("span", { class: "badge badge-" + st, text: STATUS_LABEL[st] })),
            h("td", { class: "col-action" }, edit)
          )
        );
      });
    }

    function renderMovements() {
      const body = $("moves-body");
      body.replaceChildren();
      const rows = state.movements.slice(0, 10);
      if (rows.length === 0) {
        body.append(h("tr", null, h("td", {
          colspan: "6", class: "empty",
          text: "No movements yet. They appear here when you record a sale or add stock.",
        })));
        return;
      }
      rows.forEach(function (m) {
        const sign = m.qty > 0 ? "+" : m.qty < 0 ? "−" : "";
        const note = m.passbookEntryId ? "Passbook entry " + m.passbookEntryId : m.note || "—";
        body.append(
          h("tr", null,
            h("td", { text: dateTime(m.date) }),
            h("td", { class: "col-name", text: m.itemName }),
            h("td", null, h("span", { class: "badge badge-" + m.type, text: TYPE_LABEL[m.type] || m.type })),
            h("td", { class: "mono " + (m.qty > 0 ? "delta-up" : "delta-down"), text: sign + Math.abs(m.qty) }),
            h("td", { class: "mono", text: String(m.after) }),
            h("td", { text: note })
          )
        );
      });
    }

    function render() {
      renderSummary();
      renderStock();
      renderMovements();
      const empty = state.items.length === 0;
      $("add-btn").disabled = empty;
      $("adjust-btn").disabled = empty;
    }

    window.addEventListener(CHANGE_EVENT, render);

    /* ---- Search and filter ---- */
    $("search").addEventListener("input", function (e) {
      query = e.target.value;
      renderStock();
    });

    document.querySelectorAll(".pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        filter = btn.dataset.filter;
        document.querySelectorAll(".pill").forEach(function (b) {
          b.setAttribute("aria-pressed", String(b === btn));
        });
        renderStock();
      });
    });

    /* ---- Dialog plumbing ---- */
    document.querySelectorAll("dialog [data-close]").forEach(function (btn) {
      btn.addEventListener("click", function () { btn.closest("dialog").close(); });
    });

    function fillSelect(select) {
      const keep = select.value;
      select.replaceChildren();
      state.items
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(function (i) { select.append(h("option", { value: i.id, text: i.name })); });
      if (keep && find(keep)) select.value = keep;
    }

    /* ---- Add stock entry ---- */
    const addDlg = $("add-dialog");

    function updateAddImpact() {
      const qty = toInt($("add-qty").value);
      const r = qty > 0 ? describeImpact($("add-item").value, qty) : null;
      $("add-impact").textContent = r ? r.text : "";
    }

    $("add-btn").addEventListener("click", function () {
      fillSelect($("add-item"));
      $("add-qty").value = "";
      $("add-note").value = "";
      $("add-error").textContent = "";
      updateAddImpact();
      addDlg.showModal();
    });
    $("add-item").addEventListener("change", updateAddImpact);
    $("add-qty").addEventListener("input", updateAddImpact);

    $("add-form").addEventListener("submit", function (e) {
      e.preventDefault();
      try {
        const qty = toInt($("add-qty").value);
        const r = api.addStock($("add-item").value, qty, $("add-note").value.trim());
        addDlg.close();
        toast("Added " + units(qty) + " to " + r.name + ".");
      } catch (err) {
        $("add-error").textContent = err.message;
      }
    });

    /* ---- Adjust stock ---- */
    const adjDlg = $("adjust-dialog");

    function syncAdjustCurrent() {
      const it = find($("adjust-item").value);
      $("adjust-current").textContent = it ? "Currently " + units(it.stock) + " in the system." : "";
      if (it) $("adjust-count").value = it.stock;
      updateAdjustImpact();
    }

    function updateAdjustImpact() {
      const it = find($("adjust-item").value);
      const n = toInt($("adjust-count").value);
      const r = it && n >= 0 && n !== it.stock ? describeImpact(it.id, n - it.stock) : null;
      $("adjust-impact").textContent = r ? r.text : "";
    }

    $("adjust-btn").addEventListener("click", function () {
      fillSelect($("adjust-item"));
      $("adjust-note").value = "";
      $("adjust-error").textContent = "";
      syncAdjustCurrent();
      adjDlg.showModal();
    });
    $("adjust-item").addEventListener("change", syncAdjustCurrent);
    $("adjust-count").addEventListener("input", updateAdjustImpact);

    $("adjust-form").addEventListener("submit", function (e) {
      e.preventDefault();
      try {
        const r = api.adjustStock($("adjust-item").value, toInt($("adjust-count").value), $("adjust-note").value.trim());
        adjDlg.close();
        toast(r.name + " is now " + units(r.after) + ".");
      } catch (err) {
        $("adjust-error").textContent = err.message;
      }
    });

    /* ---- New item / edit item ---- */
    const itemDlg = $("item-dialog");
    let editingId = null;

    function openItemDialog(item) {
      editingId = item ? item.id : null;
      $("item-title").textContent = item ? "Edit item" : "New item";
      $("item-name").value = item ? item.name : "";
      $("item-reorder").value = item ? item.reorder : "";
      $("item-price").value = item && item.price ? item.price : "";
      $("item-stock").value = "";
      $("item-stock-field").hidden = !!item;
      $("item-edit-hint").hidden = !item;
      $("item-delete").hidden = !item;
      $("item-error").textContent = "";
      itemDlg.showModal();
    }

    $("new-item-btn").addEventListener("click", function () { openItemDialog(null); });

    $("item-form").addEventListener("submit", function (e) {
      e.preventDefault();
      try {
        const saved = api.saveItem({
          id: editingId,
          name: $("item-name").value,
          reorder: toInt($("item-reorder").value),
          stock: toInt($("item-stock").value),
          price: $("item-price").value.trim(),
        });
        itemDlg.close();
        toast((editingId ? "Saved " : "Added ") + saved.name + ".");
      } catch (err) {
        $("item-error").textContent = err.message;
      }
    });

    $("item-delete").addEventListener("click", function () {
      const it = find(editingId);
      if (it && window.confirm("Delete " + it.name + "? Its stock history stays in the movement log.")) {
        api.deleteItem(editingId);
        itemDlg.close();
        toast("Deleted " + it.name + ".");
      }
    });

    /* ---- Reset ---- */
    $("reset-btn").addEventListener("click", function () {
      if (window.confirm("Replace all inventory data with the sample items?")) {
        api.resetSampleData();
        toast("Sample data restored.");
      }
    });

    render();
  }

  function boot() {
    if (document.getElementById("stock-body")) initUI();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
