const express = require("express");
const cors = require("cors");
const app = express();
const path = require("path");
const cookieParser = require("cookie-parser");
app.use(cookieParser());

// app.use(cors({
//   origin: "http://localhost:3000",
//   credentials: true   // 🔥 REQUIRED
// }));

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:3000");
}
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Razorpay webhook needs the exact raw body for signature checking, so it is mounted
// before the JSON parser and only for this path.
app.post("/api/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }), require("./controllers/payments/webhookController").handleWebhook);
app.use(express.json({ limit: "10mb" }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    console.error("[Error] Invalid JSON from " + req.ip + " to " + req.originalUrl + ":", err.message);
    return res.status(400).send({ success: false, message: "Invalid JSON format" });
  }
  next(err);
});
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/category', require('./routes/category.routes'));
app.use('/api/subcategory', require('./routes/subcategory.routes'));
app.use('/api/journal-categories', require('./routes/journal_category.routes'));
app.use('/api/journal-tags', require('./routes/journal_tag.routes'));
app.use('/api/products', require('./routes/products.routes'));
app.use('/api/media', require('./routes/media.routes'));
app.use('/api/coupons', require('./routes/coupons.routes'));
app.use('/api/cart', require('./routes/cart.routes'));
app.use('/api/addresses', require('./routes/useraddress.route'));
//app.use('/api/users', require('./routes/user.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/orders', require('./routes/order.routes'));
app.use('/api/payments', require('./routes/payments.routes'));
app.use('/api/sos', require('./routes/sos.routes'));
app.use('/api/consent', require('./routes/consent.routes'));
app.use('/api/config', require('./routes/config.routes'));
app.use('/api/pcr', require('./routes/pcr.routes'));
app.use('/api/patients', require('./routes/patients.routes'));
app.use('/api/clinical', require('./routes/clinical.routes'));
app.use('/api/calendar', require('./routes/calendar.routes'));
app.use('/api/payout-batches', require('./routes/payouts.routes'));
app.use('/api/hooks', require('./routes/hooks.routes'));
app.use('/api/privacy', require('./routes/privacy.routes'));
app.use('/api/communication', require('./routes/communication.routes'));
app.use('/api/invoices', require('./routes/invoices.routes'));
app.use('/api/therapists', require('./routes/therapist.routes'));
app.use('/api/therapy-admin', require('./routes/therapy-admin.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/notifications', require('./routes/notifications.routes'));

app.use('/api/appointments', require('./routes/appointments.routes'));
app.use('/api/general', require('./routes/general.routes'));
app.use('/api/service-types', require('./routes/service_types.routes'));
app.use('/api/support', require('./routes/support.routes'));
app.use('/api/shipment', require('./routes/shipment.routes'));
app.use('/api/stats', require('./routes/stats.routes'));
app.use('/api/reviews', require('./routes/review.routes'));
app.use('/api/offers', require('./routes/offers.routes'));


app.get("/", (req, res) => {
  res.send("API running successfully");
});

// Final error handler: log server-side, never leak stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[Error]", req.method, req.originalUrl, err && err.message);
  const status = err && err.status >= 400 && err.status < 500 ? err.status : 500;
  const message = status === 413 ? "Payload too large" : status === 500 ? "Internal server error" : "Bad request";
  res.status(status).json({ success: false, message });
});

module.exports = app;
