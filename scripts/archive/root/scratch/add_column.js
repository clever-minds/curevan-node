const { sequelize } = require('../src/config/db');

async function addColumn() {
  try {
    await sequelize.query(
      "ALTER TABLE products ADD COLUMN additional_features JSONB DEFAULT '[]'::jsonb"
    );
    console.log('✅ Column additional_features added successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding column:', error);
    process.exit(1);
  }
}

addColumn();
