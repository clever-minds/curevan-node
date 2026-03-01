const express = require("express");
const router = express.Router();

const products = require("../controllers/products/productsController");
const inventory = require("../controllers/inventory/inventoryController");
const responseHandler = require("../middlewares/responseHandler");


const authMiddleware = require("../middlewares/authMiddleware");
console.log(authMiddleware);
router.get('/list', authMiddleware, products.listProducts);
router.get('/:id', authMiddleware, products.getProductById);
router.get('/inventory/list', authMiddleware, inventory.listInventory);
router.get('/frontend/list',responseHandler, products.getProduct);
router.post("/get-by-ids", authMiddleware, products.getProductsByIds);
router.post('/add', authMiddleware, products.addProduct);
router.put('/edit/:id', authMiddleware, products.updateProduct);
router.delete('/delete/:id', authMiddleware, products.deleteProduct);

module.exports = router;
