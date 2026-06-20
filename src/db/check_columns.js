const { Sequelize } = require("sequelize");

const sequelize = new Sequelize("curevan", "postgres", "postgres", {
  host: "localhost",
  dialect: "postgres",
  logging: false,
});

async function run() {
  try {
    await sequelize.authenticate();
    const rows = await sequelize.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
    console.log(rows[0].map(r => r.column_name).join(", "));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

run();
