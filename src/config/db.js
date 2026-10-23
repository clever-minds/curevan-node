require("dotenv").config(); // 👈 sabse upar

const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_NAME,      // curevan_db
  process.env.DB_USER,      // postgres
  process.env.DB_PASSWORD,  // password
  {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    dialect: "postgres",
    logging: false,
    timezone: "+05:30",
    // a managed / remote PostgreSQL (for example AWS RDS) often refuses plain connections: set DB_SSL=true
    ...(require("./dbSsl").dialectOptions()),
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
