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
