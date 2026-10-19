// Adds visit-flow demo bookings for browser testing (run after seed_ui.js):
//   #A confirmed + paid, slot in ~30 minutes with an address (therapist can start travel, patient sees the start code)
//   #B confirmed + paid (Razorpay payment), slot in ~6 hours  -> cancel dialog shows the 50% charge
const __db = process.env.DB_NAME || "curevan_test";
if (!/test/i.test(__db)) { console.error(`Refusing to run: DB_NAME "${__db}" does not look like a test database.`); process.exit(2); }
const { Client } = require("pg");
(async () => {
  const pg = new Client({ host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT) || 54329, database: process.env.DB_NAME || "curevan_test", user: process.env.DB_USER || "curevan", password: process.env.DB_PASSWORD || "testpw" });
  await pg.connect();
  const q = async (s, p) => (await pg.query(s, p)).rows;
  const [p] = await q("SELECT id FROM users WHERE email = 'patient@curevan.test'");
  const [t] = await q("SELECT id FROM users WHERE email = 'therapist@curevan.test'");
  const [a] = await q("SELECT id FROM order_addresses WHERE user_id = $1 LIMIT 1", [p.id]);
  const when = (min) => { const d = new Date(Date.now() + 5.5 * 3600e3 + min * 60000); const pad = (n) => String(n).padStart(2, "0"); return [`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`]; };
  for (const [min, pid] of [[30, "pay_demo_A"], [360, "pay_demo_B"]]) {
    const [date, time] = when(min);
    const [r] = await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, mode, status, payment_status, payment_method, razorpay_payment_id, service_address_id, created_at)
      VALUES ($1,'Priya Patient',$2,'Dr Tara Therapist',1,'Physio',1500,1500,$3,$4,'home','confirmed','Paid','razorpay',$5,$6, now() - interval '1 day') RETURNING id`, [p.id, t.id, date, time, pid, a.id]);
    await q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version) VALUES ($1,$2,$3,1,'not_started',1)", [r.id, p.id, t.id]);
    console.log("booking", r.id, date, time);
  }
  await pg.end();
})();
