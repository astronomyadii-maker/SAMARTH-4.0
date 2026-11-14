/* ============================================================
 * VittaSetu backend entry point (PostgreSQL / Supabase version)
 * ============================================================ */

require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is missing. Set it in backend/.env or in Render's Environment.");
  process.exit(1);
}

const db = require("./db"); // needs DATABASE_URL, so it loads after dotenv
const authRoutes = require("./routes/auth");
const transactionRoutes = require("./routes/transactions");
const loanRoutes = require("./routes/loan");
const chatRoutes = require("./routes/chat");
const inventoryRoutes = require("./routes/inventory");

const app = express();
const PORT = process.env.PORT || 5000;

// Render sits behind a proxy. Without this every visitor looks like the same IP to the rate limiter.
app.set("trust proxy", 1);

// The site and the API come from the same address, so CORS only matters for local Live Server testing.
const allowed = [process.env.FRONTEND_URL, "http://localhost:5500", "http://127.0.0.1:5500", "https://localhost", "http://localhost", "capacitor://localhost"].filter(Boolean);
app.use(cors({ origin: allowed }));
app.use(express.json({ limit: "1mb" }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/loan", loanRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/chat", chatLimiter, chatRoutes);

// Render's health check. It also touches the database.
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, service: "vittasetu-backend", db: true });
  } catch (err) {
    res.status(503).json({ ok: false, db: false });
  }
});

// Home page: the site lives in public/html.
app.get("/", (req, res) => res.redirect("/html/index.html"));

const FRONTEND_DIR = path.join(__dirname, "..", "public");
app.use(express.static(FRONTEND_DIR));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// Last stop for errors thrown anywhere above (httpError() messages are safe to show).
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Something went wrong. Please try again." });
});

db.init()
  .then(() => {
    app.listen(PORT, () => console.log("VittaSetu backend running on port " + PORT));
  })
  .catch((err) => {
    console.error("Could not set up the database:", err.message);
    process.exit(1);
  });
