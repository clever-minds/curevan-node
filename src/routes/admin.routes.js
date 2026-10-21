const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const reconciliationController = require("../controllers/admin/reconciliationController");

// Payment reconciliation for super admin and ecom admin
router.get(
  "/reconciliation",
  authMiddleware,
  requireRole("admin.super", "admin.ecom"),
  reconciliationController.getReconciliation
);

// Payment exceptions: pending orders > 30m and failed webhooks
router.get(
  "/payment-exceptions",
  authMiddleware,
  requireRole("admin.super", "admin.ecom"),
  reconciliationController.getPaymentExceptions
);

module.exports = router;
