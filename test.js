const { sequelize } = require('./src/config/db');
async function test() {
  try {
    await sequelize.query(`SELECT o.*, o.id as "orderId",
      COALESCE(
        json_agg(
          jsonb_build_object(
            'id', oi.id,
            'name', oi.name,
            'quantity', oi.qty,
            'price', oi.price,
            'tax_rate_pct', oi.tax_rate_pct,
            'price_excl_gst', ROUND(oi.price / (1 + (oi.tax_rate_pct/100))::numeric, 2),
            'gst_amount', ROUND(oi.price - (oi.price / (1 + (oi.tax_rate_pct/100)))::numeric, 2),
            'cgst', CASE WHEN true THEN ROUND((oi.price - (oi.price / (1 + (oi.tax_rate_pct/100)))) / 2, 2) ELSE 0 END,
            'sgst', CASE WHEN true THEN ROUND((oi.price - (oi.price / (1 + (oi.tax_rate_pct/100)))) / 2, 2) ELSE 0 END,
            'igst', CASE WHEN NOT true THEN ROUND((oi.price - (oi.price / (1 + (oi.tax_rate_pct/100)))), 2) ELSE 0 END,
            'variantAttributes', pv.attributes,
            'components', '[]'::json
          )
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON oi.variant_id = pv.id
      WHERE o.id = 66
      GROUP BY o.id`);
    console.log('Success');
  } catch(e) {
    console.error('ERROR:', e.message);
  }
  process.exit(0);
}
test();
