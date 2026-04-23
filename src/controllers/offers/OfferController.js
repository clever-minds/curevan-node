const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

// ✅ LIST OFFERS
exports.listOffers = async (req, res) => {
  try {
    const offers = await sequelize.query(
      `SELECT 
        id, name, type, value, scope, 
        product_id AS "productId", 
        category_id AS "categoryId", 
        applicable_products AS "applicableProducts", 
        applicable_categories AS "applicableCategories", 
        is_active AS "isActive", 
        valid_from AS "validFrom", 
        valid_to AS "validTo", 
        description, 
        created_at AS "createdAt", 
        updated_at AS "updatedAt"
       FROM offers
       ORDER BY created_at DESC`,
      { type: QueryTypes.SELECT }
    );
    return res.success(offers, "Offers fetched successfully");
  } catch (error) {
    console.error("LIST OFFERS ERROR:", error);
    return res.error("Failed to fetch offers");
  }
};

// ✅ CREATE OFFER
exports.createOffer = async (req, res) => {
  try {
    const {
      name, type, value, scope,
      productId, categoryId,
      applicableProducts, applicableCategories,
      isActive, validFrom, validTo, description
    } = req.body;

    if (!name || !type || !value || !scope) {
      return res.status(400).json({ success: false, message: "Required fields missing" });
    }

    const [result] = await sequelize.query(
      `INSERT INTO offers (
        name, type, value, scope, 
        product_id, category_id, 
        applicable_products, applicable_categories, 
        is_active, valid_from, valid_to, description
      ) VALUES (
        :name, :type, :value, :scope, 
        :productId, :categoryId, 
        :applicableProducts, :applicableCategories, 
        :isActive, :validFrom, :validTo, :description
      ) RETURNING *`,
      {
        replacements: {
          name, type, value, scope,
          productId: productId || null,
          categoryId: categoryId || null,
          applicableProducts: applicableProducts || null,
          applicableCategories: applicableCategories || null,
          isActive: isActive !== undefined ? isActive : true,
          validFrom: validFrom || null,
          validTo: validTo || null,
          description: description || null
        },
        type: QueryTypes.INSERT
      }
    );

    return res.success(result[0], "Offer created successfully");
  } catch (error) {
    console.error("CREATE OFFER ERROR:", error);
    return res.error("Failed to create offer");
  }
};

// ✅ UPDATE OFFER
exports.updateOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, type, value, scope,
      productId, categoryId,
      applicableProducts, applicableCategories,
      isActive, validFrom, validTo, description
    } = req.body;

    const [result] = await sequelize.query(
      `UPDATE offers SET
        name = COALESCE(:name, name),
        type = COALESCE(:type, type),
        value = COALESCE(:value, value),
        scope = COALESCE(:scope, scope),
        product_id = :productId,
        category_id = :categoryId,
        applicable_products = :applicableProducts,
        applicable_categories = :applicableCategories,
        is_active = COALESCE(:isActive, is_active),
        valid_from = :validFrom,
        valid_to = :validTo,
        description = :description,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = :id
      RETURNING *`,
      {
        replacements: {
          id,
          name: name || null,
          type: type || null,
          value: value || null,
          scope: scope || null,
          productId: productId || null,
          categoryId: categoryId || null,
          applicableProducts: applicableProducts || null,
          applicableCategories: applicableCategories || null,
          isActive: isActive !== undefined ? isActive : null,
          validFrom: validFrom || null,
          validTo: validTo || null,
          description: description || null
        },
        type: QueryTypes.UPDATE
      }
    );

    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    return res.success(result[0], "Offer updated successfully");
  } catch (error) {
    console.error("UPDATE OFFER ERROR:", error);
    return res.error("Failed to update offer");
  }
};

// ✅ GET SINGLE OFFER
exports.getOfferById = async (req, res) => {
  try {
    const { id } = req.params;
    const [offer] = await sequelize.query(
      `SELECT 
        id, name, type, value, scope, 
        product_id AS "productId", 
        category_id AS "categoryId", 
        applicable_products AS "applicableProducts", 
        applicable_categories AS "applicableCategories", 
        is_active AS "isActive", 
        valid_from AS "validFrom", 
        valid_to AS "validTo", 
        description, 
        created_at AS "createdAt", 
        updated_at AS "updatedAt"
       FROM offers
       WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.SELECT
      }
    );

    if (!offer) {
      return res.status(404).json({ success: false, message: "Offer not found" });
    }

    return res.success(offer, "Offer fetched successfully");
  } catch (error) {
    console.error("GET OFFER ERROR:", error);
    return res.error("Failed to fetch offer");
  }
};

// ✅ DELETE OFFER
exports.deleteOffer = async (req, res) => {
  try {
    const { id } = req.params;
    await sequelize.query(
      `DELETE FROM offers WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE
      }
    );
    return res.success(null, "Offer deleted successfully");
  } catch (error) {
    console.error("DELETE OFFER ERROR:", error);
    return res.error("Failed to delete offer");
  }
};
