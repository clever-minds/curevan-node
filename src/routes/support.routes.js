const express = require("express");
const router = express.Router();

const support = require("../controllers/supportController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

router.post("/tickets", authMiddleware, responseHandler, support.createTicket);

router.get("/tickets", authMiddleware, responseHandler, support.getTickets);

router.get("/tickets/:id", authMiddleware, responseHandler, support.getTicket);

router.post("/tickets/reply", authMiddleware, responseHandler, support.replyTicket);

router.post("/tickets/:id/close", authMiddleware, responseHandler, support.closeTicket);

module.exports = router;