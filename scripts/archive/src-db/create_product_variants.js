const { sequelize } = require('../config/db');

async function createProductVariantsTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS product_variants (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        sku VARCHAR(255) UNIQUE NOT NULL,
        mrp DECIMAL(10, 2),
        selling_price DECIMAL(10, 2),
        attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
        stock INTEGER DEFAULT 0,
        reorder_point INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sequelize.query(query);
    console.log("product_variants table created successfully.");
  } catch (error) {
    console.error("Error creating product_variants table:", error);
  } finally {
    process.exit();
  }
}

createProductVariantsTable();
