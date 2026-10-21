require('dotenv').config();
const { sequelize } = require('./src/config/db');

async function migrate() {
  try {
    await sequelize.query(`
      ALTER TABLE knowledge_base DROP CONSTRAINT journal_status_check;
      ALTER TABLE knowledge_base ADD CONSTRAINT journal_status_check 
      CHECK (status = ANY (ARRAY['draft', 'pending_review', 'published', 'archived', 'rejected', 'scheduled']));
    `);
    console.log('Successfully updated journal_status_check on knowledge_base table to include scheduled status.');
    process.exit(0);
  } catch (err) {
    console.error('Error during migration:', err);
    process.exit(1);
  }
}

migrate();
