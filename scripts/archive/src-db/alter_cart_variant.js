const { sequelize } = require('../config/db');

async function alterCartAndOrderItems() {
  try {
    const query = `
      ALTER TABLE cart ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL;
    `;
    await sequelize.query(query);
    console.log("variant_id columns added to cart and order_items successfully.");
  } catch (error) {
    console.error("Error adding variant_id columns:", error);
  } finally {
    process.exit();
  }
}

alterCartAndOrderItems();
