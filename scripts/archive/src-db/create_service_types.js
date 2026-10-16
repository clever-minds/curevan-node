require("dotenv").config({ path: "../.env" });
const { sequelize } = require("../config/db");

async function createTable() {
  try {
    await sequelize.authenticate();
    console.log("Connected to database");
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS service_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Table service_types created successfully");
    
    // Seed some initial data
    await sequelize.query(`
      INSERT INTO service_types (name)
      VALUES 
        ('Physiotherapy'), ('Nursing Care'), ('Geri care Therapy'), ('Speech Therapy'),
        ('Mental Health Counseling'), ('Dietitian/Nutritionist'), ('Respiratory Therapy'),
        ('Operations'), ('Earnings'), ('Clinical')
      ON CONFLICT DO NOTHING;
    `);
    console.log("Seeded initial data");
  } catch (err) {
    console.error("Error creating table:", err);
  } finally {
    process.exit();
  }
}

createTable();
