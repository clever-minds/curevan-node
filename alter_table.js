const { sequelize } = require("./src/config/db");

async function runMigration() {
  try {
    console.log("Connecting to the database...");
    await sequelize.authenticate();
    console.log("Connection has been established successfully.");

    console.log("Adding fa_icon column...");
    await sequelize.query(`ALTER TABLE service_types ADD COLUMN IF NOT EXISTS fa_icon VARCHAR(255);`).catch(e => console.log("Note: fa_icon may already exist."));
    
    console.log("Adding description column...");
    await sequelize.query(`ALTER TABLE service_types ADD COLUMN IF NOT EXISTS description TEXT;`).catch(e => console.log("Note: description may already exist."));
    
    console.log("Removing icon_path column (ignoring if not exists)...");
    await sequelize.query(`ALTER TABLE service_types DROP COLUMN IF EXISTS icon_path;`).catch(e => console.log("Note: icon_path may already be removed."));

    console.log("✅ Database schema updated successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Unable to connect to the database or run query:", error);
    process.exit(1);
  }
}

runMigration();
