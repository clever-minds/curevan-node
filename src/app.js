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

app.use(cors({
  origin: [
    "https://your-app.vercel.app",
    "https://13.235.132.236",
    "http://localhost:3000",
    "https://curevan-dev.vercel.app/",
    "https://curevan-dev.vercel.app/",
    "http://192.168.29.237:3000",
    "https://api.curevan.com",
    "http://192.168.29.207:3000"
  ],
  credentials: true
}));
app.use(express.json({ limit: "600mb" }));
app.use(express.urlencoded({ limit: "600mb", extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/category', require('./routes/category.routes'));
app.use('/api/products', require('./routes/products.routes'));
app.use('/api/media', require('./routes/media.routes'));
app.use('/api/coupons', require('./routes/coupons.routes'));
app.use('/api/cart', require('./routes/cart.routes'));
app.use('/api/addresses', require('./routes/useraddress.route'));
//app.use('/api/users', require('./routes/user.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/orders', require('./routes/order.routes'));
//app.use('/api/payments', require('./routes/payment.routes'));
app.use('/api/therapists', require('./routes/therapist.routes'));

app.use('/api/appointments', require('./routes/appointments.routes'));
app.use('/api/general', require('./routes/general.routes'));
app.use('/api/support', require('./routes/support.routes'));
app.use('/api/shipment', require('./routes/shipment.routes'));
app.use('/api/stats', require('./routes/stats.routes'));
app.use('/api/reviews', require('./routes/review.routes'));


app.get("/", (req, res) => {
  res.send("API running successfully");
});

module.exports = app;
