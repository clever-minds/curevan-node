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
const PAYFIRST = !process.argv.includes("--approval");   // default = the handoff pack flow (pay first)
Object.assign(process.env, {
  GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y", JWT_SECRET: "integration-secret", JWT_EXPIRE: "1d",
  RAZORPAY_KEY_ID: "rzp_test_KEY", RAZORPAY_KEY_SECRET: "rzp_secret_123", RAZORPAY_WEBHOOK_SECRET: "whsec_123",
  NODE_ENV: "test", FRONTEND_URL: "http://localhost:3000",
  DB_HOST: process.env.DB_HOST || "127.0.0.1", DB_PORT: process.env.DB_PORT || "54329",
  DB_NAME: process.env.DB_NAME || "curevan_test", DB_USER: process.env.DB_USER || "curevan", DB_PASSWORD: process.env.DB_PASSWORD || "testpw",
});
process.env.DIRECT_BOOKING_NEEDS_APPROVAL = PAYFIRST ? "false" : "true";

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
const firebaseTokens = { caregiver: { phone_number: "+919000000077" }, good: { phone_number: "+919000000001" }, unknown: { phone_number: "+910000000000" }, nophone: { uid: "x" } };
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
    coupon_usages, order_stock_reservations, payment_webhook_events, sos_alerts, consent_logs, notifications, audit_logs, tickets, ticket_messages, payout_items, media RESTART IDENTITY`);
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
  for (const tp of [tp1.id, tp2.id]) for (const d of ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]) await q("INSERT INTO therapist_availability(therapist_id, day_of_week, is_enabled, morning_start, morning_end) VALUES ($1,$2,true,'09:00','18:00')", [tp, d]);
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
    VALUES ($1,'Patient One','9000000001',$2,'Dr One','9000000011',1,'Physio',1500,1500,'2031-01-10','10:00','home','confirmed','Paid','not_started',$3) RETURNING id`, [U.p1.id, U.t1.id, U.a1]);
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
  check("#5 server price (1500) not the tampered 1; payment Pending; patient = caller; status not 'Completed'", b1 && Number(b1.service_amount) === 1500 && b1.payment_status === "Pending" && b1.patient_id === U.p1.id && b1.status !== "completed", b1 && `${b1.service_amount}/${b1.payment_status}/${b1.patient_id}/${b1.status}`);
  check("#5 no invoice / PCR / payout row before payment", b1 && (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [b1.id])).length === 0 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [b1.id])).length === 0 && (await q("SELECT 1 FROM payout_items WHERE source_id = $1", [b1.id])).length === 0);
  let rzB;
  if (!PAYFIRST) {
    check("#5 approval-first: status 'searching_therapist', no Razorpay order yet", b1.status === "searching_therapist" && !b1.razorpay_order_id);
    r = await call("POST", "/api/appointments/create-appointment", T.p1, { appointmentId: b1.id });
    check("#5 cannot pay before the therapist approves -> " + r.s, r.s === 400);
    r = await call("POST", "/api/appointments/accept/" + b1.id, T.t2, {});
    check("#5 a different therapist cannot accept someone else's booking -> " + r.s, r.s === 403);
    r = await call("POST", "/api/appointments/accept/" + b1.id, T.t1, {});
    check("#5 assigned therapist approves -> 'accepted_unpaid' -> " + r.s, r.s === 200 && (await q("SELECT status FROM appointments WHERE id = $1", [b1.id]))[0].status === "accepted_unpaid", "got " + r.s + " " + (r.raw || "").slice(0, 150));
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
  check("#5 'Request a therapist' is saved as 'searching_therapist', payment 'Pending', never Paid ₹0 (real SQL) -> " + r.s, rq && rq.status === "searching_therapist" && rq.payment_status === "Pending" && rq.patient_id === U.p2.id, rq && `${rq.status}/${rq.payment_status}/${rq.patient_id}`);
  check("#5 request creates no invoice, PCR or payout", (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [rq.id])).length === 0 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [rq.id])).length === 0 && (await q("SELECT 1 FROM payout_items WHERE source_id = $1", [rq.id])).length === 0);
  check("#5 the request is broadcast to approved therapists with the matching specialty (real SQL: specialty is INTEGER[])", pushes.some((x) => Array.isArray(x.tokens) && x.tokens.includes("tokT1") && x.tokens.includes("tokT2")), JSON.stringify(pushes.slice(-3)));
  r = await call("GET", "/api/appointments/requests/available", T.t2);
  check("#5 therapist sees the open request (matching specialty, real SQL) -> " + r.s, r.s === 200 && r.j.data.some((x) => x.id === rq.id), "got " + r.s + " " + JSON.stringify(r.j).slice(0, 150));
  r = await call("POST", "/api/appointments/accept/" + rq.id, T.p2, {});
  check("#5 a patient cannot accept a request -> " + r.s, r.s === 403);
  r = await call("POST", "/api/appointments/accept/" + rq.id, T.t2, { therapistId: U.t1.id, therapistName: "Evil" });
  const rqa = (await q("SELECT * FROM appointments WHERE id = $1", [rq.id]))[0];
  check("#5 accepting therapist = the caller (id " + rqa.therapist_id + "), priced from their rate (" + rqa.service_amount + "), status " + rqa.status, r.s === 200 && rqa.therapist_id === U.t2.id && Number(rqa.service_amount) === 900 && rqa.status === "accepted_unpaid" && rqa.price_source === "therapist_rate", "got " + r.s + " " + (r.raw || "").slice(0, 150));
  check("#5 still unpaid: no invoice/PCR/payout after acceptance; patient notified", (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [rq.id])).length === 0 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [rq.id])).length === 0 && (await q("SELECT 1 FROM notifications WHERE user_uid = $1", [String(U.p2.id)])).length === 1);
  r = await call("POST", "/api/appointments/create-appointment", T.p2, { appointmentId: rq.id });
  const rzR = r.j && r.j.razorpayOrderId;
  check("#5 Pay now on the accepted request -> order for 90000 paise", r.s === 200 && r.j.amountPaise === 90000);
  // webhook alone confirms the booking (browser closed)
  w = await hook("payment.captured", { id: "pay_rq", order_id: rzR, amount: 90000 }, "payment", "evt_rq");
  await sleep(400);
  const rqp = (await q("SELECT * FROM appointments WHERE id = $1", [rq.id]))[0];
  check("#5 request paid via webhook only: Paid + Confirmed, invoice + PCR created", rqp.payment_status === "Paid" && rqp.status === "confirmed" && (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [rq.id])).length === 1 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [rq.id])).length === 1, `${rqp.payment_status}/${rqp.status}`);
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
    VALUES ($1,$2,1,900,900,$3,$4,'accepted_unpaid','Pending','therapist_rate') RETURNING id`, [U.p1.id, U.t2.id, `${soon2.getUTCFullYear()}-${pad(soon2.getUTCMonth() + 1)}-${pad(soon2.getUTCDate())}`, `${pad(soon2.getUTCHours())}:${pad(soon2.getUTCMinutes())}`]);
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

  // ============================================================ P10 notifications, SOS, consent, cancel, invoices
  const [nA] = await q("INSERT INTO notifications(user_uid, type, title, message) VALUES ($1,'booking','For patient one','x') RETURNING id", [String(U.p1.id)]);
  const [nB] = await q("INSERT INTO notifications(user_uid, type, title, message) VALUES ($1,'booking','For patient two','y') RETURNING id", [String(U.p2.id)]);
  r = await call("GET", "/api/notifications/list/" + U.p2.id, T.p1);
  check("P10 notification list returns only the caller's own rows even when another user's id is in the URL", r.s === 200 && r.j.data.length >= 1 && r.j.data.every((n) => n.title !== "For patient two") && r.j.data.some((n) => n.title === "For patient one"), "got " + r.s + " " + JSON.stringify(r.j && r.j.data && r.j.data.map((n) => n.title)));
  r = await call("GET", "/api/notifications/unread-count/" + U.p2.id, T.p1);
  const ownUnread = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND is_read = false", [String(U.p1.id)]))[0].n;
  check("P10 unread count is the caller's own (" + ownUnread + ")", r.s === 200 && r.j.data.count === ownUnread);
  r = await call("POST", "/api/notifications/read/" + nB.id, T.p1);
  check("P10 marking someone else's notification as read -> 404 and it stays unread", r.s === 404 && (await q("SELECT is_read FROM notifications WHERE id = $1", [nB.id]))[0].is_read === false);
  r = await call("POST", "/api/notifications/read/not-a-uuid", T.p1);
  check("P10 malformed notification id -> 404 (not a 500)", r.s === 404, "got " + r.s);
  r = await call("POST", "/api/notifications/read/" + nA.id, T.p1);
  check("P10 mark-as-read works for the owner", r.s === 200 && (await q("SELECT is_read FROM notifications WHERE id = $1", [nA.id]))[0].is_read === true);

  // SOS
  const [sosAppt] = await q(`INSERT INTO appointments(patient_id, therapist_id, therapist_name, patient_name, service_type_id, service_amount, total_amount, date, time, status, payment_status)
    VALUES ($1,$2,'Dr One','Patient One',1,1500,1500,'2031-03-01','10:00','confirmed','Paid') RETURNING id`, [U.p1.id, U.t1.id]);
  const adminNotifBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'sos'"))[0].n;
  r = await call("POST", "/api/sos/create", T.p2, { bookingId: String(sosAppt.id), location: { lat: 22.3, lng: 73.2 }, type: "sos" });
  check("P10 a user who is not part of the booking cannot raise an alert for it -> 403", r.s === 403);
  r = await call("POST", "/api/sos/create", null, { type: "sos" });
  check("P10 SOS needs a login -> 401", r.s === 401);
  r = await call("POST", "/api/sos/create", T.t1, { bookingId: String(sosAppt.id), location: { lat: 22.3072, lng: 73.1812 }, type: "sos" });
  const alertRow = (await q("SELECT * FROM sos_alerts ORDER BY id DESC LIMIT 1"))[0];
  check("P10 therapist presses SOS -> alert saved with booking, location and role -> " + r.s, r.s === 200 && r.j.success && alertRow && alertRow.raised_by === U.t1.id && alertRow.appointment_id === sosAppt.id && Number(alertRow.lat) === 22.3072 && alertRow.status === "active", "got " + r.s + " " + (r.raw || "").slice(0, 200));
  const sosNotifs = (await q("SELECT user_uid FROM notifications WHERE type = 'sos'")).map((x) => x.user_uid);
  check("P10 every Super Admin and Therapy Admin gets an in-app notification (" + sosNotifs.length + " rows, none for the ecom admin)", sosNotifs.length - adminNotifBefore === 3 && sosNotifs.includes(String(U.su.id)) && sosNotifs.includes(String(U.therapy.id)) && !sosNotifs.includes(String(U.ecom.id)), JSON.stringify(sosNotifs));
  r = await call("POST", "/api/sos/create", T.p1, { bookingId: String(sosAppt.id), type: "missed-checkin" });
  check("P10 a patient can raise an alert for their own booking too (no location needed)", r.s === 200 && r.j.success);
  r = await call("GET", "/api/sos/list", T.p1); check("P10 a patient cannot read the alert list -> " + r.s, r.s === 403);
  r = await call("GET", "/api/sos/list", T.ecom); check("P10 the e-com admin cannot read the alert list -> " + r.s, r.s === 403);
  r = await call("GET", "/api/sos/list", T.therapy);
  const a0 = r.j && r.j.data && r.j.data.find((x) => x.therapistName === "Dr One" && x.type === "sos");
  check("P10 Therapy Admin sees the alert in the shape the page needs (name, booking, location, status, timestamp)", r.s === 200 && a0 && a0.status === "active" && a0.bookingId === String(sosAppt.id) && a0.location.lat === 22.3072 && a0.location.lng === 73.1812 && a0.timestamp, JSON.stringify(a0));
  r = await call("GET", "/api/sos/list?status=active", T.su);
  check("P10 Super Admin sees the same active alerts -> " + (r.j && r.j.data && r.j.data.length), r.s === 200 && r.j.data.length === 2);
  r = await call("POST", "/api/sos/resolve", T.ecom, { alertId: alertRow.id }); check("P10 the e-com admin cannot resolve -> " + r.s, r.s === 403);
  r = await call("POST", "/api/sos/resolve", T.therapy, { alertId: alertRow.id, actorId: "someone-else" });
  const resolved = (await q("SELECT * FROM sos_alerts WHERE id = $1", [alertRow.id]))[0];
  check("P10 an admin resolves it; resolver = the logged-in admin, not the actorId in the body", r.s === 200 && resolved.status === "resolved" && resolved.resolved_by === U.therapy.id && resolved.resolved_at, "got " + r.s);
  r = await call("POST", "/api/sos/resolve", T.su, { alertId: alertRow.id }); check("P10 resolving twice -> 404", r.s === 404);
  r = await call("GET", "/api/sos/list?status=resolved", T.su);
  check("P10 the resolved alert now shows resolvedAt and leaves the active list", r.s === 200 && r.j.data.length === 1 && r.j.data[0].resolvedAt);

  // consent
  r = await call("POST", "/api/consent/log", null, { consentType: "cookies", version: "1", granted: false });
  const cAnon = (await q("SELECT * FROM consent_logs ORDER BY id DESC LIMIT 1"))[0];
  check("P10 anonymous cookie consent is logged (user_id NULL, granted false, ip + user agent kept)", r.s === 200 && cAnon.user_id === null && cAnon.consent_type === "cookies" && cAnon.granted === false && cAnon.ip);
  r = await call("POST", "/api/consent/log", T.p1, { consentType: "privacy", version: "2026-10", userId: U.p2.id });
  const cUser = (await q("SELECT * FROM consent_logs ORDER BY id DESC LIMIT 1"))[0];
  check("P10 accepting a consent form creates a consent_logs row for the TOKEN's user (body userId ignored)", r.s === 200 && cUser.user_id === U.p1.id && cUser.policy_version === "2026-10" && cUser.granted === true, JSON.stringify(cUser));
  r = await call("POST", "/api/consent/log", T.p1, { consentType: "hack" }); check("P10 unknown consent type -> 400", r.s === 400);
  r = await call("GET", "/api/consent/list", T.therapy); check("P10 only the Super Admin can read consent records -> " + r.s, r.s === 403);
  r = await call("GET", "/api/consent/list?type=privacy", T.su); check("P10 Super Admin lists consent records (filter by type)", r.s === 200 && r.j.data.length === 1 && r.j.data[0].userName === "Patient One");

  // cancel
  const day = (n) => { const d = new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  let mkN = 0;   // every test booking gets its own time, because the database now refuses two active bookings in one slot
  const mkA = async (pay, daysAhead, extra = {}) => (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, razorpay_payment_id, payment_method, created_at)
    VALUES ($1,'Patient One',$2,'Dr One',1,1500,1500,$3,$4,CASE WHEN $5 = 'Paid' THEN 'confirmed' ELSE 'pending_payment' END,$5,$6,$7, now() - interval '1 day') RETURNING id`, [U.p1.id, U.t1.id, day(daysAhead), extra.time || `${pad(1 + (mkN++ % 20))}:30`, pay, extra.rzp || null, extra.method || null]))[0].id;
  const unpaid = await mkA("Pending", 0, { time: "23:00" });
  r = await call("POST", "/api/appointments/" + unpaid + "/cancel", T.p2); check("P10 another patient cannot cancel -> " + r.s, r.s === 403);
  const tNotifBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Appointment cancelled'", [String(U.t1.id)]))[0].n;
  r = await call("POST", "/api/appointments/" + unpaid + "/cancel", T.p1);
  check("P10 patient cancels an UNPAID booking (even hours before) -> Cancelled, therapist notified", r.s === 200 && (await q("SELECT status FROM appointments WHERE id = $1", [unpaid]))[0].status === "cancelled_by_patient" && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Appointment cancelled'", [String(U.t1.id)]))[0].n === tNotifBefore + 1, "got " + r.s + " " + (r.raw || "").slice(0, 150));
  r = await call("PATCH", "/api/appointments/" + unpaid + "/cancel", T.p1); check("P10 cancelling again is refused -> " + r.s, r.s === 400);
  const rfBefore = rzpRefunds.length;
  const paidFar = await mkA("Paid", 3, { rzp: "pay_cancel1", method: "razorpay" });
  r = await call("PATCH", "/api/appointments/" + paidFar + "/cancel", T.p1);
  check("P10 patient cancels a PAID booking more than 12h away -> Cancelled + full refund through Razorpay (PATCH, as the website calls it)", r.s === 200 && rzpRefunds.length === rfBefore + 1 && rzpRefunds[rfBefore].pid === "pay_cancel1" && rzpRefunds[rfBefore].amount === 150000 && r.j.refund && r.j.refund.status === "pending" && (await q("SELECT status FROM appointments WHERE id = $1", [paidFar]))[0].status === "cancelled_by_patient" && (await q("SELECT 1 FROM order_refunds WHERE appointment_id = $1 AND status = 'pending'", [paidFar])).length === 1, "got " + r.s + " " + (r.raw || "").slice(0, 200));
  const paidNear = await mkA("Paid", 0, { rzp: "pay_cancel2", method: "razorpay", time: pad(Math.min(23, (new Date(Date.now() + 5.5 * 3600e3)).getUTCHours() + 1)) + ":00" });
  r = await call("POST", "/api/appointments/" + paidNear + "/cancel", T.p1);
  check("P10/P14 a PAID booking less than 2h away can be cancelled, but the whole price is kept (no refund)", r.s === 200 && (await q("SELECT status, cancellation_charge, refund_amount FROM appointments WHERE id = $1", [paidNear]))[0].status === "cancelled_by_patient" && Number((await q("SELECT cancellation_charge FROM appointments WHERE id = $1", [paidNear]))[0].cancellation_charge) === 1500 && rzpRefunds.length === rfBefore + 1, "got " + r.s + " " + JSON.stringify(r.j));
  const paidManual = await mkA("Paid", 3, { method: "manual_cash" });
  r = await call("POST", "/api/appointments/" + paidManual + "/cancel", T.p1);
  check("P10 a booking paid in cash (no online payment to refund) -> 400 contact support", r.s === 400 && (await q("SELECT status FROM appointments WHERE id = $1", [paidManual]))[0].status === "confirmed");
  const paidByTherapist = await mkA("Paid", 0, { rzp: "pay_cancel3", method: "razorpay", time: "23:30" });
  r = await call("POST", "/api/appointments/" + paidByTherapist + "/cancel", T.t1, { reason: "Family emergency" });
  check("P10 therapist cancels their own paid booking -> full refund; patient notified", r.s === 200 && rzpRefunds.some((x) => x.pid === "pay_cancel3") && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Appointment cancelled'", [String(U.p1.id)]))[0].n >= 1, "got " + r.s + " " + (r.raw || "").slice(0, 150));

  // ---- P12: visit flow, state machine, start OTP
  const istParts = (minFromNow) => { const d = new Date(Date.now() + 5.5 * 3600e3 + minFromNow * 60000); return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }; };
  const mkVisit = async (minFromNow, status, extra = {}) => { const w = istParts(minFromNow); return (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, start_otp_hash, razorpay_payment_id, created_at)
    VALUES ($1,'Patient One',$2,'Dr One',1,1500,1500,$3,$4,$5,'Paid','razorpay',$6,$7, now() - interval '1 day') RETURNING id`, [U.p1.id, U.t1.id, w.date, w.time, status, extra.hash || null, extra.pid || null]))[0].id; };
  const st = async (id) => (await q("SELECT * FROM appointments WHERE id = $1", [id]))[0];
  const otpSvc = require("../../src/services/otpService");

  let v = await mkVisit(20, "confirmed");
  r = await call("PUT", "/api/appointments/status/" + v, T.p1, { status: "therapist_on_the_way" });
  check("P12 a patient cannot move a booking to 'on the way' -> 403", r.s === 403, "got " + r.s);
  r = await call("PUT", "/api/appointments/status/" + v, T.t2, { status: "therapist_on_the_way" });
  check("P12 a different therapist cannot either -> 403", r.s === 403, "got " + r.s);
  r = await call("PUT", "/api/appointments/status/" + v, T.t1, { status: "completed" });
  check("P12 confirmed -> completed is refused with 409", r.s === 409 && (await st(v)).status === "confirmed", "got " + r.s + " " + (r.raw || "").slice(0, 120));
  const far = await mkVisit(60 * 24 * 40, "confirmed");
  r = await call("PUT", "/api/appointments/status/" + far, T.t1, { status: "therapist_on_the_way" });
  check("P12 travel cannot start earlier than 45 minutes before the slot -> 409", r.s === 409 && /45 minutes/.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));

  r = await call("GET", "/api/appointments/" + v + "/otp", T.t1);
  check("P12 the therapist cannot read the start code -> 403", r.s === 403 && !/\d{4}/.test(r.j && r.j.data ? JSON.stringify(r.j.data) : ""), "got " + r.s);
  r = await call("GET", "/api/appointments/" + v + "/otp", T.p2);
  check("P12 another patient cannot read the start code -> 403", r.s === 403, "got " + r.s);
  r = await call("GET", "/api/appointments/" + far + "/otp", T.p1);
  check("P12 the start code is not available days before the slot -> 403", r.s === 403, "got " + r.s);
  r = await call("GET", "/api/appointments/" + v + "/otp", T.p1);
  const code = r.j && r.j.data && r.j.data.otp;
  check("P12 the patient gets a " + 4 + "-digit start code inside the window", r.s === 200 && /^\d{4}$/.test(code || ""), "got " + r.s + " " + (r.raw || "").slice(0, 100));
  const stored = (await st(v)).start_otp_hash;
  check("P12 only a hash of the code is stored (never the plain digits)", stored && stored !== code && stored.length === 64 && otpSvc.matches(v, code, stored));

  r = await call("PUT", "/api/appointments/status/" + v, T.t1, { status: "therapist_on_the_way" });
  check("P12 the assigned therapist starts travelling -> 200, history written, travel time stamped", r.s === 200 && (await st(v)).status === "therapist_on_the_way" && (await st(v)).travel_started_at && (await q("SELECT 1 FROM appointment_status_history WHERE appointment_id = $1 AND from_status = 'confirmed' AND to_status = 'therapist_on_the_way'", [v])).length === 1, "got " + r.s + " " + (r.raw || "").slice(0, 120));
  r = await call("POST", "/api/appointments/" + v + "/verify-start-otp", T.t1, { otp: code });
  check("P12 the start code cannot be used before 'arrived' -> 409", r.s === 409, "got " + r.s);
  r = await call("PUT", "/api/appointments/status/" + v, T.t1, { status: "arrived" });
  check("P12 therapist arrives -> 200", r.s === 200 && (await st(v)).status === "arrived" && (await st(v)).arrived_at, "got " + r.s);
  r = await call("PUT", "/api/appointments/status/" + v, T.t1, { status: "in_progress" });
  check("P12 the therapist cannot jump to in_progress without the code -> 403", r.s === 403 && (await st(v)).status === "arrived", "got " + r.s);

  r = await call("POST", "/api/appointments/" + v + "/verify-start-otp", T.t1, { otp: code === "0000" ? "1111" : "0000" });
  check("P12 a wrong code is refused, 4 attempts left", r.s === 400 && r.j.attemptsLeft === 4 && (await st(v)).status === "arrived", "got " + r.s + " " + (r.raw || "").slice(0, 120));
  r = await call("GET", "/api/appointments/" + v, T.t1);
  check("P12 therapist API responses never contain the code or its hash", r.s === 200 && !(r.raw || "").includes(code) && !/start_otp|startOtp|otp_attempts/.test(r.raw || ""), (r.raw || "").slice(0, 150));
  r = await call("POST", "/api/appointments/" + v + "/verify-start-otp", T.t1, { otp: code });
  check("P12 the right code starts the session: in_progress, otp_verified_at + session_started_at set, hash cleared", r.s === 200 && (await st(v)).status === "in_progress" && (await st(v)).otp_verified_at && (await st(v)).session_started_at && (await st(v)).start_otp_hash === null, "got " + r.s + " " + (r.raw || "").slice(0, 120));

  // 5 wrong codes lock the booking and tell admins
  const lk = await mkVisit(21, "arrived", { hash: otpSvc.issue(0).hash });
  const alertsBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'Start code locked'"))[0].n;
  let lastLock;
  for (let i = 0; i < 5; i++) lastLock = await call("POST", "/api/appointments/" + lk + "/verify-start-otp", T.t1, { otp: "9999" });
  check("P12 the 5th wrong code locks the booking (423) and admins are notified", lastLock.s === 423 && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'Start code locked'"))[0].n > alertsBefore, "got " + lastLock.s + " " + (lastLock.raw || "").slice(0, 100));
  await q("UPDATE appointments SET start_otp_hash = $1 WHERE id = $2", [otpSvc.hash(lk, "9999"), lk]);
  r = await call("POST", "/api/appointments/" + lk + "/verify-start-otp", T.t1, { otp: "9999" });
  check("P12 once locked even the right code is refused (423)", r.s === 423 && (await st(lk)).status === "arrived", "got " + r.s);

  // session -> PCR -> completed
  const fullPcr = { chiefComplaint: "knee pain", assessment: "<p>Swelling and reduced flexion of the knee</p>", treatmentProvided: "<p>Manual therapy and stretching</p>", planOfCare: "<p>Daily exercises, review in a week</p>", bp: "120/80", hr: "80", rr: "16", temp: "98.6", hep: "<p>Quadriceps sets 3x10 daily</p>", functionalScore: 6, painVas: 4, functionalMeasure: "ROM" };
  r = await call("PUT", "/api/appointments/status/" + v, T.t1, { status: "completed" });
  check("P12 in_progress -> completed directly is refused (409)", r.s === 409, "got " + r.s);
  await q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version, chief_complaint) VALUES ($1,$2,$3,1,'in_progress',1,'pain')", [v, U.p1.id, U.t1.id]);
  r = await call("PATCH", "/api/appointments/pcr/" + v, T.t1, { ...fullPcr, status: "submitted" });
  check("P12 submitting the PCR while still in_progress is refused (409): complete the session first", r.s === 409 && (await st(v)).status === "in_progress", "got " + r.s + " " + (r.raw || "").slice(0, 120));
  r = await call("PUT", "/api/appointments/status/" + v, T.t1, { status: "pcr_pending" });
  check("P12 'Complete session' -> pcr_pending (not completed yet)", r.s === 200 && (await st(v)).status === "pcr_pending" && (await st(v)).session_ended_at, "got " + r.s);
  r = await call("PUT", "/api/appointments/status/" + v, T.t1, { status: "completed" });
  check("P12 the therapist cannot mark it completed by hand (403) - only the PCR does", r.s === 403 && (await st(v)).status === "pcr_pending", "got " + r.s);
  r = await call("PATCH", "/api/appointments/pcr/" + v, T.t1, { ...fullPcr, status: "submitted" });
  check("P12 the booking becomes completed only after the PCR is submitted", r.s === 200 && (await st(v)).status === "completed" && (await st(v)).completed_at, "got " + r.s + " " + (r.raw || "").slice(0, 120));
  check("P12 every move is in the history table (" + 5 + "+ rows)", (await q("SELECT COUNT(*)::int AS n FROM appointment_status_history WHERE appointment_id = $1", [v]))[0].n >= 5);

  // cancel / no-show roles
  const cx = await mkVisit(600, "confirmed");
  r = await call("PUT", "/api/appointments/status/" + cx, T.p1, { status: "no_show" });
  check("P12 a patient cannot mark a no-show (403)", r.s === 403, "got " + r.s);
  r = await call("PUT", "/api/appointments/status/" + cx, T.t1, { status: "no_show" });
  check("P12 the therapist can mark a no-show", r.s === 200 && (await st(cx)).status === "no_show", "got " + r.s);
  r = await call("PUT", "/api/appointments/status/" + cx, T.su, { status: "cancelled_by_admin" });
  check("P12/P14 the status endpoint refuses cancellations (they must use the cancel option so refunds apply) -> 400", r.s === 400, "got " + r.s);
  r = await call("GET", "/api/config/public");
  check("P12 /api/config/public gives the 60-minute timer and the 45-minute travel window", r.s === 200 && r.j.data.session.timerMinutes === 60 && r.j.data.visit.travelFromMinutesBefore === 45 && r.j.data.otp.length === 4, "got " + r.s + " " + (r.raw || "").slice(0, 100));

  // address only inside the visit window (P04 + P12)
  const [addr] = await q("INSERT INTO order_addresses(user_id, address_type, full_name, full_address, city, state, pincode) VALUES ($1,'shipping','Patient One','12 Test Lane','Vadodara','Gujarat','390001') RETURNING id", [U.p1.id]);
  const nearA = await mkVisit(22, "confirmed"); const farA = await mkVisit(60 * 24 * 30, "confirmed");
  await q("UPDATE appointments SET service_address_id = $1 WHERE id = ANY($2)", [addr.id, [nearA, farA]]);
  r = await call("GET", "/api/appointments/" + nearA, T.t1);
  check("P12 the therapist gets the full address + session timestamps inside the 2-hour window", r.s === 200 && r.j.data.serviceAddressDetail && r.j.data.serviceAddressDetail.fullAddress === "12 Test Lane" && "sessionStartedAt" in r.j.data, "got " + r.s + " " + (r.raw || "").slice(0, 160));
  r = await call("GET", "/api/appointments/" + farA, T.t1);
  check("P12 ...but no address days before the slot", r.s === 200 && r.j.data.serviceAddressDetail === null, "got " + r.s + " " + JSON.stringify(r.j && r.j.data && r.j.data.serviceAddressDetail));
  r = await call("GET", "/api/appointments/" + farA, T.p1);
  check("P12 the patient always sees their own address", r.s === 200 && r.j.data.serviceAddressDetail && r.j.data.serviceAddressDetail.city === "Vadodara", "got " + r.s);

  // ---- P13: slot guard (availability, leave, double booking, 4 h lead, 30 day limit)
  const bk = (therapistId, date, time, extra = {}) => ({ bookingData: { therapistId, patientName: "P", serviceTypeId: 1, therapyType: "Physio", date, time, mode: "home", addressId: U.a1, ...extra } });
  r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + day(10));
  const slotTimes = (r.j && r.j.data && r.j.data.slots || []).map((x) => x.time);
  check("P13 the public slots endpoint lists hourly slots inside the working hours (09:00-18:00 -> 9 slots)", r.s === 200 && slotTimes.length === 9 && slotTimes[0] === "09:00" && slotTimes[8] === "17:00", "got " + r.s + " " + JSON.stringify(slotTimes));
  r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + day(0));
  const todayLimit = Date.now() + 5.5 * 3600e3 + 4 * 3600e3;
  check("P13 today's slots start at least 4 hours from now", r.s === 200 && r.j.data.slots.every((x) => { const [h, m] = x.time.split(":").map(Number); const t = new Date(day(0) + "T00:00:00Z").getTime() + (h * 60 + m) * 60000; return t >= todayLimit - 60000; }), "got " + JSON.stringify(r.j && r.j.data && r.j.data.slots));
  r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + day(31));
  check("P13 no slots more than 30 days ahead", r.s === 200 && r.j.data.slots.length === 0);
  r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=2020-01-01");
  check("P13 no slots in the past", r.s === 200 && r.j.data.slots.length === 0);
  r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=nonsense");
  check("P13 a bad date is a 400", r.s === 400, "got " + r.s);
  r = await call("GET", "/api/therapists/99999/slots?date=" + day(10));
  check("P13 unknown therapist -> 404", r.s === 404, "got " + r.s);

  // leave days and partial-day leave
  await q("INSERT INTO therapist_leaves(therapist_id, start_date, end_date, reason, status) VALUES ($1,$2,$2,'trip','approved')", [U.tp1, day(11)]);
  await q("INSERT INTO therapist_leaves(therapist_id, start_date, end_date, start_time, end_time, reason, status) VALUES ($1,$2,$2,'11:00','13:00','appointment','approved')", [U.tp1, day(12)]);
  r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + day(11));
  check("P13 a leave day has no slots", r.s === 200 && r.j.data.slots.length === 0, JSON.stringify(r.j && r.j.data));
  r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + day(12));
  const partial = (r.j.data.slots || []).map((x) => x.time);
  check("P13 a part-day leave removes only its hours (11:00 and 12:00 gone)", !partial.includes("11:00") && !partial.includes("12:00") && partial.includes("10:00") && partial.includes("13:00"), JSON.stringify(partial));
  r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(11), "10:00"));
  check("P13 booking on a leave day is refused by the API (400)", r.s === 400 && /leave/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));

  // rules the API enforces even when the browser is bypassed
  r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(10), "20:00"));
  check("P13 outside the working hours is refused (400)", r.s === 400 && /working hours/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
  const soonT = istParts(60);
  r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, soonT.date, soonT.time));
  check("P13 less than 4 hours ahead is refused (400)", r.s === 400 && /4 hours/.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
  r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(31), "10:00"));
  check("P13 more than 30 days ahead is refused (400)", r.s === 400 && /30 days/.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
  r = await call("POST", "/api/appointments/request", T.p1, { bookingData: { patientId: U.p1.id, patientName: "P", serviceTypeId: 1, therapyType: "Physio", date: day(31), time: "10:00", mode: "home", addressId: U.a1 } });
  check("P13 a 'request a therapist' for a date >30 days ahead is refused too", r.s === 400, "got " + r.s);

  if (PAYFIRST) {
    // double booking
    r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(13), "10:00"));
    const first = r.s;
    r = await call("POST", "/api/appointments/create-appointment", T.p2, bk(U.t1.id, day(13), "10:00"));
    check("P13 the second booking of the same slot -> 409 'Slot no longer available'", first === 200 && r.s === 409 && /no longer available/i.test(r.raw || ""), "got " + first + "/" + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + day(13));
    check("P13 a booked slot disappears from the slots list", !r.j.data.slots.some((x) => x.time === "10:00") && r.j.data.slots.some((x) => x.time === "11:00"));

    // two simultaneous bookings, exactly one wins
    const both = await Promise.all([
      call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(14), "14:00")),
      call("POST", "/api/appointments/create-appointment", T.p2, bk(U.t1.id, day(14), "14:00")),
    ]);
    const codes = both.map((x) => x.s).sort();
    const rowsAt = (await q("SELECT COUNT(*)::int AS n FROM appointments WHERE therapist_id = $1 AND date = $2 AND time = '14:00' AND status = 'pending_payment'", [U.t1.id, day(14)]))[0].n;
    check("P13 two simultaneous bookings for one slot: exactly one succeeds (" + codes.join("/") + "), one row saved", codes[0] === 200 && codes[1] === 409 && rowsAt === 1, JSON.stringify(both.map((x) => x.s + " " + (x.raw || "").slice(0, 80))));
  }

  // the database refuses it as well, whatever the code does
  let dbRefused = false;
  try {
    await q(`INSERT INTO appointments(patient_id, therapist_id, date, time, status, payment_status) VALUES ($1,$2,$3,'09:00','confirmed','Paid')`, [U.p1.id, U.t2.id, day(15)]);
    await q(`INSERT INTO appointments(patient_id, therapist_id, date, time, status, payment_status) VALUES ($1,$2,$3,'09:00','pending_payment','Pending')`, [U.p2.id, U.t2.id, day(15)]);
  } catch (e) { dbRefused = /uq_appointments_active_slot/.test(e.message); }
  check("P13 the unique index stops a duplicate active booking at database level", dbRefused);
  await q(`INSERT INTO appointments(patient_id, therapist_id, date, time, status, payment_status) VALUES ($1,$2,$3,'09:00','cancelled_by_patient','Pending')`, [U.p2.id, U.t2.id, day(15)]);
  check("P13 ...but a cancelled booking does not block the slot", true);

  // accepting a request needs the therapist to be free
  r = await call("POST", "/api/appointments/request", T.p1, { bookingData: { patientId: U.p1.id, patientName: "P", serviceTypeId: 1, therapyType: "Physio", date: day(16), time: "11:00", mode: "home", addressId: U.a1 } });
  const reqRow = (await q("SELECT id FROM appointments WHERE patient_id = $1 AND date = $2 AND time = '11:00' AND status = 'searching_therapist'", [U.p1.id, day(16)]))[0];
  await q(`INSERT INTO appointments(patient_id, therapist_id, date, time, status, payment_status) VALUES ($1,$2,$3,'11:00','confirmed','Paid')`, [U.p2.id, U.t2.id, day(16)]);
  r = await call("POST", "/api/appointments/accept/" + reqRow.id, T.t2, {});
  check("P13 a therapist who already has that slot cannot accept the request (409)", r.s === 409 && (await q("SELECT status FROM appointments WHERE id = $1", [reqRow.id]))[0].status === "searching_therapist", "got " + r.s + " " + (r.raw || "").slice(0, 120));
  await q("DELETE FROM therapist_leaves WHERE therapist_id = $1", [U.tp1]);

  // ---- P14: cancellation policy engine
  const cancelBody = (b) => b || {};
  const rf0 = rzpRefunds.length;
  const far14 = await mkVisit(60 * 20, "confirmed", { pid: "pay_p14_far" });          // 20 hours ahead
  r = await call("GET", "/api/appointments/" + far14 + "/cancel-quote", T.p1);
  check("P14 quote 20 h ahead: free, full refund shown to the patient", r.s === 200 && r.j.data.band === "free" && r.j.data.chargeInr === 0 && r.j.data.refundInr === 1500, "got " + r.s + " " + (r.raw || "").slice(0, 150));
  r = await call("GET", "/api/appointments/" + far14 + "/cancel-quote", T.p2);
  check("P14 another patient cannot ask for the quote -> 403", r.s === 403);
  r = await call("GET", "/api/appointments/" + far14 + "/cancel-quote", T.t1);
  check("P14 the therapist's quote is a full refund (therapist cancels)", r.s === 200 && r.j.data.band === "therapist" && r.j.data.refundInr === 1500);

  const mid14 = await mkVisit(60 * 6, "confirmed", { pid: "pay_p14_mid" });             // 6 hours ahead -> 50 %
  r = await call("GET", "/api/appointments/" + mid14 + "/cancel-quote", T.p1);
  check("P14 quote 6 h ahead: 50% charge (750) and 750 back", r.s === 200 && r.j.data.band === "partial" && r.j.data.chargeInr === 750 && r.j.data.refundInr === 750, "got " + (r.raw || "").slice(0, 160));
  r = await call("POST", "/api/appointments/" + mid14 + "/cancel", T.p1, { acceptedChargeInr: 0 });
  check("P14 if the charge the patient agreed to is not the real one -> 409 with the real quote, nothing cancelled", r.s === 409 && r.j.quote.chargeInr === 750 && (await st(mid14)).status === "confirmed", "got " + r.s);
  r = await call("POST", "/api/appointments/" + mid14 + "/cancel", T.p1, { acceptedChargeInr: 750 });
  const mrow14 = await st(mid14);
  check("P14 patient cancels 6 h ahead: 750 refunded through Razorpay, charge 750 stored, therapist share stored", r.s === 200 && rzpRefunds.length === rf0 + 1 && rzpRefunds[rf0].pid === "pay_p14_mid" && rzpRefunds[rf0].amount === 75000 && mrow14.status === "cancelled_by_patient" && Number(mrow14.cancellation_charge) === 750 && Number(mrow14.refund_amount) === 750 && Number(mrow14.cancellation_therapist_share) === 750 && mrow14.cancelled_at && mrow14.cancelled_by === U.p1.id, "got " + r.s + " " + (r.raw || "").slice(0, 160) + " " + JSON.stringify(mrow14));
  check("P14 the cancelled slot is free again", (await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + istParts(60 * 6).date, undefined)).s === 200);

  const late14 = await mkVisit(75, "confirmed", { pid: "pay_p14_late" });            // 1 hour ahead -> 100 %
  r = await call("POST", "/api/appointments/" + late14 + "/cancel", T.p1, { acceptedChargeInr: 1500 });
  check("P14 patient cancels 1 h ahead: whole price kept, no Razorpay refund, booking cancelled", r.s === 200 && Number((await st(late14)).cancellation_charge) === 1500 && Number((await st(late14)).refund_amount) === 0 && rzpRefunds.length === rf0 + 1 && (await st(late14)).status === "cancelled_by_patient", "got " + r.s + " " + (r.raw || "").slice(0, 160));

  const grace14 = await mkVisit(95, "confirmed", { pid: "pay_p14_grace" });
  await q("UPDATE appointments SET created_at = now() - interval '4 minutes' WHERE id = $1", [grace14]);
  r = await call("GET", "/api/appointments/" + grace14 + "/cancel-quote", T.p1);
  check("P14 within 10 minutes of booking, cancelling is free even 1 h before the slot", r.s === 200 && r.j.data.band === "grace" && r.j.data.refundInr === 1500, (r.raw || "").slice(0, 150));

  // therapist late: more than 30 min after the slot start and not arrived
  const lateT = await mkVisit(-40, "confirmed", { pid: "pay_p14_tlate" });
  r = await call("GET", "/api/appointments/" + lateT + "/cancel-quote", T.p1);
  check("P14 therapist more than 30 min late (not arrived) -> the patient cancels free", r.s === 200 && r.j.data.band === "therapist_late" && r.j.data.refundInr === 1500, (r.raw || "").slice(0, 150));
  const lateArrived = await mkVisit(-47, "arrived", { pid: "pay_p14_arr" });
  r = await call("GET", "/api/appointments/" + lateArrived + "/cancel-quote", T.p1);
  check("P14 ...but not once the therapist has arrived", r.s === 200 && r.j.data.band === "late", (r.raw || "").slice(0, 150));

  // therapist and admin cancellations
  const thr = await mkVisit(60 * 3, "confirmed", { pid: "pay_p14_thr" });
  r = await call("POST", "/api/appointments/" + thr + "/cancel", T.t1, {});
  check("P14 a therapist must give a reason (400)", r.s === 400 && (await st(thr)).status === "confirmed");
  const adminAlertsBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'Therapist cancelled a booking'"))[0].n;
  r = await call("POST", "/api/appointments/" + thr + "/cancel", T.t1, { reason: "Car broke down" });
  check("P14 therapist cancels: patient gets 100% back, reliability event, therapy admins told", r.s === 200 && rzpRefunds.some((x) => x.pid === "pay_p14_thr" && x.amount === 150000) && (await q("SELECT 1 FROM therapist_reliability_events WHERE appointment_id = $1 AND type = 'cancelled_by_therapist'", [thr])).length === 1 && (await st(thr)).status === "cancelled_by_therapist" && (await st(thr)).cancel_reason === "Car broke down" && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'Therapist cancelled a booking'"))[0].n > adminAlertsBefore, "got " + r.s + " " + (r.raw || "").slice(0, 160));
  const adm = await mkVisit(60 * 3 + 5, "confirmed", { pid: "pay_p14_adm" });
  r = await call("POST", "/api/appointments/" + adm + "/cancel", T.therapy, { reason: "Duplicate booking" });
  check("P14 a therapy admin cancels: full refund, status cancelled_by_admin, reason + admin id stored", r.s === 200 && rzpRefunds.some((x) => x.pid === "pay_p14_adm" && x.amount === 150000) && (await st(adm)).status === "cancelled_by_admin" && (await st(adm)).cancelled_by === U.therapy.id, "got " + r.s + " " + (r.raw || "").slice(0, 160));
  const ecomTry = await mkVisit(60 * 3 + 10, "confirmed", { pid: "pay_p14_ec" });
  r = await call("POST", "/api/appointments/" + ecomTry + "/cancel", T.ecom, { reason: "x y z" });
  check("P14 the e-commerce admin cannot cancel therapy bookings -> 403", r.s === 403 && (await st(ecomTry)).status === "confirmed", "got " + r.s);
  r = await call("PUT", "/api/appointments/status/" + ecomTry, T.t1, { status: "cancelled_by_therapist" });
  check("P14 no cancelling through the plain status endpoint (it would skip the refund) -> 400", r.s === 400 && (await st(ecomTry)).status === "confirmed");

  // no-show is charged like a very late cancellation
  const ns = await mkVisit(-5, "confirmed", { pid: "pay_p14_ns" });
  r = await call("PUT", "/api/appointments/status/" + ns, T.t1, { status: "no_show" });
  check("P14 a no-show keeps the whole price (100%) and records the charge", r.s === 200 && r.j.settlement && r.j.settlement.band === "no_show" && Number((await st(ns)).cancellation_charge) === 1500 && !rzpRefunds.some((x) => x.pid === "pay_p14_ns"), "got " + r.s + " " + (r.raw || "").slice(0, 160));

  // unpaid booking: nothing to charge or refund
  const unpaid14 = await mkA("Pending", 2, {});
  r = await call("GET", "/api/appointments/" + unpaid14 + "/cancel-quote", T.p1);
  check("P14 an unpaid booking costs nothing to cancel", r.s === 200 && r.j.data.chargeInr === 0 && r.j.data.refundInr === 0 && r.j.data.paid === false, (r.raw || "").slice(0, 150));
  r = await call("GET", "/api/config/public");
  check("P14 the public config carries the policy numbers the website page prints", r.s === 200 && r.j.data.cancellation.freeHoursBefore === 12 && r.j.data.cancellation.partialHoursBefore === 2 && r.j.data.cancellation.partialChargePct === 50 && r.j.data.cancellation.lateChargePct === 100 && r.j.data.cancellation.graceMinutesAfterBooking === 10, (r.raw || "").slice(0, 200));

  const base = `http://127.0.0.1:${port}`;
  // ---- P15: PCR outcomes, access timing, baseline carry-forward, PDF
  const pcrId = (await q("SELECT id FROM pcr WHERE appointment_id = $1", [v]))[0].id;
  const pcrOf = async (apptId) => (await q("SELECT * FROM pcr WHERE appointment_id = $1", [apptId]))[0];
  const mkPcrRow = (apptId) => q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version) VALUES ($1,$2,$3,1,'not_started',1)", [apptId, U.p1.id, U.t1.id]);

  // required fields: build a booking that is in progress and try incomplete submissions
  const inProg = await mkVisit(240 + 15, "in_progress"); await mkPcrRow(inProg);
  r = await call("PATCH", "/api/appointments/pcr/" + inProg, T.t1, { status: "submitted", assessment: "<p>Some assessment text</p>", treatmentProvided: "<p>Treatment done today</p>", bp: "120/80", hr: "80", rr: "16", temp: "98" });
  check("P15 submit is blocked without HEP and both scores (400, lists what is missing)", r.s === 400 && r.j.missing.includes("home exercise programme") && r.j.missing.includes("functional score (1-10)") && r.j.missing.includes("pain score (0-10)"), "got " + r.s + " " + (r.raw || "").slice(0, 200));
  r = await call("PATCH", "/api/appointments/pcr/" + inProg, T.t1, { ...fullPcr, status: "in_progress", functionalScore: 11 });
  check("P15 a functional score of 11 is rejected by the database range", r.s >= 400 || (await pcrOf(inProg)).functional_score === null, "got " + r.s);
  r = await call("PATCH", "/api/appointments/pcr/" + inProg, T.t1, { ...fullPcr, status: "in_progress", painVas: 0, functionalScore: 1 });
  check("P15 the edge scores (pain 0, function 1) are accepted", r.s === 200 && (await pcrOf(inProg)).pain_vas === 0 && (await pcrOf(inProg)).functional_score === 1, "got " + r.s + " " + (r.raw || "").slice(0, 120));

  // therapist cannot write before the start code was verified
  const notStarted = await mkVisit(240 + 20, "confirmed"); await mkPcrRow(notStarted);
  r = await call("PATCH", "/api/appointments/pcr/" + notStarted, T.t1, { chiefComplaint: "x" });
  check("P15 the therapist cannot edit the PCR before the session starts (403)", r.s === 403, "got " + r.s);

  // lock the first visit's PCR: hash + PDF + access log
  await call("PATCH", "/api/appointments/pcr/" + v, T.therapy, { baseline: { chiefComplaint: "knee pain", diagnosis: "OA", medicalHistory: "diabetes", allergies: "none", longTermGoal: "walk 1 km" } });
  r = await call("PATCH", "/api/appointments/pcr/" + v, T.therapy, { status: "locked" });
  const locked = await pcrOf(v);
  check("P15 Lock & Finalize stores a SHA-256 content hash, the PDF path and locked_at", r.s === 200 && /^[0-9a-f]{64}$/.test(locked.content_hash || "") && locked.pdf_path && locked.locked_at, "got " + r.s + " " + (r.raw || "").slice(0, 150));
  const pdfPatient = await fetch(base + "/api/pcr/" + locked.id + "/pdf", { headers: { authorization: "Bearer " + T.p1 } });
  const pdfBytes = Buffer.from(await pdfPatient.arrayBuffer());
  check("P15 the patient downloads the PDF (application/pdf, starts with %PDF)", pdfPatient.status === 200 && /application\/pdf/.test(pdfPatient.headers.get("content-type")) && pdfBytes.slice(0, 4).toString() === "%PDF", "got " + pdfPatient.status);
  const pdfText = pdfBytes.toString("latin1");
  check("P15 the PDF is private: other patient 403, other therapist 403, anonymous 401", (await fetch(base + "/api/pcr/" + locked.id + "/pdf", { headers: { authorization: "Bearer " + T.p2 } })).status === 403 && (await fetch(base + "/api/pcr/" + locked.id + "/pdf", { headers: { authorization: "Bearer " + T.t2 } })).status === 403 && [401, 403].includes((await fetch(base + "/api/pcr/" + locked.id + "/pdf")).status));
  check("P15 the therapist and a clinical admin can also download it", (await fetch(base + "/api/pcr/" + locked.id + "/pdf", { headers: { authorization: "Bearer " + T.t1 } })).status === 200 && (await fetch(base + "/api/pcr/" + locked.id + "/pdf", { headers: { authorization: "Bearer " + T.therapy } })).status === 200);
  check("P15 the same PDF is reachable by booking id (what the health-records page uses)", (await fetch(base + "/api/pcr/appointment/" + v + "/pdf", { headers: { authorization: "Bearer " + T.p1 } })).status === 200);
  const nonLocked = await pcrOf(inProg);
  check("P15 an unlocked PCR has no PDF yet (409)", (await fetch(base + "/api/pcr/" + nonLocked.id + "/pdf", { headers: { authorization: "Bearer " + T.t1 } })).status === 409);
  const logs = (await q("SELECT action FROM pcr_access_log WHERE pcr_id = $1", [locked.id])).map((x) => x.action);
  check("P15 access log has rows for edit, lock and pdf (" + [...new Set(logs)].join(",") + ")", ["edit", "lock", "pdf"].every((a) => logs.includes(a)));

  // unlock needs a reason
  r = await call("PATCH", "/api/appointments/pcr/" + v, T.therapy, { status: "returned" });
  check("P15 returning / unlocking a PCR needs a reason (400)", r.s === 400, "got " + r.s);
  r = await call("PATCH", "/api/appointments/pcr/" + v, T.therapy, { status: "returned", reason: "Missing HEP detail" });
  check("P15 with a reason it is returned and the reason is logged", r.s === 200 && (await q("SELECT 1 FROM pcr_access_log WHERE pcr_id = $1 AND action = 'return' AND note = 'Missing HEP detail'", [locked.id])).length === 1 && (await pcrOf(v)).locked_at === null, "got " + r.s + " " + (r.raw || "").slice(0, 120));
  r = await call("PATCH", "/api/appointments/pcr/" + v, T.therapy, { status: "locked" });
  check("P15 it can be locked again", r.s === 200 && (await pcrOf(v)).status === "locked");

  // baseline carry-forward for the next visit of the same patient
  const visit2 = await mkVisit(30, "in_progress"); await mkPcrRow(visit2);
  r = await call("GET", "/api/appointments/pcr/" + visit2, T.t1);
  const g = r.j && r.j.data;
  check("P15 second-visit PCR opens with the baseline prefilled from the last locked PCR; vitals, HEP and scores start empty", r.s === 200 && g.baseline && g.baseline.chiefComplaint === "knee pain" && g.baseline.allergies === "none" && g.bp === "" && g.hep === "" && g.functionalScore === null && g.painVas === null, "got " + r.s + " " + JSON.stringify(g && { b: g.baseline, bp: g.bp, hep: g.hep }));

  // T-4h rule: history stays closed until 4 hours before the session
  const later = await mkVisit(60 * 9, "confirmed"); await mkPcrRow(later);
  r = await call("GET", "/api/appointments/pcr/" + later, T.t1);
  check("P15 more than 4 h before the session the therapist gets no clinical history", r.s === 200 && r.j.data.baseline === null && r.j.data.historyLocked === true, "got " + r.s + " " + JSON.stringify(r.j && r.j.data && { b: r.j.data.baseline }));
  const p2Only = await mkVisit(60 * 9 + 7, "confirmed");   // a different patient's far-off booking with therapist 1
  await q("UPDATE appointments SET patient_id = $1 WHERE id = $2", [U.p2.id, p2Only]);
  r = await call("GET", "/api/patients/" + U.p2.id + "/progress", T.t1);
  check("P15 therapist cannot read another patient's progress before T-4 h (403)", r.s === 403, "got " + r.s);
  r = await call("GET", "/api/patients/" + U.p1.id + "/progress", T.t2);
  check("P15 an unrelated therapist cannot read progress (403)", r.s === 403, "got " + r.s);
  r = await call("GET", "/api/patients/" + U.p1.id + "/progress", T.t1);
  check("P15 the current therapist (session within 4 h) reads the series", r.s === 200 && r.j.data.length >= 1 && "functionalScore" in r.j.data[0] && "painVas" in r.j.data[0] && "sessionDate" in r.j.data[0] && "therapistName" in r.j.data[0], "got " + r.s + " " + (r.raw || "").slice(0, 150));
  r = await call("GET", "/api/patients/" + U.p1.id + "/progress", T.p1);
  check("P15 the patient reads their own series", r.s === 200 && r.j.data.some((x) => x.functionalScore === 6 && x.painVas === 4), "got " + r.s + " " + (r.raw || "").slice(0, 150));
  r = await call("GET", "/api/patients/" + U.p1.id + "/progress", T.p2);
  check("P15 another patient cannot (403)", r.s === 403);

  // ---- P16: treatment plans, goals, outcome measures, progress, reports, caregivers
  {
  const mid = Object.fromEntries((await q("SELECT id, code FROM outcome_measures")).map((m) => [m.code, m.id]));
  check("P16 the free-to-use measure library is seeded (20 scales, none of the licensed ones)", Object.keys(mid).length === 20 && !mid.FIM && !mid.WAB && !mid.ODI, Object.keys(mid).length + " found");
  let sessN = 0;
  const mkSess = async (patientId, serviceTypeId) => {
    sessN += 1;
    const id = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method)
      VALUES ($1,'Test Patient',$2,'Dr One',$3,1500,1500,$4,'10:00','pcr_pending','Paid','razorpay') RETURNING id`, [patientId, U.t1.id, serviceTypeId, day(-(500 - sessN))]))[0].id;
    await q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version) VALUES ($1,$2,$3,$4,'not_started',1)", [id, patientId, U.t1.id, serviceTypeId]);
    return id;
  };
  const submit = (apptId, body) => call("PATCH", "/api/appointments/pcr/" + apptId, T.t1, { ...fullPcr, status: "submitted", nextSessionPlan: body.sessionType === "discharge" ? { mode: "none" } : { mode: "later", reason: "patient will book later" }, ...body });
  const ov = (code, value, extra = {}) => ({ measureId: mid[code], value, ...extra });

  // --- measure library admin
  r = await call("GET", "/api/clinical/measures", T.t1);
  check("P16 any signed-in user can read the library", r.s === 200 && r.j.data.length === 20);
  r = await call("POST", "/api/clinical/measures", T.t1, { code: "ODI2", name: "x", scaleType: "numeric", frequency: "review", licenceNote: "x" });
  check("P16 a therapist cannot add measures (403)", r.s === 403, "got " + r.s);
  r = await call("POST", "/api/clinical/measures", T.therapy, { code: "TEST_SCALE", name: "Test scale", scaleType: "numeric", minValue: 0, maxValue: 10, frequency: "review" });
  check("P16 a new measure needs a licence note (400)", r.s === 400, "got " + r.s);
  r = await call("POST", "/api/clinical/measures", T.therapy, { code: "TEST_SCALE", name: "Test scale", scaleType: "numeric", minValue: 0, maxValue: 10, frequency: "review", licenceNote: "Curevan own scale" });
  const newMeasureId = r.j && r.j.data && r.j.data.id;
  check("P16 Therapy Admin adds a measure with its licence note", r.s === 201 && newMeasureId);
  r = await call("POST", "/api/clinical/measures", T.su, { code: "TEST_SCALE", name: "Dup", scaleType: "numeric", frequency: "review", licenceNote: "x" });
  check("P16 a duplicate code is refused (409)", r.s === 409, "got " + r.s);
  r = await call("PATCH", "/api/clinical/measures/" + newMeasureId, T.su, { active: false });
  check("P16 a measure can be deactivated", r.s === 200 && r.j.data.active === false);

  // --- plan creation rules
  const goalsA = [
    { description: "Walk 10 m with quad cane independently in 6 weeks", measureCode: "10MWT", baselineValue: 0.1, targetValue: 0.4, targetDate: day(20) },
    { description: "Feed self with left hand", measureCode: "FMA_UE", baselineValue: 20, targetValue: 30, targetDate: day(25) },
  ];
  const measuresA = [{ code: "10MWT" }, { code: "BBS" }, { code: "FMA_UE", side: "left" }, { code: "MMT", side: "left", item: "quadriceps" }, { code: "NPRS" }];
  const a1 = await mkSess(U.p2.id, 1);
  const planBody = { patientId: U.p2.id, serviceTypeId: 1, condition: "Left hemiplegia after stroke", affectedSide: "left", bodyRegion: "left side", onsetDate: "2026-08-01", plannedSessions: 10, frequencyPerWeek: 3, reviewEverySessions: 5, goals: goalsA, measures: measuresA, appointmentId: a1 };
  r = await call("POST", "/api/clinical/plans", T.p2, planBody);
  check("P16 a patient cannot create a plan (403)", r.s === 403, "got " + r.s);
  const [stranger] = await q("INSERT INTO users(uid, email, name, phone, role, is_verified) VALUES ('stranger-1','stranger1@x.com','Stranger','9000000044','patient',true) RETURNING id");
  r = await call("POST", "/api/clinical/plans", T.t2, { ...planBody, patientId: stranger.id, appointmentId: undefined });
  check("P16 a therapist with no booking for the patient cannot (403)", r.s === 403, "got " + r.s);
  r = await call("POST", "/api/clinical/plans", T.t1, { ...planBody, goals: [] });
  check("P16 a plan needs at least 1 goal (400)", r.s === 400);
  r = await call("POST", "/api/clinical/plans", T.t1, { ...planBody, goals: Array.from({ length: 6 }, (_, i) => ({ description: "goal " + i })) });
  check("P16 and at most 5 goals (400)", r.s === 400);
  r = await call("POST", "/api/clinical/plans", T.t1, { ...planBody, measures: [{ code: "TEST_SCALE" }] });
  check("P16 an inactive measure cannot be put in a plan (400)", r.s === 400, "got " + r.s + " " + (r.raw || "").slice(0, 100));
  r = await call("POST", "/api/clinical/plans", T.t1, planBody);
  const planA = r.j && r.j.data && r.j.data.id;
  check("P16 Example A: neuro-physio plan with 2 goals and 5 measures is created", r.s === 201 && planA);

  // --- baseline visit: initial assessment must record every measure
  const baseA = [ov("10MWT", 0.1), ov("BBS", 20), ov("FMA_UE", 20, { side: "left" }), ov("MMT", 2, { side: "left", item: "quadriceps" }), ov("NPRS", 6)];
  r = await submit(a1, { sessionType: "initial_assessment", outcomeValues: baseA.slice(0, 3) });
  check("P16 due measures are enforced on submit (400 names what is missing)", r.s === 400 && r.j.missingMeasures && r.j.missingMeasures.length === 2, "got " + r.s + " " + (r.raw || "").slice(0, 160));
  r = await submit(a1, { sessionType: "initial_assessment", outcomeValues: [...baseA.slice(0, 4), { measureId: mid.NPRS, couldNotAssess: true }] });
  check("P16 'Could not assess' needs a reason (400)", r.s === 400, "got " + r.s);
  r = await submit(a1, { sessionType: "initial_assessment", outcomeValues: [...baseA.slice(0, 4), ov("NPRS", 99)] });
  check("P16 a value outside the scale range is refused (400)", r.s === 400 && /between/.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
  r = await submit(a1, { sessionType: "initial_assessment", outcomeValues: baseA });
  check("P16 baseline recorded: 5 results saved as 'baseline'", r.s === 200 && (await q("SELECT COUNT(*)::int AS n FROM outcome_results WHERE plan_id = $1 AND assessment_point = 'baseline'", [planA]))[0].n === 5, "got " + r.s + " " + (r.raw || "").slice(0, 160));
  check("P16 the booking joined the plan", (await q("SELECT treatment_plan_id FROM appointments WHERE id = $1", [a1]))[0].treatment_plan_id === planA);

  // --- sessions 2..10 (review at 5 and 10)
  const sessionsA = [a1];
  for (let n = 2; n <= 10; n++) {
    const id = await mkSess(U.p2.id, 1); sessionsA.push(id);
    if (n === 5 || n === 10) {
      const k = n === 5 ? 1 : 2;
      const vals = [ov("10MWT", [0.3, 0.45][k - 1]), ov("BBS", [30, 40][k - 1]), ov("FMA_UE", [26, 31][k - 1], { side: "left" }), ov("MMT", [3, 4][k - 1], { side: "left", item: "quadriceps" }), ov("NPRS", [4, 2][k - 1])];
      r = await submit(id, { sessionType: "review", outcomeValues: vals });
      check("P16 review session " + n + " needs the progress summary (400)", r.s === 400 && /progress summary/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
      r = await submit(id, { sessionType: "review", outcomeValues: vals, progressSummary: "Walking and balance are improving steadily; continue the plan.", goalStatuses: [] });
    } else {
      r = await submit(id, { sessionType: "follow_up", outcomeValues: [ov("NPRS", Math.max(1, 6 - Math.floor(n / 2)))] });
    }
    if (r.s !== 200) check("P16 session " + n + " submitted", false, "got " + r.s + " " + (r.raw || "").slice(0, 200));
  }
  check("P16 10 sessions submitted; session numbers run 1..10", (await q("SELECT array_agg(session_number ORDER BY session_number) AS s FROM pcr WHERE treatment_plan_id = $1", [planA]))[0].s.join(",") === "1,2,3,4,5,6,7,8,9,10", (await q("SELECT array_agg(session_number ORDER BY id) AS s FROM pcr WHERE treatment_plan_id = $1", [planA]))[0].s.join(","));
  await q("UPDATE appointments SET status = 'completed' WHERE id = ANY($1)", [sessionsA]);

  r = await call("GET", "/api/clinical/plans/" + planA + "/progress", T.p2);
  const pr = r.j && r.j.data;
  const mA = (code, side) => pr.measures.find((m) => m.code === code && (!side || m.side === side));
  check("P16 the patient sees charts for 10MWT, BBS, FMA_UE (left) and MMT (left): baseline, 2 reviews", r.s === 200 && ["10MWT", "BBS"].every((c) => mA(c).series.length === 3) && mA("FMA_UE", "left").series.length === 3 && mA("MMT", "left").series.length === 3, "got " + r.s + " " + JSON.stringify(pr && pr.measures.map((m) => m.code + ":" + m.series.length)));
  check("P16 % progress toward the goal: gait speed 0.1 -> 0.45 with target 0.4 = 116.67%, FMA_UE 20 -> 31 with target 30 = 110%", mA("10MWT").percentTowardTarget === 116.67 && mA("FMA_UE", "left").percentTowardTarget === 110 && mA("10MWT").absoluteChange === 0.35, JSON.stringify([mA("10MWT").percentTowardTarget, mA("FMA_UE", "left").percentTowardTarget]));
  check("P16 trend says improving for gait speed; NPRS (lower is better) fell from 6 to 2 with one point per session", mA("10MWT").status === "improving" && mA("NPRS").series.length === 10 && mA("NPRS").latest < mA("NPRS").baseline);
  check("P16 plan numbers: 10 of 10 sessions, adherence ratio 1, goals carry their progress", pr.sessionsDone === 10 && pr.adherence.attended === 10 && pr.adherence.ratio === 1 && pr.goals.length === 2 && pr.goals[0].percentTowardTarget === 116.67, JSON.stringify(pr.adherence));
  check("P16 the patient is not shown the clinical 'stalled' flag", !("stalled" in pr));
  r = await call("GET", "/api/clinical/plans/" + planA + "/reports", T.p2);
  const repsA = r.j && r.j.data;
  check("P16 two review reports exist (sessions 5 and 10) and the patient can list them", r.s === 200 && repsA.length === 2 && repsA[0].sessionNumber === 5 && repsA[1].sessionNumber === 10, "got " + r.s + " " + (r.raw || "").slice(0, 150));
  const pdfR = await fetch(base + "/api/clinical/reports/" + repsA[1].id + "/pdf", { headers: { authorization: "Bearer " + T.p2 } });
  const pdfRB = Buffer.from(await pdfR.arrayBuffer());
  check("P16 the progress report is a real PDF the patient can download", pdfR.status === 200 && pdfRB.slice(0, 4).toString() === "%PDF", "got " + pdfR.status);

  // --- access
  r = await call("GET", "/api/clinical/plans/" + planA + "/progress", T.p1);
  check("P16 another patient's progress -> 403", r.s === 403);
  r = await call("GET", "/api/clinical/plans/" + planA + "/progress", T.t2);
  check("P16 an unrelated therapist -> 403", r.s === 403);
  r = await call("GET", "/api/clinical/plans/" + planA + "/progress", T.t1);
  check("P16 the primary therapist reads it, with the stalled flag", r.s === 200 && r.j.data.stalled === false);
  r = await call("GET", "/api/clinical/plans", T.p1);
  check("P16 a patient's plan list only has their own plans", r.s === 200 && r.j.data.every((p) => p.patient_id === U.p1.id));
  r = await call("PATCH", "/api/clinical/plans/" + planA, T.p2, { status: "on_hold" });
  check("P16 the patient cannot edit the plan (403)", r.s === 403);

  // --- an 11th visit: every-session measure missing / could-not-assess
  const a11 = await mkSess(U.p2.id, 1);
  r = await submit(a11, { sessionType: "follow_up", outcomeValues: [] });
  check("P16 a normal visit still needs the every-session measure (NPRS)", r.s === 400 && /NPRS|Pain/.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 140));
  r = await submit(a11, { sessionType: "follow_up", outcomeValues: [ov("NPRS", null, { couldNotAssess: true, reason: "Patient too tired today" })] });
  check("P16 'Could not assess' with a reason is accepted and kept as a note", r.s === 200 && (await q("SELECT 1 FROM outcome_results r JOIN pcr p ON p.id = r.pcr_id WHERE p.appointment_id = $1 AND r.value IS NULL AND r.note LIKE '%too tired%'", [a11])).length === 1, "got " + r.s + " " + (r.raw || "").slice(0, 140));

  // --- stalled flag after two non-improving reviews
  const [stallPatient] = await q("INSERT INTO users(uid, email, name, phone, role, is_verified) VALUES ('stall-1','stall1@x.com','Stall Patient','9000000055','patient',true) RETURNING id");
  const sp = stallPatient.id;
  const s0 = await mkSess(sp, 1);
  r = await call("POST", "/api/clinical/plans", T.t1, { patientId: sp, serviceTypeId: 1, condition: "Balance problem", goals: [{ description: "Improve balance", measureCode: "BBS", baselineValue: 30, targetValue: 45 }], measures: [{ code: "BBS" }], plannedSessions: 10, frequencyPerWeek: 2, appointmentId: s0 });
  const stallPlan = r.j.data.id;
  r = await submit(s0, { sessionType: "initial_assessment", outcomeValues: [ov("BBS", 30)] });
  let flat = r.s === 200;
  for (const n of [5, 10]) {
    for (let i = 0; i < (n === 5 ? 3 : 4); i++) { const f = await mkSess(sp, 1); const rr = await submit(f, { sessionType: "follow_up", outcomeValues: [] }); flat = flat && rr.s === 200; }
    const rv = await mkSess(sp, 1);
    const rr = await submit(rv, { sessionType: "review", outcomeValues: [ov("BBS", 30)], progressSummary: "No change in balance this period; changing approach." });
    flat = flat && rr.s === 200;
  }
  check("P16 stalled setup: baseline + 2 reviews all at 30", flat);
  r = await call("GET", "/api/clinical/plans?stalled=1", T.therapy);
  check("P16 the plan with two non-improving reviews is flagged 'stalled' for Therapy Admin", r.s === 200 && r.j.data.some((p) => p.id === stallPlan && p.stalled === true) && !r.j.data.some((p) => p.id === planA), JSON.stringify(r.j && r.j.data && r.j.data.map((p) => p.id + ":" + p.stalled)));
  r = await call("GET", "/api/clinical/plans?stalled=1", T.p2);
  check("P16 the stalled list is empty for a patient", r.s === 200 && r.j.data.length === 0);

  // --- Example B: speech after stroke, 20 sessions, discharge
  const goalsB = [{ description: "Be understood by an unfamiliar listener at 80%", measureCode: "SPEECH_INT", baselineValue: 30, targetValue: 80 }];
  const measuresB = [{ code: "COMM_FUNC" }, { code: "SPEECH_INT" }, { code: "NAMING" }, { code: "COMM_CONF" }];
  const b1 = await mkSess(U.p1.id, 2);
  r = await call("POST", "/api/clinical/plans", T.t1, { patientId: U.p1.id, serviceTypeId: 2, condition: "Aphasia after stroke", affectedSide: "na", plannedSessions: 20, frequencyPerWeek: 3, goals: goalsB, measures: measuresB, appointmentId: b1 });
  const planB = r.j.data.id;
  const sessionsB = [b1];
  let okB = true;
  for (let n = 1; n <= 20; n++) {
    const id = n === 1 ? b1 : await mkSess(U.p1.id, 2); if (n > 1) sessionsB.push(id);
    const rv = n % 5 === 0;
    const body = n === 1 ? { sessionType: "initial_assessment", outcomeValues: [ov("COMM_FUNC", 2), ov("SPEECH_INT", 30), ov("NAMING", 20), ov("COMM_CONF", 3)] }
      : n === 20 ? { sessionType: "discharge", outcomeValues: [ov("COMM_FUNC", 7), ov("SPEECH_INT", 78), ov("NAMING", 80), ov("COMM_CONF", 8)], progressSummary: "Clear improvement in speech; independent in routine settings.", dischargeReason: "Goals achieved" }
      : rv ? { sessionType: "review", outcomeValues: [ov("COMM_FUNC", 2 + Math.floor(n / 5)), ov("SPEECH_INT", 30 + n * 2.5), ov("NAMING", 20 + n * 3), ov("COMM_CONF", 3 + Math.floor(n / 5))], progressSummary: "Steady improvement in speech and naming." }
      : { sessionType: "follow_up", outcomeValues: [ov("COMM_FUNC", Math.min(6, 2 + Math.floor(n / 4)))] };
    const rr = await submit(id, body);
    if (rr.s !== 200) { okB = false; check("P16 Example B session " + n + " submitted", false, "got " + rr.s + " " + (rr.raw || "").slice(0, 200)); break; }
  }
  check("P16 Example B: 20 sessions recorded (COMM_FUNC every session, SPEECH_INT/NAMING every 5th)", okB);
  await q("UPDATE appointments SET status = 'completed' WHERE id = ANY($1)", [sessionsB]);
  r = await call("GET", "/api/clinical/plans/" + planB + "/progress", T.p1);
  const pb = r.j && r.j.data;
  const cf = pb && pb.measures.find((m) => m.code === "COMM_FUNC");
  check("P16 Example B charts: COMM_FUNC has 20 points trending up; SPEECH_INT 5 points (baseline, 3 reviews, discharge)", r.s === 200 && cf.series.length === 20 && cf.status === "improving" && pb.measures.find((m) => m.code === "SPEECH_INT").series.length === 5, "got " + r.s + " " + JSON.stringify(pb && pb.measures.map((m) => m.code + ":" + m.series.length)));
  check("P16 discharge closed the plan with its reason", (await q("SELECT status, discharge_reason FROM treatment_plans WHERE id = $1", [planB]))[0].status === "discharged" && (await q("SELECT discharge_reason FROM treatment_plans WHERE id = $1", [planB]))[0].discharge_reason === "Goals achieved");
  r = await call("GET", "/api/clinical/plans/" + planB + "/reports", T.p1);
  const dis = r.j.data.find((x) => x.reportType === "discharge");
  const disPdf = dis && (await fetch(base + "/api/clinical/reports/" + dis.id + "/pdf", { headers: { authorization: "Bearer " + T.p1 } }));
  const disBytes = disPdf && Buffer.from(await disPdf.arrayBuffer());
  check("P16 Example B: 3 review reports + a Discharge Summary PDF", r.j.data.filter((x) => x.reportType === "review").length === 3 && disPdf && disPdf.status === 200 && disBytes.slice(0, 4).toString() === "%PDF", "reports " + JSON.stringify(r.j.data.map((x) => x.reportType)));
  r = await call("GET", "/api/clinical/reports/" + dis.id + "/pdf", T.p2);
  check("P16 another patient cannot download it (403)", r.s === 403);

  // --- family access: OTP login activates the link; revoke closes it
  r = await call("POST", "/api/clinical/caregivers", T.p2, { mobile: "9000000077", relation: "Son" });
  check("P16 sharing needs the patient's consent (400)", r.s === 400);
  r = await call("POST", "/api/clinical/caregivers", T.p2, { mobile: "9000000077", relation: "Son", consentAccepted: true });
  const linkId = r.j && r.j.data && r.j.data.id;
  check("P16 the patient shares with one family member by mobile number; consent is logged", r.s === 201 && linkId && (await q("SELECT 1 FROM consent_logs WHERE user_id = $1 AND consent_type = 'caregiver_share'", [U.p2.id])).length === 1, "got " + r.s + " " + (r.raw || "").slice(0, 120));
  r = await call("POST", "/api/clinical/caregivers", T.p2, { mobile: "9000000078", consentAccepted: true });
  check("P16 only one family member at a time (409)", r.s === 409);
  const cgUser = (await q("SELECT id FROM users WHERE phone = '9000000077'"))[0];
  const cgToken = token({ id: cgUser.id, uid: "caregiver-9000000077", email: "c@x", role: "caregiver", roleName: "caregiver" });
  r = await call("GET", "/api/clinical/plans/" + planA + "/progress", cgToken);
  check("P16 before the OTP login the family link does not work (403)", r.s === 403, "got " + r.s);
  r = await call("POST", "/api/auth/login-with-mobile", null, { firebaseIdToken: "caregiver" });
  const cgLive = r.j && r.j.token;
  check("P16 the family member signs in with an OTP (Firebase-verified phone)", r.s === 200 && cgLive, "got " + r.s);
  r = await call("GET", "/api/clinical/plans/" + planA + "/progress", cgLive);
  check("P16 after OTP the family member sees the progress (read-only, no stalled flag)", r.s === 200 && !("stalled" in r.j.data), "got " + r.s);
  r = await call("PATCH", "/api/clinical/plans/" + planA, cgLive, { status: "on_hold" });
  check("P16 and cannot change anything (403)", r.s === 403);
  r = await call("GET", "/api/clinical/plans/" + planB + "/progress", cgLive);
  check("P16 nor see another patient's plan (403)", r.s === 403);
  r = await call("DELETE", "/api/clinical/caregivers/" + linkId, T.p2);
  check("P16 the patient revokes the link", r.s === 200);
  r = await call("GET", "/api/clinical/plans/" + planA + "/progress", cgLive);
  check("P16 after revoking, access is closed again (403)", r.s === 403, "got " + r.s);

  }

  // ---- P17: next-session proposals, holds, reminders, calendar, overdue
  {
    const followUpService = require("../../src/services/followUpService");
    const reminderService = require("../../src/services/reminderService");
    const [fuPatient] = await q("INSERT INTO users(uid, email, name, phone, role, is_verified) VALUES ('fu-1','fu1@x.com','Fiona Patient','9000000066','patient',true) RETURNING id");
    const fuToken = token({ id: fuPatient.id, uid: "fu-1", email: "fu1@x.com", role: "patient" });
    await q("UPDATE users SET reminder_prefs = '{\"r24h\":true,\"r2h\":true,\"hep_daily\":false}'::jsonb WHERE id = $1", [fuPatient.id]);
    const [fuAddr] = await q("INSERT INTO order_addresses(user_id, address_type, full_name, full_address, city, state, pincode) VALUES ($1,'shipping','Fiona','5 Lake Rd','Vadodara','Gujarat','390001') RETURNING id", [fuPatient.id]);
    let fuN = 0;
    const mkSrc = async () => {   // a finished visit waiting for its PCR
      fuN += 1;
      const id = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, service_address_id)
        VALUES ($1,'Fiona Patient',$2,'Dr One',1,1500,1500,$3,'08:00','pcr_pending','Paid','razorpay',$4) RETURNING id`, [fuPatient.id, U.t1.id, day(-(300 - fuN)), fuAddr.id]))[0].id;
      await q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version) VALUES ($1,$2,$3,1,'not_started',1)", [id, fuPatient.id, U.t1.id]);
      return id;
    };
    const send = (id, extra) => call("PATCH", "/api/appointments/pcr/" + id, T.t1, { ...fullPcr, status: "submitted", sessionType: "follow_up", ...extra });
    const src1 = await mkSrc();

    // validation of the "next session plan"
    r = await send(src1, {});
    check("P17 a follow-up visit must say what happens next (400)", r.s === 400 && /what happens next/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await send(src1, { nextSessionPlan: { mode: "none" } });
    check("P17 'No further sessions' is only for a discharge (400)", r.s === 400);
    r = await send(src1, { nextSessionPlan: { mode: "later" } });
    check("P17 'Patient will book later' needs a reason (400)", r.s === 400);
    r = await send(src1, { nextSessionPlan: { mode: "series", weekdays: [1, 3, 5], time: "16:00", occurrences: 13 } });
    check("P17 a series is limited to 12 sessions (400)", r.s === 400);

    // series: Mon/Wed/Fri 16:00 x 6
    const seriesPlan = { mode: "series", weekdays: [1, 3, 5], time: "16:00", occurrences: 6, startDate: day(2) };
    const notifBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Your next session'", [String(fuPatient.id)]))[0].n;
    r = await send(src1, { nextSessionPlan: seriesPlan });
    check("P17 PCR submitted with a 6-session series", r.s === 200, "got " + r.s + " " + (r.raw || "").slice(0, 150));
    const props = await q("SELECT fp.*, a.status AS astatus, to_char(a.date,'YYYY-MM-DD') AS d, a.time FROM followup_proposals fp JOIN appointments a ON a.id = fp.appointment_id WHERE fp.patient_id = $1 AND fp.status = 'proposed' ORDER BY a.date", [fuPatient.id]);
    check("P17 6 'proposed' appointments hold the slots (one series row, hold expiry set)", props.length === 6 && props.every((x) => x.astatus === "proposed" && x.time === "16:00" && x.hold_expires_at) && new Set(props.map((x) => x.series_id)).size === 1 && (await q("SELECT 1 FROM followup_series WHERE id = $1", [props[0].series_id])).length === 1, JSON.stringify(props.map((x) => x.d + " " + x.astatus)));
    check("P17 they fall on Mon/Wed/Fri", props.every((x) => [1, 3, 5].includes(new Date(x.d + "T00:00:00Z").getUTCDay())));
    check("P17 the old next_treatment_date is filled from the plan", (await q("SELECT left(next_treatment_date::text, 10) AS d FROM pcr WHERE appointment_id = $1", [src1]))[0].d === props[0].d, "");
    const pn = await q("SELECT message FROM notifications WHERE user_uid = $1 AND title = 'Your next session' ORDER BY id DESC", [String(fuPatient.id)]);
    check("P17 the patient is told once, with no clinical text", pn.length === notifBefore + 1 && /recommends 6 sessions/.test(pn[0].message) && !/hemipleg|stroke|aphasia|knee|diagnos/i.test(pn[0].message), pn[0] && pn[0].message);

    // another patient cannot take those slots
    r = await call("POST", "/api/appointments/create-appointment", T.p2, bk(U.t1.id, props[0].d, "16:00"));
    check("P17 another patient cannot book a held slot (409)", r.s === 409, "got " + r.s + " " + (r.raw || "").slice(0, 100));
    r = await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + props[0].d);
    check("P17 and the slot is gone from the free-slots list", r.s === 200 && !r.j.data.slots.some((x) => x.time === "16:00") && r.j.data.slots.some((x) => x.time === "09:00"));

    // patient sees them; others do not
    r = await call("GET", "/api/clinical/followups/mine", fuToken);
    check("P17 the patient lists their 6 proposals", r.s === 200 && r.j.data.length === 6 && r.j.data.every((x) => x.apptStatus === "proposed"), "got " + r.s + " " + (r.raw || "").slice(0, 100));
    r = await call("GET", "/api/clinical/followups/mine", T.p2);
    check("P17 another patient sees none", r.s === 200 && r.j.data.length === 0);
    r = await call("POST", "/api/clinical/followups/" + props[0].id + "/decline", T.p2);
    check("P17 another patient cannot respond to them (403)", r.s === 403, "got " + r.s);

    // change one time, decline one
    r = await call("POST", "/api/clinical/followups/" + props[1].id + "/change", fuToken, { date: props[1].d, time: "12:00" });
    check("P17 the patient chooses another time for one session", r.s === 200 && (await q("SELECT time FROM appointments WHERE id = $1", [props[1].appointment_id]))[0].time === "12:00" && (await q("SELECT status FROM followup_proposals WHERE id = $1", [props[1].id]))[0].status === "changed", "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/clinical/followups/" + props[2].id + "/change", fuToken, { date: props[1].d, time: "12:00" });
    check("P17 a time that is taken is refused (409)", r.s === 409, "got " + r.s);
    r = await call("POST", "/api/clinical/followups/" + props[2].id + "/change", fuToken, { date: props[2].d, time: "23:00" });
    check("P17 a time outside the working hours is refused (400/409)", [400, 409].includes(r.s), "got " + r.s);
    r = await call("POST", "/api/clinical/followups/" + props[5].id + "/decline", fuToken);
    check("P17 the patient declines one: appointment proposal_declined, slot free again", r.s === 200 && (await q("SELECT status FROM appointments WHERE id = $1", [props[5].appointment_id]))[0].status === "proposal_declined" && (await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + props[5].d)).j.data.slots.some((x) => x.time === "16:00"));

    // confirm all: sessions wait for payment, one at a time
    r = await call("POST", "/api/clinical/followups/" + props[0].id + "/confirm", fuToken, { all: true });
    const confirmedIds = r.j && r.j.data && r.j.data.confirmed;
    check("P17 'Confirm all' commits the 5 remaining sessions (awaiting payment, hold ends 12 h before each)", r.s === 200 && confirmedIds.length === 5 && (await q("SELECT COUNT(*)::int AS n FROM appointments WHERE id = ANY($1) AND status = 'accepted_unpaid'", [confirmedIds]))[0].n === 5 && (await q("SELECT COUNT(*)::int AS n FROM followup_proposals WHERE appointment_id = ANY($1) AND status = 'confirmed' AND hold_expires_at IS NOT NULL", [confirmedIds]))[0].n === 5, "got " + r.s + " " + (r.raw || "").slice(0, 150));
    r = await call("POST", "/api/appointments/" + confirmedIds[0] + "/pay", T.therapy, { gateway: "manual_cash", paymentId: "m17" });
    check("P17 a paid session becomes 'confirmed' (the visit flow and OTP then apply)", r.s === 200 && (await q("SELECT status, start_otp_hash FROM appointments WHERE id = $1", [confirmedIds[0]]))[0].status === "confirmed" && !!(await q("SELECT start_otp_hash FROM appointments WHERE id = $1", [confirmedIds[0]]))[0].start_otp_hash);

    // single session through the normal payment (Step A from 'proposed', Step B verify)
    const src2 = await mkSrc();
    r = await send(src2, { nextSessionPlan: { mode: "single", date: day(20), time: "15:00" } });
    const single = (await q("SELECT fp.id, fp.appointment_id FROM followup_proposals fp WHERE fp.source_pcr_id = (SELECT id FROM pcr WHERE appointment_id = $1)", [src2]))[0];
    check("P17 'Single next session' creates one proposal", r.s === 200 && single, "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/clinical/followups/" + single.id + "/confirm", fuToken, {});
    check("P17 'Confirm & pay' hands over to the normal payment", r.s === 200 && r.j.data.next === "pay" && r.j.data.appointmentId === single.appointment_id);
    r = await call("POST", "/api/appointments/create-appointment", fuToken, { appointmentId: single.appointment_id });
    const rzS = r.j && r.j.razorpayOrderId;
    check("P17 payment Step A works from 'proposed' (server price, Razorpay order)", r.s === 200 && rzS, "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/payments/verify-booking", fuToken, { razorpay_order_id: rzS, razorpay_payment_id: "pay_p17", razorpay_signature: sign(rzS, "pay_p17") });
    check("P17 Step B verifies it: the session is 'confirmed' and the proposal row too", r.s === 200 && (await q("SELECT status FROM appointments WHERE id = $1", [single.appointment_id]))[0].status === "confirmed" && (await q("SELECT status FROM followup_proposals WHERE id = $1", [single.id]))[0].status === "confirmed", "got " + r.s + " " + (r.raw || "").slice(0, 150));

    // hold expiry: one nudge, then release
    const src3 = await mkSrc();
    await send(src3, { nextSessionPlan: { mode: "single", date: day(21), time: "15:00" } });
    const exp = (await q("SELECT fp.id, fp.appointment_id FROM followup_proposals fp WHERE fp.source_pcr_id = (SELECT id FROM pcr WHERE appointment_id = $1)", [src3]))[0];
    await q("UPDATE followup_proposals SET created_at = now() - interval '13 hours' WHERE id = $1", [exp.id]);
    let jr = await followUpService.expireHolds();
    jr = await followUpService.expireHolds();
    check("P17 an unanswered proposal gets exactly one nudge after 12 h", (await q("SELECT COUNT(*)::int AS n FROM reminder_log WHERE appointment_id = $1 AND type = 'followup_nudge'", [exp.appointment_id]))[0].n === 1 && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Keep your next session'", [String(fuPatient.id)]))[0].n === 1);
    await q("UPDATE followup_proposals SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [exp.id]);
    const notesBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'A recommended session was released'"))[0].n;
    jr = await followUpService.expireHolds();
    check("P17 at hold expiry the booking is released (proposal_expired) and both sides are told", jr.expired >= 1 && (await q("SELECT status FROM appointments WHERE id = $1", [exp.appointment_id]))[0].status === "proposal_expired" && (await q("SELECT status FROM followup_proposals WHERE id = $1", [exp.id]))[0].status === "expired" && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'A recommended session was released'"))[0].n === notesBefore + 2);
    check("P17 the expired slot is free for others", (await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + day(21))).j.data.slots.some((x) => x.time === "15:00"));

    // no_slot: the slot was taken before submit
    const src4 = await mkSrc();
    await q(`INSERT INTO appointments(patient_id, therapist_id, date, time, status, payment_status) VALUES ($1,$2,$3,'15:00','confirmed','Paid')`, [U.p2.id, U.t1.id, day(22)]);
    const alertsBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'A recommended time is no longer free'"))[0].n;
    r = await send(src4, { nextSessionPlan: { mode: "single", date: day(22), time: "15:00" } });
    check("P17 a slot that was just taken becomes 'no_slot' and the therapist is alerted", r.s === 200 && (await q("SELECT COUNT(*)::int AS n FROM followup_proposals WHERE source_pcr_id = (SELECT id FROM pcr WHERE appointment_id = $1) AND status = 'no_slot'", [src4]))[0].n === 1 && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'A recommended time is no longer free'"))[0].n === alertsBefore + 1);

    // ---- reminders: exactly once, respecting preferences
    const mkConf = async (patientId, minFromNow, name = "Fiona Patient") => {
      const w = istParts(minFromNow);
      return (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, service_address_id)
        VALUES ($1,$2,$3,'Dr One',1,1500,1500,$4,$5,'confirmed','Paid','razorpay',$6) RETURNING id`, [patientId, name, U.t1.id, w.date, w.time, fuAddr.id]))[0].id;
    };
    const a24 = await mkConf(fuPatient.id, 23 * 60 + 40);
    const a2h = await mkConf(fuPatient.id, 90);
    const a60 = await mkConf(fuPatient.id, 45);
    const nowMs = Date.now();
    let sent = await reminderService.run(nowMs);
    sent = await reminderService.run(nowMs);
    const cnt = async (appt, type, user) => (await q("SELECT COUNT(*)::int AS n FROM reminder_log WHERE appointment_id = $1 AND type = $2 AND user_id = $3", [appt, type, user]))[0].n;
    check("P17 the 24 h reminder is logged exactly once even though the job ran twice", (await cnt(a24, "reminder_24h", fuPatient.id)) === 1 && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND message LIKE '%tomorrow%'", [String(fuPatient.id)]))[0].n === 1);
    const m2 = await q("SELECT message FROM notifications WHERE user_uid = $1 AND message LIKE '%in 2 hours%'", [String(fuPatient.id)]);
    check("P17 the 2 h reminder (once) says the start code will be visible", (await cnt(a2h, "reminder_2h", fuPatient.id)) === 1 && m2.length === 1 && /start code will be visible/.test(m2[0].message));
    check("P17 the therapist gets the 60-minute reminder once, with the patient's first name only", (await cnt(a60, "therapist_60min", U.t1.id)) === 1 && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Session starting soon' AND message LIKE '%Fiona%'", [String(U.t1.id)]))[0].n === 1);
    // preferences
    r = await call("PUT", "/api/clinical/reminder-prefs", T.p2, { r24h: false, r2h: true, hep_daily: false });
    const a24b = await mkConf(U.p2.id, 23 * 60 + 35, "Patient Two");
    await reminderService.run(nowMs);
    check("P17 a patient who switched the 24 h reminder off does not get it", r.s === 200 && (await cnt(a24b, "reminder_24h", U.p2.id)) === 0);
    // agenda 07:00 and HEP 18:00 (clock passed in)
    const at = (hh) => new Date(day(1) + "T" + hh + ":00+05:30").getTime();   // tomorrow, so the earlier real-time run cannot have used up today's agenda
    const agendaAppt = await mkConf(fuPatient.id, 0);
    await q("UPDATE appointments SET time = '13:15', date = $2 WHERE id = $1", [agendaAppt, day(1)]);
    await reminderService.run(at("08:00")); await reminderService.run(at("08:05"));
    const agenda = await q("SELECT message FROM notifications WHERE user_uid = $1 AND title = 'Your sessions today' AND message LIKE '%13:15 Fiona%'", [String(U.t1.id)]);
    check("P17 the therapist's daily agenda goes out once from 07:00 and lists the day's sessions", agenda.length === 1 && /13:15 Fiona/.test(agenda[0].message), JSON.stringify(agenda));
    await q("UPDATE users SET reminder_prefs = '{\"r24h\":true,\"r2h\":true,\"hep_daily\":true}'::jsonb WHERE id = $1", [U.p2.id]);
    await reminderService.run(at("19:00")); await reminderService.run(at("19:05"));
    check("P17 the 18:00 home-exercise reminder goes to opted-in patients with an active plan, once a day", (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Time for your home exercises'", [String(U.p2.id)]))[0].n === 1);
    check("P17 no reminder or proposal text contains the condition, diagnosis or clinical notes", (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE message ~* '(hemipleg|stroke|aphasia|diagnos|knee|speech)' AND type IN ('reminder','followup_proposed','followup_nudge','followup_expired','followup_no_slot','followup_overdue')"))[0].n === 0);

    // ---- calendar: .ics for one booking, personal feed with tentative entries
    r = await call("GET", "/api/calendar/appointments/" + a24 + ".ics", fuToken);
    check("P17 the patient downloads a .ics for their booking: no clinical text", r.s === 200 && /BEGIN:VEVENT/.test(r.raw) && /Curevan home session/.test(r.raw) && !/hemipleg|stroke|aphasia|diagnos/i.test(r.raw), "got " + r.s + " " + (r.raw || "").slice(0, 100));
    r = await call("GET", "/api/calendar/appointments/" + a24 + ".ics", T.p2);
    check("P17 another patient cannot (403)", r.s === 403);
    await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, date, time, status, payment_status) VALUES ($1,'Fiona Patient',$2,'Dr One',$3,'11:00','proposed','Pending')`, [fuPatient.id, U.t1.id, day(5)]);
    r = await call("GET", "/api/calendar/token", T.t1);
    const feedUrl = r.j.data.url;
    const feed = await fetch(feedUrl).then((x) => x.text());
    check("P17 the therapist's personal feed (no login, secret address) lists confirmed sessions and marks proposed ones '(tentative)'", /BEGIN:VCALENDAR/.test(feed) && /Curevan home session with Fiona/.test(feed) && /\(tentative\)/.test(feed), feed.slice(0, 200));
    r = await call("POST", "/api/calendar/token/regenerate", T.t1);
    const newFeed = r.j.data.url;
    check("P17 regenerating the token kills the old address", newFeed !== feedUrl && (await fetch(feedUrl)).status === 404 && (await fetch(newFeed)).status === 200);

    // ---- overdue follow-up
    const [odPatient] = await q("INSERT INTO users(uid, email, name, phone, role, is_verified) VALUES ('od-1','od1@x.com','Omar Patient','9000000067','patient',true) RETURNING id");
    const [odPlan] = await q("INSERT INTO treatment_plans(patient_id, primary_therapist_id, service_type_id, condition, planned_sessions, frequency_per_week, plan_start) VALUES ($1,$2,1,'Back pain',10,2, CURRENT_DATE - 20) RETURNING id", [odPatient.id, U.t1.id]);
    await q(`INSERT INTO appointments(patient_id, therapist_id, date, time, status, payment_status, treatment_plan_id) VALUES ($1,$2,$3,'11:00','completed','Paid',$4)`, [odPatient.id, U.t1.id, day(-10), odPlan.id]);
    const od1 = await followUpService.markOverdue();
    check("P17 a patient with an active plan and no next booking past the grace period is flagged overdue", od1.flagged >= 1 && (await q("SELECT follow_up_overdue FROM treatment_plans WHERE id = $1", [odPlan.id]))[0].follow_up_overdue === true && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Time to book your next session'", [String(odPatient.id)]))[0].n === 1);
    await followUpService.markOverdue();
    check("P17 the patient is told only once", (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Time to book your next session'", [String(odPatient.id)]))[0].n === 1);
    r = await call("GET", "/api/clinical/followups/overdue", T.therapy);
    check("P17 Therapy Admin sees the overdue list", r.s === 200 && r.j.data.some((x) => x.planId === odPlan.id));
    r = await call("GET", "/api/clinical/followups/overdue", T.t1);
    check("P17 the primary therapist sees their own", r.s === 200 && r.j.data.some((x) => x.planId === odPlan.id));
    r = await call("GET", "/api/clinical/followups/overdue", T.t2);
    check("P17 another therapist does not see it", r.s === 200 && !r.j.data.some((x) => x.planId === odPlan.id));
    r = await call("GET", "/api/clinical/followups/overdue", T.p1);
    check("P17 patients cannot read the list (403)", r.s === 403);
    await q(`INSERT INTO appointments(patient_id, therapist_id, date, time, status, payment_status, treatment_plan_id) VALUES ($1,$2,$3,'11:30','confirmed','Paid',$4)`, [odPatient.id, U.t1.id, day(3), odPlan.id]);
    await followUpService.markOverdue();
    check("P17 booking a next session clears the flag", (await q("SELECT follow_up_overdue FROM treatment_plans WHERE id = $1", [odPlan.id]))[0].follow_up_overdue === false);
  }

  // ---- P18: payout engine, weekly batches, approval and payment
  {
    const payoutService = require("../../src/services/payoutService");
    const fs = require("fs");
    const pathMod = require("path");

    // --- the maths
    const prem = payoutService.computeLine({ gross: 1000, plan: "premium", ytdGrossBefore: 0 });
    const std = payoutService.computeLine({ gross: 1000, plan: "standard", ytdGrossBefore: 0 });
    check("P18 premium gross 1,000 -> fee 100, GST on fee 18, TDS 0, net 882", prem.fee === 100 && prem.gst === 18 && prem.tds === 0 && prem.net === 882, JSON.stringify(prem));
    check("P18 standard gross 1,000 -> fee 0, net 1,000", std.fee === 0 && std.gst === 0 && std.net === 1000, JSON.stringify(std));
    const edge = payoutService.computeLine({ gross: 1000, plan: "standard", ytdGrossBefore: 499500 });
    const over = payoutService.computeLine({ gross: 1000, plan: "standard", ytdGrossBefore: 600000 });
    check("P18 TDS counts only the part above the yearly threshold: 500 above -> 0.50, fully above -> 1.00", edge.tds === 0.5 && over.tds === 1 && over.net === 999, JSON.stringify([edge.tds, over.tds]));
    check("P18 the financial year runs April to March", payoutService.financialYear("2026-03-31").start === "2025-04-01" && payoutService.financialYear("2026-04-01").start === "2026-04-01");

    // --- when a line is made
    await q("UPDATE therapist_profiles SET membership_plan = 'premium' WHERE user_id = $1", [U.t2.id]);
    let pn = 0;
    const mkPayable = async (therapist, { paid = true, otp = true, pcr = "locked", amount = 1000, pid = true } = {}) => {
      pn += 1;
      const id = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, razorpay_payment_id, otp_verified_at)
        VALUES ($1,'Pay Patient',$2,'Dr',1,$3,$3,$4,'09:00','completed',$5,'razorpay',$6,$7) RETURNING id`, [U.p1.id, therapist, amount, day(-(900 - pn * 8)), paid ? "Paid" : "Pending", pid ? "pay_p18_" + pn : null, otp ? new Date() : null]))[0].id;
      await q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version, submitted_at) VALUES ($1,$2,$3,1,$4,1, now())", [id, U.p1.id, therapist, pcr]);
      return id;
    };
    const tryMake = async (id) => { try { return await payoutService.createItemForAppointment(id); } catch (e) { return { error: e.message, status: e.httpStatus }; } };
    check("P18 not payable while the payment is unconfirmed (409)", (await tryMake(await mkPayable(U.t1.id, { paid: false }))).status === 409);
    check("P18 not payable while the start code was never verified (409)", (await tryMake(await mkPayable(U.t1.id, { otp: false }))).status === 409);
    check("P18 not payable while the PCR is not locked (409)", (await tryMake(await mkPayable(U.t1.id, { pcr: "submitted" }))).status === 409);
    const okId = await mkPayable(U.t1.id);
    const made = await tryMake(okId);
    check("P18 payable once payment, start code and lock are all in place: standard 1,000 -> net 1,000, snapshot standard", made.created === true && made.item.net === 1000 && (await q("SELECT membership_plan_snapshot, state, platform_fee_pct FROM payout_items WHERE source_id = $1 AND type = 'service'", [okId]))[0].membership_plan_snapshot === "standard");
    check("P18 asking again does not duplicate the line", (await tryMake(okId)).created === false && (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE source_id = $1 AND type = 'service'", [okId]))[0].n === 1);
    const premId = await mkPayable(U.t2.id);
    await payoutService.createItemForAppointment(premId);
    const premRow = (await q("SELECT * FROM payout_items WHERE source_id = $1 AND type = 'service'", [premId]))[0];
    check("P18 a premium therapist's line: fee 100, GST 18, net 882 stored", Number(premRow.platform_fee_amount) === 100 && Number(premRow.gst_on_platform_fee) === 18 && Number(premRow.net_amount) === 882 && premRow.membership_plan_snapshot === "premium");

    // locking the PCR through the API creates the line by itself
    const lockId = await mkPayable(U.t1.id, { pcr: "submitted" });
    r = await call("PATCH", "/api/appointments/pcr/" + lockId, T.therapy, { status: "locked" });
    check("P18 an admin locking the PCR creates the payout line without any client call (and the reply says so)", r.s === 200 && r.j.payout && r.j.payout.created === true && (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE source_id = $1 AND type = 'service'", [lockId]))[0].n === 1, "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/general/payout-items/add", T.therapy, { type: "service", sourceId: 1, therapistId: U.t1.id, patientId: 1, grossAmount: 99999, platformFeePct: 0, platformFeeAmount: 0, netAmount: 99999, state: "Paid", weekStart: day(0), membershipPlanSnapshot: "premium" });
    check("P18 the old client-written payout endpoint is switched off (410)", r.s === 410, "got " + r.s);
    check("P18 cancellation charges became payout lines (type 'cancellation')", (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE type = 'cancellation'"))[0].n >= 1);

    // --- weekly batches
    const before = (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE batch_id IS NULL AND state = 'Pending'"))[0].n;
    const dowToday = new Date(day(0) + "T00:00:00Z").getUTCDay();   // 0 = Sunday; run "as of" the coming Sunday 23:59 IST
    const runAt = new Date(day(0) + "T23:59:00+05:30").getTime() + ((7 - dowToday) % 7) * 86400000;
    const jr = await payoutService.runWeeklyBatches(runAt);
    const batches = await q("SELECT * FROM payout_batches ORDER BY id");
    check("P18 the Sunday job made batches from the waiting lines (" + before + " lines -> " + batches.length + " batches)", before > 0 && jr.created > 0 && batches.length === jr.created && (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE batch_id IS NULL AND state = 'Pending'"))[0].n === 0);
    const perKey = await q("SELECT therapist_id, week_start, COUNT(*)::int AS n FROM payout_batches GROUP BY 1, 2 HAVING COUNT(*) > 1");
    check("P18 exactly one batch per therapist per week", perKey.length === 0);
    const sums = await q("SELECT b.id, b.gross, b.net, COALESCE(SUM(i.gross_amount),0) AS g, COALESCE(SUM(i.net_amount),0) AS n FROM payout_batches b JOIN payout_items i ON i.batch_id = b.id GROUP BY b.id");
    check("P18 each batch total equals the sum of its lines", sums.length > 0 && sums.every((x) => Number(x.gross) === Number(x.g) && Number(x.net) === Number(x.n)));
    const jr2 = await payoutService.runWeeklyBatches(runAt);
    check("P18 running the job again changes nothing", jr2.created === 0 && jr2.attached === 0);
    const t1Batch = (await q("SELECT * FROM payout_batches WHERE therapist_id = $1 AND status = 'scheduled' ORDER BY id LIMIT 1", [U.t1.id]))[0];
    const t2Batch = (await q("SELECT * FROM payout_batches WHERE therapist_id = $1 ORDER BY id LIMIT 1", [U.t2.id]))[0];
    check("P18 a therapist without bank details gets a batch 'on_hold' with the reason; one with details is 'scheduled'", t1Batch && t2Batch.status === "on_hold" && /bank/i.test(t2Batch.hold_reason) && (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE batch_id = $1 AND state = 'onHold'", [t2Batch.id]))[0].n > 0);

    // --- API access
    r = await call("GET", "/api/payout-batches/list", T.su);
    check("P18 admins list all batches", r.s === 200 && r.j.data.length === batches.length);
    r = await call("GET", "/api/payout-batches/list", T.t1);
    check("P18 a therapist lists only their own", r.s === 200 && r.j.data.length > 0 && r.j.data.every((b) => b.therapistId === U.t1.id));
    r = await call("GET", "/api/payout-batches/list", T.p1);
    check("P18 a patient cannot (403)", r.s === 403);
    r = await call("GET", "/api/payout-batches/" + t1Batch.id, T.t2);
    check("P18 another therapist cannot open the batch (403)", r.s === 403);
    r = await call("GET", "/api/payout-batches/" + t1Batch.id, T.t1);
    check("P18 the owner sees the lines, never the bank number", r.s === 200 && r.j.data.items.length > 0 && !/bank_account|ifsc/i.test(r.raw || ""));

    // --- approval
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/approve", T.therapy);
    check("P18 only the Super Admin approves (Therapy Admin gets 403)", r.s === 403);
    r = await call("POST", "/api/payout-batches/" + t2Batch.id + "/approve", T.su);
    check("P18 an on-hold batch cannot be approved (409)", r.s === 409);
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/hold", T.therapy, {});
    check("P18 holding needs a reason (400)", r.s === 400);
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/hold", T.therapy, { reason: "Check the PCR" });
    check("P18 Therapy Admin can hold with a reason; the lines go on hold too", r.s === 200 && (await q("SELECT status FROM payout_batches WHERE id = $1", [t1Batch.id]))[0].status === "on_hold" && (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE batch_id = $1 AND state <> 'onHold'", [t1Batch.id]))[0].n === 0);
    r = await call("POST", "/api/payout-batches/" + t2Batch.id + "/release", T.therapy);
    check("P18 a batch with missing bank details cannot be released (409)", r.s === 409);
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/release", T.therapy);
    check("P18 a held batch with bank details is released back to 'scheduled'", r.s === 200 && (await q("SELECT status FROM payout_batches WHERE id = $1", [t1Batch.id]))[0].status === "scheduled");
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/mark-paid", T.su, { utr: "UTR123456" });
    check("P18 a batch must be approved before it can be marked paid (409)", r.s === 409);
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/approve", T.su);
    check("P18 the Super Admin approves a scheduled batch", r.s === 200 && (await q("SELECT status, approved_by FROM payout_batches WHERE id = $1", [t1Batch.id]))[0].approved_by === U.su.id);

    // --- CSV export
    const wk = (await q("SELECT to_char(week_start, 'YYYY-MM-DD') AS w FROM payout_batches WHERE id = $1", [t1Batch.id]))[0].w;
    await q("UPDATE users SET name = '=HYPERLINK(1)' WHERE id = $1", [U.t1.id]);
    const csvRes = await fetch(base + "/api/payout-batches/export.csv?week=" + wk, { headers: { authorization: "Bearer " + T.su } });
    const csv = await csvRes.text();
    await q("UPDATE users SET name = 'Dr One' WHERE id = $1", [U.t1.id]);
    check("P18 the CSV has beneficiary, account, IFSC, amount and batch id for approved batches", csvRes.status === 200 && /Beneficiary name,Account number,IFSC,Amount \(INR\),Batch id/.test(csv) && new RegExp(`,${t1Batch.id}\\r?\\n`).test(csv) && /HDFC0001/.test(csv), csv.slice(0, 250));
    check("P18 spreadsheet formulas in names are neutralised ('=HYPERLINK' -> text)", !/(^|,)=HYPERLINK/m.test(csv) && /'=HYPERLINK/.test(csv));
    r = await call("GET", "/api/payout-batches/export.csv?week=" + wk, T.t1);
    check("P18 a therapist cannot export (403)", r.s === 403);

    // --- payment with UTR
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/mark-paid", T.su, { utr: "x" });
    check("P18 a bad UTR is refused (400)", r.s === 400);
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/mark-paid", T.therapy, { utr: "UTR123456" });
    check("P18 Therapy Admin cannot mark paid (403)", r.s === 403);
    const notesBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Your payout was sent'", [String(U.t1.id)]))[0].n;
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/mark-paid", T.su, { utr: "UTR123456", paidAt: new Date().toISOString() });
    check("P18 the Super Admin enters the UTR: batch paid, lines paid, therapist told", r.s === 200 && (await q("SELECT status, utr FROM payout_batches WHERE id = $1", [t1Batch.id]))[0].utr === "UTR123456" && (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE batch_id = $1 AND state <> 'Paid'", [t1Batch.id]))[0].n === 0 && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Your payout was sent'", [String(U.t1.id)]))[0].n === notesBefore + 1, "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/mark-paid", T.su, { utr: "UTR999999" });
    check("P18 a paid batch cannot be paid again (409)", r.s === 409);
    r = await call("POST", "/api/payout-batches/" + t1Batch.id + "/hold", T.su, { reason: "oops" });
    check("P18 a paid batch cannot be put on hold (409)", r.s === 409);

    // --- the therapist's own view
    const pdfRes = await fetch(base + "/api/payout-batches/" + t1Batch.id + "/statement.pdf", { headers: { authorization: "Bearer " + T.t1 } });
    const pdfB = Buffer.from(await pdfRes.arrayBuffer());
    check("P18 the therapist downloads the payout statement (PDF)", pdfRes.status === 200 && pdfB.slice(0, 4).toString() === "%PDF");
    check("P18 another therapist cannot (403)", (await fetch(base + "/api/payout-batches/" + t1Batch.id + "/statement.pdf", { headers: { authorization: "Bearer " + T.t2 } })).status === 403);
    r = await call("GET", "/api/therapists/earnings/" + U.t1.id, T.t1);
    check("P18 earnings page data: the paid batch shows with its bank reference", r.s === 200 && r.j.data.payoutHistory.some((p) => p.status === "Paid" && p.utr === "UTR123456" && p.batchId === t1Batch.id), "got " + r.s + " " + (r.raw || "").slice(0, 200));
    r = await call("GET", "/api/therapists/dashboard-stats/" + U.t1.id, T.t1);
    const sumNet = Number((await q("SELECT COALESCE(SUM(net_amount),0) AS s FROM payout_items WHERE therapist_id = $1", [U.t1.id]))[0].s);
    check("P18 dashboard net payout = sum of payout lines (no fixed percentage)", r.s === 200 && Number(r.j.data.kpis.netPayout) === sumNet, "got " + r.s + " " + (r.j && r.j.data && r.j.data.kpis.netPayout) + " vs " + sumNet);
    const srcFiles = [];
    const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = pathMod.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith(".js")) srcFiles.push(p); } };
    walk(pathMod.join(root, "src"));
    const bad = srcFiles.filter((f) => /\*\s*0\.9\b/.test(fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")));
    check("P18 no hard-coded 0.9 earnings maths is left in the backend", bad.length === 0, bad.join(", "));

    // --- premium tier needs an approval
    await q("UPDATE therapist_profiles SET membership_plan = 'standard' WHERE user_id = $1", [U.t1.id]);
    await call("PUT", "/api/therapists/profile/" + U.t1.id, T.t1, { membershipPlan: "premium", bio: "x", fullName: "Dr One", email: "t1@x.com", mobile: "9000000011", experienceYears: 3, hourlyRate: 1500, specialty: "1" });
    check("P18 a therapist cannot make themselves premium through the profile update", (await q("SELECT membership_plan FROM therapist_profiles WHERE user_id = $1", [U.t1.id]))[0].membership_plan === "standard");
    const [cr] = await q(`INSERT INTO change_requests(user_id, role, entity_id, section, changes, status) VALUES ($1,'therapist',$2,'profile',$3::jsonb,'pending') RETURNING id`, [U.t1.id, String(U.tp1), JSON.stringify({ membershipPlan: { old: "standard", new: "premium" } })]);
    r = await call("PUT", "/api/users/change-request/approve/" + cr.id, T.therapy);
    const prof = (await q("SELECT membership_plan, premium_approved_by FROM therapist_profiles WHERE user_id = $1", [U.t1.id]))[0];
    check("P18 an approved request makes the therapist premium and records who approved it", r.s === 200 && prof.membership_plan === "premium" && prof.premium_approved_by === U.therapy.id, "got " + r.s + " " + JSON.stringify(prof) + " " + (r.raw || "").slice(0, 100));
    await q("UPDATE therapist_profiles SET membership_plan = 'standard' WHERE user_id IN ($1, $2)", [U.t1.id, U.t2.id]);
  }

  // invoices
  r = await call("GET", "/api/invoices/list", T.su);
  const allInv = (await q("SELECT COUNT(*)::int AS n FROM invoices"))[0].n;
  check("P10 admin invoice list returns every invoice (" + allInv + ") in the frontend's shape", r.s === 200 && r.j.data.length === allInv && r.j.data[0].invoiceNumber && r.j.data[0].source && typeof r.j.data[0].totalAmountPaise === "number" && "issuedAt" in r.j.data[0], "got " + r.s + " " + (r.j && r.j.data && r.j.data.length));
  r = await call("GET", "/api/invoices/list?type=order", T.ecom);
  check("P10 filter type=order returns only shop invoices", r.s === 200 && r.j.data.length > 0 && r.j.data.every((x) => x.source.orderId));
  r = await call("GET", "/api/invoices/list?type=service", T.therapy);
  check("P10 filter type=service returns only booking invoices", r.s === 200 && r.j.data.length > 0 && r.j.data.every((x) => x.source.bookingId));
  r = await call("GET", "/api/invoices/list?from=2999-01-01", T.su); check("P10 date filter works (nothing after 2999)", r.s === 200 && r.j.data.length === 0);
  r = await call("GET", "/api/invoices/list?from=2020-01-01&to=2999-12-31", T.su); check("P10 date range filter accepts a range", r.s === 200 && r.j.data.length === allInv);
  r = await call("GET", "/api/invoices/list", T.p1);
  const p1Inv = (await q("SELECT COUNT(*)::int AS n FROM invoices WHERE user_id = $1", [U.p1.id]))[0].n;
  check("P10 a patient sees only their own invoices (" + p1Inv + " of " + allInv + ")", r.s === 200 && r.j.data.length === p1Inv && r.j.data.every((x) => x.userId === U.p1.id) && p1Inv < allInv);
  r = await call("GET", "/api/invoices/list?userId=" + U.p2.id, T.p1); check("P10 a patient cannot widen the list with ?userId=", r.s === 200 && r.j.data.every((x) => x.userId === U.p1.id));
  r = await call("GET", "/api/invoices/list", null); check("P10 invoice list needs a login -> " + r.s, r.s === 401);

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
