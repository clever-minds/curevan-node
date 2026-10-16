const {sequelize} = require('./src/config/db');
sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inventory'")
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());
