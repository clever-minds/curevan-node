const express = require("express");
const router = express.Router();
const notificationsController = require("../controllers/notifications/notificationsController");
const authMiddleware = require("../middlewares/authMiddleware");

router.get("/list/:id", authMiddleware, notificationsController.listNotifications);

module.exports = router;