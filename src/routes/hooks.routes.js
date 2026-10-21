const express = require("express");
const router = express.Router();
const logistics = require("../controllers/shipment/logisticsWebhookController");

// Courier tracking updates. The path must not contain "shiprocket", "sr", "kr" or "kartrocket" (Shiprocket rejects such URLs).
router.post("/logistics", logistics.receive);

// Masked-call status updates from the telephony provider (duration, final status); refused without the shared token
router.post("/telephony", require("../controllers/communication/maskedCallController").statusWebhook);

module.exports = router;
