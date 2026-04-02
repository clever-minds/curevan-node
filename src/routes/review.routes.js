const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviews/reviewController');
const authMiddleware = require('../middlewares/authMiddleware');
const responseHandler = require("../middlewares/responseHandler");

// Public
router.get('/product/:productId', responseHandler, reviewController.getProductReviews);

// Auth required
router.post('/', authMiddleware, responseHandler, reviewController.addReview);
router.get('/user', authMiddleware, responseHandler, reviewController.getUserReviews);
router.put('/:id', authMiddleware, responseHandler, reviewController.updateReview);
router.delete('/:id', authMiddleware, responseHandler, reviewController.deleteReview);

module.exports = router;
