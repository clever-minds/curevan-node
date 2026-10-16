const express = require("express");
const router = express.Router();

const category = require("../controllers/category/CategoryController");
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require("../middlewares/responseHandler");

console.log(authMiddleware);
router.get("/list", authMiddleware, category.listCategories);
router.post("/add", authMiddleware, requireRole("admin.ecom"), category.addCategory);
router.put("/edit/:id", authMiddleware, requireRole("admin.ecom"), category.editCategory);
router.delete("/delete/:id", authMiddleware, requireRole("admin.ecom"), category.deleteCategory);

router.get("/get-all", responseHandler,category.getAllCategories);

module.exports = router;
