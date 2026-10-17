const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const pcrController = require("../controllers/pcr/pcrController");

// access is checked inside the controller (patient own / treating therapist / clinical admin)
router.get("/appointment/:appointmentId/pdf", authMiddleware, pcrController.downloadPdf);   // the website knows the booking id
router.get("/:id/pdf", authMiddleware, pcrController.downloadPdf);

module.exports = router;
