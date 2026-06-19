require("dotenv").config({ path: "../../.env" });
const { sequelize } = require("../config/db");

async function runAlter() {
  try {
    await sequelize.authenticate();
    console.log("✅ DB Connected");

    // Make therapist_id nullable in appointments
    await sequelize.query(`ALTER TABLE appointments ALTER COLUMN therapist_id DROP NOT NULL;`);
    await sequelize.query(`ALTER TABLE appointments ALTER COLUMN therapist_name DROP NOT NULL;`);
    console.log("✅ Successfully made therapist_id and therapist_name nullable in appointments table.");

    // Make therapist_id nullable in pcr
    await sequelize.query(`ALTER TABLE pcr ALTER COLUMN therapist_id DROP NOT NULL;`);
    console.log("✅ Successfully made therapist_id nullable in pcr table.");

    process.exit(0);
  } catch (err) {
    console.error("❌ Error running alter query:", err.message);
    process.exit(1);
  }
}

runAlter();
