/**
 * Seeds demo data (users with password "Test@1234", products, bookings, orders, refunds...) so the
 * website can be clicked through in a browser. Run after setup_db.js.
 */
const __db = process.env.DB_NAME || "curevan_test";
if (!/test/i.test(__db)) { console.error(`Refusing to run: DB_NAME "${__db}" does not look like a test database.`); process.exit(2); }
const bcrypt = require("bcrypt");
const { Client } = require("pg");

(async () => {
  const pg = new Client({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT) || 54329, database: process.env.DB_NAME || "curevan_test", user: process.env.DB_USER || "curevan", password: process.env.DB_PASSWORD || "testpw" });
  await pg.connect();
  const q = async (s, p) => (await pg.query(s, p)).rows;
  const hash = await bcrypt.hash("Test@1234", 10);
  for (const r of ["patient", "therapist", "admin.super", "admin.ecom", "admin.therapy"]) await q("INSERT INTO roles(name) VALUES ($1) ON CONFLICT DO NOTHING", [r]);
  const mk = async (uid, email, name, phone, role) => {
    // like production: users.role is the generic 'admin' for every admin; the real role is in user_roles
    const [u] = await q(`INSERT INTO users(uid,email,password,name,phone,role,is_verified,city,state) VALUES ($1,$2,$3,$4,$5,$6,true,'Vadodara','Gujarat') RETURNING *`, [uid, email, hash, name, phone, role.startsWith('admin.') ? 'admin' : role]);
    await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = $2", [u.id, role]);
    return u;
  };
  const p1 = await mk("patient-01", "patient@curevan.test", "Priya Patient", "9000000001", "patient");
  const t1 = await mk("therapist-01", "therapist@curevan.test", "Dr Tara Therapist", "9000000011", "therapist");
  await mk("admin-super-01", "super@curevan.test", "Sam Super", "9000000021", "admin.super");
  await mk("admin-ecom-01", "ecom@curevan.test", "Eva Ecom", "9000000023", "admin.ecom");
  await mk("admin-therapy-01", "therapy@curevan.test", "Theo Therapy", "9000000024", "admin.therapy");
  await q("INSERT INTO service_types(name) VALUES ('Physiotherapy'), ('Speech Therapy') ON CONFLICT DO NOTHING");
  const [tp] = await q("INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, specialty, membership_plan, bio, qualification, experience_years) VALUES ($1,1500,'approved','{1}','standard','Neuro physio','BPT',8) RETURNING id", [t1.id]);
  for (const d of ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]) await q("INSERT INTO therapist_availability(therapist_id, day_of_week, is_enabled, morning_start, morning_end, evening_start, evening_end) VALUES ($1,$2,true,'09:00','13:00','16:00','19:00')", [tp.id, d]);
  await q("INSERT INTO categories(name) VALUES ('Rehab')");
  await q("INSERT INTO products(title, selling_price, mrp, sku, category_id, hsn_code, gst_slab, is_tax_inclusive, weight_kg) VALUES ('Resistance Band', 1000, 1200, 'A1', 1, '9021', 18, false, 0.5), ('Therapy Ball', 590, 700, 'B1', 1, '9021', 18, true, 0.2)");
  await q("INSERT INTO inventory(product_id, sku, on_hand, reserved) VALUES (1,'A1',200,0), (2,'B1',200,0)");
  const [a1] = await q("INSERT INTO order_addresses(user_id, full_name, email, phone, full_address, city, state, pincode) VALUES ($1,'Priya Patient','patient@curevan.test','9000000001','1 Main St','Vadodara','Gujarat','390012') RETURNING id", [p1.id]);
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const mkAppt = async (n, status, pay, pcr, method) => (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, mode, status, payment_status, pcr_status, service_address_id, payment_method, razorpay_payment_id, paid_at)
    VALUES ($1,'Priya Patient',$2,'Dr Tara Therapist',1,'Physiotherapy',1500,1500,$3,'10:00','home',$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [p1.id, t1.id, day(n), status, pay, pcr, a1.id, method, method === 'razorpay' ? 'pay_demo' + n : null, pay === 'Paid' ? new Date() : null]))[0];
  const ap1 = await mkAppt(2, "confirmed", "Paid", "not_started", "razorpay");
  const ap2 = await mkAppt(-3, "completed", "Paid", "submitted", "manual_cash");
  const ap3 = await mkAppt(4, "accepted_unpaid", "Pending", "not_started", null);
  const ap4 = await mkAppt(5, "searching_therapist", "Pending", "not_started", null);
  for (const a of [ap1, ap2]) await q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version, chief_complaint) VALUES ($1,$2,$3,1,$4,1,'Knee pain')", [a.id, p1.id, t1.id, a.id === ap2.id ? "submitted" : "not_started"]);
  await q("INSERT INTO invoices(invoice_number, invoice_type, status, user_id, booking_id, total_amount_paise, issued_at) VALUES ('INV-BK-1','service','issued',$1,$2,150000,now()), ('INV-BK-2','service','issued',$1,$3,150000,now())", [p1.id, ap1.id, ap2.id]);
  await q("INSERT INTO payout_items(source_id, therapist_id, gross_amount, platform_fee_amount, gst_on_platform_fee, tds_deducted, net_amount, state, week_start) VALUES ($1,$2,1500,0,0,0,1500,'onHold',current_date)", [ap2.id, t1.id]);
  const [o1] = await q(`INSERT INTO orders(order_number, user_id, customer_name, subtotal, taxable_value, cgst, sgst, igst, total_tax, total, shipping_charges, status, payment_status, billing_address_id, shipping_address_id, razorpay_payment_id, paid_at)
    VALUES ('ORD-DEMO-1',$1,'Priya Patient',1180,1000,90,90,0,180,1230,50,'Placed','Paid',$2,$2,'pay_demo_o1',now()) RETURNING id`, [p1.id, a1.id]);
  await q("INSERT INTO order_items(order_id, sku, name, qty, price, mrp, hsn_code, tax_rate_pct) VALUES ($1,'A1','Resistance Band',1,1000,1200,'9021',18)", [o1.id]);
  await q("INSERT INTO invoices(invoice_number, invoice_type, status, user_id, order_id, total_amount_paise, cgst_amount, sgst_amount, issued_at) VALUES ('INV-ORD-1','order','issued',$1,$2,123000,90,90,now())", [p1.id, o1.id]);
  await q("INSERT INTO payment_transactions(txn_id, ref, user_id, order_id, amount, currency, status, gateway, razorpay_order_id, razorpay_payment_id) VALUES ('txn-1','ORD-DEMO-1',$1,$2,123000,'INR','paid','razorpay','order_demo1','pay_demo_o1')", [p1.id, o1.id]);
  await q("INSERT INTO order_refunds(order_id, user_id, amount, reason, transaction_id, status, razorpay_refund_id) VALUES ($1,$2,100,'damaged','pay_demo_o1','processed','rfnd_demo1')", [o1.id, p1.id]);
  await q("INSERT INTO order_returns(order_id, user_id, reason, status) VALUES ($1,$2,'Defective','Requested')", [o1.id, p1.id]);
  await q("INSERT INTO shipments(order_id, awb, carrier, status) VALUES ($1,'AWB123','Delhivery','In Transit')", [o1.id]).catch(() => {});
  console.log("UI demo data ready. Logins (password Test@1234): patient@ / therapist@ / super@ / ecom@ / therapy@ curevan.test");
  await pg.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
