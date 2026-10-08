
const cron = require('node-cron');
const { sequelize } = require('./config/db');

// Run every minute to check for scheduled posts
cron.schedule('* * * * *', async () => {
  try {
    const [result] = await sequelize.query(`
      UPDATE knowledge_base 
      SET status = 'published' 
      WHERE status = 'scheduled' 
      AND published_at IS NOT NULL 
      AND published_at <= CURRENT_TIMESTAMP
    `);
    if (result && result.rowCount > 0) {
      console.log(`Cron: Published ${result.rowCount} scheduled posts.`);
    }
  } catch (err) {
    console.error('Cron Error publishing posts:', err);
  }
});

console.log('Cron jobs initialized.');
