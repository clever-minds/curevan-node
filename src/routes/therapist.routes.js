const express = require("express");
const router = express.Router();
const therapistController = require("../controllers/therapist/therapistController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");
// Profile
router.get(
  "/list",
  responseHandler,
  therapistController.listUsersWithProfiles
);
router.post("/register",responseHandler, therapistController.registerTherapist);
router.get("/profile/:userId",authMiddleware,responseHandler, therapistController.getProfile);
router.put("/profile/:userId", authMiddleware, therapistController.updateProfile);

// Availability
router.post("/availability",authMiddleware,responseHandler, therapistController.saveAvailability);
router.get("/availability/:therapistId",authMiddleware,responseHandler, therapistController.getAvailability);
// Documents
router.post("/document",authMiddleware,responseHandler, therapistController.uploadDocument);
router.get("/listnearby",responseHandler, therapistController.listUsersWithProfilesInRadius);

module.exports = router;

