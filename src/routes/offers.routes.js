const express = require("express");
const router = express.Router();
const offerController = require("../controllers/offers/OfferController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

router.get("/list", responseHandler, offerController.listOffers);
router.get("/:id", responseHandler, offerController.getOfferById);
router.post("/create", authMiddleware, responseHandler, offerController.createOffer);
router.put("/update/:id", authMiddleware, responseHandler, offerController.updateOffer);
router.delete("/delete/:id", authMiddleware, responseHandler, offerController.deleteOffer);

module.exports = router;
