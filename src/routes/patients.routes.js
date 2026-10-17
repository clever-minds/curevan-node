const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const pcrController = require("../controllers/pcr/pcrController");

const dashboard = require("../controllers/patients/patientDashboardController");

// patient home screen (must stay above the :patientId routes)
router.get("/me/dashboard", authMiddleware, dashboard.getDashboard);
router.get("/:patientId/progress", authMiddleware, pcrController.patientProgress);

module.exports = router;
