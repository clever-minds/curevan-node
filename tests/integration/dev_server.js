/**
 * Starts the real API on http://localhost:5000 against the integration-test PostgreSQL, with Razorpay,
 * Firebase, e-mail and Shiprocket replaced by stubs. Used to click through the website in a browser.
 *   node tests/integration/seed_ui.js   (once, after setup_db.js)
 *   node tests/integration/dev_server.js
 */
const path = require("path");
const Module = require("module");
const root = path.resolve(__dirname, "../..");
require("dotenv").config({ path: path.join(root, ".env"), quiet: true });
process.chdir(root);
Object.assign(process.env, {
  GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y", JWT_SECRET: process.env.JWT_SECRET || "ui-test-secret", JWT_EXPIRE: "7d",
  // REAL_RAZORPAY=1 keeps the keys from .env and talks to the real Razorpay TEST API instead of the stub
  ...(process.env.REAL_RAZORPAY ? {} : { RAZORPAY_KEY_ID: "rzp_test_KEY", RAZORPAY_KEY_SECRET: "rzp_secret_123", RAZORPAY_WEBHOOK_SECRET: "whsec_123" }),
  NODE_ENV: "development", FRONTEND_URL: "http://localhost:3000", CORS_ORIGINS: process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:3001",
  DB_HOST: process.env.DB_HOST || "127.0.0.1", DB_PORT: process.env.DB_PORT || "54329",
  DB_NAME: process.env.DB_NAME || "curevan_test", DB_USER: process.env.DB_USER || "curevan", DB_PASSWORD: process.env.DB_PASSWORD || "testpw",
});
let n = 0;
class FakeRazorpay { constructor() { this.orders = { create: async (o) => ({ id: "order_UI" + ++n, amount: o.amount }) }; this.payments = { refund: async () => ({ id: "rfnd_UI" + ++n }), all: async () => ({ entity: "collection", count: 0, items: [] }) }; } }
const orig = Module._load;
Module._load = function (r, parent, ...a) {
  if (r === "razorpay" && !process.env.REAL_RAZORPAY) return FakeRazorpay;
  if (/config[\\/]mailer(\.js)?$/.test(r)) return { sendMail: async () => ({}) };
  if (/config[\\/]firebaseAdmin(\.js)?$/.test(r)) return { getAuth: () => ({ verifyIdToken: async () => { throw new Error("stub"); } }), getMessaging: () => ({ send: async () => {}, sendEachForMulticast: async () => {} }), isReady: () => true };
  if (/utils[\\/]firebaseNotifier(\.js)?$/.test(r)) return { sendToTherapist: async () => {}, sendToMultipleTherapists: async () => {}, sendToAllTherapists: async () => {} };
  if (/services[\\/]shiprocketService(\.js)?$/.test(r)) return { getPickupLocations: async () => ({ data: { shipping_address: [{ pin_code: "390012" }] } }), checkServiceability: async () => ({ data: { available_courier_companies: [{ courier_company_id: 1, rate: 50 }], recommended_courier_company_id: 1 } }), createOrder() {}, generateAWB() {}, generateLabel() {}, generateManifest() {}, trackShipment() {}, cancelShipment() {}, createReturnOrder() {} };
  return orig.call(this, r, parent, ...a);
};
const app = require(root + "/src/app");
app.listen(5000, () => console.log("API on http://localhost:5000 (stubbed Razorpay/Firebase/mail/Shiprocket)"));
