const { sequelize } = require('./src/config/db');
sequelize.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'order_items'").then(res => console.log(res[0])).catch(console.error).finally(() => process.exit());
