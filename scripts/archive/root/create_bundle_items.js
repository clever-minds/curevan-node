const { sequelize } = require('./src/config/db');

async function migrate() {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS product_bundle_items (
        id SERIAL PRIMARY KEY,
        bundle_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        component_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        component_variant_sku VARCHAR(255),
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("product_bundle_items table created successfully.");
  } catch (err) {
    console.error("Migration failed", err);
  } finally {
    process.exit(0);
  }
}
migrate();
