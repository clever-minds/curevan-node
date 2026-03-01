const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

/* =========================
   LIST COUPONS
========================= */
exports.listCoupons = async (req, res) => {
  try {
    const result = await sequelize.query(
      `SELECT * FROM coupons ORDER BY id DESC`,
      { type: QueryTypes.SELECT }
    );

    res.json({ status: true, data: result });
  } catch (error) {
    console.error("listCoupons error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

/* =========================
   GET COUPON BY ID
========================= */
exports.getCouponById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await sequelize.query(
    `SELECT
    id,
    code,
    type,
    status,
    value,
    owner_type   AS ownerType,
    scope,
    is_stackable AS isStackable,

    max_discount AS maxDiscount,
    usage_limit  AS usageLimit,
    usage_per_user AS usagePerUser,
    min_order_value AS minOrderValue,

    valid_from AS validFrom,
    valid_to   AS validTo,

    therapist_id AS therapistId,
    internal_notes AS internalNotes
    FROM coupons
    WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.SELECT,
      }
    );

    if (!result.length) {
      return res.status(404).json({ status: false, message: "Coupon not found" });
    }

    res.json({ status: true, data: result[0] });
  } catch (error) {
    console.error("getCouponById error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

/* =========================
   ADD NEW COUPON
========================= */
exports.addCoupon = async (req, res) => {
  try {
    const {
      status,
      value,
      code,
      type,
      scope,
      owner_type,
      is_stackable,
      max_discount,
      valid_from,
      valid_to,
      usage_limit,
      usage_per_user,
      min_order_value,
      therapist_id,
      applicable_categories,
      applicable_products,
      internal_notes,
    } = req.body;

    /* ===============================
       1. REQUIRED FIELDS
    =============================== */
    const requiredFields = {
      status,
      value,
      code,
      type,
      scope,
      owner_type,
      is_stackable,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([_, v]) => v === undefined || v === null || v === '')
      .map(([k]) => k);

    if (missingFields.length > 0) {
      return res.status(400).json({
        status: false,
        message: 'Required fields missing',
        missing_fields: missingFields,
      });
    }

    /* ===============================
       2. ENUM VALIDATION
    =============================== */
    if (!['Active', 'Paused', 'Scheduled'].includes(status))
      return res.status(400).json({ status: false, message: 'Invalid status' });

    if (!['flat', 'percent'].includes(type))
      return res.status(400).json({ status: false, message: 'Invalid coupon type' });

    if (!['Global', 'Category', 'Product'].includes(scope))
      return res.status(400).json({ status: false, message: 'Invalid scope' });

    if (!['Platform', 'Therapist'].includes(owner_type))
      return res.status(400).json({ status: false, message: 'Invalid owner type' });

    /* ===============================
       3. VALUE VALIDATION
    =============================== */
    if (!Number.isFinite(Number(value)) || value <= 0)
      return res.status(400).json({ status: false, message: 'Invalid coupon value' });

    if (type === 'percent' && value > 100)
      return res.status(400).json({
        status: false,
        message: 'Percent value cannot exceed 100',
      });

    // if (max_discount != null) {
    //   if (type !== 'percent')
    //     return res.status(400).json({
    //       status: false,
    //       message: 'max_discount allowed only for percent coupons',
    //     });

    //   if (!Number.isFinite(Number(max_discount)) || max_discount < 0)
    //     return res.status(400).json({
    //       status: false,
    //       message: 'Invalid max_discount',
    //     });
    // }

    /* ===============================
       4. DATE VALIDATION
    =============================== */
    if (valid_from && valid_to) {
      if (new Date(valid_from) >= new Date(valid_to)) {
        return res.status(400).json({
          status: false,
          message: 'valid from must be earlier than valid to',
        });
      }
    }

    if (status === 'Scheduled' && !valid_from) {
      return res.status(400).json({
        status: false,
        message: 'valid_from required for Scheduled coupons',
      });
    }

    /* ===============================
       5. USAGE LIMIT VALIDATION
    =============================== */
    if (usage_limit != null && (!Number.isInteger(Number(usage_limit)) || usage_limit <= 0))
      return res.status(400).json({ status: false, message: 'Invalid usage_limit' });

    if (usage_per_user != null) {
      if (!Number.isInteger(Number(usage_per_user)) || usage_per_user <= 0)
        return res.status(400).json({ status: false, message: 'Invalid usage_per_user' });

      if (usage_limit && usage_per_user > usage_limit)
        return res.status(400).json({
          status: false,
          message: 'Each user can use the coupon only up to the total usage limit.',
        });
    }

    /* ===============================
       6. SCOPE VALIDATION
    =============================== */
    if (scope === 'Category' && (!applicable_categories || applicable_categories.length === 0))
      return res.status(400).json({
        status: false,
        message: 'applicable_categories required for Category scope',
      });

    if (scope === 'Product' && (!applicable_products || applicable_products.length === 0))
      return res.status(400).json({
        status: false,
        message: 'applicable_products required for Product scope',
      });

    /* ===============================
       7. OWNER VALIDATION
    =============================== */
    if (owner_type === 'Therapist' && !therapist_id)
      return res.status(400).json({
        status: false,
        message: 'therapist_id required for Therapist coupon',
      });

    if (owner_type === 'Platform' && therapist_id)
      return res.status(400).json({
        status: false,
        message: 'therapist_id must be null for Platform coupon',
      });

    /* ===============================
       8. DUPLICATE COUPON CODE CHECK
    =============================== */
    const normalizedCode = code.trim().toUpperCase();

    const codeExists = await sequelize.query(
      `SELECT id FROM coupons WHERE UPPER(code) = :code LIMIT 1`,
      {
        replacements: { code: normalizedCode },
        type: QueryTypes.SELECT,
      }
    );

    if (codeExists.length > 0) {
      return res.status(400).json({
        status: false,
        message: 'Coupon code already exists',
      });
    }

    /* ===============================
       9. DATE OVERLAP CHECK
    =============================== */
        if (valid_from && valid_to) {
        const overlappingCoupons = await sequelize.query(
            `
            SELECT id FROM coupons
            WHERE status IN ('Active', 'Scheduled')
            AND scope = :scope
            AND owner_type = :owner_type
            AND (
                (valid_from IS NULL OR valid_from <= :valid_to)
                AND
                (valid_to IS NULL OR valid_to >= :valid_from)
            )
            `,
            {
            replacements: {
                scope,
                owner_type,
                valid_from,
                valid_to,
            },
            type: QueryTypes.SELECT,
            }
        );

        if (overlappingCoupons.length > 0) {
            return res.status(400).json({
            status: false,
            message: 'Coupon already exists for the same or overlapping date range',
            });
        }
        }

    /* ===============================
       10. INSERT
    =============================== */
    const result = await sequelize.query(
      `
      INSERT INTO coupons (
        status, value, code, type, scope, owner_type, is_stackable,
        max_discount, valid_from, valid_to, usage_limit, usage_per_user,
        min_order_value, therapist_id, applicable_categories, applicable_products,
        internal_notes
      )
      VALUES (
        :status, :value, :code, :type, :scope, :owner_type, :is_stackable,
        :max_discount, :valid_from, :valid_to, :usage_limit, :usage_per_user,
        :min_order_value, :therapist_id, :applicable_categories, :applicable_products,
        :internal_notes
      )
      RETURNING *
      `,
      {
        replacements: {
          status,
          value,
          code: normalizedCode,
          type,
          scope,
          owner_type,
          is_stackable,
          max_discount: max_discount ?? null,
          valid_from: valid_from ?? null,
          valid_to: valid_to ?? null,
          usage_limit: usage_limit ?? null,
          usage_per_user: usage_per_user ?? null,
          min_order_value: min_order_value ?? null,
          therapist_id: therapist_id ?? null,
          applicable_categories: applicable_categories ?? null,
          applicable_products: applicable_products ?? null,
          internal_notes: internal_notes ?? null,
        },
        type: QueryTypes.INSERT,
      }
    );

    return res.status(201).json({
      status: true,
      data: result[0][0],
    });

  } catch (error) {
    console.error('addCoupon error:', error);
    return res.status(500).json({
      status: false,
      message: 'Server error',
    });
  }
};

/* =========================
   UPDATE COUPON
========================= */
exports.updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      value,
      code,
      type,
      scope,
      owner_type,
      is_stackable,
      max_discount,
      valid_from,
      valid_to,
      usage_limit,
      usage_per_user,
      min_order_value,
      therapist_id,
      applicable_categories,
      applicable_products,
      internal_notes,
    } = req.body;

    const result = await sequelize.query(
      `
      UPDATE coupons
      SET
        status = :status,
        value = :value,
        code = :code,
        type = :type,
        scope = :scope,
        owner_type = :owner_type,
        is_stackable = :is_stackable,
        max_discount = :max_discount,
        valid_from = :valid_from,
        valid_to = :valid_to,
        usage_limit = :usage_limit,
        usage_per_user = :usage_per_user,
        min_order_value = :min_order_value,
        therapist_id = :therapist_id,
        applicable_categories = :applicable_categories,
        applicable_products = :applicable_products,
        internal_notes = :internal_notes
      WHERE id = :id
      RETURNING *
      `,
      {
        replacements: {
          id,
          status,
          value,
          code,
          type,
          scope,
          owner_type,
          is_stackable,
          max_discount: max_discount || null,
          valid_from: valid_from || null,
          valid_to: valid_to || null,
          usage_limit: usage_limit || null,
          usage_per_user: usage_per_user || null,
          min_order_value: min_order_value || null,
          therapist_id: therapist_id || null,
          applicable_categories: applicable_categories || null,
          applicable_products: applicable_products || null,
          internal_notes: internal_notes || null,
        },
        type: QueryTypes.UPDATE,
      }
    );

    if (!result[0].length) {
      return res.status(404).json({ status: false, message: "Coupon not found" });
    }

    res.json({ status: true, data: result[0][0] });
  } catch (error) {
    console.error("updateCoupon error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

/* =========================
   DELETE COUPON
========================= */
exports.deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const coupon = await sequelize.query(
      `SELECT * FROM coupons WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!coupon.length) {
      return res.status(404).json({ status: false, message: "Coupon not found" });
    }
    await sequelize.query(`DELETE FROM coupons WHERE id = :id`, {
      replacements: { id },
      type: QueryTypes.DELETE,
    });

    res.json({ status: true, message: "Coupon deleted successfully" });
  } catch (error) {
    console.error("deleteCoupon error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getAllCoupons= async(req,res)=>{
try {
    const result = await sequelize.query(
        `select id, code ,value,type from coupons where status='Active' and valid_from <= NOW() and valid_to >= NOW()`,
    )
    if (!result.length) {
      return res.error("Coupons not found", 404);
    }   
    return res.success(result, "result fetched successfully");
  } catch (error) {
    console.error("getAllCoupons error:", error);
    return res.error("Failed to fetch coupons");
  }
}
/* =========================
   APPLY COUPON
========================= */
exports.applyCoupon = async (req, res) => {
  try {
    const {
      code,
      order_amount,
      category_id,
      product_id
    } = req.body;
    const user_id = req.user.id;
console.log("Apply coupon request body:", req.body, "User ID:", user_id);
    if (!code || !user_id || !order_amount) {
      return res.status(400).json({
        status: false,
        message: "code and order_amount are required",
      });
    }

    const normalizedCode = code.trim().toUpperCase();

    /* ===============================
       1. FETCH COUPON
    =============================== */
    const couponResult = await sequelize.query(
      `
      SELECT * FROM coupons
      WHERE UPPER(code) = :code
      AND status = 'Active'
      AND (valid_from IS NULL OR valid_from <= NOW())
      AND (valid_to IS NULL OR valid_to >= NOW())
      LIMIT 1
      `,
      {
        replacements: { code: normalizedCode },
        type: QueryTypes.SELECT,
      }
    );

    if (!couponResult.length) {
      return res.status(400).json({
        status: false,
        message: "Invalid or expired coupon",
      });
    }

    const coupon = couponResult[0];

    /* ===============================
       2. MIN ORDER CHECK
    =============================== */
    if (
      coupon.min_order_value &&
      Number(order_amount) < Number(coupon.min_order_value)
    ) {
      return res.status(400).json({
        status: false,
        message: `Minimum order value is ${coupon.min_order_value}`,
      });
    }

    /* ===============================
       3. USAGE LIMIT CHECK
    =============================== */
    if (coupon.usage_limit) {
      const usageCount = await sequelize.query(
        `SELECT COUNT(*) as total FROM coupon_usages WHERE coupon_id = :coupon_id`,
        {
          replacements: { coupon_id: coupon.id },
          type: QueryTypes.SELECT,
        }
      );

      if (usageCount[0].total >= coupon.usage_limit) {
        return res.status(400).json({
          status: false,
          message: "Coupon usage limit reached",
        });
      }
    }

    /* ===============================
       4. PER USER LIMIT CHECK
    =============================== */
    if (coupon.usage_per_user) {
      const userUsage = await sequelize.query(
        `
        SELECT COUNT(*) as total
        FROM coupon_usages
        WHERE coupon_id = :coupon_id
        AND user_id = :user_id
        `,
        {
          replacements: { coupon_id: coupon.id, user_id },
          type: QueryTypes.SELECT,
        }
      );

      if (userUsage[0].total >= coupon.usage_per_user) {
        return res.status(400).json({
          status: false,
          message: "You have already used this coupon maximum times",
        });
      }
    }

    /* ===============================
       5. SCOPE CHECK
    =============================== */
    if (coupon.scope === "Category") {
      if (!category_id) {
        return res.status(400).json({
          status: false,
          message: "Category coupon requires category_id",
        });
      }

      if (
        !coupon.applicable_categories ||
        !coupon.applicable_categories.includes(category_id)
      ) {
        return res.status(400).json({
          status: false,
          message: "Coupon not applicable for this category",
        });
      }
    }

    if (coupon.scope === "Product") {
      if (!product_id) {
        return res.status(400).json({
          status: false,
          message: "Product coupon requires product_id",
        });
      }

      if (
        !coupon.applicable_products ||
        !coupon.applicable_products.includes(product_id)
      ) {
        return res.status(400).json({
          status: false,
          message: "Coupon not applicable for this product",
        });
      }
    }

    /* ===============================
       6. CALCULATE DISCOUNT
    =============================== */
    let discount = 0;
    if (coupon.type === "flat") {
      discount = Number(coupon.value);
    }

    if (coupon.type === "percent") {
      discount = (Number(order_amount) * Number(coupon.value)) / 100;

      if (coupon.max_discount && discount > coupon.max_discount) {
        discount = Number(coupon.max_discount);
      }
    }

    if (discount > order_amount) {
      discount = order_amount;
    }

    const finalAmount = Number(order_amount) - discount;

    return res.json({
      status: true,
      message: "Coupon applied successfully",
      data: {
        coupon_id: coupon.id,
        code: coupon.code,
        discount,
        final_amount: finalAmount,
      },
    });

  } catch (error) {
    console.error("applyCoupon error:", error);
    return res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};
