const express = require("express");
const router = express.Router();

const serviceTypesController = require("../controllers/serviceTypes/serviceTypesController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");
const upload = require("../middlewares/upload.middleware");

// Public/Authenticated route to get list of service types
router.get("/list", responseHandler, serviceTypesController.listServiceTypes);

// Admin protected routes
router.post("/add", authMiddleware, upload.single("icon"), responseHandler, serviceTypesController.addServiceType);
router.put("/update/:id", authMiddleware, upload.single("icon"), responseHandler, serviceTypesController.updateServiceType);
router.delete("/delete/:id", authMiddleware, responseHandler, serviceTypesController.deleteServiceType);

module.exports = router;
