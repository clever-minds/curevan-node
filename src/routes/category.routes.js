const express = require("express");
const router = express.Router();

const category = require("../controllers/category/CategoryController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

console.log(authMiddleware);
router.get("/list", authMiddleware, category.listCategories);
router.post("/add", authMiddleware, category.addCategory);
router.put("/edit/:id", authMiddleware, category.editCategory);
router.delete("/delete/:id", authMiddleware, category.deleteCategory);

router.get("/get-all", responseHandler,category.getAllCategories);

module.exports = router;
