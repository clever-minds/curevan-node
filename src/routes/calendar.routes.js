const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const calendar = require("../controllers/clinical/calendarController");

router.get("/token", authMiddleware, calendar.getToken);
router.post("/token/regenerate", authMiddleware, calendar.regenerateToken);
router.get("/appointments/:file", authMiddleware, calendar.appointmentIcs);   // /appointments/12.ics
router.get("/feed/:file", calendar.feed);                                      // /feed/<token>.ics (no login)

module.exports = router;
