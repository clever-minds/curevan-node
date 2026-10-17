const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

exports.listInventory = async (req, res) => {
  try {
    const inventory = await sequelize.query(
      `
      SELECT
        id,
        product_id AS "productId",
        on_hand as "onHand",
        reorder_point AS "reorderPoint",
        warehouse_id AS "warehouseId",
  updated_at AS "updatedAt"
      FROM inventory
      ORDER BY id DESC
      `,
      { type: QueryTypes.SELECT }
    );

    res.json(inventory);
  } catch (error) {
    console.error('Inventory fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory'
    });
  }
};

exports.getInventoryForecast = async (req, res) => {
  try {
    const rows = await sequelize.query(
      `
      SELECT
        p.id AS "productId",
        p.title AS "productName",
        COALESCE(MAX(i.sku), p.sku, ('SKU-' || p.id)) AS "sku",
        COALESCE(SUM(i.on_hand), 0)::int AS "onHand",
        COALESCE(SUM(i.reserved), 0)::int AS "reserved",
        GREATEST(0, COALESCE(SUM(i.on_hand), 0) - COALESCE(SUM(i.reserved), 0))::int AS "stock",
        COALESCE(MAX(i.reorder_point), 0)::int AS "reorderPoint",
        COALESCE(MAX(s.sold_30d), 0)::int AS "sold30d"
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      LEFT JOIN (
        SELECT oi.sku, SUM(oi.qty) AS sold_30d
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.payment_status = 'Paid'
          AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY oi.sku
      ) s ON s.sku = COALESCE(i.sku, p.sku)
      GROUP BY p.id, p.title, p.sku
      ORDER BY p.id ASC
      `,
      { type: QueryTypes.SELECT }
    );

    const data = rows.map((r) => {
      const stock = Math.max(0, Number(r.stock) || 0);
      const sold30d = Number(r.sold30d) || 0;
      const reorderPoint = Number(r.reorderPoint) || 0;
      const runRate = Math.round((sold30d / 30.0) * 100) / 100;
      let daysCover;
      if (sold30d === 0) {
        daysCover = stock > 0 ? 999 : 0;
      } else {
        daysCover = Math.floor(stock / (sold30d / 30.0));
      }
      return {
        productId: r.productId,
        productName: r.productName,
        sku: r.sku,
        onHand: Number(r.onHand),
        reserved: Number(r.reserved),
        stock,
        reorderPoint,
        sold30d,
        runRate,
        daysCover,
        isLowStock: stock <= reorderPoint
      };
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error("Inventory forecast error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch inventory forecast"
    });
  }
};
