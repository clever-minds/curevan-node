const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const payouts = require("../controllers/payouts/payoutsController");

// lists and statements: admins see all, a therapist only their own (checked inside)
router.get("/list", authMiddleware, requireRole("therapist", "admin.therapy", "admin.super"), payouts.list);
router.get("/export.csv", authMiddleware, requireRole("admin.therapy", "admin.super"), payouts.exportCsv);   // above /:id
router.get("/:id/statement.pdf", authMiddleware, requireRole("therapist", "admin.therapy", "admin.super"), payouts.statementPdf);
router.get("/:id", authMiddleware, requireRole("therapist", "admin.therapy", "admin.super"), payouts.get);

// money decisions: approving and marking paid is the Super Admin's; holding and releasing is for both clinical admins
router.post("/:id/approve", authMiddleware, requireRole("admin.super"), payouts.approve);
router.post("/:id/mark-paid", authMiddleware, requireRole("admin.super"), payouts.markPaid);
router.post("/:id/hold", authMiddleware, requireRole("admin.therapy", "admin.super"), payouts.hold);
router.post("/:id/release", authMiddleware, requireRole("admin.therapy", "admin.super"), payouts.release);

module.exports = router;
