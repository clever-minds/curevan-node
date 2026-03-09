const express = require("express");
const router = express.Router();

const general = require("../controllers/general/generalController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

router.post( "/audit-logs/add",authMiddleware,responseHandler, general.addAuditLog);
router.post("/payout-items/add",authMiddleware,responseHandler,general.addPayoutItem);
router.get("/payout-items/source/:sourceId",authMiddleware,responseHandler,general.getPayoutItemBySourceId);
router.get("/payout-items/list",authMiddleware,responseHandler,general.listPayoutItems);

// Knowledge Base routes
router.post("/knowledge-base/add",authMiddleware,responseHandler,general.addKnowledgeBase);
router.get("/knowledge-base/get-by-id/:id",authMiddleware,responseHandler,general.getKnowledgeBaseById);
router.get("/knowledge-base/list",authMiddleware,responseHandler,general.listKnowledgeBase);
router.put("/knowledge-base/update/:id",authMiddleware,responseHandler,general.updateKnowledgeBase);
router.delete("/knowledge-base/delete/:id",authMiddleware,responseHandler,general.deleteKnowledgeBase);

module.exports = router;   