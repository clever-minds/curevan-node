const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
/* =========================
   ADD PRODUCT
========================= */
exports.addProduct = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      productType, title, subtitle, shortDescription, longDescription,
      brand, sku, category, mrp, sellingPrice,
      isTaxInclusive, isCouponExcluded,
      hsnCode, sacCode, gstSlab, status,
      length_cm, width_cm, height_cm, weight_kg,
      manufacturer, country_of_origin, packer, importer, batch_number,
      manufacturing_date, expiry_date, tags, image_ids,
      stock, reorderPoint
    } = req.body;

    if (!title || !sku || !category) {
      return res.status(400).json({ message: 'Title, SKU and Category are required' });
    }

    // ✅ Ensure tags is valid JSON
    const tagsJSON = tags ? JSON.stringify(tags) : '[]'; // store empty array if no tags

    // ✅ Ensure image_ids is always an array - handle null/undefined
    let imageIdsArray = [];
    if (image_ids) {
      imageIdsArray = Array.isArray(image_ids) ? image_ids : [image_ids];
    }

    // Insert product
    const [product] = await sequelize.query(
      `INSERT INTO products (
          product_type, title, subtitle, short_description, long_description,
          brand, sku, category_id, mrp, selling_price,
          is_tax_inclusive, is_coupon_excluded,
          hsn_code, sac_code, gst_slab, status,
          length_cm, width_cm, height_cm, weight_kg,
          manufacturer, country_of_origin, packer, importer, batch_number,
          manufacturing_date, expiry_date, tags,
          image_ids
        ) VALUES (
          :productType, :title, :subtitle, :shortDescription, :longDescription,
          :brand, :sku, :category, :mrp, :sellingPrice,
          :isTaxInclusive, :isCouponExcluded,
          :hsnCode, :sacCode, :gstSlab, :status,
          :length_cm, :width_cm, :height_cm, :weight_kg,
          :manufacturer, :country_of_origin, :packer, :importer, :batch_number,
          :manufacturing_date, :expiry_date, :tags::json,
          ARRAY[:image_ids]::integer[]
        )
        RETURNING id`,
      {
        replacements: {
          productType, title, subtitle, shortDescription, longDescription,
          brand, sku, category, mrp, sellingPrice,
          isTaxInclusive, isCouponExcluded,
          hsnCode: hsnCode ?? null,
          sacCode: sacCode ?? null,
          gstSlab, status,
          length_cm, width_cm, height_cm, weight_kg,
          manufacturer, country_of_origin, packer, importer, batch_number,
          manufacturing_date, expiry_date,
          tags: tagsJSON,
          image_ids: imageIdsArray.length > 0 ? imageIdsArray.join(',') : ''
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const productId = product[0].id;

    // Insert inventory
    await sequelize.query(
      `INSERT INTO inventory (product_id, sku, warehouse_id, on_hand, reorder_point)
      VALUES (:productId, :sku, :warehouse_id, :stock, :reorderPoint)`,
      {
        replacements: {
          productId,
          sku,
          stock: stock || 0,
          warehouse_id: 0,
          reorderPoint: reorderPoint || 0
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    await t.commit();
    res.status(201).json({ success: true, message: 'Product added successfully', productId });

  } catch (error) {
    await t.rollback();
    if (error.original?.code === '23505') {
      return res.status(409).json({ message: 'SKU already exists' });
    }
    console.error(error);
    res.status(500).json({ message: 'Failed to add product' });
  }

};


/* =========================
   LIST PRODUCTS
========================= */
exports.listProducts = async (req, res) => {
  try {
    const products = await sequelize.query(
      ` SELECT 
      p.*,
      p.title AS name,p.selling_price as price,
      p.category_id AS "categoryId",
      c.name AS category_name,
      i.on_hand AS "onHand",
      i.reserved,
      i.reorder_point,
      m.file_path AS "featuredImage"
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN inventory i ON i.product_id = p.id
  LEFT JOIN media m 
      ON m.id = p.image_ids[1]
  ORDER BY p.created_at DESC`,
      { type: QueryTypes.SELECT }
    );
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
};

/* =========================
   GET SINGLE PRODUCT
========================= */
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await sequelize.query(
      `
      SELECT 
        p.*,
        i.on_hand,
        i.reorder_point,

        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', m.id,
              'url', m.file_path,
              'type', m.media_type
            )
          ) FILTER (WHERE m.id IS NOT NULL),
          '[]'
        ) AS images

      FROM products p
      LEFT JOIN inventory i 
        ON i.product_id = p.id

      LEFT JOIN media m 
        ON m.id = ANY (p.image_ids)

      WHERE p.id = :id
      GROUP BY p.id, i.on_hand, i.reorder_point
      `,
      {
        replacements: { id },
        type: QueryTypes.SELECT,
      }
    );

    if (!product.length) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch product' });
  }
};


/* =========================
   UPDATE PRODUCT
========================= */

exports.updateProduct = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;

    const {
      productType,
      title,
      subtitle,
      shortDescription,
      longDescription,
      brand,
      sku,
      category,
      mrp,
      sellingPrice,
      isTaxInclusive,
      isCouponExcluded,
      hsnCode,
      sacCode,
      gstSlab,
      status,
      stock,
      reorderPoint,
      image_ids,

      length_cm,
      width_cm,
      height_cm,
      weight_kg,
      manufacturer,
      country_of_origin,
      packer,
      importer,
      batch_number,
      manufacturing_date,
      expiry_date,
      tags
    } = req.body;

    // ---------------- IMAGE IDS (INTEGER ARRAY) ----------------
    const imageIds = Array.isArray(image_ids)
      ? image_ids.map(Number).filter(n => !isNaN(n))
      : [];

    // ---------------- TAGS JSON ----------------
    const tagsJSON = JSON.stringify(tags || []);

    // ---------------- PRODUCT UPDATE QUERY ----------------
    let updateQuery = `
      UPDATE products SET
        product_type = :productType,
        title = :title,
        subtitle = :subtitle,
        short_description = :shortDescription,
        long_description = :longDescription,
        brand = :brand,
        sku = :sku,
        category_id = :category,
        mrp = :mrp,
        selling_price = :sellingPrice,
        is_tax_inclusive = :isTaxInclusive,
        is_coupon_excluded = :isCouponExcluded,
        hsn_code = :hsnCode,
        sac_code = :sacCode,
        gst_slab = :gstSlab,
        status = :status,
        length_cm = :length_cm,
        width_cm = :width_cm,
        height_cm = :height_cm,
        weight_kg = :weight_kg,
        manufacturer = :manufacturer,
        country_of_origin = :country_of_origin,
        packer = :packer,
        importer = :importer,
        batch_number = :batch_number,
        manufacturing_date = :manufacturing_date,
        expiry_date = :expiry_date,
        tags = :tags::json
    `;

    // update image_ids only if provided
    if (imageIds.length > 0) {
      updateQuery += `, image_ids = ARRAY[:image_ids]::integer[]`;
    }

    updateQuery += ` WHERE id = :id`;

    const replacements = {
      id,
      productType,
      title,
      subtitle,
      shortDescription,
      longDescription,
      brand,
      sku,
      category,
      mrp,
      sellingPrice,
      isTaxInclusive,
      isCouponExcluded,
      hsnCode: hsnCode || null,
      sacCode: sacCode || null,
      gstSlab,
      status,
      length_cm,
      width_cm,
      height_cm,
      weight_kg,
      manufacturer,
      country_of_origin,
      packer,
      importer,
      batch_number,
      manufacturing_date,
      expiry_date,
      tags: tagsJSON
    };

    if (imageIds.length > 0) {
      replacements.image_ids = imageIds; // MUST be array
    }

    // ---------------- EXECUTE PRODUCT UPDATE ----------------
    await sequelize.query(updateQuery, {
      replacements,
      type: QueryTypes.UPDATE,
      transaction: t
    });

    // ---------------- INVENTORY UPDATE ----------------
    await sequelize.query(
      `
      UPDATE inventory SET
        sku = :sku,
        on_hand = :stock,
        reorder_point = :reorderPoint
      WHERE product_id = :id
      `,
      {
        replacements: {
          id,
          sku,
          stock: stock || 0,
          reorderPoint: reorderPoint || 0
        },
        type: QueryTypes.UPDATE,
        transaction: t
      }
    );

    await t.commit();

    res.json({
      success: true,
      message: 'Product updated successfully'
    });

  } catch (error) {
    await t.rollback();
    console.error('UPDATE PRODUCT ERROR:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to update product'
    });
  }
};



/* =========================
   DELETE PRODUCT
========================= */
exports.deleteProduct = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;

    // inventory delete
    await sequelize.query(
      `DELETE FROM inventory WHERE product_id = :id`,
      {
        replacements: { id },
        transaction
      }
    );

    // product delete
    const result = await sequelize.query(
      `DELETE FROM products WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE,
        transaction
      }
    );

    // result = number of affected rows
    if (result === 0) {
      await transaction.rollback();
      return res.status(404).json({ message: "Product not found" });
    }

    await transaction.commit();
    res.json({ message: "Product deleted successfully" });

  } catch (error) {
    await transaction.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to delete product" });
  }
};

exports.getProduct = async (req, res) => {
  try {
    const products = await sequelize.query(
      `SELECT 
        p.*,
        p.title AS name,
        p.selling_price AS price,
        p.category_id AS "categoryId",
        c.name AS categoryname,
        i.on_hand AS "onHand",
        i.reserved,
        i.reorder_point,
        m.file_path AS "featuredImage"
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN inventory i ON i.product_id = p.id
      LEFT JOIN media m ON m.id = p.image_ids[1]`,
      { type: QueryTypes.SELECT }
    );

    return res.success(products, "Products fetched successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch products");
  }
};


exports.getProductsByIds = async (req, res) => {
  try {
    const { ids } = req.body; // expecting { ids: [22, 23] }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No product IDs provided', data: [] });
    }

    const products = await sequelize.query(
      `
      SELECT 
        p.*,
        p.id as 'productId  ',
        p.title AS name,
        p.selling_price AS price,
        p.category_id AS "categoryId",
        c.name AS category_name,
        i.on_hand AS "onHand",
        i.reserved,
        i.reorder_point,
        m.file_path AS "featuredImage",
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', m2.id,
              'url', m2.file_path,
              'type', m2.media_type
            )
          ) FILTER (WHERE m2.id IS NOT NULL),
          '[]'
        ) AS images
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN inventory i ON i.product_id = p.id
      LEFT JOIN media m ON m.id = p.image_ids[1]
      LEFT JOIN media m2 ON m2.id = ANY(p.image_ids)
      WHERE p.id = ANY(:ids::int[])
      GROUP BY p.id, c.name, i.on_hand, i.reserved, i.reorder_point, m.file_path
      ORDER BY p.created_at DESC
      `,
      {
        replacements: { ids },
        type: QueryTypes.SELECT
      }
    );

    return res.success(products, "Products fetched successfully");

  } catch (error) {
    console.error('getProductsByIds ERROR:', error);
    return res.error("Failed to fetch products");
  }
};
