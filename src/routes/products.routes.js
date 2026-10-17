const express = require("express");
const router = express.Router();

const products = require("../controllers/products/productsController");
const inventory = require("../controllers/inventory/inventoryController");
const responseHandler = require("../middlewares/responseHandler");


const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
console.log(authMiddleware);
router.get('/inventory/forecast', authMiddleware, requireRole("admin.ecom", "admin.super"), inventory.getInventoryForecast);
router.get('/inventory/list', authMiddleware, requireRole("admin.ecom", "admin.super"), inventory.listInventory);
router.get('/list', authMiddleware, requireRole("admin.ecom"), products.listProducts);
router.get('/:id', authMiddleware, products.getProductById);
router.get('/frontend/list',responseHandler, products.getProduct);
router.get('/frontend/recommended', responseHandler, products.getRecommendedProducts);
router.get('/frontend/:id', responseHandler, products.getProductFrontendById);
router.post("/get-by-ids", authMiddleware, products.getProductsByIds);
router.post('/add', authMiddleware, requireRole("admin.ecom"), products.addProduct);
router.put('/edit/:id', authMiddleware, requireRole("admin.ecom"), products.updateProduct);
router.delete('/delete/:id', authMiddleware, requireRole("admin.ecom"), products.deleteProduct);

module.exports = router;
