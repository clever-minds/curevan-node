const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const reconciliationController = require("../controllers/admin/reconciliationController");
const notificationLogController = require("../controllers/admin/notificationLogController");

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

// Notification delivery log & resend (P30: WhatsApp Cloud API & Omnichannel delivery)
router.get(
  "/notification-log",
  authMiddleware,
  requireRole("admin.super"),
  notificationLogController.getNotificationLogs
);

router.post(
  "/notification-log/:id/resend",
  authMiddleware,
  requireRole("admin.super"),
  notificationLogController.resendNotification
);

module.exports = router;
