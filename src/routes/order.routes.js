const express = require("express");
const router = express.Router();

const orderController = require("../controllers/orders/orderController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");


// ✅ Create Order From Cart
router.post("/create-order",authMiddleware,responseHandler,orderController.createOrderFromCart);

// ✅ My Orders
router.get( "/my-orders",authMiddleware,responseHandler,orderController.myOrders);

router.get("/invoice/:id",authMiddleware,responseHandler,orderController.getInvoiceById);

// ✅ Single Order Details
router.get("/:id",authMiddleware,responseHandler,orderController.getOrderById);

// ✅ Order Status History
//router.get("/:id/status-history",authMiddleware,responseHandler,orderController.orderStatusHistory);

// ✅ Admin Orders (optional admin middleware laga sakte ho)
//router.get("/admin/list",authMiddleware,responseHandler,orderController.adminOrders);

module.exports = router;
