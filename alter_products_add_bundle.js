const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: 'postgres',
    port: process.env.DB_PORT || 5432,
    logging: console.log,
  }
);

async function alterDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Connected to the database.');

    // Create product_bundle_items table
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS product_bundle_items (
        id SERIAL PRIMARY KEY,
        bundle_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        component_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        component_variant_sku VARCHAR(255),
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('product_bundle_items table created or verified.');

    // We also need to check if product_type constraint allows 'Bundle'
    // By default, product_type might be a VARCHAR or ENUM. If it's a VARCHAR, nothing to do.
    // Let's just assume it's VARCHAR for now since the frontend sends 'Bundle'.
    // If it was an ENUM we would need: ALTER TYPE product_type ADD VALUE IF NOT EXISTS 'Bundle';

  } catch (error) {
    console.error('Error altering database:', error);
  } finally {
    await sequelize.close();
  }
}

alterDatabase();
