const express = require("express");
const router = express.Router();

const subCategory = require("../controllers/category/SubCategoryController");
const authMiddleware = require("../middlewares/authMiddleware");

const { requireRole } = require("../middlewares/requireRole");
// ✅ ROUTES FOR SUB-CATEGORIES
router.get("/list", authMiddleware, subCategory.listSubCategories);
router.get("/category/:categoryId", subCategory.getSubCategoriesByCategory); // Used in frontend forms, can be public or auth
router.post("/add", authMiddleware, requireRole("admin.ecom"), subCategory.addSubCategory);
router.put("/edit/:id", authMiddleware, requireRole("admin.ecom"), subCategory.editSubCategory);
router.delete("/delete/:id", authMiddleware, requireRole("admin.ecom"), subCategory.deleteSubCategory);

module.exports = router;
