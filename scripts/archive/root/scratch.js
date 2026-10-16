const {sequelize} = require('./src/config/db');
sequelize.query("SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name='inventory'")
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());
