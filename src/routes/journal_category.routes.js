const express = require("express");
const router = express.Router();

const category = require("../controllers/category/JournalCategoryController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

router.get("/list", category.listJournalCategories);
router.post("/add", authMiddleware, category.addJournalCategory);
router.put("/edit/:id", authMiddleware, category.editJournalCategory);
router.delete("/delete/:id", authMiddleware, category.deleteJournalCategory);

module.exports = router;
