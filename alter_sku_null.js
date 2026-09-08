const { Sequelize } = require('sequelize');

// Update with your AWS RDS credentials
const sequelize = new Sequelize('postgres://postgres:Admin%2391011@awsrdspg910111.cz6oywy0gdad.ap-south-1.rds.amazonaws.com:5432/curevan');

async function main() {
  try {
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');

    // Drop the NOT NULL constraint
    await sequelize.query(`ALTER TABLE products ALTER COLUMN sku DROP NOT NULL;`);
    console.log('Successfully dropped NOT NULL constraint on sku in products table.');

  } catch (error) {
    console.error('Unable to connect or alter table:', error);
  } finally {
    await sequelize.close();
  }
}

main();
