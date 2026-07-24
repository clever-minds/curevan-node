const {sequelize} = require('./src/config/db');
sequelize.query("SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'inventory' AND c.conname = 'uq_inventory_product_warehouse'")
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());
