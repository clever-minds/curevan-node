const { sequelize } = require('./src/config/db');

async function getTables() {
  const [results] = await sequelize.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  console.log(results.map(r => r.table_name).join(', '));
  process.exit();
}
getTables();
