/* ============================================================
 * /api/chat — Samarth assistant (OpenRouter + PostgreSQL)
 * Needs OPENROUTER_API_KEY. Optional: OPENROUTER_MODEL, APP_URL.
 * ============================================================ */

const express = require("express");
const fetch = require("node-fetch");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { wrap, httpError } = require("../utils/wrap");

const router = express.Router();
router.use(requireAuth);

const SYSTEM_PROMPT =
  "You are Samarth, the assistant inside VittaSetu, a banking app for small businesses in India. " +
  "Help with passbook entries, loans, EMI, inventory, GST invoices and government schemes. " +
  "Answer briefly in simple language. If the user writes in Hindi or Hinglish, reply the same way. " +
  "Never ask for passwords or OTPs. For final loan or scheme decisions, say the bank or the official site decides.";

const isTurn = (m) =>
  m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim();

/* ---------- POST /api/chat  { message, history } ---------- */
router.post("/", wrap(async (req, res) => {
  const { message, history } = req.body || {};

  if (typeof message !== "string" || !message.trim()) throw httpError(400, "Type a message first.");
  if (message.length > 1000) throw httpError(400, "Message is too long.");
  if (!process.env.OPENROUTER_API_KEY) throw httpError(503, "The assistant is not set up yet.");

  // The frontend already pushes the new message into history, so drop it to avoid sending it twice.
  let past = Array.isArray(history) ? history.filter(isTurn) : [];
  const last = past[past.length - 1];
  if (last && last.role === "user" && last.content === message) past = past.slice(0, -1);
  past = past.slice(-10).map((m) => ({ role: m.role, content: String(m.content).slice(0, 1000) }));

  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...past, { role: "user", content: message.trim() }];

  let data;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      timeout: 25000,
      headers: {
        Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://vittasetu.local",
        "X-Title": "VittaSetu",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
        messages: messages,
        max_tokens: 500,
      }),
    });
    data = await r.json();
    if (!r.ok) {
      console.error("OpenRouter error:", r.status, JSON.stringify(data).slice(0, 300));
      throw new Error("bad status");
    }
  } catch (err) {
    throw httpError(502, "Samarth is not available right now. Please try again in a moment.");
  }

  const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!reply) throw httpError(502, "Samarth did not reply. Please try again.");

  await db.query(
    "INSERT INTO chat_messages (user_id, role, content) VALUES ($1, 'user', $2), ($1, 'assistant', $3)",
    [req.user.id, message.trim(), reply]
  );

  res.json({ reply: reply });
}));

/* ---------- GET /api/chat/history ---------- */
router.get("/history", wrap(async (req, res) => {
  const { rows } = await db.query(
    "SELECT role, content, created_at FROM chat_messages WHERE user_id = $1 ORDER BY id ASC LIMIT 100",
    [req.user.id]
  );
  res.json({ messages: rows });
}));

module.exports = router;