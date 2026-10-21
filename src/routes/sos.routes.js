const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const sos = require("../controllers/sos/sosController");

// any logged-in therapist or patient can raise an alert
router.post("/create", authMiddleware, sos.createAlert);
// only the admins who handle emergencies can see and close them
router.get("/list", authMiddleware, requireRole("admin.therapy"), sos.listAlerts);
router.post("/resolve", authMiddleware, requireRole("admin.therapy"), sos.resolveAlert);

module.exports = router;
