require("dotenv").config({ path: "../../.env" });
const fs = require("fs");
const path = require("path");
const { sequelize } = require("../config/db");

async function runCreate() {
  try {
    const sqlPath = path.join(__dirname, "create_therapist_reviews.sql");
    const sql = fs.readFileSync(sqlPath, "utf-8");

    console.log("Running create_therapist_reviews.sql...");
    await sequelize.query(sql);

    console.log("✅ Successfully created therapist_reviews table.");
  } catch (error) {
    console.error("❌ Error running script:", error);
  } finally {
    process.exit(0);
  }
}

runCreate();
