const express = require("express");
const router = express.Router();

const subCategory = require("../controllers/category/SubCategoryController");
const authMiddleware = require("../middlewares/authMiddleware");

// ✅ ROUTES FOR SUB-CATEGORIES
router.get("/list", authMiddleware, subCategory.listSubCategories);
router.get("/category/:categoryId", subCategory.getSubCategoriesByCategory); // Used in frontend forms, can be public or auth
router.post("/add", authMiddleware, subCategory.addSubCategory);
router.put("/edit/:id", authMiddleware, subCategory.editSubCategory);
router.delete("/delete/:id", authMiddleware, subCategory.deleteSubCategory);

module.exports = router;
