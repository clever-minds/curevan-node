const { sequelize } = require("./src/config/db");

async function addColumn() {
  try {
    await sequelize.query(`
      ALTER TABLE knowledge_base 
      ADD COLUMN IF NOT EXISTS faqs JSONB DEFAULT '[]'::jsonb;
    `);
    console.log("Column 'faqs' added successfully or already exists!");
    process.exit(0);
  } catch (err) {
    console.error("Error adding column:", err);
    process.exit(1);
  }
}

addColumn();
