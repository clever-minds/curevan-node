const { sequelize } = require('../config/db');

async function alterProductVariantsAddImage() {
  try {
    console.log("Adding image_id column to product_variants...");
    await sequelize.query(`
      ALTER TABLE product_variants 
      ADD COLUMN IF NOT EXISTS image_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
    `);

    console.log("image_id column added successfully.");
  } catch (error) {
    console.error("Error altering product_variants table:", error);
  } finally {
    process.exit();
  }
}

alterProductVariantsAddImage();
