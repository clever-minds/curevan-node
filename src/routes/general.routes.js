const express = require("express");
const router = express.Router();

const general = require("../controllers/general/generalController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

router.post( "/audit-logs/add",authMiddleware,responseHandler, general.addAuditLog);
router.post("/payout-items/add",authMiddleware,responseHandler,general.addPayoutItem);
router.get("/payout-items/source/:sourceId",authMiddleware,responseHandler,general.getPayoutItemBySourceId);
router.get("/payout-items/list",authMiddleware,responseHandler,general.listPayoutItems);

router.post("/journal/add",authMiddleware,responseHandler,general.addJournal);
router.get("/journal/get-by-id/:id",authMiddleware,responseHandler,general.getJournalById);
router.get("/journal/list",authMiddleware,responseHandler,general.listJournals);
router.put("/journal/update/:id",authMiddleware,responseHandler,general.updateJournal);
router.delete("/journal/delete/:id",authMiddleware,responseHandler,general.deleteJournal);
router.delete("/journal/delete/:id",authMiddleware,responseHandler,general.deleteJournal);

module.exports = router;   