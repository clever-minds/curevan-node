const express = require("express");
const router = express.Router();

const general = require("../controllers/general/generalController");
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require("../middlewares/responseHandler");

router.post( "/audit-logs/add",authMiddleware,responseHandler, general.addAuditLog);
router.post("/payout-items/add",authMiddleware, requireRole("admin.therapy"),responseHandler,general.addPayoutItem);
router.get("/payout-items/source/:sourceId",authMiddleware, requireRole("admin.therapy", "therapist"),responseHandler,general.getPayoutItemBySourceId);
router.get("/payout-items/list",authMiddleware, requireRole("admin.therapy", "therapist"),responseHandler,general.listPayoutItems);
router.put("/payout-items/:id/state", authMiddleware, requireRole("admin.therapy"), responseHandler, general.updatePayoutState);
router.put("/payout-items/source/:sourceId/state", authMiddleware, requireRole("admin.therapy"), responseHandler, general.updatePayoutStateBySourceId);

// Knowledge Base routes
router.post("/knowledge-base/add",authMiddleware, requireRole("admin.ecom", "admin.therapy", "therapist"),responseHandler,general.addKnowledgeBase);
router.get("/knowledge-base/get-by-id/:id",authMiddleware,responseHandler,general.getKnowledgeBaseById);

router.get("/knowledge-base/list",authMiddleware,responseHandler,general.listKnowledgeBase);
router.get("/knowledge-base/post-get-public",responseHandler,general.listKnowledgeBasepublic);

router.put("/knowledge-base/update/:id",authMiddleware, requireRole("admin.ecom", "admin.therapy", "therapist"),responseHandler,general.updateKnowledgeBase);
router.patch("/knowledge-base/:id/status", authMiddleware, requireRole("admin.therapy"), responseHandler, general.updateKnowledgeBaseStatus);
router.delete("/knowledge-base/delete/:id",authMiddleware, requireRole("admin.therapy"),responseHandler,general.deleteKnowledgeBase);
router.get("/knowledge-base/:slug", responseHandler,general.getKnowledgeBaseBySlug);

module.exports = router;   

