const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

console.log("🚀 Migration started");

// ✅ MongoDB connect (Node 22 compatible)
mongoose.connect("mongodb://127.0.0.1:27017/curevan")
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB error", err);
    process.exit(1);
  });

const EXPORTS_DIR = path.join(__dirname, "exports");

// Generic schema
const genericSchema = new mongoose.Schema({}, { strict: false });

// 🔁 Recursively find JSON files
function findJsonFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);

  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat && stat.isDirectory()) {
      results = results.concat(findJsonFiles(filePath));
    } else if (file.endsWith(".json")) {
      results.push(filePath);
    }
  });

  return results;
}

async function migrate() {
  try {
    const collections = fs.readdirSync(EXPORTS_DIR);

    for (const collectionName of collections) {
      const collectionPath = path.join(EXPORTS_DIR, collectionName);

      if (!fs.statSync(collectionPath).isDirectory()) continue;

      console.log(`\n📂 Migrating: ${collectionName}`);

      const Model =
        mongoose.models[collectionName] ||
        mongoose.model(collectionName, genericSchema, collectionName);

      const jsonFiles = findJsonFiles(collectionPath);
      let count = 0;

      for (const filePath of jsonFiles) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

        const firebaseId = path.basename(filePath).replace(".json", "");

        await Model.create({
          firebaseId,
          ...data
        });

        count++;
      }

      console.log(`✅ ${collectionName} → ${count} records inserted`);
    }

    console.log("\n🎉 FULL MIGRATION COMPLETED");
    mongoose.disconnect();

  } catch (err) {
    console.error("❌ Migration failed:", err);
    mongoose.disconnect();
  }
}

migrate();
