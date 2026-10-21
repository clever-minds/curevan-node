const { sequelize } = require('../config/db');

async function alterInventoryConstraint() {
  try {
    console.log("Dropping old unique constraint...");
    await sequelize.query(`
      ALTER TABLE inventory 
      DROP CONSTRAINT IF EXISTS uq_inventory_product_warehouse;
    `);

    console.log("Adding new unique constraint on sku and warehouse_id...");
    await sequelize.query(`
      ALTER TABLE inventory 
      ADD CONSTRAINT uq_inventory_sku_warehouse UNIQUE (sku, warehouse_id);
    `);
    
    console.log("Inventory constraint altered successfully.");
  } catch (error) {
    console.error("Error altering inventory constraint:", error);
  } finally {
    process.exit();
  }
}

alterInventoryConstraint();
