const express = require("express");
const router = express.Router({ mergeParams: true });

const addressController = require("../controllers/users/addressController");
const responseHandler = require("../middlewares/responseHandler");
const authMiddleware = require("../middlewares/authMiddleware");

router.get("/list", authMiddleware, responseHandler, addressController.listOrderAddresses);

router.get("/:addressId", authMiddleware, responseHandler, addressController.getOrderAddressById);

router.post("/add", authMiddleware, responseHandler, addressController.addOrderAddress);

router.put("/edit/:addressId", authMiddleware, responseHandler, addressController.updateOrderAddress);

router.delete("/delete/:addressId", authMiddleware, responseHandler, addressController.deleteOrderAddress);

module.exports = router;
