const express = require("express");
const router = express.Router();
const users = require("../controllers/users/usersController");
const authMiddleware = require("../middlewares/authMiddleware");

// router.get("/public", authMiddleware, users.publicStats); // the frontend passes a Bearer token
router.get("/public", users.publicStats);

module.exports = router;
