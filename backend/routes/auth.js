/* ============================================================
 * /api/auth — signup, login, current-user (PostgreSQL version)
 * ============================================================ */

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { wrap, httpError } = require("../utils/wrap");
const {
  isValidEmail,
  isValidMobile,
  checkPasswordStrength,
  isAdult,
  VALID_BUSINESS_TYPES,
  VALID_ACCOUNT_TYPES,
} = require("../utils/validators");

const router = express.Router();

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    dob: row.dob,
    businessType: row.business_type,
    businessName: row.business_name,
    accountType: row.account_type,
    address: row.address,
    createdAt: row.created_at,
  };
}

/* ---------- POST /api/auth/signup ---------- */
router.post("/signup", wrap(async (req, res) => {
  const {
    fullName, email, mobile, password, dob,
    businessType, businessName, accountType, address,
  } = req.body || {};

  const errors = {};

  if (!fullName || fullName.trim().length < 3) errors.fullName = "Enter your full name.";
  if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
  if (!isValidMobile(mobile)) errors.mobile = "Enter a valid 10-digit mobile number.";
  if (!dob || !isAdult(dob)) errors.dob = "You must be 18 or older to open an account.";

  const pwCheck = checkPasswordStrength(password);
  if (!pwCheck.valid) errors.password = "Password needs " + pwCheck.reasons.join(", ") + ".";

  if (!VALID_BUSINESS_TYPES.includes(businessType)) errors.businessType = "Select a valid business type.";
  if (!businessName || businessName.trim().length < 2) errors.businessName = "Enter your business name.";
  if (!VALID_ACCOUNT_TYPES.includes(accountType)) errors.accountType = "Select a valid account type.";
  if (!address || address.trim().length < 8) errors.address = "Enter your registered address.";

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  }

  // Check with the same cleaned-up values we store, so "A@x.com" and "a@x.com" are one account.
  const emailN = email.trim().toLowerCase();
  const mobileN = mobile.trim();

  const existing = await db.query("SELECT 1 FROM users WHERE email = $1 OR mobile = $2", [emailN, mobileN]);
  if (existing.rowCount) {
    throw httpError(409, "An account with this email or mobile number already exists.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let user;
  try {
    const result = await db.query(
      `INSERT INTO users (full_name, email, mobile, password_hash, dob, business_type, business_name, account_type, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [fullName.trim(), emailN, mobileN, passwordHash, dob, businessType, businessName.trim(), accountType, address.trim()]
    );
    user = result.rows[0];
  } catch (err) {
    // Two signups at the same moment can both pass the check above.
    if (err.code === "23505") throw httpError(409, "An account with this email or mobile number already exists.");
    throw err;
  }

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

/* ---------- POST /api/auth/login ---------- */
router.post("/login", wrap(async (req, res) => {
  const { loginId, password } = req.body || {};

  if (!loginId || !password) {
    throw httpError(400, "Enter your email/mobile and password.");
  }

  const id = String(loginId).trim();
  const { rows } = await db.query("SELECT * FROM users WHERE email = $1 OR mobile = $2", [id.toLowerCase(), id]);
  const user = rows[0];

  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    throw httpError(401, "Incorrect email/mobile or password.");
  }

  res.json({ token: signToken(user), user: publicUser(user) });
}));

/* ---------- GET /api/auth/me ---------- */
router.get("/me", requireAuth, wrap(async (req, res) => {
  const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
  if (!rows[0]) throw httpError(404, "User not found.");
  res.json({ user: publicUser(rows[0]) });
}));

module.exports = router;
