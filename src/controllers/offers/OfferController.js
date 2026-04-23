
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

// ✅ LIST OFFERS
exports.listOffers = async (req, res) => {
  try {
    const offers = await sequelize.query(
      `SELECT 
        id, 
        name, 
        type, 
        value, 
        scope, 
        product_id AS "productId",
        category_id AS "categoryId",
        applicable_products AS "applicableProducts", 
        applicable_categories AS "applicableCategories",
        is_active AS "isActive", 
        valid_from AS "validFrom", 
        valid_to AS "validTo", 
        description 
      FROM offers 
      ORDER BY id DESC`,
      { type: QueryTypes.SELECT }
    );

    return res.success(offers, "Offers fetched successfully");
  } catch (error) {
    console.error("LIST OFFERS ERROR:", error);
    return res.error("Failed to fetch offers");
  }
};

// ✅ GET OFFER BY ID
exports.getOfferById = async (req, res) => {
  try {
    const { id } = req.params;
    const [offer] = await sequelize.query(
      `SELECT 
        id, 
        name, 
        type, 
        value, 
        scope, 
        product_id AS "productId",
        category_id AS "categoryId",
        applicable_products AS "applicableProducts", 
        applicable_categories AS "applicableCategories",
        is_active AS "isActive", 
        valid_from AS "validFrom", 
        valid_to AS "validTo", 
        description 
      FROM offers 
      WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.SELECT
      }
    );

    if (!offer) {
      return res.error("Offer not found", 404);
    }

    return res.success(offer, "Offer fetched successfully");
  } catch (error) {
    console.error("GET OFFER BY ID ERROR:", error);
    return res.error("Failed to fetch offer");
  }
};

// ✅ CREATE OFFER
exports.createOffer = async (req, res) => {
  try {
    const { 
      name, 
      type, 
      value, 
      scope, 
      applicableProducts, 
      isActive, 
      validFrom, 
      validTo, 
      description 
    } = req.body;

    if (!name || !type || value === undefined) {
      return res.error("Name, type, and value are required", 400);
    }

    const [result] = await sequelize.query(
      `INSERT INTO offers (
        name, 
        type, 
        value, 
        scope, 
        applicable_products, 
        is_active, 
        valid_from, 
        valid_to, 
        description
      ) VALUES (
        :name, 
        :type, 
        :value, 
        :scope, 
        :applicable_products, 
        :is_active, 
        :valid_from, 
        :valid_to, 
        :description
      ) RETURNING *`,
      {
        replacements: {
          name,
          type,
          value,
          scope: scope || 'global',
          applicable_products: applicableProducts ? JSON.stringify(applicableProducts) : '[]',
          is_active: isActive ?? true,
          valid_from: validFrom || null,
          valid_to: validTo || null,
          description: description || null
        },
        type: QueryTypes.INSERT
      }
    );

    return res.success(result[0], "Offer created successfully", 201);
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
      name, 
      type, 
      value, 
      scope, 
      applicableProducts, 
      isActive, 
      validFrom, 
      validTo, 
      description 
    } = req.body;

    const [result] = await sequelize.query(
      `UPDATE offers SET 
        name = :name, 
        type = :type, 
        value = :value, 
        scope = :scope, 
        applicable_products = :applicable_products, 
        is_active = :is_active, 
        valid_from = :valid_from, 
        valid_to = :valid_to, 
        description = :description,
        updated_at = NOW()
      WHERE id = :id 
      RETURNING *`,
      {
        replacements: {
          id,
          name,
          type,
          value,
          scope,
          applicable_products: applicableProducts ? JSON.stringify(applicableProducts) : '[]',
          is_active: isActive,
          valid_from: validFrom || null,
          valid_to: validTo || null,
          description: description || null
        },
        type: QueryTypes.UPDATE
      }
    );

    if (!result || result.length === 0) {
      return res.error("Offer not found", 404);
    }

    return res.success(result[0], "Offer updated successfully");
  } catch (error) {
    console.error("UPDATE OFFER ERROR:", error);
    return res.error("Failed to update offer");
  }
};

// ✅ DELETE OFFER
exports.deleteOffer = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedCount = await sequelize.query(
      `DELETE FROM offers WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE
      }
    );

    if (deletedCount === 0) {
      return res.error("Offer not found", 404);
    }

    return res.success(null, "Offer deleted successfully");
  } catch (error) {
    console.error("DELETE OFFER ERROR:", error);
    return res.error("Failed to delete offer");
  }
};
