/**
 * Thin Razorpay wrapper. Secrets come from the environment only:
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (and RAZORPAY_WEBHOOK_SECRET for webhooks, P08).
 * The SDK client is created lazily so the server still boots when keys are not configured.
 */
const crypto = require("crypto");

let client = null;
function getClient() {
  if (!client) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
    }
    const Razorpay = require("razorpay");
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return client;
}

const getKeyId = () => process.env.RAZORPAY_KEY_ID || "";

// amountPaise must be an integer number of paise.
async function createOrder(amountPaise, receipt, notes = {}) {
  if (!Number.isInteger(amountPaise) || amountPaise < 100) {
    throw new Error("Invalid payment amount");
  }
  return getClient().orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: String(receipt).slice(0, 40),
    notes,
  });
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// HMAC-SHA256 of "order_id|payment_id" with the key secret, compared in constant time.
function verifyPaymentSignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

module.exports = { createOrder, verifyPaymentSignature, getKeyId, safeEqualHex };
