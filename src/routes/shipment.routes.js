const express = require("express");
const router = express.Router();


const shipment = require("../controllers/shipment/shipmentController");

const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require("../middlewares/responseHandler");

// ✅ Create Shipment
router.post("/create", authMiddleware, requireRole("admin.ecom"), shipment.createShipment);

// ✅ Get All Shipments
router.get("/list", authMiddleware, requireRole("admin.ecom"), shipment.listShipments);

// ✅ Get Shipment by ID
router.get("/:id", authMiddleware, requireRole("admin.ecom"), shipment.getShipmentById);

// ✅ Track Shipment (optional public)
router.get("/track/:awb", responseHandler, shipment.trackShipment);

// ✅ Cancel Shipment
router.post("/cancel/:id", authMiddleware, requireRole("admin.ecom"), shipment.cancelShipment);

// ✅ Estimate Shipping (Public)
router.get("/estimate", responseHandler, shipment.estimateShipping);

module.exports = router;