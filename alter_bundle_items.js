const { sequelize } = require('./src/config/db');

async function alterTable() {
  try {
    await sequelize.query(`
      ALTER TABLE product_bundle_items 
      ADD COLUMN IF NOT EXISTS selling_price NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gst_slab NUMERIC DEFAULT 0;
    `);
    console.log("Table altered successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to alter table:", err);
    process.exit(1);
  }
}

alterTable();
