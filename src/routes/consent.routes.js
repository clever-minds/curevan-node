const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const consent = require("../controllers/consent/consentController");

// logged-in or anonymous (cookie banner)
router.post("/log", consent.logConsent);
// Super Admin only
router.get("/list", authMiddleware, requireRole(), consent.listConsents);

module.exports = router;
