const express = require("express");
const router = express.Router();

const category = require("../controllers/category/JournalCategoryController");
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require("../middlewares/responseHandler");

router.get("/list", category.listJournalCategories);
router.post("/add", authMiddleware, requireRole("admin.therapy", "admin.ecom"), category.addJournalCategory);
router.put("/edit/:id", authMiddleware, requireRole("admin.therapy", "admin.ecom"), category.editJournalCategory);
router.delete("/delete/:id", authMiddleware, requireRole("admin.therapy", "admin.ecom"), category.deleteJournalCategory);

module.exports = router;
