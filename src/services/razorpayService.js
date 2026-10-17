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

// Razorpay signs the RAW webhook body with the webhook secret (set in the Razorpay dashboard).
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

// Refund (all or part) of a captured payment. Amount in paise.
async function refund(paymentId, amountPaise, notes = {}) {
  if (!paymentId) throw new Error("paymentId is required");
  if (!Number.isInteger(amountPaise) || amountPaise < 100) throw new Error("Invalid refund amount");
  return getClient().payments.refund(paymentId, { amount: amountPaise, speed: "normal", notes });
}

// Fetch captured payments for a timestamp window (timestamps in seconds)
async function fetchPayments({ from, to, count = 100 } = {}) {
  const params = { count };
  if (from) params.from = from;
  if (to) params.to = to;
  return getClient().payments.all(params);
}

module.exports = { getClient, createOrder, verifyPaymentSignature, verifyWebhookSignature, refund, fetchPayments, getKeyId, safeEqualHex };
