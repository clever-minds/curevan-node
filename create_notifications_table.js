require('dotenv').config();
const { sequelize } = require('./src/config/db.js');

async function createTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_uid VARCHAR(255) NOT NULL,
      type VARCHAR(100),
      title VARCHAR(255) NOT NULL,
      message TEXT,
      is_read BOOLEAN DEFAULT false,
      link VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await sequelize.query(createTableQuery);
    console.log("Notifications table created successfully!");
  } catch (err) {
    console.error("Failed to create table:", err);
  } finally {
    process.exit(0);
  }
}

createTable();
