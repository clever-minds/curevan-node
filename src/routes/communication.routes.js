const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const maskedCall = require("../controllers/communication/maskedCallController");

// the patient or the therapist of a booking, inside the calling window
router.post("/mask-call", authMiddleware, maskedCall.maskCall);

module.exports = router;
