const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const privacy = require("../controllers/privacy/privacyController");

// every signed-in user: their own data rights
router.post("/requests", authMiddleware, privacy.createRequest);
router.get("/requests", authMiddleware, privacy.myRequests);
router.get("/export", authMiddleware, privacy.exportMyData);

// Super Admin: the list of requests
router.get("/admin/requests", authMiddleware, requireRole("admin.super"), privacy.adminList);
router.patch("/admin/requests/:id", authMiddleware, requireRole("admin.super"), privacy.adminUpdate);

module.exports = router;
