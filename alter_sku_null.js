const { Sequelize } = require('sequelize');

// Adjust your connection string according to your env or hardcode for test
const sequelize = new Sequelize('postgres://postgres:@localhost:5432/curevan');

async function main() {
  try {
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');

    // Check if the constraint exists or just alter it directly
    await sequelize.query(`ALTER TABLE products ALTER COLUMN sku DROP NOT NULL;`);
    console.log('Successfully dropped NOT NULL constraint on sku in products table.');

  } catch (error) {
    console.error('Unable to connect or alter table:', error);
  } finally {
    await sequelize.close();
  }
}

main();
