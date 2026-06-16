const express = require("express");
const router = express.Router();

const serviceTypesController = require("../controllers/serviceTypes/serviceTypesController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

// Public/Authenticated route to get list of service types
router.get("/list", responseHandler, serviceTypesController.listServiceTypes);

// Admin protected routes
router.post("/add", authMiddleware, responseHandler, serviceTypesController.addServiceType);
router.put("/update/:id", authMiddleware, responseHandler, serviceTypesController.updateServiceType);
router.delete("/delete/:id", authMiddleware, responseHandler, serviceTypesController.deleteServiceType);

module.exports = router;
