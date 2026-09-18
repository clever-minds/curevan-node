const therapistLeavesController = require("../controllers/therapist/therapistLeavesController");
const express = require("express");
const router = express.Router();
const therapistController = require("../controllers/therapist/therapistController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");
const upload = require("../middlewares/upload.middleware");
// Profile
router.get(
  "/list",
  responseHandler,
  therapistController.listUsersWithProfiles
);
router.post("/register", upload.any(), responseHandler, therapistController.registerTherapist);
router.get("/profile/:userId",authMiddleware,responseHandler, therapistController.getProfile);
router.put("/profile/:userId", authMiddleware, therapistController.updateProfile);

// Availability
router.post("/availability",authMiddleware,responseHandler, therapistController.saveAvailability);
router.get("/availability/:therapistId",authMiddleware,responseHandler, therapistController.getAvailability);
// Leaves (Unavailable Dates)
router.post("/leave", authMiddleware, responseHandler, therapistController.addLeave);
router.delete("/leave/:date", authMiddleware, responseHandler, therapistController.removeLeave);
router.get("/leaves/:therapistId", authMiddleware, responseHandler, therapistController.getLeaves);

// Documents
router.post("/document",authMiddleware,responseHandler, therapistController.uploadDocument);
router.get("/listnearby",responseHandler, therapistController.listUsersWithProfilesInRadius);

// Dashboard
router.get("/dashboard-stats/:therapistId", authMiddleware, responseHandler, therapistController.getDashboardStats);
router.get("/earnings/:therapistId", authMiddleware, responseHandler, therapistController.getEarnings);



// --- Leaves ---
router.post("/leaves", authMiddleware, responseHandler, therapistLeavesController.addLeave);
router.get("/leaves", authMiddleware, responseHandler, therapistLeavesController.listLeaves);
router.delete("/leaves/:id", authMiddleware, responseHandler, therapistLeavesController.deleteLeave);

module.exports = router;

