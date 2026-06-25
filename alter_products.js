require('dotenv').config();
const { sequelize } = require('./src/config/db');

async function alterTable() {
  try {
    await sequelize.query(`
      ALTER TABLE products 
      ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS service_type_id INTEGER;
    `);
    console.log("Successfully added is_recommended and service_type_id to products table.");
    process.exit(0);
  } catch (error) {
    console.error("Error altering table:", error);
    process.exit(1);
  }
}

alterTable();
