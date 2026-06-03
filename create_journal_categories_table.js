const { sequelize } = require('./src/config/db');

async function createTable() {
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS journal_categories (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) NOT NULL UNIQUE,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Table journal_categories created.");
    
    // Check if table is empty
    const [results] = await sequelize.query(`SELECT COUNT(*) as count FROM journal_categories`);
    if (parseInt(results[0].count) === 0) {
      const defaultCategories = [
        "Physiotherapy",
        "Nursing Care",
        "Geri care Therapy",
        "Speech Therapy",
        "Mental Health Counseling",
        "Dietitian/Nutritionist",
        "Respiratory Therapy",
        "Acupuncture",
        "Operations",
        "Earnings",
        "Clinical",
      ];
      for (const cat of defaultCategories) {
        const slug = cat.toLowerCase().replace(/ /g, '-');
        await sequelize.query(
          `INSERT INTO journal_categories (name, slug) VALUES (:name, :slug)`,
          {
            replacements: { name: cat, slug: slug }
          }
        );
      }
      console.log("Default categories inserted.");
    }
  } catch (error) {
    console.error(error);
  } finally {
    process.exit();
  }
}
createTable();
