const express = require("express");
const router = express.Router();
const logistics = require("../controllers/shipment/logisticsWebhookController");

// Courier tracking updates. The path must not contain "shiprocket", "sr", "kr" or "kartrocket" (Shiprocket rejects such URLs).
router.post("/logistics", logistics.receive);

module.exports = router;
