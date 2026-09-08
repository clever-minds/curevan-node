const { sequelize } = require("./src/config/db");

async function alterSkuColumn() {
  try {
    await sequelize.query(`ALTER TABLE products ALTER COLUMN sku DROP NOT NULL;`);
    console.log("Successfully dropped NOT NULL constraint on sku in products table.");
    process.exit(0);
  } catch (err) {
    console.error("Error altering column:", err);
    process.exit(1);
  }
}

alterSkuColumn();
