const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const payments = require("../controllers/payments/paymentsController");

// Browser calls this after Razorpay Checkout succeeds; the server re-checks the signature.
router.post("/verify", authMiddleware, payments.verifyPayment);

module.exports = router;
