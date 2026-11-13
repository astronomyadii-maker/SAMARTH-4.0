/* ============================================================
 * /api/loan — EMI calculator and loan applications (PostgreSQL version)
 * ============================================================ */

const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { wrap, httpError } = require("../utils/wrap");

const router = express.Router();
router.use(requireAuth);

const round2 = (n) => Math.round(n * 100) / 100;

function readTerms(body) {
  const principal = Number(body.principal !== undefined ? body.principal : body.amount);
  const rate = Number(body.rate);
  const months = Number(body.tenureMonths);

  if (!Number.isFinite(principal) || principal <= 0 || principal > 100000000) {
    throw httpError(400, "Enter a loan amount between ₹1 and ₹10 crore.");
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 60) {
    throw httpError(400, "Enter an interest rate between 0% and 60%.");
  }
  if (!Number.isInteger(months) || months < 1 || months > 360) {
    throw httpError(400, "Enter a tenure between 1 and 360 months.");
  }
  return { principal, rate, months };
}

function buildSchedule(principal, annualRate, months) {
  const r = annualRate / 12 / 100;
  const emi = r === 0
    ? principal / months
    : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);

  let balance = principal;
  const schedule = [];
  for (let m = 1; m <= months; m++) {
    const interest = balance * r;
    const principalPart = m === months ? balance : emi - interest; // last month clears the balance
    balance = Math.max(0, balance - principalPart);
    schedule.push({
      month: m,
      emi: round2(principalPart + interest),
      principalPortion: round2(principalPart),
      interestPortion: round2(interest),
      balance: round2(balance),
    });
  }
  return {
    emi: round2(emi),
    totalPayment: round2(emi * months),
    totalInterest: round2(emi * months - principal),
    schedule: schedule,
  };
}

/* ---------- POST /api/loan/calculate ---------- */
router.post("/calculate", wrap(async (req, res) => {
  const t = readTerms(req.body || {});
  res.json(buildSchedule(t.principal, t.rate, t.months));
}));

/* ---------- POST /api/loan/apply ---------- */
// Applications are saved as "pending". There is no automatic approval or rejection here.
router.post("/apply", wrap(async (req, res) => {
  const body = req.body || {};
  const t = readTerms(body);
  const calc = buildSchedule(t.principal, t.rate, t.months);
  const purpose = body.purpose ? String(body.purpose).trim().slice(0, 200) : null;
  const note = "Application received. It will be reviewed and you will be contacted.";

  const { rows } = await db.query(
    `INSERT INTO loan_applications (user_id, amount, purpose, tenure_months, interest_rate, emi, status, decision_note)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING id`,
    [req.user.id, t.principal, purpose, t.months, t.rate, calc.emi, note]
  );

  res.status(201).json({ id: rows[0].id, status: "pending", note: note, emi: calc.emi });
}));

module.exports = router;
