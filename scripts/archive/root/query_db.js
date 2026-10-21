const { sequelize } = require("./src/config/db");

async function checkData() {
  try {
    const rows = await sequelize.query(`
      SELECT id, title, slug, content
      FROM knowledge_base;
    `, { type: sequelize.QueryTypes.SELECT });
    for (const row of rows) {
      console.log(`ID: ${row.id}, Title: ${row.title}`);
      if (row.content && row.content.includes('<script')) {
        console.log("  -> Contains <script tag!");
        console.log("  -> Content slice:", row.content.slice(row.content.indexOf('<script'), row.content.indexOf('<script') + 300));
      } else {
        console.log("  -> No script tag in content");
      }
    }
    process.exit(0);
  } catch (err) {
    console.error("Database query failed:", err);
    process.exit(1);
  }
}

checkData();
