
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

// Unpaid shop orders older than 30 minutes give their reserved stock back (every 10 minutes).
const { releaseExpiredPendingOrders } = require('./controllers/orders/orderController');
const releaseTimer = setInterval(async () => {
  try {
    const n = await releaseExpiredPendingOrders();
    if (n > 0) console.log(`Released ${n} expired unpaid order(s).`);
  } catch (err) {
    console.error('Cron Error releasing unpaid orders:', err.message);
  }
}, 10 * 60 * 1000);
releaseTimer.unref();

console.log('Cron jobs initialized.');
