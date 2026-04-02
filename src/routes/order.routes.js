const express = require("express");
const router = express.Router();

const orderController = require("../controllers/orders/orderController");
const auth = require("../middlewares/authMiddleware");
const resHandler = require("../middlewares/responseHandler");



const returnController = require("../controllers/orders/returnController");

// ✅ My Orders
router.get("/my-orders", auth, resHandler, orderController.myOrders);

// ✅ Return Routes
router.get("/returns", auth, resHandler, returnController.listReturns); // Admin
router.post("/:id/return", auth, resHandler, returnController.requestReturn); // User
router.put("/returns/:id/approve", auth, resHandler, returnController.approveReturn); // Admin

// ✅ Invoice
router.get("/invoice/:id", auth, resHandler, orderController.getInvoiceById);

// ✅ Single Order (FIXED - prefix added)
router.get("/order/:id", auth, resHandler, orderController.getOrderById);


// ✅ Create Order

router.post( "/validate-cart-stock",auth,resHandler,orderController.validateCartStock);
router.post("/create-order", auth, resHandler, orderController.createOrderFromCart);
router.post("/:id/cancel", auth, resHandler, orderController.cancelOrder);
module.exports = router;

