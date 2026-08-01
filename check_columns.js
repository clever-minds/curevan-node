const { sequelize } = require('./src/config/db');

async function run() {
  try {
    const [cols] = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name='categories'
    `);
    console.log('categories columns:', cols);
  } catch (err) {
    console.error(err);
  }
  process.exit();
}
run();
