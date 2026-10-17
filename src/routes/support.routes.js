const express = require("express");
const router = express.Router();

const support = require("../controllers/supportController");
const escalation = require("../controllers/support/escalationController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

router.post("/tickets", authMiddleware, responseHandler, support.createTicket);

router.get("/tickets", authMiddleware, responseHandler, support.getTickets);

router.get("/tickets/:id", authMiddleware, responseHandler, support.getTicket);

router.post("/tickets/reply", authMiddleware, responseHandler, support.replyTicket);

router.post("/tickets/:id/close", authMiddleware, responseHandler, support.closeTicket);

router.post("/contact-us", responseHandler, support.contactUs);

// AI chat (P26): sessions, messages and the hand-over to a person
router.post("/chat/sessions", authMiddleware, escalation.startSession);
router.post("/chat/sessions/:id/messages", authMiddleware, escalation.addMessages);
router.post("/escalate", authMiddleware, escalation.escalate);

module.exports = router;