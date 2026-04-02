const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

/* =========================
   ADD REVIEW
========================= */
exports.addReview = async (req, res) => {
  try {
    const { productId, rating, comment } = req.body;
    const userId = req.user.id; // From authMiddleware

    if (!productId || !rating) {
      return res.status(400).json({ success: false, message: 'Product ID and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    // Check if user already reviewed this product
    const existingReview = await sequelize.query(
      `SELECT id FROM reviews WHERE user_id = :userId AND product_id = :productId`,
      {
        replacements: { userId, productId },
        type: QueryTypes.SELECT
      }
    );

    if (existingReview.length > 0) {
      return res.status(400).json({ success: false, message: 'You have already reviewed this product' });
    }

    // Insert review
    await sequelize.query(
      `INSERT INTO reviews (user_id, product_id, rating, comment)
       VALUES (:userId, :productId, :rating, :comment)`,
      {
        replacements: { userId, productId, rating, comment },
        type: QueryTypes.INSERT
      }
    );

    res.status(201).json({ success: true, message: 'Review added successfully' });
  } catch (error) {
    console.error('ADD REVIEW ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to add review', error: error.message });
  }
};

/* =========================
   GET PRODUCT REVIEWS
========================= */
exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;

    const reviews = await sequelize.query(
      `SELECT 
          r.*, 
          u.name as user_name 
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.product_id = :productId
       ORDER BY r.created_at DESC`,
      {
        replacements: { productId },
        type: QueryTypes.SELECT
      }
    );

    res.json({ success: true, data: reviews });
  } catch (error) {
    console.error('GET PRODUCT REVIEWS ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
};

/* =========================
   GET USER REVIEWS
========================= */
exports.getUserReviews = async (req, res) => {
  try {
    const userId = req.user.id;

    const reviews = await sequelize.query(
      `SELECT 
          r.*, 
          p.title as product_name 
       FROM reviews r
       JOIN products p ON p.id = r.product_id
       WHERE r.user_id = :userId
       ORDER BY r.created_at DESC`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT
      }
    );

    res.json({ success: true, data: reviews });
  } catch (error) {
    console.error('GET USER REVIEWS ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user reviews' });
  }
};

/* =========================
   UPDATE REVIEW
========================= */
exports.updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user.id;

    const review = await sequelize.query(
      `SELECT id FROM reviews WHERE id = :id AND user_id = :userId`,
      {
        replacements: { id, userId },
        type: QueryTypes.SELECT
      }
    );

    if (review.length === 0) {
      return res.status(404).json({ success: false, message: 'Review not found or unauthorized' });
    }

    await sequelize.query(
      `UPDATE reviews SET 
          rating = :rating, 
          comment = :comment, 
          updated_at = CURRENT_TIMESTAMP 
       WHERE id = :id`,
      {
        replacements: { id, rating, comment },
        type: QueryTypes.UPDATE
      }
    );

    res.json({ success: true, message: 'Review updated successfully' });
  } catch (error) {
    console.error('UPDATE REVIEW ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to update review' });
  }
};

/* =========================
   DELETE REVIEW
========================= */
exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    // Check if review exists and owner or admin
    let query = `SELECT id FROM reviews WHERE id = :id`;
    let replacements = { id };

    if (role !== 'admin') {
      query += ` AND user_id = :userId`;
      replacements.userId = userId;
    }

    const review = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT
    });

    if (review.length === 0) {
      return res.status(404).json({ success: false, message: 'Review not found or unauthorized' });
    }

    await sequelize.query(`DELETE FROM reviews WHERE id = :id`, {
      replacements: { id },
      type: QueryTypes.DELETE
    });

    res.json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    console.error('DELETE REVIEW ERROR:', error);
    res.status(500).json({ success: false, message: 'Failed to delete review' });
  }
};
