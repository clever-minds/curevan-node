const therapistLeavesController = require("../controllers/therapist/therapistLeavesController");
const express = require("express");
const router = express.Router();
const therapistController = require("../controllers/therapist/therapistController");
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
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
router.post("/availability",authMiddleware, requireRole("therapist"),responseHandler, therapistController.saveAvailability);
router.get("/availability/:therapistId",authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy"),responseHandler, therapistController.getAvailability);

// Documents
router.post("/document",authMiddleware, requireRole("therapist"),responseHandler, therapistController.uploadDocument);
router.get("/listnearby",responseHandler, therapistController.listUsersWithProfilesInRadius);

// Dashboard
router.get("/dashboard-stats/:therapistId", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy"), responseHandler, therapistController.getDashboardStats);
router.get("/earnings/:therapistId", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy"), responseHandler, therapistController.getEarnings);



// --- Leaves ---
router.post("/leaves", authMiddleware, requireRole("therapist"), responseHandler, therapistLeavesController.addLeave);
router.get("/leaves", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy"), responseHandler, therapistLeavesController.listLeaves);
router.delete("/leaves/:id", authMiddleware, requireRole("therapist"), responseHandler, therapistLeavesController.deleteLeave);


module.exports = router;

