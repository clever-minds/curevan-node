require('dotenv').config();
const { sequelize } = require('./src/config/db');

async function test() {
  try {
    const products = await sequelize.query(`SELECT id, title, is_recommended, service_type_id FROM products LIMIT 5;`);
    console.log("PRODUCTS:", products[0]);
    const cats = await sequelize.query(`SELECT id, name FROM categories;`);
    console.log("CATEGORIES:", cats[0]);
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

test();
