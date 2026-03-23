const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

/* =====================================================
   LIST ORDER ADDRESSES (LOGIN USER)
===================================================== */
exports.listOrderAddresses = async (req, res) => {
  try {

    const userId = req.user?.id;

    const result = await sequelize.query(
      `SELECT 
        id,
        user_id AS "userId",
        address_type AS "addressType",
        full_name AS "fullName",
        email,
        phone,
        full_address AS "fullAddress",
        city,
        state,
        pincode,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM order_addresses
      WHERE user_id = :userId
      ORDER BY id DESC`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT
      }
    );

    return res.success(result, "Order addresses fetched successfully");

  } catch (error) {
    console.error(error);
    return res.error("Server error");
  }
};


/* =====================================================
   GET ORDER ADDRESS BY ID (LOGIN USER)
===================================================== */
exports.getOrderAddressById = async (req, res) => {
  try {

    const id = Number(req.params.addressId);
    const userId = req.user?.id;

    if (!id) return res.error("Address ID is required");

    const result = await sequelize.query(
      `SELECT 
        id,
        user_id AS "userId",
        address_type AS "addressType",
        full_name AS "fullName",
        email,
        phone,
        full_address AS "fullAddress",
        city,
        state,
        pincode,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM order_addresses
      WHERE id = :id
      AND user_id = :userId`,
      {
        replacements: { id, userId },
        type: QueryTypes.SELECT
      }
    );

    if (!result.length) {
      return res.error("Order address not found");
    }

    return res.success(result[0], "Order address fetched successfully");

  } catch (error) {
    console.error(error);
    return res.error("Server error");
  }
};


/* =====================================================
   ADD ORDER ADDRESS (LOGIN USER)
===================================================== */
exports.addOrderAddress = async (req, res) => {

  const transaction = await sequelize.transaction();

  try {

    const userId = req.user?.id;

    const {
      address_type,
      full_name,
      phone,
      street,
      city,
      state,
      postal_code,
      email,
      same_as_shipping
    } = req.body;

    const finalType = same_as_shipping ? "both" : address_type || "shipping";

    const result = await sequelize.query(
      `INSERT INTO order_addresses (
        user_id,
        address_type,
        full_name,
        email,
        phone,
        full_address,
        city,
        state,
        pincode,
        created_at,
        updated_at
      )
      VALUES (
        :userId,
        :address_type,
        :full_name,
        :email,
        :phone,
        :full_address,
        :city,
        :state,
        :pincode,
        NOW(),
        NOW()
      )
      RETURNING *`,
      {
        replacements: {
          userId,
          address_type: finalType,
          full_name,
          email,
          phone,
          full_address: street,
          city,
          state,
          pincode: postal_code
        },
        type: QueryTypes.INSERT,
        transaction
      }
    );

    await transaction.commit();

    return res.success(result[0][0], "Order address added successfully");

  } catch (error) {

    await transaction.rollback();
    console.error(error);
    return res.error("Server error");

  }
};


/* =====================================================
   UPDATE ORDER ADDRESS (LOGIN USER)
===================================================== */
exports.updateOrderAddress = async (req, res) => {

  const transaction = await sequelize.transaction();

  try {

    const id = Number(req.params.addressId);
    const userId = req.user?.id;

    const {
      address_type,
      full_name,
      phone,
      street,
      city,
      state,
      postal_code,
      email
    } = req.body;

    const result = await sequelize.query(
      `UPDATE order_addresses
       SET
        address_type = :address_type,
        full_name = :full_name,
        email = :email,
        phone = :phone,
        full_address = :full_address,
        city = :city,
        state = :state,
        pincode = :pincode,
        updated_at = NOW()
       WHERE id = :id
       AND user_id = :userId
       RETURNING *`,
      {
        replacements: {
          id,
          userId,
          address_type,
          full_name,
          email,
          phone,
          full_address: street,
          city,
          state,
          pincode: postal_code
        },
        type: QueryTypes.UPDATE,
        transaction
      }
    );

    if (!result[0].length) {
      await transaction.rollback();
      return res.error("Order address not found");
    }

    await transaction.commit();

    return res.success(result[0][0], "Order address updated successfully");

  } catch (error) {

    await transaction.rollback();
    console.error(error);
    return res.error("Server error");

  }
};


/* =====================================================
   DELETE ORDER ADDRESS (LOGIN USER)
===================================================== */
exports.deleteOrderAddress = async (req, res) => {
  try {

    const id = Number(req.params.addressId);
    const userId = req.user?.id;

    const result = await sequelize.query(
      `DELETE FROM order_addresses
       WHERE id = :id
       AND user_id = :userId
       RETURNING id`,
      {
        replacements: { id, userId },
        type: QueryTypes.DELETE
      }
    );

    if (!result[0].length) {
      return res.error("Order address not found");
    }

    return res.success(null, "Order address deleted successfully");

  } catch (error) {

    console.error(error);
    return res.error("Server error");

  }
};