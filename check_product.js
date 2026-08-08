const { sequelize } = require("./src/config/db");

async function checkData() {
  try {
    const products = await sequelize.query(`
      SELECT p.id, p.title, p.sku, COALESCE(p.gst_slab, 0) AS gst_slab,
      (SELECT COALESCE(json_agg(pv.*), '[]') FROM product_variants pv WHERE pv.product_id = p.id) AS variants
      FROM products p
      WHERE p.sku = 'HC-73';
    `, { type: sequelize.QueryTypes.SELECT });
    console.log(JSON.stringify(products, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("Database query failed:", err);
    process.exit(1);
  }
}

checkData();
