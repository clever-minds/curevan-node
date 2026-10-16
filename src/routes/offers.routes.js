const express = require('express');
const router = express.Router();
const offerController = require('../controllers/offers/OfferController');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require('../middlewares/responseHandler');

router.get("/list", responseHandler, offerController.listOffers);
router.get("/:id", responseHandler, offerController.getOfferById);
router.post("/create", authMiddleware, requireRole("admin.ecom"), responseHandler, offerController.createOffer);
router.put("/update/:id", authMiddleware, requireRole("admin.ecom"), responseHandler, offerController.updateOffer);
router.delete("/delete/:id", authMiddleware, requireRole("admin.ecom"), responseHandler, offerController.deleteOffer);

module.exports = router;
