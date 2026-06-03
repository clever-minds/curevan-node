const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

// ✅ LIST CART
exports.listCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const cartItems = await sequelize.query(
      `SELECT q.*, 
        CASE 
          WHEN q.offer IS NOT NULL THEN
            CASE 
              WHEN q.offer->>'type' = 'percent' OR q.offer->>'type' = 'percentage' THEN 
                ROUND(q.price * (1 - CAST(q.offer->>'value' AS NUMERIC) / 100.0), 2)
              WHEN q.offer->>'type' IN ('flat', 'fixed') THEN 
                GREATEST(0::numeric, ROUND(q.price - CAST(q.offer->>'value' AS NUMERIC), 2))
              ELSE q.price
            END
          ELSE q.price
        END AS "discountedPrice"
      FROM (
        SELECT 
         c.id,
         c.user_id AS "userId",
         c.product_id AS "productId",
         c.quantity,
         c.created_at AS "createdAt",
         c.updated_at AS "updatedAt",
         p.title as name,
         p.selling_price AS price,
         COALESCE(p.gst_slab, 0) AS "gstPercent",
         CASE 
            WHEN p.is_tax_inclusive THEN ROUND(p.selling_price - (p.selling_price / (1 + COALESCE(p.gst_slab,0)/100.0)), 2)
            ELSE ROUND(p.selling_price * (COALESCE(p.gst_slab,0)/100.0), 2)
         END AS "gstAmount",
         p.long_description as description,
         p.category_id AS "categoryId",
         p.status AS "isActive",
         p.is_coupon_excluded AS "isCouponExcluded",
         p.is_tax_inclusive AS "isTaxInclusive",
         p.sku,
         p.hsn_code AS "hsnCode",
         m.file_path AS "featuredImage",
         (
          SELECT jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'type', o.type,
            'value', o.value,
            'scope', o.scope,
            'description', o.description
          )
          FROM offers o
          WHERE o.is_active = true 
            AND (o.valid_from IS NULL OR o.valid_from <= CURRENT_DATE)
            AND (o.valid_to IS NULL OR o.valid_to >= CURRENT_DATE)
            AND (
              (o.scope = 'product' AND o.product_id = p.id) OR
              (o.scope = 'category' AND o.category_id = p.category_id) OR
              (o.scope = 'global') OR
              (p.id = ANY(o.applicable_products)) OR
              (p.category_id = ANY(o.applicable_categories))
            )
          ORDER BY 
            CASE 
              WHEN o.scope = 'product' THEN 1
              WHEN p.id = ANY(o.applicable_products) THEN 2
              WHEN o.scope = 'category' THEN 3
              WHEN p.category_id = ANY(o.applicable_categories) THEN 4
              ELSE 5 
            END ASC
          LIMIT 1
         ) AS offer
       FROM cart c
       JOIN products p ON c.product_id = p.id
       LEFT JOIN media m ON m.id = p.image_ids[1]
       WHERE c.user_id = :userId
       ORDER BY c.id DESC
      ) q`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    return res.success(cartItems, "Cart items fetched successfully");
  } catch (error) {
    console.log(error);
    return res.error("Failed to fetch cart");
  }
};


// ✅ ADD TO CART
exports.addToCart = async (req, res) => {
  try {
    console.log("Add to cart request body:", req.body);
    const userId = req.user.id;
    const { product_id, quantity } = req.body;

    if (!product_id || !quantity) {
      return res.error("Product and quantity are required");
    }

    // Check if item already exists in cart
    const [existing] = await sequelize.query(
      `SELECT id, quantity FROM cart WHERE user_id = :userId AND product_id = :productId`,
      {
        replacements: { userId, productId: product_id },
        type: QueryTypes.SELECT,
      }
    );

    if (existing) {
      // Update existing quantity
      await sequelize.query(
        `UPDATE cart 
         SET quantity =:quantity, updated_at = CURRENT_TIMESTAMP
         WHERE id = :id`,
        { replacements: { quantity, id: existing.id }, type: QueryTypes.UPDATE, logging: console.log }
      );
    } else {
      // Insert new cart item
      await sequelize.query(
        `INSERT INTO cart (user_id, product_id, quantity)
         VALUES (:userId, :productId, :quantity)`,
        { replacements: { userId, productId: product_id, quantity }, type: QueryTypes.INSERT }
      );
    }

    return res.success(null, "Item added to cart successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to add to cart");
  }
};

// ✅ REMOVE CART ITEM
exports.removeCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    await sequelize.query(
      `DELETE FROM cart WHERE user_id = :userId AND product_id = :productId`,
      { replacements: { userId, productId }, type: QueryTypes.DELETE }
    );

    return res.success(null, "Item removed from cart successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to remove cart item");
  }
};

// ✅ CLEAR CART
exports.clearCart = async (req, res) => {
  try {
    const userId = req.user.id;

    await sequelize.query(
      `DELETE FROM cart WHERE user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.DELETE }
    );

    return res.success(null, "Cart cleared successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to clear cart");
  }
};
