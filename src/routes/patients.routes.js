const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const pcrController = require("../controllers/pcr/pcrController");

router.get("/:patientId/progress", authMiddleware, pcrController.patientProgress);

module.exports = router;
