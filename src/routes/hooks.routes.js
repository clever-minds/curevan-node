const express = require("express");
const router = express.Router();
const logistics = require("../controllers/shipment/logisticsWebhookController");
const whatsapp = require("../controllers/communication/whatsappWebhookController");

// Courier tracking updates. The path must not contain "shiprocket", "sr", "kr" or "kartrocket" (Shiprocket rejects such URLs).
router.post("/logistics", logistics.receive);

// Masked-call status updates from the telephony provider (duration, final status); refused without the shared token
router.post("/telephony", require("../controllers/communication/maskedCallController").statusWebhook);

// WhatsApp Cloud API webhook (verification and updates)
router.get("/whatsapp", whatsapp.verify);
router.post("/whatsapp", whatsapp.receive);

module.exports = router;
