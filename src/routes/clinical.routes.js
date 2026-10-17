const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const plans = require("../controllers/clinical/treatmentPlanController");
const outcomes = require("../controllers/clinical/outcomeController");

// plans (access is decided inside: therapist of the patient / admins / the patient and their caregiver read-only)
router.post("/plans", authMiddleware, requireRole("therapist", "admin.therapy", "admin.super"), plans.createPlan);
router.get("/plans", authMiddleware, plans.listPlans);
router.get("/plans/:id", authMiddleware, plans.getPlan);
router.patch("/plans/:id", authMiddleware, plans.updatePlan);
router.post("/plans/:id/goals", authMiddleware, plans.addGoal);
router.patch("/goals/:id", authMiddleware, plans.updateGoal);
router.get("/plans/:id/progress", authMiddleware, plans.getProgress);
router.get("/plans/:id/reports", authMiddleware, plans.listReports);
router.get("/reports/:id/pdf", authMiddleware, plans.reportPdf);

// outcome-measure library
router.get("/measures", authMiddleware, outcomes.listMeasures);
router.post("/measures", authMiddleware, requireRole("admin.therapy", "admin.super"), outcomes.createMeasure);
router.patch("/measures/:id", authMiddleware, requireRole("admin.therapy", "admin.super"), outcomes.updateMeasure);

// family access: the patient shares with one family member
router.post("/caregivers", authMiddleware, plans.addCaregiver);
router.get("/caregivers", authMiddleware, plans.listCaregivers);
router.delete("/caregivers/:id", authMiddleware, plans.revokeCaregiver);

module.exports = router;
