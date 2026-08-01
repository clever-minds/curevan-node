const { sequelize } = require('./src/config/db');

async function run() {
  const [res] = await sequelize.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema='public' 
    AND table_name LIKE '%categor%';
  `);
  console.log('Tables containing category:', res.map(r => r.table_name));
  process.exit(0);
}
run();
