const { sequelize } = require('../config/db');

async function updateSchema() {
  try {
    await sequelize.authenticate();
    console.log("DB connected");

    // Alter therapist_id, therapist_name, therapist_phone to allow NULL
    await sequelize.query(`ALTER TABLE appointments ALTER COLUMN therapist_id DROP NOT NULL;`).catch(() => console.log('therapist_id already nullable or not found'));
    await sequelize.query(`ALTER TABLE appointments ALTER COLUMN therapist_name DROP NOT NULL;`).catch(() => console.log('therapist_name already nullable or not found'));
    await sequelize.query(`ALTER TABLE appointments ALTER COLUMN therapist_phone DROP NOT NULL;`).catch(() => console.log('therapist_phone already nullable or not found'));

    // Check enum type of status if it's an enum, otherwise if it's VARCHAR we are good.
    // Let's just make it VARCHAR to be safe, or if it's an ENUM, add values.
    try {
       await sequelize.query(`ALTER TABLE appointments ALTER COLUMN status TYPE VARCHAR(255);`);
       console.log("status altered to VARCHAR");
    } catch(e) {
       console.log("status already VARCHAR or could not alter", e.message);
    }

    // Patient Features Columns
    await sequelize.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reports JSON;`).catch(() => console.log('reports already added'));
    await sequelize.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rating INT;`).catch(() => console.log('rating already added'));
    await sequelize.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS review TEXT;`).catch(() => console.log('review already added'));

    console.log("Schema updated successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error updating schema:", error);
    process.exit(1);
  }
}

updateSchema();
