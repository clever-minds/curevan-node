const express = require("express");
const router = express.Router();

const Tag = require("../controllers/category/JournalTagController");
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require("../middlewares/responseHandler");

router.get("/list", Tag.listJournalTags);
router.post("/add", authMiddleware, requireRole("admin.therapy", "admin.ecom"), Tag.addJournalTag);
router.put("/edit/:id", authMiddleware, requireRole("admin.therapy", "admin.ecom"), Tag.editJournalTag);
router.delete("/delete/:id", authMiddleware, requireRole("admin.therapy", "admin.ecom"), Tag.deleteJournalTag);

module.exports = router;
