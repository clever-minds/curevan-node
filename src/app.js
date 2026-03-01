const express = require("express");
const cors = require("cors");
const app = express();
const path = require("path");
const cookieParser = require("cookie-parser");
app.use(cookieParser());

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true   // 🔥 REQUIRED
}));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/category', require('./routes/category.routes'));
app.use('/api/products', require('./routes/products.routes'));
app.use('/api/media', require('./routes/media.routes'));
app.use('/api/coupons', require('./routes/coupons.routes'));
app.use('/api/cart', require('./routes/cart.routes'));
app.use('/api/addresses', require('./routes/useraddress.route'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/orders', require('./routes/order.routes'));
//app.use('/api/payments', require('./routes/payment.routes'));
app.use('/api/therapists', require('./routes/therapist.routes'));

app.use('/api/appointments', require('./routes/appointments.routes'));

app.get("/", (req, res) => {
  res.send("API running successfully");
});

module.exports = app;
                     