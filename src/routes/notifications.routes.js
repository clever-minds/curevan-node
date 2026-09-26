const express = require("express");
const router = express.Router();
const notificationsController = require("../controllers/notifications/notificationsController");
const authMiddleware = require("../middlewares/authMiddleware");

router.get("/list/:id", authMiddleware, notificationsController.listNotifications);

router.get('/unread-count/:id', authMiddleware, notificationsController.unreadCount);

router.post('/read/:id', authMiddleware, notificationsController.markAsRead);

module.exports = router;

