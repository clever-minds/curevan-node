const { sequelize } = require('./src/config/db');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('Connected to PostgreSQL database');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS therapist_leaves (
        id SERIAL PRIMARY KEY,
        therapist_id INTEGER REFERENCES therapist_profiles(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        start_time TIME,
        end_time TIME,
        reason TEXT,
        status VARCHAR(50) DEFAULT 'approved',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sequelize.query(createTableQuery);
    console.log("Table 'therapist_leaves' created or verified successfully with start_date and end_date.");

    process.exit(0);
  } catch (error) {
    console.error('Error creating schema:', error);
    process.exit(1);
  }
}

run();
