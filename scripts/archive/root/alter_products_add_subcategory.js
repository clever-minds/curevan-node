const { sequelize } = require('./src/config/db');

async function alterTable() {
  try {
    await sequelize.query('ALTER TABLE products ADD COLUMN sub_category_id BIGINT;');
    console.log('Successfully added sub_category_id to products');
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('sub_category_id already exists');
    } else {
      console.error('Error:', error);
    }
  }
  process.exit();
}

alterTable();
