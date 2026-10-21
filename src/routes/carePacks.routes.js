const express = require("express");
const router = express.Router();
const carePacksController = require("../controllers/carePacks/carePacksController");
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");

// Public / Patient routes
router.get("/plans", carePacksController.listPlans);
router.get("/my-packs", authMiddleware, carePacksController.getMyPacks);
router.post("/purchase/order", authMiddleware, carePacksController.createPurchaseOrder);
router.post("/purchase/verify", authMiddleware, carePacksController.verifyPurchase);
router.get("/:id", authMiddleware, carePacksController.getPackById);

// Admin routes
router.get("/admin/all", authMiddleware, requireRole("admin.super", "admin.therapy", "admin.ecom"), carePacksController.adminListPacks);
router.post("/admin/:id/refund", authMiddleware, requireRole("admin.super", "admin.therapy"), carePacksController.adminRefundPack);
router.post("/admin/plans", authMiddleware, requireRole("admin.super"), carePacksController.adminCreatePlan);
router.put("/admin/plans/:id", authMiddleware, requireRole("admin.super"), carePacksController.adminUpdatePlan);

module.exports = router;
