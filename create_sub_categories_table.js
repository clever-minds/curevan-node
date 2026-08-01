const { sequelize } = require('./src/config/db');

async function createTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS sub_categories (
        id SERIAL PRIMARY KEY,
        category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    
    await sequelize.query(query);
    console.log('Successfully created sub_categories table!');
    
  } catch (error) {
    console.error('Error creating table:', error);
  } finally {
    process.exit();
  }
}

createTable();
