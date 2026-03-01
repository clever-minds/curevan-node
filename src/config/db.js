require("dotenv").config(); // 👈 sabse upar

const { Sequelize } = require("sequelize");

console.log("DB_NAME =", process.env.DB_NAME);
console.log("DB_USER =", process.env.DB_USER);
console.log("DB_PASSWORD =", process.env.DB_PASSWORD);
console.log("DB_HOST =", process.env.DB_HOST);
console.log("DB_PORT =", process.env.DB_PORT);
const sequelize = new Sequelize(
  process.env.DB_NAME,      // curevan_db
  process.env.DB_USER,      // postgres
  process.env.DB_PASSWORD,  // password
  {
    host: process.env.DB_HOST || "localhost",
    dialect: "postgres",
    logging: false
  }
);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("✅ PostgreSQL Connected");
  } catch (error) {
    console.error("❌ PostgreSQL Error:", error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
