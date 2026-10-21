const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const invoices = require("../controllers/invoices/invoicesController");

// admins: all invoices; everyone else: only their own (filtered inside the controller)
router.get("/list", authMiddleware, invoices.listInvoices);

module.exports = router;
