const { sequelize } = require('../src/config/db');
const { QueryTypes } = require('sequelize');

async function checkColumns() {
  try {
    const columns = await sequelize.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'products'",
      { type: QueryTypes.SELECT }
    );
    console.log('Columns in products table:', columns.map(c => c.column_name));
    process.exit(0);
  } catch (error) {
    console.error('Error checking columns:', error);
    process.exit(1);
  }
}

checkColumns();
