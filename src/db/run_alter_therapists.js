const { Sequelize } = require("sequelize");

const sequelize = new Sequelize("curevan", "postgres", "postgres", {
  host: "localhost",
  dialect: "postgres",
  logging: false,
});

async function run() {
  try {
    await sequelize.authenticate();
    await sequelize.query("ALTER TABLE therapist_profiles ADD COLUMN documents JSON DEFAULT '[]'::json;");
    console.log("Added documents column successfully.");
  } catch (err) {
    if (err.message.includes("already exists")) {
       console.log("Column already exists.");
    } else {
       console.error("Error adding column:", err.message);
    }
  } finally {
    process.exit();
  }
}

run();
