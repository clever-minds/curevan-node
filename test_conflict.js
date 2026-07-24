const {sequelize, QueryTypes} = require('./src/config/db');

async function run() {
  const t = await sequelize.transaction();
  try {
    // 1. Insert product 1000
    await sequelize.query(`INSERT INTO products (id, sku, title, category_id, product_type) VALUES (1000, 'TEST-PROD-SKU', 'Test', 1, 'Physical')`, {transaction: t});
    
    // 2. Insert variant 'TEST-VAR-SKU'
    await sequelize.query(`INSERT INTO product_variants (product_id, sku, mrp, selling_price, attributes) VALUES (1000, 'TEST-VAR-SKU', 10, 10, '{}'::jsonb)`, {transaction: t});
    
    await t.commit();
    console.log("Setup done");
  } catch(e) {
    await t.rollback();
    console.error("Setup error", e.message);
  }

  const t2 = await sequelize.transaction();
  try {
    // 3. Delete variant
    await sequelize.query(`DELETE FROM product_variants WHERE product_id = 1000`, {replacements:{id:1000}, type: QueryTypes.DELETE, transaction: t2});
    
    // 4. Insert variant with SAME SKU
    await sequelize.query(`INSERT INTO product_variants (product_id, sku, mrp, selling_price, attributes) VALUES (1000, 'TEST-VAR-SKU', 10, 10, '{}'::jsonb)`, {transaction: t2});
    
    await t2.commit();
    console.log("Update done successfully!");
  } catch (e) {
    await t2.rollback();
    console.error("Update error:", e.original?.code, e.message);
  } finally {
    // Cleanup
    await sequelize.query(`DELETE FROM products WHERE id=1000`);
    process.exit();
  }
}
run();
