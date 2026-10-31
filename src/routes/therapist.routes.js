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
router.get("/affiliate", authMiddleware, requireRole("therapist"), responseHandler, therapistController.getAffiliate);
router.get("/profile/:userId",authMiddleware,responseHandler, therapistController.getProfile);
router.put("/profile/:userId", authMiddleware, therapistController.updateProfile);

// Registration certificate (private file: the therapist and the therapy / super admins only)
const certificateController = require("../controllers/therapist/certificateController");
router.post("/me/certificate", authMiddleware, requireRole("therapist"), certificateController.uploadCertificate);
router.get("/me/certificate", authMiddleware, requireRole("therapist"), responseHandler, certificateController.myCertificate);
router.get("/certificate/:userId/file", authMiddleware, certificateController.certificateFile);

// Open slots for a date (public): GET /api/therapists/:therapistId/slots?date=YYYY-MM-DD
router.get("/:therapistId/slots", async (req, res) => {
  const slotService = require("../services/slotService");
  try {
    const data = await slotService.getAvailableSlots(Number(req.params.therapistId), String(req.query.date || ""));
    return res.json({ success: true, data });
  } catch (err) {
    if (err instanceof slotService.SlotError) return res.status(err.httpStatus).json({ success: false, error: err.message });
    console.error("slots error:", err.message);
    return res.status(500).json({ success: false, error: "Could not load slots" });
  }
});

// Availability
router.post("/availability",authMiddleware, requireRole("therapist"),responseHandler, therapistController.saveAvailability);
router.get("/availability/:therapistId",authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy"),responseHandler, therapistController.getAvailability);

// Documents
router.post("/document",authMiddleware, requireRole("therapist"),responseHandler, therapistController.uploadDocument);
router.get("/listnearby",responseHandler, therapistController.listUsersWithProfilesInRadius);

// Dashboard
router.get("/dashboard-stats", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy", "admin.super"), responseHandler, therapistController.getDashboardStats);
router.get("/dashboard-stats/:therapistId", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy", "admin.super"), responseHandler, therapistController.getDashboardStats);
router.get("/stats", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy", "admin.super"), responseHandler, therapistController.getDashboardStats);
router.get("/stats/:therapistId", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy", "admin.super"), responseHandler, therapistController.getDashboardStats);
router.get("/my-patients", authMiddleware, requireRole("therapist"), responseHandler, therapistController.getMyPatientsProgress);
router.get("/earnings/:therapistId", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy"), responseHandler, therapistController.getEarnings);



// --- Leaves ---
router.post("/leaves", authMiddleware, requireRole("therapist"), responseHandler, therapistLeavesController.addLeave);
router.get("/leaves", authMiddleware, requireRole("therapist", "admin.ecom", "admin.therapy"), responseHandler, therapistLeavesController.listLeaves);
router.delete("/leaves/:id", authMiddleware, requireRole("therapist"), responseHandler, therapistLeavesController.deleteLeave);


module.exports = router;

