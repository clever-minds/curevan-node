const express = require("express");
const router = express.Router();

const cartController = require("../controllers/cart/CartController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

// Get user cart
router.get("/list", authMiddleware, responseHandler,cartController.listCart);

// Add to cart
router.post("/add-or-update", authMiddleware, responseHandler,cartController.addToCart);

// Update quantity

// Remove item
router.delete("/remove/:productId", authMiddleware,responseHandler, cartController.removeCartItem);

// Clear cart
router.delete("/clear", authMiddleware, responseHandler, cartController.clearCart);

module.exports = router;
