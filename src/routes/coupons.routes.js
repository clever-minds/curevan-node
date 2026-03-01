const express = require("express");
const router = express.Router();

const coupons = require("../controllers/coupons/CouponsController"); // your controller
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

console.log(authMiddleware);
router.post("/add", authMiddleware, coupons.addCoupon);

router.get("/list", authMiddleware, coupons.listCoupons);
router.get("/get-all", responseHandler,coupons.getAllCoupons);

router.get("/:id", authMiddleware, coupons.getCouponById);

router.put("/edit/:id", authMiddleware, coupons.updateCoupon);

router.delete("/delete/:id", authMiddleware, coupons.deleteCoupon);
router.post("/apply",authMiddleware,responseHandler,coupons.applyCoupon);


module.exports = router;
