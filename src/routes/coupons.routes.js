const express = require("express");
const router = express.Router();

const coupons = require("../controllers/coupons/CouponsController"); // your controller
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require("../middlewares/responseHandler");

console.log(authMiddleware);
router.post("/add", authMiddleware, requireRole("admin.ecom", "admin.therapy"), coupons.addCoupon);

router.get("/list", authMiddleware, requireRole("admin.ecom", "admin.therapy"), coupons.listCoupons);
router.get("/get-all", responseHandler,coupons.getAllCoupons);

router.get("/:id", authMiddleware, requireRole("admin.ecom", "admin.therapy"), coupons.getCouponById);

router.put("/edit/:id", authMiddleware, requireRole("admin.ecom", "admin.therapy"), coupons.updateCoupon);

router.delete("/delete/:id", authMiddleware, requireRole("admin.ecom", "admin.therapy"), coupons.deleteCoupon);
router.post("/apply",authMiddleware,responseHandler,coupons.applyCoupon);


module.exports = router;
