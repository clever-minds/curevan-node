require("dotenv").config({ path: "../../.env" });
const { sequelize } = require("../config/db");

async function runAlter() {
  try {
    await sequelize.authenticate();
    console.log("✅ DB Connected");

    await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT;`);
    console.log("✅ Successfully added fcm_token column to users table.");

    process.exit(0);
  } catch (err) {
    console.error("❌ Error running alter query:", err.message);
    process.exit(1);
  }
}

runAlter();
