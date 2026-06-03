const express = require("express");
const router = express.Router();

const Tag = require("../controllers/category/JournalTagController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

router.get("/list", Tag.listJournalTags);
router.post("/add", authMiddleware, Tag.addJournalTag);
router.put("/edit/:id", authMiddleware, Tag.editJournalTag);
router.delete("/delete/:id", authMiddleware, Tag.deleteJournalTag);

module.exports = router;
