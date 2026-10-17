// Therapy Admin Routes (P22)
const express = require("express");
const router = express.Router();
const therapyAdminController = require("../controllers/therapyAdmin/therapyAdminController");
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require("../middlewares/responseHandler");

// All therapy admin routes require admin.therapy or admin.super
router.use(authMiddleware);
router.use(requireRole("admin.therapy", "admin.super"));

// Overview
router.get("/overview", therapyAdminController.getDashboardOverview);

// Emergency Reassignment
router.get("/reassign-queue", therapyAdminController.getEmergencyReassignQueue);
router.get("/emergency-queue", therapyAdminController.getEmergencyReassignQueue);
router.post("/reassign", therapyAdminController.reassignBooking);

// Quality Queue
router.get("/quality-queue", therapyAdminController.getQualityQueue);
router.post("/quality-action", therapyAdminController.recordQualityAction);

// Credential Queue
router.get("/credential-queue", therapyAdminController.getCredentialQueue);

// Overdue Follow-ups
router.get("/overdue-followups", therapyAdminController.getOverdueFollowUps);
router.post("/close-plan", therapyAdminController.closeTreatmentPlan);

// Stalled Progress
router.get("/stalled-progress", therapyAdminController.getStalledProgressQueue);

// Outcome Summary (last 90 days real data)
router.get("/outcome-summary", therapyAdminController.getOutcomeSummary);

module.exports = router;
