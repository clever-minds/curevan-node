const { sequelize } = require('./src/config/db');
sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'product_bundle_items'").then(res => {
  console.log(JSON.stringify(res[0], null, 2));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
