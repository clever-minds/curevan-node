const { sequelize } = require('./src/config/db');

async function run() {
  try {
    const [cols] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema='public'
    `);
    console.log('All tables:', cols.map(c => c.table_name));
  } catch (err) {
    console.error(err);
  }
  process.exit();
}
run();
