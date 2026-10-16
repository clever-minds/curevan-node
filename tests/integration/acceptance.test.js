/**
 * Integration tests on a REAL PostgreSQL (see setup_db.js). The real Express app, real controllers and
 * real SQL run. Only the outside world is replaced: Razorpay, Firebase, e-mail and Shiprocket.
 *
 *   node tests/integration/acceptance.test.js [--payfirst]
 *
 * Covers the hand-off pack go-live checklist items that exist in the code today (1-7) plus the
 * Definition-of-Done checks of P03-P09.
 */
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const Module = require("module");
const fs = require("fs");

const root = path.resolve(__dirname, "../..");
process.chdir(root);
const PAYFIRST = process.argv.includes("--payfirst");
Object.assign(process.env, {
  GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y", JWT_SECRET: "integration-secret", JWT_EXPIRE: "1d",
  RAZORPAY_KEY_ID: "rzp_test_KEY", RAZORPAY_KEY_SECRET: "rzp_secret_123", RAZORPAY_WEBHOOK_SECRET: "whsec_123",
  NODE_ENV: "test", FRONTEND_URL: "http://localhost:3000",
  DB_HOST: process.env.DB_HOST || "127.0.0.1", DB_PORT: process.env.DB_PORT || "54329",
  DB_NAME: process.env.DB_NAME || "curevan_test", DB_USER: process.env.DB_USER || "curevan", DB_PASSWORD: process.env.DB_PASSWORD || "testpw",
});
if (PAYFIRST) process.env.DIRECT_BOOKING_NEEDS_APPROVAL = "false";

const realLog = console.log, realError = console.error, realWarn = console.warn;
const mute = () => { console.log = () => {}; if (!process.env.DEBUG_TEST) { console.error = () => {}; console.warn = () => {}; } }; // DEBUG_TEST=1 shows server errors
const unmute = () => { console.log = realLog; console.error = realError; console.warn = realWarn; };
mute();

// ---------------------------------------------------------------- stubs for the outside world
const captured = []; // every Razorpay order the server created: { id, amount }
const rzpRefunds = [];
let rzpSeq = 0, refundSeq = 0;
class FakeRazorpay {
  constructor() {
    this.orders = { create: async (o) => { const x = { id: "order_I" + ++rzpSeq, amount: o.amount }; captured.push(x); return x; } };
    this.payments = { refund: async (pid, o) => { rzpRefunds.push({ pid, amount: o.amount }); return { id: "rfnd_I" + ++refundSeq }; } };
  }
}
const mails = [], pushes = [];
const firebaseTokens = { good: { phone_number: "+919000000001" }, unknown: { phone_number: "+910000000000" }, nophone: { uid: "x" } };
const orig = Module._load;
Module._load = function (r, parent, ...a) {
  if (r === "razorpay") return FakeRazorpay;
  if (/config[\\/]mailer(\.js)?$/.test(r)) return { sendMail: async (m) => { mails.push(m); return {}; } };
  if (/config[\\/]firebaseAdmin(\.js)?$/.test(r)) return { getAuth: () => ({ verifyIdToken: async (t) => { if (firebaseTokens[t]) return firebaseTokens[t]; throw new Error("bad token"); } }), getMessaging: () => ({ send: async () => {}, sendEachForMulticast: async () => {} }), isReady: () => true };
  if (/utils[\\/]firebaseNotifier(\.js)?$/.test(r)) return { sendToTherapist: async (tok, title) => { pushes.push({ tok, title }); }, sendToMultipleTherapists: async (tokens, title) => { pushes.push({ tokens, title }); }, sendToAllTherapists: async () => {} };
  if (/services[\\/]shiprocketService(\.js)?$/.test(r)) return { getPickupLocations: async () => ({ data: { shipping_address: [{ pin_code: "390012" }] } }), checkServiceability: async () => ({ data: { available_courier_companies: [{ courier_company_id: 1, rate: 50 }], recommended_courier_company_id: 1 } }), createOrder() {}, generateAWB() {}, generateLabel() {}, generateManifest() {}, trackShipment() {}, cancelShipment() {}, createReturnOrder() {} };
  return orig.call(this, r, parent, ...a);
};

const { Client } = require("pg");
const jwt = require("jsonwebtoken");
const pg = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
const q = async (sql, p) => (await pg.query(sql, p)).rows;

const results = []; let failed = 0;
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); if (!ok) failed++; };
const sign = (o, p) => crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(o + "|" + p).digest("hex");
const token = (u) => jwt.sign({ id: u.id, uid: u.uid, email: u.email, role: u.role, roles: [u.roleName || u.role] }, process.env.JWT_SECRET);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  await q(`TRUNCATE users, roles, user_roles, therapist_profiles, therapist_availability, therapist_leaves, service_types, order_addresses, appointments, pcr,
    categories, products, product_variants, inventory, cart, offers, coupons, orders, order_items, payment_transactions, invoices, order_refunds,
    coupon_usages, order_stock_reservations, payment_webhook_events, notifications, audit_logs, tickets, ticket_messages, payout_items, media RESTART IDENTITY`);
  for (const r of ["patient", "therapist", "admin.super", "admin.ecom", "admin.therapy"]) await q("INSERT INTO roles(name) VALUES ($1)", [r]);
  const mk = async (uid, email, name, phone, role, extra = {}) => {
    // like production: users.role holds the generic 'admin' for every admin, the real role lives in user_roles
    const generic = role.startsWith("admin.") ? "admin" : role;
    const [u] = await q(`INSERT INTO users(uid,email,name,phone,role,is_verified,fcm_token,city,state) VALUES ($1,$2,$3,$4,$5,true,$6,'Vadodara','Gujarat') RETURNING *`, [uid, email, name, phone, generic, extra.fcm || null]);
    await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = $2", [u.id, role]);
    u.roleName = role;
    return u;
  };
  const U = {};
  U.p1 = await mk("patient-01", "p1@x.com", "Patient One", "9000000001", "patient", { fcm: "tokP1" });
  U.p2 = await mk("patient-02", "p2@x.com", "Patient Two", "9000000002", "patient");
  U.t1 = await mk("therapist-01", "t1@x.com", "Dr One", "9000000011", "therapist", { fcm: "tokT1" });
  U.t2 = await mk("therapist-02", "t2@x.com", "Dr Two", "9000000012", "therapist", { fcm: "tokT2" });
  U.su = await mk("admin-super-01", "su@x.com", "Super", "9000000021", "admin.super");
  U.su2 = await mk("admin-super-02", "su2@x.com", "Super Two", "9000000022", "admin.super");
  U.ecom = await mk("admin-ecom-01", "ec@x.com", "Ecom", "9000000023", "admin.ecom");
  U.therapy = await mk("admin-therapy-01", "th@x.com", "Therapy", "9000000024", "admin.therapy");
  await q("INSERT INTO service_types(name) VALUES ('Physiotherapy'), ('Speech Therapy')");
  const [tp1] = await q(`INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, specialty, pan_number, bank_account_number, bank_ifsc_code, lat, lng, full_address)
    VALUES ($1, 1500, 'approved', '{1}', 'ABCDE1234F', '1234567890', 'HDFC0001', 22.3, 73.2, 'secret street') RETURNING id`, [U.t1.id]);
  const [tp2] = await q(`INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, specialty) VALUES ($1, 900, 'approved', '{1,2}') RETURNING id`, [U.t2.id]);
  U.tp1 = tp1.id; U.tp2 = tp2.id;
  for (const tp of [tp1.id, tp2.id]) for (const d of ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]) await q("INSERT INTO therapist_availability(therapist_id, day_of_week, is_enabled, morning_start, morning_end) VALUES ($1,$2,true,'09:00','13:00')", [tp, d]);
  await q("INSERT INTO categories(name) VALUES ('Rehab')");
  await q(`INSERT INTO products(title, selling_price, mrp, sku, category_id, hsn_code, gst_slab, is_tax_inclusive, weight_kg) VALUES
    ('Band', 1000, 1200, 'A1', 1, '9021', 18, false, 0.5), ('Ball', 590, 700, 'B1', 1, '9021', 18, true, 0.2)`);
  await q("INSERT INTO inventory(product_id, sku, on_hand, reserved) VALUES (1,'A1',200,0), (2,'B1',200,0)");
  const [a1] = await q("INSERT INTO order_addresses(user_id, full_name, email, phone, full_address, city, state, pincode) VALUES ($1,'Patient One','p1@x.com','9000000001','1 Main St','Vadodara','Gujarat','390012') RETURNING id", [U.p1.id]);
  const [a2] = await q("INSERT INTO order_addresses(user_id, full_name, email, phone, full_address, city, state, pincode) VALUES ($1,'Patient Two','p2@x.com','9000000002','2 Side St','Mumbai','Maharashtra','400001') RETURNING id", [U.p2.id]);
  U.a1 = a1.id; U.a2 = a2.id;
  await q(`INSERT INTO coupons(code, type, value, status, scope, usage_limit, usage_per_user) VALUES ('SAVE100','flat',100,'Active','Global',1,1), ('OPEN10','percent',10,'Active','Global',NULL,NULL)`);
  return U;
}

(async () => {
  await pg.connect();
  const U = await seed();
  const app = require(root + "/src/app");
  const T = Object.fromEntries(Object.entries({ p1: U.p1, p2: U.p2, t1: U.t1, t2: U.t2, su: U.su, su2: U.su2, ecom: U.ecom, therapy: U.therapy }).map(([k, v]) => [k, token(v)]));
  const srv = app.listen(0);
  await new Promise((r) => srv.on("listening", r));
  const port = srv.address().port;
  const call = (m, p, t, body, hdr = {}) => new Promise((rs) => {
    const data = body === undefined || m === "GET" || m === "DELETE" ? null : JSON.stringify(body);
    const q2 = http.request({ port, host: "127.0.0.1", method: m, path: p, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}), ...hdr, ...(data ? { "content-length": Buffer.byteLength(data) } : {}) }, timeout: 8000 }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (e) { /* html */ } rs({ s: res.statusCode, j, raw: d, h: res.headers }); });
    });
    q2.on("error", (e) => rs({ s: "err:" + e.code })); if (data) q2.write(data); q2.end();
  });
  const webhook = async (event, entity, kind, id) => {
    const payload = JSON.stringify({ event, payload: { [kind]: { entity } } });
    const sig = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest("hex");
    const r = await call("POST", "/api/payments/webhook", null, undefined, { "x-razorpay-signature": sig, "x-razorpay-event-id": id });
    return r; // placeholder replaced below (raw body needed)
  };
  const rawPost = (p, headers, body) => new Promise((rs) => {
    const q2 = http.request({ port, host: "127.0.0.1", method: "POST", path: p, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers } }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => rs({ s: res.statusCode, d })); });
    q2.on("error", (e) => rs({ s: "err" })); q2.write(body); q2.end();
  });
  const hook = async (event, entity, kind, id, badSig) => {
    const payload = JSON.stringify({ event, payload: { [kind]: { entity } } });
    const sig = badSig || crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest("hex");
    return rawPost("/api/payments/webhook", { "x-razorpay-signature": sig, "x-razorpay-event-id": id }, payload);
  };
  const putCart = async (uid, items) => { await q("DELETE FROM cart WHERE user_id = $1", [uid]); for (const [pid, qty] of items) await q("INSERT INTO cart(user_id, product_id, quantity) VALUES ($1,$2,$3)", [uid, pid, qty]); };

  // ============================================================ #1 phone login bypass
  let r = await call("POST", "/api/auth/login-with-mobile", null, { phoneNumber: "+919000000001", verifyOtp: true });
  check("#1 login-with-mobile {phoneNumber, verifyOtp:true} without a Firebase token -> 401", r.s === 401 && !(r.j && r.j.token), "got " + r.s);
  r = await call("POST", "/api/auth/login-with-mobile", null, { phoneNumber: "+919000000001", verifyOtp: true, firebaseIdToken: "forged" });
  check("#1 forged Firebase token -> 401", r.s === 401);
  r = await call("POST", "/api/auth/login-with-mobile", null, { firebaseIdToken: "good" });
  check("#1 valid token logs in the owner of the token's phone (real SQL, roles from DB)", r.s === 200 && r.j.success && r.j.roles.includes("patient") && jwt.decode(r.j.token).id === U.p1.id, "got " + r.s + " " + JSON.stringify(r.j).slice(0, 120));

  // ============================================================ #2 role escalation
  for (const [m, p, b] of [["POST", "/api/users/update-roles", { id: U.p1.id, roles: ["admin.super"] }], ["DELETE", "/api/users/delete/" + U.p2.id], ["POST", "/api/products/add", {}], ["POST", "/api/coupons/add", {}], ["GET", "/api/appointments"], ["POST", "/api/general/payout-items/add", {}]]) {
    r = await call(m, p, T.p1, b);
    check(`#2 patient token ${m} ${p} -> 403`, r.s === 403, "got " + r.s);
  }
  r = await call("POST", "/api/auth/register", null, { email: "evil@x.com", password: "Passw0rd!", name: "Evil", phone: "9111111111", role: "admin.super", roles: ["admin.super", "admin.ecom"] });
  const evil = (await q("SELECT id, role FROM users WHERE email = 'evil@x.com'"))[0];
  const evilRoles = evil ? (await q("SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1", [evil.id])).map((x) => x.name) : null;
  check("#2 sign-up with roles:[admin.super] creates a patient only (checked in the database)", r.s === 200 && evil && evil.role === "patient" && JSON.stringify(evilRoles) === '["patient"]', "role=" + (evil && evil.role) + " roles=" + JSON.stringify(evilRoles) + " status=" + r.s);
  r = await call("POST", "/api/users/update-roles", T.su, { id: U.su2.id, roles: ["patient"] });
  const supers = await q("SELECT COUNT(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin.super'");
  check("#2 a Super Admin can demote another while one remains; audit row written", r.s === 200 && supers[0].n === 1 && (await q("SELECT * FROM audit_logs WHERE action = 'update_roles'")).length === 1, "status " + r.s);
  r = await call("POST", "/api/users/update-roles", T.su, { id: U.su.id, roles: ["patient"] });
  check("#2 the last Super Admin cannot be demoted (real SQL count)", r.s === 400, "got " + r.s + " " + JSON.stringify(r.j));
  r = await call("POST", "/api/users/update-roles", T.su, { uid: "patient-02", roles: ["therapist"] });
  check("#2 update-roles by uid works against the real database", r.s === 200 && r.j.success, JSON.stringify(r.j));
  await q("UPDATE user_roles SET role_id = (SELECT id FROM roles WHERE name='patient') WHERE user_id = $1", [U.p2.id]);
  await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name='admin.super' ON CONFLICT DO NOTHING", [U.su2.id]);

  // ============================================================ #3 data privacy
  const [ap] = await q(`INSERT INTO appointments(patient_id, patient_name, patient_phone, therapist_id, therapist_name, therapist_phone, service_type_id, therapy_type, service_amount, total_amount, date, time, mode, status, payment_status, pcr_status, service_address_id)
    VALUES ($1,'Patient One','9000000001',$2,'Dr One','9000000011',1,'Physio',1500,1500,'2031-01-10','10:00','home','Confirmed','Paid','not_started',$3) RETURNING id`, [U.p1.id, U.t1.id, U.a1]);
  await q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version, chief_complaint) VALUES ($1,$2,$3,1,'in_progress',1,'knee pain')", [ap.id, U.p1.id, U.t1.id]);
  const [ord] = await q("INSERT INTO orders(order_number, user_id, total, status, payment_status, billing_address_id, shipping_address_id) VALUES ('ORD-X',$1,100,'Placed','Paid',$2,$2) RETURNING id", [U.p1.id, U.a1]);
  const [tk] = await q("INSERT INTO tickets(user_id, subject, message, status) VALUES ($1,'help','please','open') RETURNING id", [U.p1.id]);
  const deny = async (label, m, p, t, body) => { const x = await call(m, p, t, body); check(`#3 ${label} -> 403`, x.s === 403, "got " + x.s); };
  await deny("patient B reads patient A's appointment", "GET", "/api/appointments/" + ap.id, T.p2);
  await deny("patient B reads patient A's PCR", "GET", "/api/appointments/pcr/" + ap.id, T.p2);
  await deny("patient B reads patient A's order", "GET", "/api/orders/order/" + ord.id, T.p2);
  await deny("patient B reads patient A's address", "GET", "/api/addresses/" + U.a1, T.p2);
  await deny("patient B reads patient A's ticket", "GET", "/api/support/tickets/" + tk.id, T.p2);
  await deny("therapist 2 reads therapist 1's appointment", "GET", "/api/appointments/" + ap.id, T.t2);
  await deny("therapist 2 edits therapist 1's PCR", "PATCH", "/api/appointments/pcr/" + ap.id, T.t2, { status: "submitted" });
  await deny("therapist 2 reads therapist 1's earnings", "GET", "/api/therapists/earnings/" + U.t1.id, T.t2);
  r = await call("GET", "/api/appointments/" + ap.id, T.p1);
  check("#3 owner patient reads own appointment, no phone numbers in it", r.s === 200 && !("patientPhone" in r.j.data) && !("therapistPhone" in r.j.data), "got " + r.s);
  r = await call("GET", "/api/appointments/" + ap.id, T.t1);
  check("#3 assigned therapist: no phone, address hidden outside the visit window", r.s === 200 && !("patientPhone" in r.j.data) && r.j.data.serviceAddress === null, "got " + r.s + " " + JSON.stringify(r.j && r.j.data && r.j.data.serviceAddress));
  r = await call("GET", "/api/addresses/" + U.a1, T.t1);
  check("#3 assigned therapist cannot read the address before the window (2h before)", r.s === 403, "got " + r.s);
  const soon = new Date(Date.now() + 5.5 * 3600e3 + 3600e3); const pad = (n) => String(n).padStart(2, "0");
  await q("UPDATE appointments SET date = $1, time = $2 WHERE id = $3", [`${soon.getUTCFullYear()}-${pad(soon.getUTCMonth() + 1)}-${pad(soon.getUTCDate())}`, `${pad(soon.getUTCHours())}:${pad(soon.getUTCMinutes())}`, ap.id]);
  r = await call("GET", "/api/addresses/" + U.a1, T.t1);
  check("#3 ... and CAN read it inside the window (1h before the visit)", r.s === 200, "got " + r.s);
  r = await call("GET", "/api/appointments/user/" + U.p1.id + "/x?role=patient", T.p2);
  check("#3 listing 'another patient's' appointments returns only the caller's own (none)", r.s === 200 && r.j.data.length === 0, "got " + r.s + " n=" + (r.j && r.j.data && r.j.data.length));
  r = await call("GET", "/api/therapists/list", null);
  const d0 = (r.j && r.j.data && r.j.data[0]) || {};
  const leaked = ["email", "phone", "pan_number", "bank_account_number", "bank_ifsc_code", "full_address", "address_line1"].filter((k) => k in d0);
  check("#3 public therapist list leaks no email/phone/PAN/bank/address (real SQL)", r.s === 200 && r.j.data.length >= 2 && leaked.length === 0, "status " + r.s + " leaked=" + leaked.join(","));
  r = await call("GET", "/api/therapists/list", T.su);
  check("#3 ... while an admin still sees them", r.s === 200 && r.j.data[0] && "email" in r.j.data[0], "got " + r.s);
  r = await call("GET", "/api/therapists/listnearby?lat=22.3&lng=73.2", null);
  const n0 = (r.j && r.j.data && r.j.data[0]) || {};
  check("#3 public listnearby leaks nothing either", r.s === 200 && !("pan_number" in n0) && !("email" in n0), "got " + r.s);
  r = await call("GET", "/api/general/payout-items/list?therapistId=" + U.t1.id, T.t2);
  check("#3 therapist payout list is forced to their own rows (real SQL)", r.s === 200 && Array.isArray(r.j) && r.j.every((x) => Number(x.therapistId) === U.t2.id), "got " + r.s);

  // ============================================================ #4 payments (shop)
  await putCart(U.p1.id, [[1, 2], [2, 1]]);
  r = await call("POST", "/api/orders/create-order", T.p1, { billing_address_id: U.a1, shipping_address_id: U.a1, coupon_code: "SAVE100", coupon_discount: 99999, total: 1, payment_status: "Paid", shipping_charges: 0 });
  check("#4 create-order works on real SQL -> 200", r.s === 200 && r.j.success, "got " + r.s + " " + (r.raw || "").slice(0, 200));
  const o1 = (await q("SELECT * FROM orders ORDER BY id DESC LIMIT 1"))[0];
  check("#4 saved unpaid (pending_payment/Pending) whatever the browser said", o1 && o1.status === "pending_payment" && o1.payment_status === "Pending", o1 && (o1.status + "/" + o1.payment_status));
  check("#4 tampered coupon_discount and total ignored: coupon=" + (o1 && o1.coupon_only_discount) + " total=" + (o1 && o1.total), o1 && Number(o1.coupon_only_discount) === 100 && Number(o1.total) > 1000);
  const expTax = Math.round((2000 - 77.22) * 0.18 * 100) / 100 + (Math.round(((590 - 22.78) - Math.round(((590 - 22.78) / 1.18) * 100) / 100) * 100) / 100);
  check("#4 GST charged on the discounted price (db tax " + (o1 && o1.total_tax) + " vs expected " + expTax.toFixed(2) + ")", o1 && Math.abs(Number(o1.total_tax) - expTax) < 0.011);
  check("#4 amount sent to Razorpay = server total in paise (" + (r.j && r.j.data && r.j.data.amountPaise) + ")", r.j && r.j.data.amountPaise === Math.round(Number(o1.total) * 100));
  const inv1 = (await q("SELECT reserved FROM inventory WHERE product_id = 1"))[0].reserved;
  check("#4 stock is reserved while unpaid (reservation rows + inventory)", inv1 === 2 && (await q("SELECT 1 FROM order_stock_reservations WHERE order_id = $1", [o1.id])).length === 2);
  check("#4 cart kept and no invoice before payment", (await q("SELECT 1 FROM cart WHERE user_id = $1", [U.p1.id])).length === 2 && (await q("SELECT 1 FROM invoices WHERE order_id = $1", [o1.id])).length === 0);
  const rz1 = o1.razorpay_order_id;
  r = await call("POST", "/api/payments/verify", T.p1, { razorpay_order_id: rz1, razorpay_payment_id: "pay_1", razorpay_signature: "forged" });
  check("#4 forged signature rejected, order stays unpaid", r.s === 400 && (await q("SELECT payment_status FROM orders WHERE id = $1", [o1.id]))[0].payment_status === "Pending");
  r = await call("POST", "/api/payments/verify", T.p2, { razorpay_order_id: rz1, razorpay_payment_id: "pay_1", razorpay_signature: sign(rz1, "pay_1") });
  check("#4 another customer cannot confirm my order even with a valid signature", r.s === 404);
  r = await call("POST", "/api/payments/verify", T.p1, { razorpay_order_id: rz1, razorpay_payment_id: "pay_1", razorpay_signature: sign(rz1, "pay_1") });
  const o1p = (await q("SELECT * FROM orders WHERE id = $1", [o1.id]))[0];
  check("#4 valid signature -> Paid/Placed, payment id + paid_at saved -> " + r.s, r.s === 200 && o1p.payment_status === "Paid" && o1p.status === "Placed" && o1p.razorpay_payment_id === "pay_1" && o1p.paid_at, "got " + r.s + " " + (r.raw || "").slice(0, 150));
  check("#4 invoice issued, cart cleared, coupon usage recorded, transaction marked paid",
    (await q("SELECT 1 FROM invoices WHERE order_id = $1", [o1.id])).length === 1 && (await q("SELECT 1 FROM cart WHERE user_id = $1", [U.p1.id])).length === 0 &&
    (await q("SELECT 1 FROM coupon_usages WHERE order_id = $1 AND user_id = $2", [o1.id, U.p1.id])).length === 1 &&
    (await q("SELECT status, razorpay_signature FROM payment_transactions WHERE order_id = $1", [o1.id]))[0].status === "paid");
  r = await call("POST", "/api/payments/verify", T.p1, { razorpay_order_id: rz1, razorpay_payment_id: "pay_1", razorpay_signature: sign(rz1, "pay_1") });
  check("#4 verify twice is idempotent (still 1 invoice, 1 usage)", r.s === 200 && (await q("SELECT 1 FROM invoices WHERE order_id = $1", [o1.id])).length === 1 && (await q("SELECT 1 FROM coupon_usages WHERE order_id = $1", [o1.id])).length === 1);
  await putCart(U.p2.id, [[1, 1]]);
  r = await call("POST", "/api/orders/create-order", T.p2, { billing_address_id: U.a2, shipping_address_id: U.a2, coupon_code: "SAVE100" });
  check("#4 a coupon with usage limit 1 cannot be used a second time -> " + r.s + " " + (r.j && r.j.error), r.s === 400);
  r = await call("POST", "/api/orders/create-order", T.p2, { billing_address_id: U.a2, shipping_address_id: U.a2 });
  const o2 = (await q("SELECT * FROM orders ORDER BY id DESC LIMIT 1"))[0];
  check("#4 inter-state order (Maharashtra) uses IGST only (real SQL): igst=" + (o2 && o2.igst), r.s === 200 && Number(o2.igst) > 0 && Number(o2.cgst) === 0);
  // browser closed after paying: only the webhook arrives
  const amt2 = Math.round(Number(o2.total) * 100);
  let w = await hook("payment.captured", { id: "pay_w2", order_id: o2.razorpay_order_id, amount: 100 }, "payment", "evt_a", "deadbeef");
  check("#4 webhook with a wrong signature -> 400 and nothing stored", w.s === 400 && (await q("SELECT 1 FROM payment_webhook_events")).length === 0);
  w = await hook("payment.captured", { id: "pay_w2", order_id: o2.razorpay_order_id, amount: 100 }, "payment", "evt_b");
  await sleep(300);
  check("#4 webhook with a tampered amount is not confirmed (error saved on the event)", (await q("SELECT payment_status FROM orders WHERE id = $1", [o2.id]))[0].payment_status === "Pending" && /mismatch/i.test(((await q("SELECT error FROM payment_webhook_events WHERE event_id = 'evt_b'"))[0] || {}).error || ""));
  w = await hook("payment.captured", { id: "pay_w2", order_id: o2.razorpay_order_id, amount: amt2 }, "payment", "evt_c");
  await sleep(400);
  check("#4 browser closed after paying: webhook alone makes the order Paid -> " + w.s, w.s === 200 && (await q("SELECT payment_status, status FROM orders WHERE id = $1", [o2.id]))[0].payment_status === "Paid");
  const evCount = (await q("SELECT 1 FROM payment_webhook_events WHERE event_id = 'evt_c'")).length;
  w = await hook("payment.captured", { id: "pay_w2", order_id: o2.razorpay_order_id, amount: amt2 }, "payment", "evt_c");
  check("#4 replaying the same webhook -> 200 duplicate, still one event and one invoice", w.s === 200 && JSON.parse(w.d).duplicate === true && evCount === 1 && (await q("SELECT 1 FROM invoices WHERE order_id = $1", [o2.id])).length === 1);
  // 20 payments reconcile with "Razorpay"
  const razorpayTotals = []; let curevanSum = 0;
  for (let i = 0; i < 20; i++) {
    const buyer = i % 2 ? U.p1 : U.p2; const addr = i % 2 ? U.a1 : U.a2; const tk2 = i % 2 ? T.p1 : T.p2;
    await putCart(buyer.id, [[1, (i % 3) + 1], [2, 1]]);
    const c = await call("POST", "/api/orders/create-order", tk2, { billing_address_id: addr, shipping_address_id: addr, coupon_code: i % 4 === 0 ? "OPEN10" : undefined });
    const rzId = c.j.data.razorpayOrderId;
    if (i % 2) await call("POST", "/api/payments/verify", tk2, { razorpay_order_id: rzId, razorpay_payment_id: "pay_r" + i, razorpay_signature: sign(rzId, "pay_r" + i) });
    else { await hook("payment.captured", { id: "pay_r" + i, order_id: rzId, amount: c.j.data.amountPaise }, "payment", "evt_r" + i); await sleep(120); }
    razorpayTotals.push(captured.find((x) => x.id === rzId).amount);
  }
  const paidRows = await q("SELECT total, payment_status, razorpay_order_id FROM orders WHERE order_number LIKE 'ORD-%' AND razorpay_order_id = ANY($1)", [captured.slice(-20).map((x) => x.id)]);
  curevanSum = paidRows.filter((x) => x.payment_status === "Paid").reduce((a, x) => a + Math.round(Number(x.total) * 100), 0);
  const rzpSum = razorpayTotals.reduce((a, x) => a + x, 0);
  check(`#4 20 test payments reconcile: Razorpay ${rzpSum} paise == Curevan ${curevanSum} paise, all 20 Paid (${paidRows.filter((x) => x.payment_status === "Paid").length})`, rzpSum === curevanSum && paidRows.filter((x) => x.payment_status === "Paid").length === 20);
  // abandoned payment -> stock released after 30 minutes
  await putCart(U.p2.id, [[1, 3]]);
  const reservedBefore = (await q("SELECT reserved FROM inventory WHERE product_id = 1"))[0].reserved;
  r = await call("POST", "/api/orders/create-order", T.p2, { billing_address_id: U.a2, shipping_address_id: U.a2 });
  const oAb = (await q("SELECT * FROM orders ORDER BY id DESC LIMIT 1"))[0];
  const ctl = require(root + "/src/controllers/orders/orderController");
  let n = await ctl.releaseExpiredPendingOrders();
  check("#4 abandoned payment: nothing released before 30 minutes", n === 0 && (await q("SELECT status FROM orders WHERE id = $1", [oAb.id]))[0].status === "pending_payment");
  await q("UPDATE orders SET created_at = now() - interval '31 minutes' WHERE id = $1", [oAb.id]);
  n = await ctl.releaseExpiredPendingOrders();
  const after = (await q("SELECT reserved FROM inventory WHERE product_id = 1"))[0].reserved;
  check(`#4 ... after 31 minutes the stock is released (reserved ${reservedBefore + 3} -> ${after}) and order marked payment_failed`, n === 1 && after === reservedBefore && (await q("SELECT status FROM orders WHERE id = $1", [oAb.id]))[0].status === "payment_failed");
  // refunds
  const refundsBefore = rzpRefunds.length;
  r = await call("POST", "/api/orders/refunds", T.ecom, { orderId: o1.id, amount: 100, reason: "damaged" });
  const rf = (await q("SELECT * FROM order_refunds ORDER BY id DESC LIMIT 1"))[0];
  check("#4 admin refund goes through Razorpay (stub) and starts 'pending' -> " + r.s, r.s === 201 && rzpRefunds.length === refundsBefore + 1 && rzpRefunds[refundsBefore].pid === "pay_1" && rzpRefunds[refundsBefore].amount === 10000 && rf.status === "pending", "got " + r.s + " " + (r.raw || "").slice(0, 150));
  r = await call("POST", "/api/orders/refunds", T.ecom, { orderId: o1.id, amount: Number(o1p.total) });
  check("#4 refund above paid-minus-pending is refused", r.s === 400);
  await hook("refund.processed", { id: rf.razorpay_refund_id, payment_id: "pay_1", amount: 10000 }, "refund", "evt_rf1");
  await sleep(300);
  check("#4 refund.processed webhook -> refund 'processed', order 'Partially Refunded' (real SQL)", (await q("SELECT status FROM order_refunds WHERE id = $1", [rf.id]))[0].status === "processed" && (await q("SELECT payment_status FROM orders WHERE id = $1", [o1.id]))[0].payment_status === "Partially Refunded");
  // cancel a paid order -> automatic full refund
  await putCart(U.p1.id, [[1, 1]]);
  const cc = await call("POST", "/api/orders/create-order", T.p1, { billing_address_id: U.a1, shipping_address_id: U.a1 });
  await call("POST", "/api/payments/verify", T.p1, { razorpay_order_id: cc.j.data.razorpayOrderId, razorpay_payment_id: "pay_c", razorpay_signature: sign(cc.j.data.razorpayOrderId, "pay_c") });
  const resBeforeCancel = (await q("SELECT reserved FROM inventory WHERE product_id = 1"))[0].reserved;
  r = await call("POST", "/api/orders/" + cc.j.data.orderId + "/cancel", T.p1);
  check("#4 customer cancels a PAID order: Cancelled, stock back, full refund started", r.s === 200 && (await q("SELECT status FROM orders WHERE id = $1", [cc.j.data.orderId]))[0].status === "Cancelled" && (await q("SELECT reserved FROM inventory WHERE product_id = 1"))[0].reserved === resBeforeCancel - 1 && (await q("SELECT 1 FROM order_refunds WHERE order_id = $1 AND status = 'pending'", [cc.j.data.orderId])).length === 1, "got " + r.s + " " + (r.raw || "").slice(0, 150));

  // ============================================================ #5 bookings
  const fut = new Date(Date.now() + 5.5 * 3600e3 + 3 * 86400e3);
  const fdate = `${fut.getUTCFullYear()}-${pad(fut.getUTCMonth() + 1)}-${pad(fut.getUTCDate())}`;
  r = await call("POST", "/api/appointments/create-appointment", T.p1, { bookingData: { therapistId: U.t1.id, patientId: U.p2.id, patientName: "P1", serviceTypeId: 1, therapyType: "Physio", date: fdate, time: "10:00", mode: "home", addressId: U.a1, serviceAmount: 1, totalAmount: 1, paymentStatus: "Paid", status: "Completed" } });
  const b1 = r.j && r.j.appointmentId ? (await q("SELECT * FROM appointments WHERE id = $1", [r.j.appointmentId]))[0] : null;
  check("#5 direct booking (real SQL) -> " + r.s + (PAYFIRST ? " pay-first" : " approval-first"), r.s === 200 && b1, "got " + r.s + " " + (r.raw || "").slice(0, 200));
  check("#5 server price (1500) not the tampered 1; payment Pending; patient = caller; status not 'Completed'", b1 && Number(b1.service_amount) === 1500 && b1.payment_status === "Pending" && b1.patient_id === U.p1.id && b1.status !== "Completed", b1 && `${b1.service_amount}/${b1.payment_status}/${b1.patient_id}/${b1.status}`);
  check("#5 no invoice / PCR / payout row before payment", b1 && (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [b1.id])).length === 0 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [b1.id])).length === 0 && (await q("SELECT 1 FROM payout_items WHERE source_id = $1", [b1.id])).length === 0);
  let rzB;
  if (!PAYFIRST) {
    check("#5 approval-first: status 'Pending Approval', no Razorpay order yet", b1.status === "Pending Approval" && !b1.razorpay_order_id);
    r = await call("POST", "/api/appointments/create-appointment", T.p1, { appointmentId: b1.id });
    check("#5 cannot pay before the therapist approves -> " + r.s, r.s === 400);
    r = await call("POST", "/api/appointments/accept/" + b1.id, T.t2, {});
    check("#5 a different therapist cannot accept someone else's booking -> " + r.s, r.s === 403);
    r = await call("POST", "/api/appointments/accept/" + b1.id, T.t1, {});
    check("#5 assigned therapist approves -> 'Payment Pending' -> " + r.s, r.s === 200 && (await q("SELECT status FROM appointments WHERE id = $1", [b1.id]))[0].status === "Payment Pending", "got " + r.s + " " + (r.raw || "").slice(0, 150));
    r = await call("POST", "/api/appointments/create-appointment", T.p1, { appointmentId: b1.id });
    rzB = r.j && r.j.razorpayOrderId;
    check("#5 patient 'Pay now' gets a Razorpay order for 150000 paise -> " + r.s, r.s === 200 && r.j.amountPaise === 150000);
  } else {
    rzB = r.j.razorpayOrderId;
    check("#5 pay-first: Razorpay order created straight away for 150000 paise", r.j.amountPaise === 150000 && rzB);
  }
  r = await call("POST", "/api/payments/verify-booking", T.p1, { razorpay_order_id: rzB, razorpay_payment_id: "pay_b1", razorpay_signature: "forged" });
  check("#5 forged signature rejected for a booking", r.s === 400 && (await q("SELECT payment_status FROM appointments WHERE id = $1", [b1.id]))[0].payment_status === "Pending");
  r = await call("POST", "/api/payments/verify-booking", T.p1, { razorpay_order_id: rzB, razorpay_payment_id: "pay_b1", razorpay_signature: sign(rzB, "pay_b1") });
  const b1p = (await q("SELECT * FROM appointments WHERE id = $1", [b1.id]))[0];
  check("#5 verified payment: Paid, razorpay id saved, status " + b1p.status + " -> " + r.s, r.s === 200 && b1p.payment_status === "Paid" && b1p.razorpay_payment_id === "pay_b1" && b1p.paid_at, "got " + r.s + " " + (r.raw || "").slice(0, 150));
  check("#5 invoice (150000 paise) + PCR created now; therapist pushed", (await q("SELECT total_amount_paise FROM invoices WHERE booking_id = $1", [b1.id]))[0].total_amount_paise == 150000 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [b1.id])).length === 1 && pushes.some((p) => p.tok === "tokT1"));
  r = await call("POST", "/api/payments/verify-booking", T.p1, { razorpay_order_id: rzB, razorpay_payment_id: "pay_b1", razorpay_signature: sign(rzB, "pay_b1") });
  check("#5 verifying twice is idempotent (1 invoice, 1 PCR)", r.s === 200 && (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [b1.id])).length === 1 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [b1.id])).length === 1);
  // request a therapist
  r = await call("POST", "/api/appointments/request", T.p2, { bookingData: { patientId: U.p1.id, patientName: "P2", serviceTypeId: 1, therapyType: "Physio", date: fdate, time: "12:00", mode: "home", serviceAmount: 0, totalAmount: 0, addressId: U.a2 } });
  const rq = (await q("SELECT * FROM appointments WHERE id = $1", [r.j && r.j.appointmentId]))[0];
  check("#5 'Request a therapist' is saved as 'Searching Therapist', payment 'Pending', never Paid ₹0 (real SQL) -> " + r.s, rq && rq.status === "Searching Therapist" && rq.payment_status === "Pending" && rq.patient_id === U.p2.id, rq && `${rq.status}/${rq.payment_status}/${rq.patient_id}`);
  check("#5 request creates no invoice, PCR or payout", (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [rq.id])).length === 0 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [rq.id])).length === 0 && (await q("SELECT 1 FROM payout_items WHERE source_id = $1", [rq.id])).length === 0);
  check("#5 the request is broadcast to approved therapists with the matching specialty (real SQL: specialty is INTEGER[])", pushes.some((x) => Array.isArray(x.tokens) && x.tokens.includes("tokT1") && x.tokens.includes("tokT2")), JSON.stringify(pushes.slice(-3)));
  r = await call("GET", "/api/appointments/requests/available", T.t2);
  check("#5 therapist sees the open request (matching specialty, real SQL) -> " + r.s, r.s === 200 && r.j.data.some((x) => x.id === rq.id), "got " + r.s + " " + JSON.stringify(r.j).slice(0, 150));
  r = await call("POST", "/api/appointments/accept/" + rq.id, T.p2, {});
  check("#5 a patient cannot accept a request -> " + r.s, r.s === 403);
  r = await call("POST", "/api/appointments/accept/" + rq.id, T.t2, { therapistId: U.t1.id, therapistName: "Evil" });
  const rqa = (await q("SELECT * FROM appointments WHERE id = $1", [rq.id]))[0];
  check("#5 accepting therapist = the caller (id " + rqa.therapist_id + "), priced from their rate (" + rqa.service_amount + "), status " + rqa.status, r.s === 200 && rqa.therapist_id === U.t2.id && Number(rqa.service_amount) === 900 && rqa.status === "Payment Pending" && rqa.price_source === "therapist_rate", "got " + r.s + " " + (r.raw || "").slice(0, 150));
  check("#5 still unpaid: no invoice/PCR/payout after acceptance; patient notified", (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [rq.id])).length === 0 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [rq.id])).length === 0 && (await q("SELECT 1 FROM notifications WHERE user_uid = $1", [String(U.p2.id)])).length === 1);
  r = await call("POST", "/api/appointments/create-appointment", T.p2, { appointmentId: rq.id });
  const rzR = r.j && r.j.razorpayOrderId;
  check("#5 Pay now on the accepted request -> order for 90000 paise", r.s === 200 && r.j.amountPaise === 90000);
  // webhook alone confirms the booking (browser closed)
  w = await hook("payment.captured", { id: "pay_rq", order_id: rzR, amount: 90000 }, "payment", "evt_rq");
  await sleep(400);
  const rqp = (await q("SELECT * FROM appointments WHERE id = $1", [rq.id]))[0];
  check("#5 request paid via webhook only: Paid + Confirmed, invoice + PCR created", rqp.payment_status === "Paid" && rqp.status === "Confirmed" && (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [rq.id])).length === 1 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [rq.id])).length === 1, `${rqp.payment_status}/${rqp.status}`);
  // manual payment
  r = await call("POST", "/api/appointments/" + ap.id + "/pay", T.p1, { gateway: "razorpay" });
  check("#5 a patient cannot mark a booking Paid -> " + r.s, r.s === 403);
  await q("UPDATE appointments SET payment_status = 'Pending' WHERE id = $1", [ap.id]);
  r = await call("POST", "/api/appointments/" + ap.id + "/pay", T.therapy, { gateway: "razorpay" });
  check("#5 admin cannot record 'razorpay' without verification -> " + r.s, r.s === 400);
  r = await call("POST", "/api/appointments/" + ap.id + "/pay", T.therapy, { gateway: "manual_cash", paymentId: "m1" });
  check("#5 admin records an offline cash payment -> Paid with method manual_cash", r.s === 200 && (await q("SELECT payment_method FROM appointments WHERE id = $1", [ap.id]))[0].payment_method === "manual_cash", "got " + r.s + " " + (r.raw || "").slice(0, 100));
  // unpaid cleanup
  const apptCtl = require(root + "/src/controllers/appointments/appointmentsController");
  if (PAYFIRST) {
    r = await call("POST", "/api/appointments/create-appointment", T.p1, { bookingData: { therapistId: U.t1.id, patientName: "P1", serviceTypeId: 1, date: fdate, time: "15:00", mode: "home" } });
    await q("UPDATE appointments SET created_at = now() - interval '31 minutes' WHERE id = $1", [r.j.appointmentId]);
    await apptCtl.cancelUnpaidAppointments();
    check("#5 unpaid direct booking cancelled after 30 minutes (cancelled_unpaid)", (await q("SELECT status FROM appointments WHERE id = $1", [r.j.appointmentId]))[0].status === "cancelled_unpaid");
  }
  const soon2 = new Date(Date.now() + 5.5 * 3600e3 + 90 * 60000);
  const [acc] = await q(`INSERT INTO appointments(patient_id, therapist_id, service_type_id, service_amount, total_amount, date, time, status, payment_status, price_source)
    VALUES ($1,$2,1,900,900,$3,$4,'Payment Pending','Pending','therapist_rate') RETURNING id`, [U.p1.id, U.t2.id, `${soon2.getUTCFullYear()}-${pad(soon2.getUTCMonth() + 1)}-${pad(soon2.getUTCDate())}`, `${pad(soon2.getUTCHours())}:${pad(soon2.getUTCMinutes())}`]);
  await apptCtl.cancelUnpaidAppointments();
  check("#5 accepted request still unpaid <2h before the slot is cancelled (real SQL)", (await q("SELECT status FROM appointments WHERE id = $1", [acc.id]))[0].status === "cancelled_unpaid");
  const bad = await q("SELECT id FROM appointments WHERE payment_status = 'Paid' AND razorpay_payment_id IS NULL AND COALESCE(payment_method,'') NOT LIKE 'manual\\_%'");
  check("#5 SQL invariant: no appointment is Paid without a verified Razorpay payment (" + bad.length + " offenders)", bad.length === 0, JSON.stringify(bad));

  // ============================================================ P09 routes, availability
  r = await call("GET", "/api/shipment/estimate?pincode=390012&weight=1", T.p1);
  check("P09 GET /shipment/estimate is reachable by a patient (not captured by /:id) -> " + r.s, r.s !== 403 && r.s !== 401);
  r = await call("GET", "/api/appointments/pcr-list?status=in_progress", T.therapy);
  check("P09 PCR list for therapy admin works on real SQL -> " + r.s, r.s === 200 && Array.isArray(r.j.data), "got " + r.s + " " + (r.raw || "").slice(0, 150));
  r = await call("POST", "/api/therapists/availability", T.t2, { therapist_id: U.tp1, availability: { mon: { enabled: true } } });
  check("P09 a therapist cannot overwrite another therapist's availability -> " + r.s, r.s === 403);
  r = await call("POST", "/api/therapists/availability", T.t2, { therapist_id: U.tp2, availability: { mon: { enabled: true, morning: { start: "08:00", end: "12:00" } }, tue: { enabled: false } } });
  check("P09 ... but can save their own (real SQL) -> " + r.s, r.s === 200 && (await q("SELECT 1 FROM therapist_availability WHERE therapist_id = $1", [U.tp2])).length === 2, "got " + r.s + " " + (r.raw || "").slice(0, 150));
  const [mrow] = await q("INSERT INTO media(user_id, filename, file_path, media_type) VALUES ($1,'a.png','/uploads/images/none.png','image') RETURNING id", [U.t1.id]);
  r = await call("DELETE", "/api/media/delete/" + mrow.id, T.t2);
  check("P09 media delete by a non-owner -> 403", r.s === 403);
  r = await call("DELETE", "/api/media/delete/" + mrow.id, T.t1);
  check("P09 media delete by the uploader works on real SQL -> " + r.s, r.s === 200 && (await q("SELECT 1 FROM media WHERE id = $1", [mrow.id])).length === 0, "got " + r.s + " " + (r.raw || "").slice(0, 100));

  // ============================================================ #6 every website call reaches a real route
  const map = fs.readFileSync(path.resolve(root, "../curevan-dev/docs/API_CALL_MAP.md"), "utf8");
  const rows = [...map.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \| ([^|]+)\|/gm)].map((m) => ({ method: m[1], p: m[2], mapped: !/no backend route/.test(m[3]) }));
  let routeless = [];
  for (const x of rows.filter((y) => y.mapped)) {
    const concrete = x.p.replace(/:id|\$\{[^}]*\}/g, "1").replace(/\/:\w+/g, "/1");
    const resp = await call(x.method, concrete, T.su, x.method === "GET" ? undefined : {});
    if (resp.s === 404 && /Cannot (GET|POST|PUT|PATCH|DELETE)/.test(resp.raw || "")) routeless.push(x.method + " " + concrete);
  }
  check(`#6 every one of the ${rows.filter((y) => y.mapped).length} website API calls that has a mapped backend route reaches it (no Express 'Cannot ...' 404): ${routeless.join(", ") || "none missing"}`, routeless.length === 0);
  const unmapped = rows.filter((y) => !y.mapped).map((y) => y.p);
  check(`#6 calls with NO backend route yet (all assigned to later prompts): ${unmapped.join(", ")}`, unmapped.length <= 12, unmapped.length + " found");

  unmute();
  const widthName = Math.max(...results.map((x) => x.name.length));
  for (const x of results) console.log((x.ok ? "PASS " : "FAIL ") + x.name + (x.ok ? "" : "  <-- " + x.detail));
  console.log(`\n${results.length - failed}/${results.length} passed${PAYFIRST ? " (pay-first mode)" : " (approval-first mode)"}`);
  srv.close(); await pg.end(); process.exit(failed ? 1 : 0);
})().catch((e) => {
  unmute();
  for (const x of results) console.log((x.ok ? "PASS " : "FAIL ") + x.name + (x.ok ? "" : "  <-- " + x.detail));
  console.error("TEST CRASH (the checks above ran before it):", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e);
  process.exit(2);
});
