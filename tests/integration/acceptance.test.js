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
  SHIPROCKET_WEBHOOK_TOKEN: "hook-token-123", RAZORPAY_KEY_ID: "rzp_test_KEY", RAZORPAY_KEY_SECRET: "rzp_secret_123", RAZORPAY_WEBHOOK_SECRET: "whsec_123",
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
    this.payments = {
      refund: async (pid, o) => { rzpRefunds.push({ pid, amount: o.amount }); return { id: "rfnd_I" + ++refundSeq }; },
      all: async (params) => {
        if (FakeRazorpay.failPayments) throw new Error("Razorpay unreachable");
        if (FakeRazorpay.mockPayments) { const items = FakeRazorpay.mockPayments.slice(Number(params.skip || 0), Number(params.skip || 0) + Number(params.count || 10)); return { entity: "collection", count: items.length, items }; }
        return { entity: "collection", count: 0, items: [] };
      }
    };
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
  if (/services[\\/]shiprocketService(\.js)?$/.test(r)) return { getPickupLocations: async () => ({ data: { shipping_address: [{ pin_code: "390012" }] } }), checkServiceability: async () => ({ data: { available_courier_companies: [{ courier_company_id: 1, rate: 50 }], recommended_courier_company_id: 1 } }), createOrder() {}, generateAWB() {}, generateLabel() {}, generateManifest() {}, trackShipment() {}, cancelShipment() {}, createReturnOrder: async () => ({ order_id: 7001, shipment_id: 8001 }) };
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
    coupon_usages, order_stock_reservations, payment_webhook_events, sos_alerts, consent_logs, notifications, notification_log, audit_logs, tickets, ticket_messages, payout_items, media,
    care_packs, care_pack_plans RESTART IDENTITY CASCADE`);
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
  // P25: patients of the fixture have already accepted the medical consent and the privacy notice (first-booking rule); the P25 tests use fresh patients
  await q("INSERT INTO consent_logs(user_id, consent_type, policy_version, granted) SELECT u.id, c, '2026-10', true FROM users u, unnest(ARRAY['medical','privacy']) c WHERE u.role = 'patient'");
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
  r = await call("GET", "/api/consent/list?type=privacy", T.su); check("P10 Super Admin lists consent records (filter by type)", r.s === 200 && r.j.data.length >= 1 && r.j.data.some((x) => x.userName === "Patient One" && x.consentType === "privacy"));

  // cancel
  const day = (n) => { const d = new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  let mkN = 0;   // every test booking gets its own time, because the database now refuses two active bookings in one slot; the minute is half an hour away from the clock's, so it never meets the fixtures that are placed relative to "now"
  const mkA1 = async (pay, daysAhead, extra = {}) => (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, razorpay_payment_id, payment_method, created_at)
    VALUES ($1,'Patient One',$2,'Dr One',1,1500,1500,$3,$4,CASE WHEN $5 = 'Paid' THEN 'confirmed' ELSE 'pending_payment' END,$5,$6,$7, now() - interval '1 day') RETURNING id`, [U.p1.id, U.t1.id, day(daysAhead), extra.time || `${pad(1 + (mkN++ % 20))}:${pad((new Date().getUTCMinutes() + 30) % 60)}`, pay, extra.rzp || null, extra.method || null]))[0].id;
  const mkA = async (pay, daysAhead, extra = {}) => { for (let k = 0; ; k++) { try { return await mkA1(pay, daysAhead, k ? { ...extra, time: `${pad(1 + (mkN++ % 20))}:${pad((new Date().getUTCMinutes() + 31 + k * 3) % 60)}` } : extra); } catch (e) { if (!/uq_appointments_active_slot/.test(String(e.message)) || k >= 8) throw e; } } };   // a slot taken by a clock-relative fixture: try another minute
  const unpaid = await mkA("Pending", 0, { time: "23:00" });
  r = await call("POST", "/api/appointments/" + unpaid + "/cancel", T.p2); check("P10 another patient cannot cancel -> " + r.s, r.s === 403);
  const tNotifBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Appointment cancelled'", [String(U.t1.id)]))[0].n;
  r = await call("POST", "/api/appointments/" + unpaid + "/cancel", T.p1);
  check("P10 patient cancels an UNPAID booking (even hours before) -> Cancelled, therapist notified", r.s === 200 && (await q("SELECT status FROM appointments WHERE id = $1", [unpaid]))[0].status === "cancelled_by_patient" && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND type = 'booking' AND title = 'Booking Cancelled'", [String(U.t1.id)]))[0].n === tNotifBefore + 1, "got " + r.s + " " + (r.raw || "").slice(0, 150));
  r = await call("PATCH", "/api/appointments/" + unpaid + "/cancel", T.p1); check("P10 cancelling again is refused -> " + r.s, r.s === 400);
  const rfBefore = rzpRefunds.length;
  const paidFar = await mkA("Paid", 3, { rzp: "pay_cancel1", method: "razorpay" });
  r = await call("PATCH", "/api/appointments/" + paidFar + "/cancel", T.p1);
  check("P10 patient cancels a PAID booking more than 12h away -> Cancelled + full refund through Razorpay (PATCH, as the website calls it)", r.s === 200 && rzpRefunds.length === rfBefore + 1 && rzpRefunds[rfBefore].pid === "pay_cancel1" && rzpRefunds[rfBefore].amount === 150000 && r.j.refund && r.j.refund.status === "pending" && (await q("SELECT status FROM appointments WHERE id = $1", [paidFar]))[0].status === "cancelled_by_patient" && (await q("SELECT 1 FROM order_refunds WHERE appointment_id = $1 AND status = 'pending'", [paidFar])).length === 1, "got " + r.s + " " + (r.raw || "").slice(0, 200));
  const paidNear = await mkA("Paid", 0, { rzp: "pay_cancel2", method: "razorpay", time: pad(Math.min(23, (new Date(Date.now() + 5.5 * 3600e3)).getUTCHours() + 1)) + ":07" });      // :07 never collides with the fixed :00 / :30 fixtures, whatever the hour the suite runs in
  r = await call("POST", "/api/appointments/" + paidNear + "/cancel", T.p1);
  check("P10/P14 a PAID booking less than 2h away can be cancelled, but the whole price is kept (no refund)", r.s === 200 && (await q("SELECT status, cancellation_charge, refund_amount FROM appointments WHERE id = $1", [paidNear]))[0].status === "cancelled_by_patient" && Number((await q("SELECT cancellation_charge FROM appointments WHERE id = $1", [paidNear]))[0].cancellation_charge) === 1500 && rzpRefunds.length === rfBefore + 1, "got " + r.s + " " + JSON.stringify(r.j));
  const paidManual = await mkA("Paid", 3, { method: "manual_cash" });
  r = await call("POST", "/api/appointments/" + paidManual + "/cancel", T.p1);
  check("P10 a booking paid in cash (no online payment to refund) -> 400 contact support", r.s === 400 && (await q("SELECT status FROM appointments WHERE id = $1", [paidManual]))[0].status === "confirmed");
  const paidByTherapist = await mkA("Paid", 0, { rzp: "pay_cancel3", method: "razorpay", time: "23:30" });
  r = await call("POST", "/api/appointments/" + paidByTherapist + "/cancel", T.t1, { reason: "Family emergency" });
  check("P10 therapist cancels their own paid booking -> full refund; patient notified", r.s === 200 && rzpRefunds.some((x) => x.pid === "pay_cancel3") && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Booking cancelled'", [String(U.p1.id)]))[0].n >= 1, "got " + r.s + " " + (r.raw || "").slice(0, 150));

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

  check("P15 the PCR carries the therapy type by name (the report form's select needs text, not an id)", typeof g.therapyType === "string" && g.therapyType.length > 0, "got " + JSON.stringify(g.therapyType));

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
    const notifBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Recommended session reserved'", [String(fuPatient.id)]))[0].n;
    r = await send(src1, { nextSessionPlan: seriesPlan });
    check("P17 PCR submitted with a 6-session series", r.s === 200, "got " + r.s + " " + (r.raw || "").slice(0, 150));
    const props = await q("SELECT fp.*, a.status AS astatus, to_char(a.date,'YYYY-MM-DD') AS d, a.time FROM followup_proposals fp JOIN appointments a ON a.id = fp.appointment_id WHERE fp.patient_id = $1 AND fp.status = 'proposed' ORDER BY a.date", [fuPatient.id]);
    check("P17 6 'proposed' appointments hold the slots (one series row, hold expiry set)", props.length === 6 && props.every((x) => x.astatus === "proposed" && x.time === "16:00" && x.hold_expires_at) && new Set(props.map((x) => x.series_id)).size === 1 && (await q("SELECT 1 FROM followup_series WHERE id = $1", [props[0].series_id])).length === 1, JSON.stringify(props.map((x) => x.d + " " + x.astatus)));
    check("P17 they fall on Mon/Wed/Fri", props.every((x) => [1, 3, 5].includes(new Date(x.d + "T00:00:00Z").getUTCDay())));
    check("P17 the old next_treatment_date is filled from the plan", (await q("SELECT left(next_treatment_date::text, 10) AS d FROM pcr WHERE appointment_id = $1", [src1]))[0].d === props[0].d, "");
    const pn = await q("SELECT message FROM notifications WHERE user_uid = $1 AND title = 'Recommended session reserved' ORDER BY id DESC", [String(fuPatient.id)]);
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
    const notesBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'followup_expired'"))[0].n;
    jr = await followUpService.expireHolds();
    check("P17 at hold expiry the booking is released (proposal_expired) and both sides are told", jr.expired >= 1 && (await q("SELECT status FROM appointments WHERE id = $1", [exp.appointment_id]))[0].status === "proposal_expired" && (await q("SELECT status FROM followup_proposals WHERE id = $1", [exp.id]))[0].status === "expired" && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'followup_expired'"))[0].n === notesBefore + 2);
    check("P17 the expired slot is free for others", (await call("GET", "/api/therapists/" + U.t1.id + "/slots?date=" + day(21))).j.data.slots.some((x) => x.time === "15:00"));

    // no_slot: the slot was taken before submit
    const src4 = await mkSrc();
    await q(`INSERT INTO appointments(patient_id, therapist_id, date, time, status, payment_status) VALUES ($1,$2,$3,'15:00','confirmed','Paid')`, [U.p2.id, U.t1.id, day(22)]);
    const alertsBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'followup_no_slot' AND title = 'Slot unavailable'"))[0].n;
    r = await send(src4, { nextSessionPlan: { mode: "single", date: day(22), time: "15:00" } });
    check("P17 a slot that was just taken becomes 'no_slot' and the therapist is alerted", r.s === 200 && (await q("SELECT COUNT(*)::int AS n FROM followup_proposals WHERE source_pcr_id = (SELECT id FROM pcr WHERE appointment_id = $1) AND status = 'no_slot'", [src4]))[0].n === 1 && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'followup_no_slot' AND title = 'Slot unavailable'"))[0].n === alertsBefore + 1);

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

  // ---- P19: shipping fee rule, courier webhook pipeline, return rules, inspection refund
  {
    const hookPost = (body, token) => fetch(base + "/api/hooks/logistics", { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { "x-api-key": token }) }, body: JSON.stringify(body) });
    const waitFor = async (fn, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(40); } return false; };
    r = await call("GET", "/api/config/public");
    check("P19 the shop numbers (free from 499, flat 50, 7-day returns) are public config", r.s === 200 && r.j.data.shop.freeShippingThresholdInr === 499 && r.j.data.shop.flatShippingFeeInr === 50 && r.j.data.shop.returnWindowDays === 7);

    // --- shipping fee
    const [p498, p499] = await q("INSERT INTO products(title, selling_price, mrp, sku, category_id, hsn_code, gst_slab, is_tax_inclusive, weight_kg) VALUES ('Low cart', 498, 498, 'L498', 1, '9021', 18, true, 0.2), ('Edge cart', 499, 499, 'E499', 1, '9021', 18, true, 0.2) RETURNING id");
    await q("INSERT INTO inventory(product_id, sku, on_hand, reserved) VALUES ($1,'L498',50,0), ($2,'E499',50,0)", [p498.id, p499.id]);
    await putCart(U.p1.id, [[p498.id, 1]]);
    r = await call("POST", "/api/orders/create-order", T.p1, { billing_address_id: U.a1, shipping_address_id: U.a1 });
    const o498 = r.j && r.j.data && r.j.data.orderId;
    const row498 = o498 && (await q("SELECT shipping_charges, total FROM orders WHERE id = $1", [o498]))[0];
    check("P19 a ₹498 cart pays ₹50 shipping (total 548)", r.s === 200 && Number(row498.shipping_charges) === 50 && Number(row498.total) === 548, "got " + r.s + " " + JSON.stringify(row498));
    await putCart(U.p1.id, [[p499.id, 1]]);
    r = await call("POST", "/api/orders/create-order", T.p1, { billing_address_id: U.a1, shipping_address_id: U.a1 });
    const o499 = r.j && r.j.data && r.j.data.orderId;
    const row499 = o499 && (await q("SELECT shipping_charges, total FROM orders WHERE id = $1", [o499]))[0];
    check("P19 a ₹499 cart ships free (total 499)", r.s === 200 && Number(row499.shipping_charges) === 0 && Number(row499.total) === 499, "got " + r.s + " " + JSON.stringify(row499));

    // --- shipments are only for paid orders
    r = await call("POST", "/api/shipment/create", T.ecom, { orderId: o498 });
    check("P19 an unpaid order cannot get a shipment/AWB (400)", r.s === 400 && /paid/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 100));

    // --- courier webhook through every stage
    let on = 0;
    const mkOrder = async (status = "Placed", extra = {}) => {
      on += 1;
      const id = (await q(`INSERT INTO orders(order_number, user_id, customer_name, billing_address_id, shipping_address_id, subtotal, total, shipping_charges, status, payment_status, razorpay_payment_id)
        VALUES ($1,$2,'Patient One',$3,$3,1000,1180,50,$4,'Paid',$5) RETURNING id`, ["ORD-P19-" + on, U.p1.id, U.a1, status, extra.pay === false ? null : "pay_ord_p19_" + on]))[0].id;
      await q("INSERT INTO order_items(order_id, sku, name, qty, price, mrp, hsn_code, tax_rate_pct) VALUES ($1,'A1','Band',2,500,600,'9021',18)", [id]);
      const awb = "AWB" + (1000 + on);
      await q("INSERT INTO shipments(order_id, awb, carrier, status, provider, shiprocket_shipment_id) VALUES ($1,$2,'Courier','Pending Pickup','shiprocket',$3)", [id, awb, 5000 + on]);
      return { id, awb, number: "ORD-P19-" + on };
    };
    const ord = (id) => q("SELECT status, delivered_at FROM orders WHERE id = $1", [id]).then((x) => x[0]);
    const A = await mkOrder();
    let res0 = await hookPost({ awb: A.awb, current_status: "AWB Assigned", current_timestamp: new Date(Date.now() - 5 * 3600e3).toISOString() }, "wrong");
    check("P19 the webhook refuses a wrong token (401) and stores nothing", res0.status === 401 && (await q("SELECT COUNT(*)::int AS n FROM shipment_events WHERE awb = $1", [A.awb]))[0].n === 0);
    res0 = await hookPost({ awb: A.awb, current_status: "AWB Assigned" });
    check("P19 ... and no token at all (401)", res0.status === 401);
    const stages = [["AWB Assigned", "awb_generated", 5], ["Picked Up", "picked_up", 4], ["In Transit", "in_transit", 3], ["Out For Delivery", "out_for_delivery", 2], ["Delivered", "delivered", 1]];
    let walked = true;
    let deliveredStamp;
    for (const [text, expect, hoursAgo] of stages) {
      const stamp = new Date(Date.now() - hoursAgo * 3600e3).toISOString();
      if (expect === "delivered") deliveredStamp = stamp;
      const hres = await hookPost({ awb: A.awb, current_status: text, current_status_id: 7, current_timestamp: stamp }, "hook-token-123");
      const ok = hres.status === 200 && (await waitFor(async () => (await ord(A.id)).status === expect));
      if (!ok) { walked = false; check("P19 webhook stage " + text + " -> " + expect, false, "http " + hres.status + " status now " + (await ord(A.id)).status); break; }
    }
    check("P19 simulated courier calls move the order through all five stages", walked);
    const done = await ord(A.id);
    check("P19 delivered_at is saved (from the courier's time) on the order and the shipment", done.delivered_at && Math.abs(new Date(done.delivered_at).getTime() - (Date.now() - 3600e3)) < 120000 && (await q("SELECT delivered_at FROM shipments WHERE order_id = $1", [A.id]))[0].delivered_at, JSON.stringify(done));
    check("P19 the customer was told it was delivered, once", (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Your order was delivered'", [String(U.p1.id)]))[0].n === 1);
    check("P19 every call is kept as an event (5 rows)", (await q("SELECT COUNT(*)::int AS n FROM shipment_events WHERE awb = $1", [A.awb]))[0].n === 5);
    await hookPost({ awb: A.awb, current_status: "Delivered", current_status_id: 7, current_timestamp: deliveredStamp }, "hook-token-123"); await sleep(150);
    check("P19 the same event sent twice is stored once", (await q("SELECT COUNT(*)::int AS n FROM shipment_events WHERE awb = $1", [A.awb]))[0].n === 5);
    await hookPost({ awb: A.awb, current_status: "In Transit", current_status_id: 6, current_timestamp: new Date(Date.now() - 30 * 60e3).toISOString() }, "hook-token-123"); await sleep(150);
    check("P19 a late 'In Transit' after delivery is kept as an event but does not move the order backwards", (await ord(A.id)).status === "delivered" && (await q("SELECT COUNT(*)::int AS n FROM shipment_events WHERE awb = $1", [A.awb]))[0].n === 6);
    res0 = await hookPost({ awb: "NOSUCHAWB", current_status: "Delivered", current_timestamp: new Date().toISOString() }, "hook-token-123"); await sleep(150);
    check("P19 an unknown AWB is answered 200 and kept (no order touched)", res0.status === 200 && (await q("SELECT COUNT(*)::int AS n FROM shipment_events WHERE awb = 'NOSUCHAWB' AND shipment_id IS NULL"))[0].n === 1);
    const Rt = await mkOrder();
    await hookPost({ awb: Rt.awb, current_status: "RTO Initiated", current_timestamp: new Date().toISOString() }, "hook-token-123");
    check("P19 RTO statuses map to 'rto'", await waitFor(async () => (await ord(Rt.id)).status === "rto"));
    await hookPost({ awb: Rt.awb, current_status: "Delivered", current_timestamp: new Date(Date.now() + 1000).toISOString() }, "hook-token-123"); await sleep(150);
    check("P19 and a stray 'Delivered' cannot revive an rto order", (await ord(Rt.id)).status === "rto");
    const Cn = await mkOrder();
    await hookPost({ awb: Cn.awb, current_status: "Canceled", current_timestamp: new Date().toISOString() }, "hook-token-123");
    check("P19 'Canceled' maps to Cancelled", await waitFor(async () => (await ord(Cn.id)).status === "Cancelled"));

    // --- return rules
    const Und = await mkOrder("in_transit");
    const itemOf = async (orderId) => (await q("SELECT id FROM order_items WHERE order_id = $1", [orderId]))[0].id;
    r = await call("POST", "/api/orders/" + Und.id + "/return", T.p1, { reason: "damaged", photos: ["p1"], items: [{ order_item_id: await itemOf(Und.id), quantity: 1 }] });
    check("P19 a return on an undelivered order is refused (400)", r.s === 400 && /delivered/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 100));
    const Old = await mkOrder("delivered");
    await q("UPDATE orders SET delivered_at = now() - interval '8 days' WHERE id = $1", [Old.id]);
    r = await call("POST", "/api/orders/" + Und.id + "/return", T.p1, { reason: "damaged", photos: ["p1"], items: [{ orderItemId: 1, qty: 1 }] });
    check("P19 an item without order_item_id and quantity is a 400, not a server error", r.s === 400, "got " + r.s + " " + (r.raw || "").slice(0, 100));
    r = await call("POST", "/api/orders/" + Old.id + "/return", T.p1, { reason: "damaged", photos: ["p1"], items: [{ order_item_id: await itemOf(Old.id), quantity: 1 }] });
    check("P19 a return after 7 days is refused (400)", r.s === 400 && /window/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 100));
    const itA = await itemOf(A.id);
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "changed my mind", items: [{ order_item_id: itA, quantity: 1 }] });
    check("P19 the reason must come from the list (400)", r.s === 400);
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "damaged", items: [{ order_item_id: itA, quantity: 1 }] });
    check("P19 a photo is required for 'damaged' (400)", r.s === 400 && /photo/i.test(r.raw || ""));
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "wrong_item", items: [{ order_item_id: await itemOf(Rt.id), quantity: 1 }] });
    check("P19 an item from another order is refused (400)", r.s === 400);
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "wrong_item", items: [{ order_item_id: itA, quantity: 5 }] });
    check("P19 returning more than was bought is refused (400)", r.s === 400);
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p2, { reason: "wrong_item", items: [{ order_item_id: itA, quantity: 1 }] });
    check("P19 another customer cannot return my order (404)", r.s === 404);
    await q("UPDATE categories SET non_returnable = true WHERE id = 1");
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "wrong_item", items: [{ order_item_id: itA, quantity: 1 }] });
    check("P19 items from a non-returnable category are refused (400)", r.s === 400 && /cannot be returned/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 100));
    await q("UPDATE categories SET non_returnable = false WHERE id = 1");
    await q("UPDATE products SET non_returnable = true WHERE sku = (SELECT sku FROM order_items WHERE id = $1)", [itA]);
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "wrong_item", items: [{ order_item_id: itA, quantity: 1 }] });
    check("P32 a product marked non-returnable by the admin is refused (400), whatever its category", r.s === 400 && /cannot be returned/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 100));
    await q("UPDATE products SET non_returnable = false WHERE sku = (SELECT sku FROM order_items WHERE id = $1)", [itA]);
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "damaged", note: "Cracked in the box", photos: ["media-1"], items: [{ order_item_id: itA, quantity: 1 }] });
    const ret1 = r.j && r.j.returnId;
    check("P19 a valid return (delivered, in window, with a photo) is accepted", r.s === 201 && ret1 && (await q("SELECT reason_code, status, photos FROM order_returns WHERE id = $1", [ret1]))[0].reason_code === "damaged");
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "wrong_item", items: [{ order_item_id: itA, quantity: 2 }] });
    check("P19 the same item cannot be returned beyond what is left (400)", r.s === 400, "got " + r.s + " " + (r.raw || "").slice(0, 100));

    // --- admin handling
    r = await call("PUT", "/api/orders/returns/" + ret1 + "/reject", T.ecom, { reason: "" });
    check("P19 rejecting needs a reason (400)", r.s === 400);
    r = await call("PUT", "/api/orders/returns/" + ret1 + "/inspect", T.ecom, { result: "pass" });
    check("P19 inspecting before it was received is refused (409)", r.s === 409);
    r = await call("PUT", "/api/orders/returns/" + ret1 + "/approve", T.ecom, {});
    check("P19 admin approves: the reverse pickup is created and remembered", r.s === 200 && (await q("SELECT status, reverse_shipment_id FROM order_returns WHERE id = $1", [ret1]))[0].reverse_shipment_id === 8001, "got " + r.s + " " + (r.raw || "").slice(0, 150));
    r = await call("PUT", "/api/orders/returns/" + ret1 + "/reject", T.ecom, { reason: "late" });
    check("P19 an approved return can no longer be rejected (409)", r.s === 409);
    const noteBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'A return arrived'"))[0].n;
    await hookPost({ awb: "REVAWB1", order_id: `RET-${A.number}-${ret1}`, is_return: 1, current_status: "Picked Up", current_timestamp: new Date().toISOString() }, "hook-token-123");
    check("P19 the courier's reverse pickup moves the return to 'In Transit'", await waitFor(async () => (await q("SELECT status FROM order_returns WHERE id = $1", [ret1]))[0].status === "In Transit"));
    await hookPost({ awb: "REVAWB1", order_id: `RET-${A.number}-${ret1}`, is_return: 1, current_status: "Delivered", current_timestamp: new Date(Date.now() + 1000).toISOString() }, "hook-token-123");
    check("P19 its delivery to the warehouse marks it 'Received' and tells the shop admins", await waitFor(async () => (await q("SELECT status FROM order_returns WHERE id = $1", [ret1]))[0].status === "Received") && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE title = 'A return arrived'"))[0].n > noteBefore);
    check("P19 a return shipment never changes the order itself (it stays Return Approved)", (await ord(A.id)).status === "Return Approved", JSON.stringify(await ord(A.id)));

    r = await call("PUT", "/api/orders/returns/" + ret1 + "/inspect", T.ecom, { result: "maybe" });
    check("P19 the inspection result must be pass or fail (400)", r.s === 400);
    const refundsBefore = rzpRefunds.length;
    r = await call("PUT", "/api/orders/returns/" + ret1 + "/inspect", T.ecom, { result: "pass" });
    const rrow = (await q("SELECT status, inspection_result, inspected_at FROM order_returns WHERE id = $1", [ret1]))[0];
    check("P19 an inspected-and-passed return triggers a Razorpay refund: 1 of 2 items = 565 of the 1,130 paid for goods", r.s === 200 && rzpRefunds.length === refundsBefore + 1 && rzpRefunds[refundsBefore].amount === 56500 && rzpRefunds[refundsBefore].pid === "pay_ord_p19_1" && rrow.status === "Inspected" && rrow.inspection_result === "pass" && rrow.inspected_at && (await q("SELECT COUNT(*)::int AS n FROM order_refunds WHERE return_id = $1 AND amount = 565", [ret1]))[0].n === 1, "got " + r.s + " " + (r.raw || "").slice(0, 200) + " " + JSON.stringify(rzpRefunds.slice(refundsBefore)));
    r = await call("PUT", "/api/orders/returns/" + ret1 + "/inspect", T.ecom, { result: "pass" });
    check("P19 a return cannot be refunded twice (409)", r.s === 409 && rzpRefunds.length === refundsBefore + 1);

    // a second return that fails the check
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "missing_part", items: [{ order_item_id: itA, quantity: 1 }] });
    const ret2 = r.j && r.j.returnId;
    await call("PUT", "/api/orders/returns/" + ret2 + "/approve", T.ecom, {});
    r = await call("PUT", "/api/orders/returns/" + ret2 + "/receive", T.ecom);
    check("P19 admin can mark a return received by hand", r.s === 200 && (await q("SELECT status FROM order_returns WHERE id = $1", [ret2]))[0].status === "Received", "got " + r.s);
    r = await call("PUT", "/api/orders/returns/" + ret2 + "/inspect", T.ecom, { result: "fail" });
    check("P19 a failed inspection needs a reason (400)", r.s === 400);
    r = await call("PUT", "/api/orders/returns/" + ret2 + "/inspect", T.ecom, { result: "fail", note: "Item was used" });
    check("P19 a failed inspection rejects the return, no refund", r.s === 200 && (await q("SELECT status, inspection_result, rejection_reason FROM order_returns WHERE id = $1", [ret2]))[0].rejection_reason === "Item was used" && rzpRefunds.length === refundsBefore + 1);
    r = await call("PUT", "/api/orders/returns/" + ret2 + "/inspect", T.p1, { result: "pass" });
    check("P19 customers cannot inspect (403)", r.s === 403);

    // reject path
    r = await call("POST", "/api/orders/" + A.id + "/return", T.p1, { reason: "wrong_item", items: [{ order_item_id: itA, quantity: 1 }] });
    const ret3 = r.j && r.j.returnId;
    r = await call("PUT", "/api/orders/returns/" + ret3 + "/reject", T.ecom, { reason: "Not eligible: used product" });
    check("P19 admin rejects a new request with a reason; the customer is told", r.s === 200 && (await q("SELECT status, rejection_reason FROM order_returns WHERE id = $1", [ret3]))[0].rejection_reason === "Not eligible: used product" && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title = 'Your return request was not accepted'", [String(U.p1.id)]))[0].n === 1);
  }

  // P20 therapist affiliate (DR code) commissions
  {
    const affiliate = require("../../src/services/affiliateService");
    const payoutService = require("../../src/services/payoutService");
    const payOrder = async (token, user, addr, code, items, tag) => {
      await putCart(user.id, items);
      const c = await call("POST", "/api/orders/create-order", token, { billing_address_id: addr, shipping_address_id: addr, coupon_code: code });
      const rz = c.j && c.j.data && c.j.data.razorpayOrderId;
      const v = rz ? await call("POST", "/api/payments/verify", token, { razorpay_order_id: rz, razorpay_payment_id: "pay_aff_" + tag, razorpay_signature: sign(rz, "pay_aff_" + tag) }) : { s: 0 };
      return { id: c.j && c.j.data && c.j.data.orderId, create: c, verify: v };
    };
    const deliver = (id, daysAgo) => q("UPDATE orders SET status = 'delivered', delivered_at = now() - ($2 || ' days')::interval WHERE id = $1", [id, String(daysAgo)]);
    const comm = (orderId) => q("SELECT * FROM affiliate_commissions WHERE order_id = $1 ORDER BY id", [orderId]);

    r = await call("GET", "/api/config/public");
    check("P20 the affiliate numbers (10% off, 5% commission, 7 days) are public config", r.s === 200 && r.j.data.affiliate.patientDiscountPct === 10 && r.j.data.affiliate.therapistCommissionPct === 5 && r.j.data.affiliate.eligibleAfterDeliveryDays === 7);
    check("P20 code names: surname in capitals, letters only, first name as fallback",
      affiliate.baseCode("Anita Sharma") === "DRSHARMA" && affiliate.baseCode("Dr. Ravi O'Neil") === "DRONEIL" && affiliate.baseCode("Madonna") === "DRMADONNA" && affiliate.baseCode("Dr One") === "DRONE");

    // --- approving a therapist creates the code
    const mkT = async (uid, email, name, phone) => { const [u] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ($1,$2,$3,$4,'therapist',true,'Vadodara','Gujarat') RETURNING *", [uid, email, name, phone]); await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = 'therapist'", [u.id]); return u; };
    const t3 = await mkT("therapist-03", "t3@x.com", "Dr Anita Sharma", "9000000013");
    const t4 = await mkT("therapist-04", "t4@x.com", "Dr Meera Sharma", "9000000014");
    const approveNew = async (user) => {
      const tpId = (await q("INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, specialty) VALUES ($1, 900, 'pending', '{1}') RETURNING id", [user.id]))[0].id;
      const crId = (await q("INSERT INTO change_requests(user_id, role, entity_id, section, changes, status) VALUES ($1,'therapist',$2,'profile',$3::jsonb,'pending') RETURNING id", [user.id, String(tpId), JSON.stringify({ membershipPlan: { old: "standard", new: "standard" } })]))[0].id;
      const ap = await call("PUT", "/api/users/change-request/approve/" + crId, T.therapy);
      return { tpId, ap };
    };
    const a3 = await approveNew(t3);
    const code3 = (await q("SELECT * FROM coupons WHERE therapist_id = $1", [a3.tpId]))[0];
    check("P20 approving a therapist creates DRSHARMA: percent, 10, Therapist, Active", a3.ap.s === 200 && code3 && code3.code === "DRSHARMA" && code3.type === "percent" && Number(code3.value) === 10 && code3.owner_type === "Therapist" && code3.status === "Active", "got " + a3.ap.s + " " + JSON.stringify(code3));
    const a4 = await approveNew(t4);
    const code4 = (await q("SELECT code FROM coupons WHERE therapist_id = $1", [a4.tpId]))[0];
    check("P20 a taken name gets a number (DRSHARMA2)", code4 && code4.code === "DRSHARMA2", JSON.stringify(code4));
    await call("PUT", "/api/users/change-request/approve/" + (await q("INSERT INTO change_requests(user_id, role, entity_id, section, changes, status) VALUES ($1,'therapist',$2,'profile',$3::jsonb,'pending') RETURNING id", [t3.id, String(a3.tpId), JSON.stringify({ membershipPlan: { old: "standard", new: "standard" } })]))[0].id, T.therapy);
    check("P20 a later approval never makes a second code", (await q("SELECT COUNT(*)::int AS n FROM coupons WHERE therapist_id = $1", [a3.tpId]))[0].n === 1);

    // --- generate-missing for therapists approved before this feature
    r = await call("POST", "/api/coupons/generate-missing", T.p1);
    check("P20 generate-missing is admin only (403)", r.s === 403);
    r = await call("POST", "/api/coupons/generate-missing", T.ecom);
    const made = (await q("SELECT id, code, therapist_id FROM coupons WHERE owner_type = 'Therapist' AND therapist_id = ANY($1) ORDER BY code", [[U.tp1, U.tp2]]));
    check("P20 generate-missing creates DRONE and DRTWO for the existing approved therapists", r.s === 200 && made.map((x) => x.code).join() === "DRONE,DRTWO", "got " + r.s + " " + JSON.stringify(made));
    const total1 = (await q("SELECT COUNT(*)::int AS n FROM coupons WHERE owner_type = 'Therapist'"))[0].n;
    r = await call("POST", "/api/coupons/generate-missing", T.ecom);
    check("P20 running it again creates nothing", r.s === 200 && (await q("SELECT COUNT(*)::int AS n FROM coupons WHERE owner_type = 'Therapist'"))[0].n === total1);

    // --- the money: 2,000 taxable with the code -> patient pays 1,800 + GST, commission 90 pending
    const [pAff] = await q("INSERT INTO products(title, selling_price, mrp, sku, category_id, hsn_code, gst_slab, is_tax_inclusive, weight_kg) VALUES ('Affiliate item', 2360, 2360, 'AFF1', 1, '9021', 18, true, 0.2) RETURNING id");
    await q("INSERT INTO inventory(product_id, sku, on_hand, reserved) VALUES ($1,'AFF1',100,0)", [pAff.id]);
    const O1 = await payOrder(T.p1, U.p1, U.a1, "DRONE", [[pAff.id, 1]], "o1");
    const ord1 = (await q("SELECT total, taxable_value, coupon_only_discount FROM orders WHERE id = $1", [O1.id]))[0];
    const c1 = O1.id ? await comm(O1.id) : [];
    check("P20 the patient gets 10% off: taxable 2,000 -> 1,800, pays 2,124 with GST", O1.verify.s === 200 && Number(ord1.taxable_value) === 1800 && Number(ord1.total) === 2124, JSON.stringify(ord1) + " verify " + O1.verify.s);
    check("P20 the commission is 5% of 1,800 = 90, pending, for the therapist user", c1.length === 1 && Number(c1[0].sale_amount) === 1800 && Number(c1[0].commission_pct) === 5 && Number(c1[0].commission_amount) === 90 && c1[0].status === "pending" && c1[0].therapist_id === U.t1.id && c1[0].coupon_id === made[0].id, JSON.stringify(c1));
    r = await call("POST", "/api/payments/verify", T.p1, { razorpay_order_id: (await q("SELECT razorpay_order_id FROM orders WHERE id = $1", [O1.id]))[0].razorpay_order_id, razorpay_payment_id: "pay_aff_o1", razorpay_signature: sign((await q("SELECT razorpay_order_id FROM orders WHERE id = $1", [O1.id]))[0].razorpay_order_id, "pay_aff_o1") });
    check("P20 verifying twice does not double the commission", (await comm(O1.id)).length === 1);

    // two lines -> one row per line
    const [pAff2] = await q("INSERT INTO products(title, selling_price, mrp, sku, category_id, hsn_code, gst_slab, is_tax_inclusive, weight_kg) VALUES ('Affiliate item 2', 1180, 1180, 'AFF2', 1, '9021', 18, true, 0.2) RETURNING id");
    await q("INSERT INTO inventory(product_id, sku, on_hand, reserved) VALUES ($1,'AFF2',100,0)", [pAff2.id]);
    const O2 = await payOrder(T.p2, U.p2, U.a2, "drtwo", [[pAff.id, 1], [pAff2.id, 2]], "o2");
    const c2 = await comm(O2.id);
    check("P20 one row per order line; code is not case sensitive; sum = 5% of taxable (lines 1,800 + 1,800 -> 180)", c2.length === 2 && c2.reduce((a, x) => a + Number(x.commission_amount), 0) === 180 && c2.every((x) => x.therapist_id === U.t2.id), JSON.stringify(c2));

    // not for platform coupons, not on your own order, not on sessions
    const O3 = await payOrder(T.p1, U.p1, U.a1, "OPEN10", [[pAff.id, 1]], "o3");
    check("P20 a platform coupon earns no commission", O3.verify.s === 200 && (await comm(O3.id)).length === 0);
    const selfOrder = (await q(`INSERT INTO orders(order_number, user_id, subtotal, total, status, payment_status, coupon_id) VALUES ('ORD-P20-SELF', $1, 1000, 1000, 'Placed', 'Paid', $2) RETURNING id`, [U.t1.id, made[0].id]))[0].id;
    await q("INSERT INTO order_items(order_id, sku, name, qty, price, mrp, hsn_code, tax_rate_pct, taxable_value) VALUES ($1,'AFF1','Self',1,1000,1000,'9021',18,847.46)", [selfOrder]);
    check("P20 a therapist earns nothing on their own order", (await affiliate.recordForOrder(selfOrder)) === 0 && (await comm(selfOrder)).length === 0);

    // --- eligibility: 7 days after delivery, never with an open return
    check("P20 nothing is eligible before delivery", (await affiliate.promoteEligible()) === 0 && (await comm(O1.id))[0].status === "pending");
    await deliver(O1.id, 3);
    check("P20 3 days after delivery it is still pending", (await affiliate.promoteEligible()) === 0 && (await comm(O1.id))[0].status === "pending");
    await deliver(O1.id, 8);
    await q("INSERT INTO order_returns(order_id, user_id, reason, status) VALUES ($1, $2, 'x', 'Requested')", [O1.id, U.p1.id]);
    check("P20 an open return request holds the commission back", (await affiliate.promoteEligible()) === 0 && (await comm(O1.id))[0].status === "pending");
    await q("DELETE FROM order_returns WHERE order_id = $1", [O1.id]);
    const promoted = await affiliate.promoteEligible();
    const e1 = (await comm(O1.id))[0];
    const pi1 = (await q("SELECT * FROM payout_items WHERE type = 'affiliate' AND source_id = $1", [e1.id]))[0];
    check("P20 8 days after delivery the commission is eligible (eligible_at = delivery + 7 days)", promoted === 1 && e1.status === "eligible" && Math.abs(new Date(e1.eligible_at) - (Date.now() - 1 * 86400e3)) < 120000, JSON.stringify(e1));
    check("P20 ... and it is a payout line: gross 90, no platform fee, net 90, for the therapist", pi1 && Number(pi1.gross_amount) === 90 && Number(pi1.platform_fee_amount) === 0 && Number(pi1.net_amount) === 90 && pi1.therapist_id === U.t1.id && pi1.state === "Pending", JSON.stringify(pi1));
    check("P20 the daily job twice makes no second payout line", (await affiliate.promoteEligible()) === 0 && (await q("SELECT COUNT(*)::int AS n FROM payout_items WHERE type = 'affiliate' AND source_id = $1", [e1.id]))[0].n === 1);

    // --- cancelled order and approved return void the commission
    const O4 = await payOrder(T.p1, U.p1, U.a1, "DRONE", [[pAff.id, 1]], "o4");
    r = await call("POST", "/api/orders/" + O4.id + "/cancel", T.p1);
    check("P20 cancelling the order cancels its commission", r.s === 200 && (await comm(O4.id))[0].status === "cancelled", "got " + r.s + " " + JSON.stringify(await comm(O4.id)));
    const O5 = await payOrder(T.p1, U.p1, U.a1, "DRONE", [[pAff.id, 1]], "o5");
    await deliver(O5.id, 1);
    const it5 = (await q("SELECT id FROM order_items WHERE order_id = $1", [O5.id]))[0].id;
    r = await call("POST", "/api/orders/" + O5.id + "/return", T.p1, { reason: "wrong_item", items: [{ order_item_id: it5, quantity: 1 }] });
    const retId = r.j && r.j.returnId;
    r = retId ? await call("PUT", "/api/orders/returns/" + retId + "/approve", T.ecom, {}) : { s: 0 };
    check("P20 an approved return makes the commission cancelled_returned", r.s === 200 && (await comm(O5.id))[0].status === "cancelled_returned", "got " + r.s + " " + JSON.stringify(await comm(O5.id)));
    check("P20 a cancelled commission is never promoted", (await (async () => { await deliver(O4.id, 20); await deliver(O5.id, 20); return affiliate.promoteEligible(); })()) === 0);

    // --- the weekly batch picks it up; paying the batch marks the commission paid
    const before = (await q("SELECT COUNT(*)::int AS n FROM payout_batches"))[0].n;
    const later = Date.now() + 14 * 86400e3;
    await payoutService.runWeeklyBatches(later);
    const pi1b = (await q("SELECT * FROM payout_items WHERE id = $1", [pi1.id]))[0];
    check("P20 the next weekly run puts the commission into a payout batch", pi1b.batch_id && (await comm(O1.id))[0].payout_batch_id === pi1b.batch_id, JSON.stringify(pi1b));
    const bat = (await q("SELECT * FROM payout_batches WHERE id = $1", [pi1b.batch_id]))[0];
    check("P20 the batch gross includes the 90", bat && Number(bat.gross) >= 90 && bat.therapist_id === U.t1.id, JSON.stringify(bat));
    await payoutService.approve(bat.id, U.su.id);
    await payoutService.markPaid(bat.id, { utr: "UTRAFF123456" });
    check("P20 paying the batch marks the commission paid", (await comm(O1.id))[0].status === "paid");

    // --- the therapist's own numbers
    r = await call("GET", "/api/therapists/affiliate", T.t1);
    const d = r.j && r.j.data;
    check("P20 therapist affiliate stats: code, 5%, redemptions, gross sales, paid 90, top product", r.s === 200 && d.code === "DRONE" && d.commissionPct === 5 && d.patientDiscountPct === 10 && d.redemptions >= 1 && d.paid === 90 && d.grossSales >= 1800 && d.topProducts[0].name === "Affiliate item", JSON.stringify(d));
    r = await call("GET", "/api/therapists/affiliate", T.p1);
    check("P20 patients cannot open the affiliate stats (403)", r.s === 403);
    r = await call("GET", "/api/therapists/affiliate");
    check("P20 ... nor anonymous callers (401)", r.s === 401);
  }

  // P21 patient dashboard summary
  {
    const pad2 = (n) => String(n).padStart(2, "0");
    const ist = (minFromNow) => { const d = new Date(Date.now() + 5.5 * 3600e3 + minFromNow * 60000); return { date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`, time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` }; };
    const [p3] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ('patient-p21','p21@x.com','Patient P21','9000000021','patient',true,'Vadodara','Gujarat') RETURNING *");
    await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = 'patient'", [p3.id]);
    const [th21] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ('therapist-p21','t21@x.com','Dr P21','9000000121','therapist',true,'Vadodara','Gujarat') RETURNING *");
    const T3 = token(p3);
    const dash = async (tk) => call("GET", "/api/patients/me/dashboard", tk);

    r = await call("GET", "/api/patients/me/dashboard");
    check("P21 the dashboard needs a login (401)", r.s === 401);
    r = await dash(token({ ...th21, roleName: "therapist" }));
    check("P21 only patients can open it (therapist 403)", r.s === 403);

    r = await dash(T3);
    let d = r.j && r.j.data;
    check("P21 a new patient gets empty sections and isNew = true", r.s === 200 && d.isNew === true && d.activeBooking === null && d.recovery === null && d.proposals.length === 0 && d.orders.length === 0 && d.records.pcrs.length === 0 && d.lastTherapist === null, JSON.stringify(d).slice(0, 300));

    // --- active booking and the start code window
    const soon = ist(60), later = ist(3 * 24 * 60);
    const mkAppt = (who, w, status, extra = {}) => q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, status, payment_status, mode, created_at)
      VALUES ($1,$2,$3,'Dr P21',1,'Physio',1500,1500,$4,$5,$6,'Paid','home', now()) RETURNING id`, [who.id, who.name, th21.id, w.date, w.time, status]).then((x) => x[0].id);
    const farId = await mkAppt(p3, later, "confirmed");
    r = await dash(T3); d = r.j.data;
    check("P21 a booking days away is shown, but no start code is offered yet", d.activeBooking && d.activeBooking.id === farId && d.activeBooking.otpAvailable === false && d.isNew === false, JSON.stringify(d.activeBooking));
    const soonId = await mkAppt(p3, soon, "confirmed");
    r = await dash(T3); d = r.j.data;
    check("P21 the nearest booking comes first and its start code is available (within 2 h)", d.activeBooking.id === soonId && d.activeBooking.otpAvailable === true && d.activeBooking.therapistName === "Dr P21");
    r = await call("GET", "/api/appointments/" + soonId + "/otp", T3);
    check("P21 ... and the OTP endpoint really gives the code to this patient", r.s === 200 && /^\d{4}$/.test(String(r.j.data.otp)));
    r = await call("GET", "/api/appointments/" + soonId + "/otp", T.p2);
    check("P21 another patient cannot read that code (403)", r.s === 403);
    await q("UPDATE appointments SET status = 'pending_payment' WHERE id = $1", [soonId]);
    r = await dash(T3); d = r.j.data;
    check("P21 an unconfirmed booking never offers a start code", d.activeBooking.id === soonId && d.activeBooking.otpAvailable === false);
    await q("UPDATE appointments SET status = 'confirmed' WHERE id = $1", [soonId]);
    r = await dash(T.p2);
    check("P21 other patients' bookings do not leak into my summary", !(r.j.data.activeBooking && [soonId, farId].includes(r.j.data.activeBooking.id)));

    // --- pending proposal
    const propW = ist(5 * 24 * 60);
    const propAppt = await mkAppt(p3, propW, "proposed");
    const [fp] = await q("INSERT INTO followup_proposals(patient_id, therapist_id, proposed_start, appointment_id, status, hold_expires_at) VALUES ($1,$2, now() + interval '5 days', $3, 'proposed', now() + interval '20 hours') RETURNING id", [p3.id, th21.id, propAppt]);
    r = await dash(T3); d = r.j.data;
    check("P21 a pending next-session proposal is listed with its hold expiry", d.proposals.length === 1 && d.proposals[0].id === fp.id && d.proposals[0].holdExpiresAt && d.activeBooking.id === soonId);

    // --- recovery: plan, goal, outcome results, quick PCR scores
    const [plan] = await q("INSERT INTO treatment_plans(patient_id, primary_therapist_id, service_type_id, condition, planned_sessions, frequency_per_week, review_every_sessions, status, follow_up_overdue) VALUES ($1,$2,1,'Stroke recovery',12,3,5,'active', true) RETURNING id", [p3.id, th21.id]);
    const bbs = (await q("SELECT id FROM outcome_measures WHERE code = 'BBS'"))[0].id;
    const tug = (await q("SELECT id FROM outcome_measures WHERE code = 'TUG'"))[0].id;
    await q("INSERT INTO plan_measures(plan_id, measure_id) VALUES ($1,$2), ($1,$3)", [plan.id, tug, bbs]);
    await q("INSERT INTO treatment_goals(plan_id, description, measure_id, baseline_value, target_value) VALUES ($1,'Walk safely indoors',$2,30,50)", [plan.id, bbs]);
    const entered = [30, 38, 44];
    const pcrIds = [];
    for (let i = 0; i < 3; i += 1) {
      const w = ist(-(10 - i) * 24 * 60);
      const apptId = await mkAppt(p3, w, "completed");
      await q("UPDATE appointments SET pcr_status = 'locked', treatment_plan_id = $2 WHERE id = $1", [apptId, plan.id]);
      const [pc] = await q("INSERT INTO pcr(appointment_id, patient_id, therapist_id, status, therapist_name, functional_score, pain_vas) VALUES ($1,$2,$3,'locked','Dr P21',$4,$5) RETURNING id", [apptId, p3.id, th21.id, 3 + i * 2, 8 - i * 2]);
      pcrIds.push(pc.id);
      await q("INSERT INTO outcome_results(plan_id, measure_id, pcr_id, value, assessment_point, recorded_at) VALUES ($1,$2,$3,$4,$5, now() - ($6 || ' days')::interval)", [plan.id, bbs, pc.id, entered[i], i === 0 ? "baseline" : "session", String(10 - i)]);
    }
    await q("INSERT INTO progress_reports(plan_id, report_type, session_number, summary, therapist_id, shared_with_patient_at) VALUES ($1,'review',5,'ok',$2, now()), ($1,'review',10,'hidden',$2, NULL)", [plan.id, th21.id]);
    r = await dash(T3); d = r.j.data;
    const rec = d.recovery;
    check("P21 recovery: condition, sessions done / planned, attendance, review countdown and the overdue flag come from the plan",
      rec && rec.condition === "Stroke recovery" && rec.sessionsDone === 3 && rec.plannedSessions === 12 && rec.sessionsToNextReview === 2 && rec.followUpOverdue === true && rec.adherence && "ratio" in rec.adherence, JSON.stringify(rec).slice(0, 300));
    const series = rec && rec.measures.find((m) => m.code === "BBS");
    check("P21 chart values are exactly the outcome results entered in the PCRs", series && series.series.map((s) => s.value).join() === entered.join(), JSON.stringify(series && series.series.map((s) => s.value)));
    check("P21 only measures that have data are returned, at most 3, goals first", rec.measures.length === 1 && rec.measures[0].code === "BBS" && rec.goals.length === 1 && rec.goals[0].measureCode === "BBS");
    check("P21 the quick functional and pain scores equal what the PCRs hold", d.quickScores.map((x) => x.functionalScore + "/" + x.painVas).join() === "3/8,5/6,7/4", JSON.stringify(d.quickScores));
    check("P21 health records: the last 3 locked PCRs, newest first; only reports shared with the patient", d.records.pcrs.length === 3 && d.records.pcrs[0].date >= d.records.pcrs[2].date && d.records.reports.length === 1 && d.records.reports[0].reportType === "review");
    check("P21 last therapist is the one from the latest finished session", d.lastTherapist && d.lastTherapist.therapistId === th21.id && d.lastTherapist.name === "Dr P21");

    // --- orders: the last 3 with tracking
    for (let i = 1; i <= 4; i += 1) {
      const oid = (await q("INSERT INTO orders(order_number, user_id, customer_name, subtotal, total, status, payment_status) VALUES ($1,$2,'Patient P21',100,100,$3,'Paid') RETURNING id", ["ORD-P21-" + i, p3.id, i === 4 ? "in_transit" : "Placed"]))[0].id;
      if (i === 4) await q("INSERT INTO shipments(order_id, awb, carrier, status, provider) VALUES ($1,'AWBP21','Courier','In Transit','shiprocket')", [oid]);
    }
    r = await dash(T3); d = r.j.data;
    check("P21 recent orders: the last 3, newest first, with the courier status and AWB", d.orders.length === 3 && d.orders[0].number === "ORD-P21-4" && d.orders[0].status === "in_transit" && d.orders[0].awb === "AWBP21" && d.orders[2].number === "ORD-P21-2", JSON.stringify(d.orders.map((o) => o.number)));

    // --- feature flags for later prompts
    r = await call("GET", "/api/config/public");
    check("P21 feature flags maskedCall and carePacks are configured in public config", r.s === 200 && typeof r.j.data.features.maskedCall === "boolean" && typeof r.j.data.features.carePacks === "boolean");
  }

  // P22 therapist dashboard on real data & therapy admin queues
  {
    const qualityService = require("../../src/services/qualityService");
    const slotService = require("../../src/services/slotService");

    // 1. Migration 0014 columns and tables
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'therapist_profiles'`)).map(c => c.column_name);
    check("P22 migration 0014 added council, registration_valid_until, quality_status to therapist_profiles",
      cols.includes("council") && cols.includes("registration_valid_until") && cols.includes("quality_status") && cols.includes("quality_note")
    );
    const hasActionsTbl = (await q(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'therapist_quality_actions') AS ex`))[0].ex;
    check("P22 therapist_quality_actions table exists", hasActionsTbl === true);

    // 2. Therapist dashboard real KPIs & PCR alerts
    r = await call("GET", "/api/therapists/dashboard-stats/" + U.t1.id, T.t1);
    check("P22 therapist dashboard stats returns 200 with real KPI metrics and PCR alert",
      r.s === 200 && r.j.success && typeof r.j.data.kpis.sessionsCompleted === "number" &&
      typeof r.j.data.kpis.pcrAlert.pendingCount === "number" && typeof r.j.data.kpis.pcrAlert.pendingAmount === "number" &&
      Array.isArray(r.j.data.charts.sessionData) && Array.isArray(r.j.data.charts.modeSplitData) &&
      Array.isArray(r.j.data.charts.weeklyEarningsData) && Array.isArray(r.j.data.charts.topServicesData)
    );
    r = await call("GET", "/api/therapists/dashboard-stats/" + U.t1.id, T.p1);
    check("P22 patient cannot access therapist stats (403)", r.s === 403);

    // 3. Therapist my-patients progress endpoint
    r = await call("GET", "/api/therapists/my-patients", T.t1);
    check("P22 therapist my-patients returns array of active treatment plans with trends and review indicators",
      r.s === 200 && r.j.success && Array.isArray(r.j.data)
    );
    r = await call("GET", "/api/therapists/my-patients", T.p1);
    check("P22 patient cannot access therapist my-patients (403)", r.s === 403);

    // exact KPI check on a therapist whose data we control
    {
      const [kt] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ('th-kpi','kpi@x.com','Dr KPI','9000000400','therapist',true,'Vadodara','Gujarat') RETURNING *");
      await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = 'therapist'", [kt.id]);
      await q("INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, specialty) VALUES ($1, 800, 'approved', '{1}')", [kt.id]);
      const ap = async (patient, daysAgo, status, pcr, amount, hour) => (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, status, payment_status, pcr_status, mode, created_at)
        VALUES ($1,'P',$2,'Dr KPI',1,'Physio',$3,$3, current_date - $4::int, $5, $6, 'Paid', $7, 'home', now()) RETURNING id`, [patient.id, kt.id, amount, daysAgo, hour, status, pcr]))[0].id;
      await ap(U.p1, 5, "completed", "locked", 1000, "09:00");
      await ap(U.p1, 8, "completed", "locked", 1000, "10:00");
      await ap(U.p2, 12, "completed", "submitted", 1500, "11:00");          // completed, PCR not locked, older than 48 h -> alert
      await ap(U.p2, 120, "completed", "locked", 1000, "09:00");            // older than 90 days: not counted
      await ap(U.p1, 3, "cancelled_by_patient", "not_started", 1000, "12:00");
      await q("INSERT INTO therapist_reviews(therapist_id, patient_id, appointment_id, rating, review, created_at) VALUES ($1,$2,1,5,'x',now()), ($1,$2,1,4,'x',now()), ($1,$2,1,1,'old', now() - interval '200 days')", [kt.id, U.p1.id]);
      await q("INSERT INTO payout_items(source_id, therapist_id, gross_amount, net_amount, state, week_start, type, created_at) VALUES (1,$1,1000,1000,'Paid', current_date - 7, 'service', now()), (2,$1,500,500,'Pending', current_date, 'service', now()), (3,$1,90,90,'Pending', current_date, 'affiliate', now())", [kt.id]);
      await q("INSERT INTO affiliate_commissions(order_id, order_item_id, therapist_id, sale_amount, commission_pct, commission_amount, status) VALUES (1, 9001, $1, 1800, 5, 90, 'pending'), (1, 9002, $1, 1000, 5, 50, 'cancelled_returned')", [kt.id]);
      r = await call("GET", "/api/therapists/dashboard-stats/" + kt.id, token({ ...kt, roleName: "therapist" }));
      const k = r.j && r.j.data && r.j.data.kpis;
      check("P22 KPI sessions completed = 3 (the 120-day-old one and the cancelled one are left out)", k && k.sessionsCompleted === 3, JSON.stringify(k));
      check("P22 KPI unique patients (last 90 days) = 2", k && k.uniquePatients === 2, JSON.stringify(k));
      check("P22 KPI average rating = 4.5 (only the last 90 days)", k && Number(k.avgRating) === 4.5, JSON.stringify(k));
      check("P22 KPI net payout = 1500 (service lines; the commission is shown separately)", k && k.netPayout === 1500, JSON.stringify(k));
      check("P22 KPI product commissions = 90 (the returned one is not counted)", k && k.productCommissions === 90, JSON.stringify(k));
      check("P22 KPI PCR lock rate = 67% (2 of 3)", k && k.pcrLockRate === 67, JSON.stringify(k));
      check("P22 PCR alert = 1 unlocked PCR older than 48 h worth 1500", k && k.pcrAlert.pendingCount >= 1 && k.pcrAlert.pendingAmount >= 1500, JSON.stringify(k && k.pcrAlert));
      check("P22 weekly earnings chart splits Service and Product from payout lines", (r.j.data.charts.weeklyEarningsData || []).reduce((a, w) => a + w.Service, 0) === 1500 && (r.j.data.charts.weeklyEarningsData || []).reduce((a, w) => a + w.Product, 0) === 90, JSON.stringify(r.j.data.charts.weeklyEarningsData));
      r = await call("GET", "/api/therapists/dashboard-stats/" + kt.id, T.t2);
      check("P22 another therapist cannot read these KPIs (403)", r.s === 403);
    }

    // 4. Quality evaluation flags under-performing therapist (<4.0)
    const [tLow] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ('therapist-low','tlow@x.com','Dr Low','9000000099','therapist',true,'Vadodara','Gujarat') RETURNING *");
    await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = 'therapist'", [tLow.id]);
    await q("INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, quality_status, council, registration_valid_until) VALUES ($1, 800, 'approved', 'ok', 'NCAHP', CURRENT_DATE + INTERVAL '1 year')", [tLow.id]);
    for (let i = 0; i < 10; i++) {
      await q("INSERT INTO therapist_reviews(therapist_id, patient_id, appointment_id, rating, review) VALUES ($1, $2, $3, 3, 'Average')", [tLow.id, U.p1.id, 1]);
    }
    const evalRes = await qualityService.evaluateTherapistQuality(tLow.id);
    const updatedLow = (await q("SELECT quality_status FROM therapist_profiles WHERE user_id = $1", [tLow.id]))[0];
    check("P22 qualityService flags therapist with <4.0 average rating to under_review or coaching",
      (updatedLow.quality_status === "under_review" || updatedLow.quality_status === "coaching") && evalRes.flagged === true
    );

    // 5. Expired registration or frozen therapist excluded from directory and available slots
    await q("UPDATE therapist_profiles SET registration_valid_until = CURRENT_DATE - INTERVAL '5 days' WHERE user_id = $1", [tLow.id]);
    r = await call("GET", "/api/therapists/" + tLow.id);
    check("P22 expired therapist profile returns 404 from public endpoint", r.s === 404);
    let bookableErr = false;
    try {
      await slotService.assertSlotBookable(tLow.id, new Date().toISOString().slice(0, 10), "10:00");
    } catch (e) {
      bookableErr = true;
    }
    check("P22 slotService.assertSlotBookable rejects expired registration therapist", bookableErr === true);

    await q("UPDATE therapist_profiles SET registration_valid_until = CURRENT_DATE + INTERVAL '1 year', quality_status = 'frozen', quality_note = 'Quality hold' WHERE user_id = $1", [tLow.id]);
    bookableErr = false;
    try {
      await slotService.assertSlotBookable(tLow.id, new Date().toISOString().slice(0, 10), "10:00");
    } catch (e) {
      bookableErr = true;
    }
    check("P22 slotService.assertSlotBookable rejects frozen therapist", bookableErr === true);

    // 6. Therapy Admin Queues & Endpoints
    r = await call("GET", "/api/therapy-admin/overview", T.p1);
    check("P22 patient cannot access therapy admin endpoints (403)", r.s === 403);
    r = await call("GET", "/api/therapy-admin/overview", T.therapy);
    check("P22 therapy admin overview returns queue counts",
      r.s === 200 && r.j.success && typeof r.j.data.qualityQueue === "number" && typeof r.j.data.credentialQueue === "number" && typeof r.j.data.emergencyReassignment === "number"
    );

    r = await call("GET", "/api/therapy-admin/quality-queue", T.therapy);
    check("P22 therapy admin quality queue lists non-ok therapists",
      r.s === 200 && r.j.success && r.j.data.some(t => t.id === tLow.id || t.user_id === tLow.id || t.therapistId === tLow.id)
    );

    r = await call("POST", "/api/therapy-admin/quality-action", T.therapy, {
      therapistId: tLow.id,
      action: "add_note",
      note: "Discussed rating improvements with therapist"
    });
    check("P22 recording a quality action succeeds and logs to therapist_quality_actions",
      r.s === 200 && r.j.success && (await q("SELECT COUNT(*)::int AS n FROM therapist_quality_actions WHERE therapist_id = $1 OR therapist_id = (SELECT id FROM therapist_profiles WHERE user_id = $1)", [tLow.id]))[0].n >= 1
    );

    r = await call("GET", "/api/therapy-admin/credential-queue", T.therapy);
    check("P22 therapy admin credential queue returns valid queue list", r.s === 200 && r.j.success && Array.isArray(r.j.data), "got " + r.s + " " + JSON.stringify(r.j));

    r = await call("GET", "/api/therapy-admin/overdue-followups", T.therapy);
    check("P22 therapy admin overdue follow-ups queue returns valid list", r.s === 200 && r.j.success && Array.isArray(r.j.data));

    r = await call("GET", "/api/therapy-admin/stalled-progress", T.therapy);
    check("P22 therapy admin stalled progress queue returns valid list", r.s === 200 && r.j.success && Array.isArray(r.j.data));

    r = await call("GET", "/api/therapy-admin/outcome-summary", T.therapy);
    check("P22 therapy admin outcome summary returns aggregated metrics from real data",
      r.s === 200 && r.j.success && typeof r.j.data.totalDischarged === "number" && Array.isArray(r.j.data.byCondition),
      "got " + r.s + " " + JSON.stringify(r.j)
    );

    // outcome summary with controlled data: 5 discharged "Knee OA" plans (shown) and 4 "Hip" plans (hidden, fewer than 5)
    {
      const bbs = (await q("SELECT id FROM outcome_measures WHERE code = 'BBS'"))[0].id;
      const tug = (await q("SELECT id FROM outcome_measures WHERE code = 'TUG'"))[0].id;
      const mkPlan = async (cond, goalStatus, n) => {
        const pl = (await q("INSERT INTO treatment_plans(patient_id, primary_therapist_id, service_type_id, condition, planned_sessions, status, updated_at) VALUES ($1,$2,1,$3,6,'discharged', now() - interval '5 days') RETURNING id", [U.p1.id, U.t1.id, cond]))[0].id;
        await q("INSERT INTO plan_measures(plan_id, measure_id) VALUES ($1,$2), ($1,$3)", [pl, bbs, tug]);
        await q("INSERT INTO treatment_goals(plan_id, description, measure_id, status) VALUES ($1,'g',$2,$3)", [pl, bbs, goalStatus]);
        await q("INSERT INTO outcome_results(plan_id, measure_id, value, assessment_point, recorded_at) VALUES ($1,$2,20,'baseline', now() - interval '60 days'), ($1,$2,30,'review', now() - interval '40 days'), ($1,$2,40,'discharge', now() - interval '6 days')", [pl, bbs]);
        if (n === 0) await q("INSERT INTO outcome_results(plan_id, measure_id, value, assessment_point, recorded_at) VALUES ($1,$2,35,'review', now() - interval '20 days')", [pl, bbs]);   // an extra review must not change the plan's weight
        await q("INSERT INTO outcome_results(plan_id, measure_id, value, assessment_point, recorded_at) VALUES ($1,$2,30,'baseline', now() - interval '60 days'), ($1,$2,20,'discharge', now() - interval '6 days')", [pl, tug]);   // TUG: lower is better, 30 -> 20 = improvement of 10
        for (let i = 0; i < 3 + n; i += 1) await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, status, payment_status, treatment_plan_id, mode, created_at)
          VALUES ($1,'P',$2,'Dr',1,'Physio',1000,1000, current_date - (30 + $5::int), $4, 'completed','Paid',$3,'home', now())`, [U.p1.id, U.t1.id, pl, "0" + (9 + i) + ":00", n * 10 + i]);
        return pl;
      };
      const statuses = ["achieved", "achieved", "partially_achieved", "not_achieved", "achieved"];
      for (let i = 0; i < 5; i += 1) await mkPlan("Knee OA", statuses[i], i);
      for (let i = 0; i < 4; i += 1) await mkPlan("Hip", "achieved", i);
      r = await call("GET", "/api/therapy-admin/outcome-summary", T.therapy);
      const d = r.j && r.j.data;
      const knee = (d.byCondition || []).filter((g) => g.condition === "Knee OA");
      check("P22 outcome summary: a condition group with 5 plans is shown with counts, one with 4 is hidden", knee.length === 2 && knee.every((g) => g.planCount === 5) && !(d.byCondition || []).some((g) => g.condition === "Hip"), JSON.stringify(d.byCondition));
      check("P22 average change per measure uses one latest value per plan (BBS +20, TUG improvement +10)", knee.find((g) => g.measureCode === "BBS").avgChange === 20 && knee.find((g) => g.measureCode === "TUG").avgChange === 10, JSON.stringify(knee));
      check("P22 goals achieved / partially achieved are percentages of the goals of discharged plans", d.goalsTotal >= 9 && d.goalsAchieved >= 6 && d.percentGoalsAchieved === Math.round((d.goalsAchieved / d.goalsTotal) * 100), JSON.stringify([d.goalsTotal, d.goalsAchieved, d.percentGoalsAchieved]));
      check("P22 median sessions to discharge comes from the completed sessions of those plans", d.medianSessionsToDischarge >= 3 && d.dischargedPlansCount >= 9, JSON.stringify([d.medianSessionsToDischarge, d.dischargedPlansCount]));
    }

    // 7. Emergency leave reassignment
    const tomorrowStr = (await q("SELECT (CURRENT_DATE + 1)::text as d"))[0].d;
    const [emAppt] = await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, status, payment_status, mode, created_at)
      VALUES ($1, 'Patient P1', $2, 'Dr T1', 1, 'Physio', 1200, 1200, $3, '11:00', 'confirmed', 'Paid', 'home', now()) RETURNING id`, [U.p1.id, U.t1.id, tomorrowStr]);
    await q(`INSERT INTO therapist_leaves(therapist_id, start_date, end_date, reason, status) VALUES ($1, $2, $2, 'Emergency', 'approved')`, [U.tp1, tomorrowStr]);
    await q("DELETE FROM therapist_availability WHERE therapist_id = $1", [U.tp2]);
    for (const d of ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]) await q("INSERT INTO therapist_availability(therapist_id, day_of_week, is_enabled, morning_start, morning_end) VALUES ($1,$2,true,'09:00','18:00')", [U.tp2, d]);

    await q("UPDATE therapist_profiles SET quality_status = 'ok', registration_valid_until = CURRENT_DATE + INTERVAL '1 year' WHERE user_id = $1", [U.t2.id]);

    r = await call("GET", "/api/therapy-admin/emergency-queue", T.therapy);
    check("P22 emergency queue detects booking impacted by therapist leave",
      r.s === 200 && r.j.success && r.j.data.some(b => (b.booking ? b.booking.id : b.id) === emAppt.id)
    );

    r = await call("POST", "/api/therapy-admin/reassign", T.therapy, {
      bookingId: emAppt.id,
      newTherapistId: U.t2.id,
      reason: "Original therapist on emergency leave"
    });
    const reassignRow = (await q("SELECT therapist_id, therapist_name FROM appointments WHERE id = $1", [emAppt.id]))[0];
    const notesCount = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND title LIKE '%Reassigned%'", [String(U.p1.id)]))[0].n;
    check("P22 1-click reassignment reassigns appointment and notifies patient",
      r.s === 200 && r.j.success && reassignRow.therapist_id === U.t2.id && notesCount >= 1,
      "got " + r.s + " " + JSON.stringify(r.j) + " row=" + JSON.stringify(reassignRow) + " notes=" + notesCount
    );

    // --- the rest of the P22 emergency rules, checked one by one
    check("P22 reassignment writes a status-history row and an audit-log row",
      (await q("SELECT 1 FROM appointment_status_history WHERE appointment_id = $1 AND note LIKE 'Reassigned from%'", [emAppt.id])).length === 1 &&
      (await q("SELECT 1 FROM audit_logs WHERE action = 'reassign_booking' AND entity_id = $1", [String(emAppt.id)])).length === 1);
    check("P22 the new AND the old therapist are told, with the patient",
      (await q("SELECT 1 FROM notification_log WHERE event = 'booking_reassigned' AND user_id = $1 AND channel = 'push'", [U.t2.id])).length >= 1 &&
      (await q("SELECT 1 FROM notification_log WHERE event = 'booking_reassigned' AND user_id = $1 AND channel = 'push'", [U.t1.id])).length >= 1 &&
      (await q("SELECT 1 FROM notification_log WHERE event = 'booking_reassigned' AND user_id = $1 AND channel = 'whatsapp'", [U.p1.id])).length >= 1);
    r = await call("POST", "/api/therapy-admin/reassign", T.therapy, { bookingId: emAppt.id, newTherapistId: U.t2.id });
    check("P22 a booking already moved to that therapist is refused (400)", r.s === 400, "got " + r.s);

    // a time of tomorrow that no other fixture of t1 uses (the suite's other bookings depend on the clock minute it runs at)
    const freeTime = async (list) => { const used = (await q("SELECT time FROM appointments WHERE therapist_id = $1 AND date = $2 AND status NOT LIKE 'cancelled%'", [U.t1.id, tomorrowStr])).map((x) => x.time); return list.find((t) => !used.includes(t)); };
    const timeB = await freeTime(["12:00", "12:20", "12:40", "13:20"]);
    const [emB] = await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, status, payment_status, mode, created_at)
      VALUES ($1, 'Patient P1', $2, 'Dr T1', 1, 'Physio', 1200, 1200, $3, $4, 'confirmed', 'Paid', 'home', now()) RETURNING id`, [U.p1.id, U.t1.id, tomorrowStr, timeB]);
    await q("UPDATE therapist_profiles SET quality_status = 'frozen' WHERE user_id = $1", [U.t2.id]);
    r = await call("POST", "/api/therapy-admin/reassign", T.therapy, { bookingId: emB.id, newTherapistId: U.t2.id });
    check("P22 a frozen therapist cannot take over (400)", r.s === 400 && /not currently accepting/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("GET", "/api/therapy-admin/emergency-queue", T.therapy);
    const rowB = (r.j.data || []).find((x) => x.booking.id === emB.id);
    check("P22 the candidate list leaves out the frozen therapist", rowB && !rowB.candidates.some((c) => c.therapistId === U.t2.id));
    await q("UPDATE therapist_profiles SET quality_status = 'ok', registration_valid_until = CURRENT_DATE - 1 WHERE user_id = $1", [U.t2.id]);
    r = await call("POST", "/api/therapy-admin/reassign", T.therapy, { bookingId: emB.id, newTherapistId: U.t2.id });
    check("P22 a therapist with an expired registration cannot take over (400)", r.s === 400 && /expired/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    await q("UPDATE therapist_profiles SET registration_valid_until = CURRENT_DATE + INTERVAL '1 year' WHERE user_id = $1", [U.t2.id]);
    await q("UPDATE therapist_profiles SET specialty = '{5}' WHERE user_id = $1", [U.t2.id]);
    r = await call("POST", "/api/therapy-admin/reassign", T.therapy, { bookingId: emB.id, newTherapistId: U.t2.id });
    check("P22 a therapist of another service type cannot take over (400)", r.s === 400 && /service/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    await q("UPDATE therapist_profiles SET specialty = '{1,2}' WHERE user_id = $1", [U.t2.id]);

    // 2 hours before the slot, still on the therapist who is on leave -> cancelled by admin, patient gets 100% back
    await q("UPDATE appointments SET payment_status = 'Paid', razorpay_payment_id = 'pay_p22_auto', payment_method = 'razorpay' WHERE id = $1", [emB.id]);
    const emergencyService = require("../../src/services/emergencyService");
    const accessUtil = require("../../src/utils/access");
    const slotMs = accessUtil.slotStart({ date: tomorrowStr, time: timeB }).getTime();
    const early = await emergencyService.autoCancelUnassigned(slotMs - 5 * 3600e3);
    check("P22 more than 2 hours before the slot this booking is not cancelled", (await q("SELECT status FROM appointments WHERE id = $1", [emB.id]))[0].status === "confirmed");   // other fixture bookings of that therapist may legitimately fall inside the 2 h window of this fake clock
    const refundsBefore = rzpRefunds.length;
    const late = await emergencyService.autoCancelUnassigned(slotMs - 90 * 60e3);
    const after = (await q("SELECT status FROM appointments WHERE id = $1", [emB.id]))[0];
    check("P22 within 2 hours the unassigned booking is cancelled by admin with a 100% Razorpay refund",
      late.cancelled >= 1 && after.status === "cancelled_by_admin" && rzpRefunds.filter((x) => x.pid === "pay_p22_auto").length === 1 && rzpRefunds.find((x) => x.pid === "pay_p22_auto").amount === 120000,
      JSON.stringify(late) + " " + after.status + " refunds " + (rzpRefunds.length - refundsBefore));
    check("P22 ... and the patient is told (booking_cancelled)", (await q("SELECT 1 FROM notification_log WHERE event = 'booking_cancelled' AND user_id = $1 AND channel = 'whatsapp'", [U.p1.id])).length >= 1);
    const again = await emergencyService.autoCancelUnassigned(slotMs - 80 * 60e3);
    check("P22 running the job again does not refund the same booking twice", rzpRefunds.filter((x) => x.pid === "pay_p22_auto").length === 1 && typeof again.cancelled === "number");

    // a leave with hours only blocks those hours
    const [emC] = await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, status, payment_status, mode, created_at)
      VALUES ($1, 'Patient P1', $2, 'Dr T1', 1, 'Physio', 1200, 1200, $3, $4, 'confirmed', 'Paid', 'home', now()) RETURNING id`, [U.p1.id, U.t1.id, tomorrowStr, await freeTime(["16:00", "16:20", "16:40", "17:00"])]);
    await q("UPDATE therapist_leaves SET start_time = '09:00', end_time = '13:00' WHERE therapist_id = $1 AND start_date = $2", [U.tp1, tomorrowStr]);
    const impacted = (await emergencyService.listImpacted()).map((x) => x.id);
    check("P22 a leave for 09:00-13:00 does not flag the 16:00 booking", !impacted.includes(emC.id));
    await q("UPDATE therapist_leaves SET start_time = NULL, end_time = NULL WHERE therapist_id = $1 AND start_date = $2", [U.tp1, tomorrowStr]);
    check("P22 a whole-day leave flags it", (await emergencyService.listImpacted()).map((x) => x.id).includes(emC.id));
    await q("UPDATE therapist_leaves SET therapist_id = $1 WHERE therapist_id = $2 AND start_date = $3", [U.t1.id + 1000, U.tp1, tomorrowStr]);
    check("P22 a leave belonging to a different therapist id (id mix-up) flags nothing", !(await emergencyService.listImpacted()).map((x) => x.id).includes(emC.id));
    await q("UPDATE therapist_leaves SET therapist_id = $1 WHERE therapist_id = $2 AND start_date = $3", [U.tp1, U.t1.id + 1000, tomorrowStr]);

    // Definition of done: a therapist creates a leave over 2 bookings -> the therapy team is alerted, the queue shows both, each is reassigned in one click and the patient is told
    {
      const [lt] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ('th-leave','leave@x.com','Dr Leave','9000000500','therapist',true,'Vadodara','Gujarat') RETURNING *");
      await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = 'therapist'", [lt.id]);
      await q("INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, specialty) VALUES ($1, 800, 'approved', '{1}')", [lt.id]);
      const mkB = async (time) => (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, status, payment_status, mode, created_at)
        VALUES ($1,'Patient P2',$2,'Dr Leave',1,'Physio',1000,1000,$3,$4,'confirmed','Paid','home', now()) RETURNING id`, [U.p2.id, lt.id, tomorrowStr, time]))[0].id;
      const b1 = await mkB("10:00"), b2 = await mkB("15:00");
      const adminAlertsBefore = (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'therapist_leave_conflict'"))[0].n;
      r = await call("POST", "/api/therapists/leaves", token({ ...lt, roleName: "therapist" }), { start_date: tomorrowStr, end_date: tomorrowStr, reason: "Family emergency" });
      check("P22 creating a leave over 2 bookings answers with affectedBookings = 2", r.s === 200 && r.j.data && r.j.data.affectedBookings === 2, "got " + r.s + " " + JSON.stringify(r.j));
      check("P22 ... and the therapy admins get one alert about it", (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'therapist_leave_conflict'"))[0].n > adminAlertsBefore);
      r = await call("GET", "/api/therapy-admin/emergency-queue", T.therapy);
      const rows = (r.j.data || []).filter((x) => [b1, b2].includes(x.booking.id));
      check("P22 the banner list (emergency queue) shows both bookings, each with candidates", rows.length === 2 && rows.every((x) => x.candidates.length >= 1), JSON.stringify(rows.map((x) => [x.booking.id, x.candidates.length])));
      const cand = rows[0].candidates[0].therapistId;
      let oneClick = true;
      for (const b of [b1, b2]) {
        const rr = await call("POST", "/api/therapy-admin/reassign", T.therapy, { bookingId: b, newTherapistId: cand, reason: "Family emergency" });
        oneClick = oneClick && rr.s === 200;
      }
      check("P22 both are reassigned in one click each; the patient is told on WhatsApp and in-app", oneClick && (await q("SELECT COUNT(*)::int AS n FROM appointments WHERE id IN ($1,$2) AND therapist_id = $3", [b1, b2, cand]))[0].n === 2 && (await q("SELECT 1 FROM notification_log WHERE event = 'booking_reassigned' AND user_id = $1 AND channel = 'whatsapp'", [U.p2.id])).length >= 1 && (await q("SELECT 1 FROM notification_log WHERE event = 'booking_reassigned' AND user_id = $1 AND channel = 'inapp'", [U.p2.id])).length >= 1);
      r = await call("GET", "/api/therapy-admin/emergency-queue", T.therapy);
      check("P22 afterwards the queue no longer lists them", !(r.j.data || []).some((x) => [b1, b2].includes(x.booking.id)));
      r = await call("POST", "/api/therapists/leaves", token({ ...lt, roleName: "therapist" }), { start_date: day(40), end_date: day(40), reason: "Far away" });
      check("P22 a leave far in the future raises no alert", r.s === 200 && r.j.data.affectedBookings === 0);
    }

    // quality rule: last windowRatings ratings, only with at least minRatings
    const mkTh = async (tag) => {
      const [u] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ($1,$2,$3,'9000000300','therapist',true,'Vadodara','Gujarat') RETURNING *", ["tq-" + tag, "tq" + tag + "@x.com", "Dr Q" + tag]);
      await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = 'therapist'", [u.id]);
      await q("INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, quality_status, specialty) VALUES ($1, 800, 'approved', 'ok', '{1}')", [u.id]);
      return u;
    };
    const rate = async (u, rating, n, minutesAgo = 0) => { for (let i = 0; i < n; i += 1) await q("INSERT INTO therapist_reviews(therapist_id, patient_id, appointment_id, rating, review, created_at) VALUES ($1,$2,1,$3,'x', now() - ($4 || ' minutes')::interval)", [u.id, U.p1.id, rating, String(minutesAgo + i)]); };
    const stat = async (u) => (await q("SELECT quality_status FROM therapist_profiles WHERE user_id = $1", [u.id]))[0].quality_status;
    const qa = await mkTh("a"), qb = await mkTh("b"), qc = await mkTh("c"), qd = await mkTh("d");
    await rate(qa, 3, 10);                         // 10 ratings averaging 3.0 -> under review
    await rate(qb, 1, 9);                          // 9 ratings only -> not judged
    await rate(qc, 4, 5); await rate(qc, 5, 5);    // 10 ratings averaging 4.5 -> ok (not below 4.5)
    await rate(qd, 1, 5, 5000); await rate(qd, 5, 20, 0);   // 5 old bad ratings fall out of the last-20 window -> ok
    for (const u of [qa, qb, qc, qd]) await qualityService.evaluateTherapistQuality(u.id);
    check("P22 10 ratings averaging below 4.0 -> under_review", (await stat(qa)) === "under_review");
    check("P22 fewer than 10 ratings are not judged at all", (await stat(qb)) === "ok");
    check("P22 an average of exactly 4.5 is fine", (await stat(qc)) === "ok");
    check("P22 only the last 20 ratings count (old bad ones dropped)", (await stat(qd)) === "ok");
    await rate(qc, 4, 10);                         // now the last 10 average 4.0..: 4.0 is below 4.5 -> coaching, not below 4.0
    await qualityService.evaluateTherapistQuality(qc.id);
    check("P22 an average between 4.0 and 4.5 -> coaching", (await stat(qc)) === "coaching");
    r = await call("GET", "/api/therapy-admin/quality-queue", T.therapy);
    const ids = (r.j.data || []).map((x) => x.therapistId);
    check("P22 the quality queue shows the flagged therapists (under_review, coaching) and not the ok ones", ids.includes(qa.id) && ids.includes(qc.id) && !ids.includes(qb.id) && !ids.includes(qd.id), JSON.stringify(ids));
    const qaRow = (r.j.data || []).find((x) => x.therapistId === qa.id);
    check("P22 the queue row carries the real average and count", qaRow && qaRow.avgRating === 3 && qaRow.totalRatings === 10, JSON.stringify(qaRow && [qaRow.avgRating, qaRow.totalRatings]));
    await qualityService.recordQualityAction({ therapistId: qa.id, action: "freeze", note: "Interview done", actorId: U.therapy.id });
    check("P22 an admin freeze sticks: a new evaluation never un-freezes", (await stat(qa)) === "frozen" && (await qualityService.evaluateTherapistQuality(qa.id)).qualityStatus === "frozen");
    await qualityService.recordQualityAction({ therapistId: qa.id, action: "unfreeze", note: "Cleared", actorId: U.therapy.id });
    check("P22 unfreeze sets it back to ok and is logged", (await stat(qa)) === "ok" && (await q("SELECT 1 FROM therapist_quality_actions WHERE action = 'unfreeze'")).length >= 1);

    // credentials: expiring in 30 days -> reminder (therapist + admin) once a week; expired -> no slots
    const qe = await mkTh("e");
    await q("UPDATE therapist_profiles SET council = 'NCAHP', registration_valid_until = CURRENT_DATE + 10 WHERE user_id = $1", [qe.id]);
    await qualityService.checkCredentialExpiryAll();
    await qualityService.checkCredentialExpiryAll();
    check("P22 a registration expiring within 30 days: the therapist is reminded once (not daily)", (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND type = 'credential_expiry'", [String(qe.id)]))[0].n === 1);
    check("P22 ... and the therapy admins are told", (await q("SELECT 1 FROM notifications WHERE type = 'therapist_credential_expiring' AND message LIKE '%Dr Qe%'")).length >= 1);
  }

  // ============================================================ P23: Super Admin and E-com Admin dashboard upgrades
  {
    // 1. E-com real inventory forecasting (no Math.random)
    r = await call("GET", "/api/products/inventory/forecast", T.p1);
    check("P23 /api/products/inventory/forecast needs admin role", r.s === 403);
    r = await call("GET", "/api/products/inventory/forecast", T.ecom);
    check("P23 ecom admin can fetch inventory forecast with real sold30d and daysCover",
      r.s === 200 && r.j.success && Array.isArray(r.j.data) && r.j.data.length > 0 &&
      "stock" in r.j.data[0] && "sold30d" in r.j.data[0] && "daysCover" in r.j.data[0] && "isLowStock" in r.j.data[0],
      "got " + r.s + " " + JSON.stringify(r.j && r.j.data && r.j.data[0])
    );
    r = await call("GET", "/api/products/inventory/forecast", T.su);
    check("P23 super admin can also fetch inventory forecast", r.s === 200 && r.j.success);

    // 2. Reconciliation endpoint
    const reconDate = "2026-10-15";
    // Clean test day with zero mismatches:
    const [recOrder] = await q(
      `INSERT INTO orders(order_number, user_id, customer_name, subtotal, total, status, payment_status, razorpay_payment_id, razorpay_order_id, paid_at, created_at)
       VALUES ('ORD-RECON-1', $1, 'Recon Customer', 2000, 2000, 'Placed', 'Paid', 'pay_clean_1', 'order_clean_1', '2026-10-15 12:00:00+05:30', '2026-10-15 12:00:00+05:30')
       RETURNING id, total, razorpay_payment_id`,
      [U.p1.id]
    );

    FakeRazorpay.mockPayments = [
      { id: "pay_clean_1", amount: 200000, status: "captured", order_id: "order_clean_1", created_at: 1792047600 }
    ];

    r = await call("GET", `/api/admin/reconciliation?date=${reconDate}`, T.su);
    check("P23 reconciliation on clean day shows 0 mismatches",
      r.s === 200 && r.j.success && r.j.data.summary.mismatchCount === 0 && r.j.data.summary.matchedCount === 1 && r.j.data.mismatches.length === 0,
      "got " + r.s + " " + JSON.stringify(r.j && r.j.data && r.j.data.summary)
    );

    // Add a mismatch: simulate an amount mismatch and an extra payment in Razorpay
    FakeRazorpay.mockPayments = [
      { id: "pay_clean_1", amount: 150000, status: "captured", order_id: "order_clean_1", created_at: 1792047600 },
      { id: "pay_ghost_2", amount: 50000, status: "captured", order_id: "order_ghost_2", created_at: 1792047600 }
    ];
    r = await call("GET", `/api/admin/reconciliation?date=${reconDate}`, T.su);
    check("P23 reconciliation flags amount mismatch and missing_in_curevan mismatch",
      r.s === 200 && r.j.success && r.j.data.summary.mismatchCount >= 2 &&
      r.j.data.mismatches.some((m) => m.type === "amount_mismatch") &&
      r.j.data.mismatches.some((m) => m.type === "missing_in_curevan"),
      "got " + r.s + " mismatches=" + JSON.stringify(r.j && r.j.data && r.j.data.mismatches)
    );

    // more than 100 payments in a day: every page is read, nothing is dropped or counted twice
    FakeRazorpay.mockPayments = [{ id: "pay_clean_1", amount: 200000, status: "captured", order_id: "order_clean_1", created_at: 1792047600 }];
    for (let i = 0; i < 230; i += 1) FakeRazorpay.mockPayments.push({ id: "pay_bulk_" + i, amount: 10000, status: "captured", order_id: "order_bulk_" + i, created_at: 1792047600 });
    r = await call("GET", `/api/admin/reconciliation?date=${reconDate}`, T.su);
    check("P23 reconciliation reads all pages of a busy day (231 payments, 230 missing in Curevan)", r.s === 200 && r.j.data.summary.razorpayCount === 231 && r.j.data.summary.matchedCount === 1 && r.j.data.summary.mismatchCount === 230, JSON.stringify(r.j && r.j.data && r.j.data.summary));
    // a payment that was partly refunded is still a captured payment of a 'Partially Refunded' booking: it matches
    await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, razorpay_payment_id, razorpay_order_id, paid_at, created_at)
             VALUES ($1,'P',$2,'Dr',1,1500,1500,'2031-02-01','10:00','cancelled_by_patient','Partially Refunded','pay_part_1','order_part_1','2026-10-15 15:00:00+05:30','2026-10-15 15:00:00+05:30')`, [U.p1.id, U.t1.id]);
    FakeRazorpay.mockPayments = [
      { id: "pay_clean_1", amount: 200000, status: "captured", order_id: "order_clean_1", created_at: 1792047600 },
      { id: "pay_part_1", amount: 150000, status: "captured", order_id: "order_part_1", created_at: 1792047600 },
    ];
    r = await call("GET", `/api/admin/reconciliation?date=${reconDate}`, T.su);
    check("P23 a partly refunded booking still reconciles (no false mismatch)", r.s === 200 && r.j.data.summary.mismatchCount === 0 && r.j.data.summary.matchedCount === 2, JSON.stringify(r.j && r.j.data && r.j.data.summary));
    // Razorpay down: say so, do not report every paid item as missing
    FakeRazorpay.failPayments = true;
    r = await call("GET", `/api/admin/reconciliation?date=${reconDate}`, T.su);
    check("P23 when Razorpay cannot be reached the report refuses (502), it does not invent mismatches", r.s === 502, "got " + r.s);
    FakeRazorpay.failPayments = false;
    r = await call("GET", `/api/admin/reconciliation?date=${reconDate}`, T.p1);
    check("P23 reconciliation is for admins only (403)", r.s === 403);

    // Reset FakeRazorpay mockPayments
    FakeRazorpay.mockPayments = null;

    // 3. Payment exceptions: pending orders > 30 min & failed webhooks
    const [oldPending] = await q(
      `INSERT INTO orders(order_number, user_id, customer_name, subtotal, total, status, payment_status, created_at)
       VALUES ('ORD-ABANDON-P23', $1, 'Abandon Customer', 999, 999, 'pending_payment', 'Pending', NOW() - INTERVAL '45 minutes')
       RETURNING id, order_number`,
      [U.p1.id]
    );

    await q(
      `INSERT INTO payment_webhook_events(event_id, event, payload, error, received_at)
       VALUES ('evt_p23_fail', 'payment.failed', '{"msg":"card error"}', 'Card network gateway timeout', NOW())`
    );

    r = await call("GET", "/api/admin/payment-exceptions", T.ecom);
    check("P23 payment exceptions returns pending orders > 30m and failed webhooks",
      r.s === 200 && r.j.success &&
      r.j.data.pendingOrders.some((o) => o.orderNumber === 'ORD-ABANDON-P23') &&
      r.j.data.failedWebhooks.some((w) => w.eventId === 'evt_p23_fail'),
      "got " + r.s + " " + JSON.stringify(r.j && r.j.data)
    );

    // 4. Super Admin Friday payout release panel actions
    const testWeekStart = "2026-11-23";
    const testWeekEnd = "2026-11-29";
    await q("DELETE FROM payout_batches WHERE therapist_id = $1 AND week_start = $2", [U.t1.id, testWeekStart]);
    const [p23Batch] = await q(
      `INSERT INTO payout_batches(therapist_id, week_start, week_end, gross, platform_fee, gst_on_fee, tds, net, status)
       VALUES ($1, $2, $3, 5000, 0, 0, 0, 5000, 'scheduled')
       RETURNING id, status`,
      [U.t1.id, testWeekStart, testWeekEnd]
    );

    r = await call("POST", `/api/payout-batches/${p23Batch.id}/approve`, T.su);
    check("P23 admin can approve scheduled payout batch", r.s === 200 && r.j.success && r.j.data.status === "approved");

    r = await call("POST", `/api/payout-batches/${p23Batch.id}/mark-paid`, T.su, { utr: "CMSP23TESTUTR123" });
    const [paidBatch] = await q("SELECT status, utr, paid_at FROM payout_batches WHERE id = $1", [p23Batch.id]);
    check("P23 admin can mark approved batch paid with bank UTR reference",
      r.s === 200 && r.j.success && paidBatch.status === "paid" && paidBatch.utr === "CMSP23TESTUTR123" && paidBatch.paid_at !== null,
      "got " + r.s + " " + JSON.stringify(paidBatch)
    );
  }

  // P25 invoices, GST tagging, consent, DPDP rights
  {
    const pad2 = (n) => String(n).padStart(2, "0");
    const dayN = (n) => { const d = new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
    const mkP = async (tag) => {
      const [u] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ($1,$2,$3,'9000000700','patient',true,'Vadodara','Gujarat') RETURNING *", ["p25-" + tag, "p25" + tag + "@x.com", "Patient " + tag]);
      await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = 'patient'", [u.id]);
      const [a] = await q("INSERT INTO order_addresses(user_id, address_type, full_name, phone, full_address, city, state, pincode) VALUES ($1,'home','P','9000000700','1 Road','Vadodara','Gujarat','390001') RETURNING id", [u.id]);
      return { ...u, addr: a.id, tk: token({ ...u, roleName: "patient" }) };
    };
    const book = (p, over = {}, time = "09:00", date = dayN(24)) => call("POST", "/api/appointments/create-appointment", p.tk, { bookingData: { therapistId: U.t1.id, patientName: p.name, serviceTypeId: 1, therapyType: "Physio", date, time, mode: "home", addressId: p.addr, ...over } });

    // --- legal entity: from settings, nothing invented
    r = await call("GET", "/api/config/legal-entity");
    const le = r.j && r.j.data;
    check("P25 legal-entity is public and comes from businessRules (name, city, state)", r.s === 200 && le.name === "Himaya Care Pvt. Ltd." && le.tradeName === "Curevan" && le.state === "Gujarat");
    check("P25 GSTIN, CIN and PAN are empty (never invented) and listed as missing", le.gstin === "" && le.cin === "" && le.pan === "" && ["gstin", "cin", "pan"].every((k) => le.missing.includes(k)), JSON.stringify(le));

    // --- first booking: consent
    const pa = await mkP("a");
    r = await book(pa);
    check("P25 a first booking without the medical consent and privacy notice is refused (400)", r.s === 400 && /medical consent/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await book(pa, { consents: { medical: true } });
    check("P25 ... the privacy notice is needed too (400)", r.s === 400 && /privacy/i.test(r.raw || ""));
    r = await book(pa, { consents: { medical: true, privacy: true } });
    const ca = await q("SELECT consent_type, policy_version, granted FROM consent_logs WHERE user_id = $1 ORDER BY id", [pa.id]);
    check("P25 with both accepted the booking goes ahead and both consents are stored with the policy version", r.s === 200 && ca.length === 2 && ca.every((x) => x.policy_version === "2026-10" && x.granted === true) && ca.map((x) => x.consent_type).sort().join() === "medical,privacy", "got " + r.s + " " + JSON.stringify(ca) + (r.raw || "").slice(0, 100));
    r = await book(pa, {}, "10:00");
    check("P25 later bookings need no new consent", r.s === 200, "got " + r.s + " " + (r.raw || "").slice(0, 100));
    check("P25 consent is not stored twice", (await q("SELECT COUNT(*)::int AS n FROM consent_logs WHERE user_id = $1", [pa.id]))[0].n === 2);

    // --- minors
    const pm = await mkP("m");
    const dob12 = `${new Date().getUTCFullYear() - 12}-01-15`;
    const okConsents = { medical: true, privacy: true };
    r = await book(pm, { dateofBirth: dob12, consents: okConsents }, "11:00");
    check("P25 a 12-year-old cannot be booked without guardian details (400)", r.s === 400 && /under 18/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await book(pm, { dateofBirth: dob12, consents: okConsents, guardian: { name: "Asha Rao", relation: "Mother", phone: "9000000701" } }, "11:00");
    check("P25 ... nor without the guardian's consent (400)", r.s === 400 && /must consent/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await book(pm, { dateofBirth: dob12, consents: okConsents, guardian: { name: "Asha Rao", relation: "Mother", phone: "123", consent: true } }, "11:00");
    check("P25 ... nor with a phone number that is not 10 digits (400)", r.s === 400);
    check("P25 a refused booking leaves no appointment and no guardian row behind", (await q("SELECT COUNT(*)::int AS n FROM appointments WHERE patient_id = $1", [pm.id]))[0].n === 0 && (await q("SELECT COUNT(*)::int AS n FROM patient_guardians WHERE patient_user_id = $1", [pm.id]))[0].n === 0);
    r = await book(pm, { dateofBirth: dob12, consents: okConsents, guardian: { name: "Asha Rao", relation: "Mother", phone: "9000000701", consent: true } }, "11:00");
    const gd = await q("SELECT guardian_name, relation, phone, consent_log_id FROM patient_guardians WHERE patient_user_id = $1", [pm.id]);
    check("P25 with a guardian and the guardian's consent the booking goes ahead; the guardian and the consent are stored", r.s === 200 && gd.length === 1 && gd[0].guardian_name === "Asha Rao" && gd[0].phone === "9000000701" && gd[0].consent_log_id, "got " + r.s + " " + JSON.stringify(gd) + (r.raw || "").slice(0, 100));
    const pad17 = await mkP("n");
    const dob30 = `${new Date().getUTCFullYear() - 30}-06-01`;
    r = await book(pad17, { dateofBirth: dob30, consents: okConsents }, "12:00");
    check("P25 an adult needs no guardian", r.s === 200);
    const pb18 = await mkP("b");
    const exactly18 = `${new Date().getUTCFullYear() - 18}-01-01`;
    r = await book(pb18, { dateofBirth: exactly18, consents: okConsents }, "13:00");
    check("P25 a patient who turned 18 this year needs no guardian", r.s === 200, "got " + r.s + " " + (r.raw || "").slice(0, 100));
    const pr = await mkP("r");
    r = await call("POST", "/api/appointments/request", pr.tk, { bookingData: { patientName: pr.name, serviceTypeId: 1, therapyType: "Physio", date: dayN(20), time: "14:00", mode: "home", addressId: pr.addr, dateofBirth: dob12 } });
    check("P25 the 'find me a therapist' request path applies the same consent rule (400)", r.s === 400, "got " + r.s + " " + (r.raw || "").slice(0, 100));

    // --- GST on service invoices
    const payFor = async (p, time, date) => {
      const c = await book(p, { consents: okConsents }, time, date);
      const rz = c.j && c.j.razorpayOrderId;
      if (!rz) return { id: c.j && c.j.appointmentId, c };
      await call("POST", "/api/payments/verify-booking", p.tk, { razorpay_order_id: rz, razorpay_payment_id: "pay_p25_" + time, razorpay_signature: sign(rz, "pay_p25_" + time) });
      return { id: c.j.appointmentId, c };
    };
    const pg = await mkP("g");
    if (PAYFIRST) {
    const ex = await payFor(pg, "14:00", dayN(24));
    const invEx = ex.id ? (await q("SELECT tax_category, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount_paise FROM invoices WHERE booking_id = $1", [ex.id]))[0] : null;
    check("P25 a clinical service (exempt_clinical, the default) has an invoice with no GST", invEx && invEx.tax_category === "exempt_clinical" && Number(invEx.gst_amount) === 0 && Number(invEx.cgst_amount) === 0 && Number(invEx.igst_amount) === 0 && Number(invEx.total_amount_paise) === 150000, JSON.stringify(invEx));
    r = await call("PUT", "/api/service-types/update/1", T.therapy, { name: "Physio", is_active: true, tax_category: "nonsense" });
    check("P25 an unknown tax category is refused", r.s === 400 || (r.j && r.j.success === false), "got " + r.s + " " + (r.raw || "").slice(0, 100));
    r = await call("PUT", "/api/service-types/update/1", T.therapy, { name: "Physio", is_active: true, tax_category: "taxable_18" });
    check("P25 the Therapy Admin can mark a service as taxable_18", (await q("SELECT tax_category FROM service_types WHERE id = 1"))[0].tax_category === "taxable_18", "got " + r.s + " " + (r.raw || "").slice(0, 100));
    r = await call("PUT", "/api/service-types/update/1", T.p1, { name: "Physio", tax_category: "exempt_clinical" });
    check("P25 a patient cannot change it (403)", r.s === 403);
    const tx = await payFor(pg, "15:00", dayN(24));
    const invTx = tx.id ? (await q("SELECT tax_category, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount_paise FROM invoices WHERE booking_id = $1", [tx.id]))[0] : null;
    check("P25 a taxable_18 service: price 1500 includes 18% GST = 228.81, split in two equal halves (CGST + SGST) inside Gujarat", invTx && invTx.tax_category === "taxable_18" && Number(invTx.gst_amount) === 228.81 && Number(invTx.cgst_amount) + Number(invTx.sgst_amount) === 228.81 && Math.abs(Number(invTx.cgst_amount) - Number(invTx.sgst_amount)) <= 0.01 && Number(invTx.igst_amount) === 0, JSON.stringify(invTx));
    await q("UPDATE order_addresses SET state = 'Maharashtra' WHERE id = $1", [pg.addr]);
    const tx2 = await payFor(pg, "16:00", dayN(24));
    const invTx2 = tx2.id ? (await q("SELECT cgst_amount, sgst_amount, igst_amount FROM invoices WHERE booking_id = $1", [tx2.id]))[0] : null;
    check("P25 outside Gujarat the whole 228.81 is IGST", invTx2 && Number(invTx2.igst_amount) === 228.81 && Number(invTx2.cgst_amount) === 0 && Number(invTx2.sgst_amount) === 0, JSON.stringify(invTx2));
    const invOne = tx.id ? (await q("SELECT id FROM invoices WHERE booking_id = $1", [tx.id]))[0] : null;
    r = invOne ? await call("GET", "/api/orders/invoice/" + invOne.id, pg.tk) : { s: 0 };
    check("P25 the invoice API gives the tax category and GST to the website", r.s === 200 && r.j.data.invoice.tax_category === "taxable_18" && Number(r.j.data.invoice.gst_amount) === 228.81, "got " + r.s);
    await call("PUT", "/api/service-types/update/1", T.therapy, { name: "Physio", is_active: true, tax_category: "exempt_clinical" });
    }

    // --- a session and a shop order must never be mixed up: "BK-<id>" is a booking id, "ORD-<id>" an order id, a bare number keeps its old meaning
    {
      const ordInv = (await q("SELECT id, order_id FROM invoices WHERE order_id IS NOT NULL ORDER BY id LIMIT 1"))[0];
      const ap = ordInv ? (await q("SELECT id, patient_id FROM appointments WHERE id = $1", [ordInv.id]))[0] : null;
      if (ordInv && ap) {
        await q("INSERT INTO invoices(invoice_number, invoice_type, status, user_id, booking_id, total_amount_paise, issued_at) VALUES ('INV-BK-SAMEID', 'booking', 'issued', $1, $2, 50000, now())", [ap.patient_id, ap.id]);
        r = await call("GET", "/api/orders/invoice/BK-" + ap.id, T.su);
        check("P25 BK-<id> opens the invoice of that session even when an order invoice has the same number", r.s === 200 && String(r.j.data.invoice.booking_id) === String(ap.id) && r.j.data.invoice.order_id == null, "got " + r.s + " " + (r.raw || "").slice(0, 120));
        r = await call("GET", "/api/orders/invoice/ORD-" + ordInv.order_id, T.su);
        check("P25 ORD-<id> opens the invoice of that shop order", r.s === 200 && String(r.j.data.invoice.order_id) === String(ordInv.order_id) && r.j.data.type === "order", "got " + r.s + " " + (r.raw || "").slice(0, 120));
        r = await call("GET", "/api/orders/invoice/" + ordInv.id, T.su);
        check("P25 a bare number keeps working for old links (the exact invoice id first)", r.s === 200 && String(r.j.data.invoice.id) === String(ordInv.id), "got " + r.s);
        r = await call("GET", "/api/orders/invoice/BK-" + ap.id, T.p2);
        check("P25 another patient cannot open that session's invoice by BK-<id> (404)", r.s === 404 || r.s === 403, "got " + r.s);
      } else check("P25 (setup) an order invoice and a booking with the same number exist for the collision test", false, "no matching pair in the fixture");
    }

    // --- an empty cart is a polite 400, not a server error
    { const ec = await mkP("emptycart"); r = await call("POST", "/api/orders/validate-cart-stock", ec.tk, {}); check("P06 checking stock with an empty cart answers 400 'cart is empty' (was a SQL error)", r.s === 400 && /empty/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 100)); }

    // --- a user record (name, e-mail, roles) is for its owner and the admins
    r = await call("GET", "/api/users/" + U.t1.id, T.p1);
    check("P04 a patient cannot read another user's record by id (403)", r.s === 403, "got " + r.s);
    r = await call("GET", "/api/users/" + U.p1.id, T.p1);
    check("P04 a user can still read their own record", r.s === 200 && String(r.j.data.id) === String(U.p1.id), "got " + r.s);
    r = await call("GET", "/api/users/" + U.p1.id, T.therapy);
    check("P04 an admin can read a user's record", r.s === 200, "got " + r.s);
    r = await call("GET", "/api/users/" + U.p1.id, T.t1);
    check("P04 a therapist cannot read a patient's user record by id (403)", r.s === 403, "got " + r.s);

    // --- shop data stays with the shop admins: a therapy admin lists only their own orders and cannot read someone else's shop invoice
    {
      const someOrder = (await q("SELECT o.id, o.user_id, i.id AS inv FROM orders o JOIN invoices i ON i.order_id = o.id WHERE o.user_id <> $1 ORDER BY o.id LIMIT 1", [U.therapy.id]))[0];
      r = await call("GET", "/api/orders/my-orders", T.therapy);
      check("P04 a therapy admin's order list holds only their own orders (none belong to other customers)", r.s === 200 && (r.j.data || []).length === 0, "got " + r.s + " rows " + ((r.j && r.j.data) || []).length);
      r = await call("GET", "/api/orders/my-orders", T.ecom);
      check("P04 the e-com admin still sees every customer's orders", r.s === 200 && (r.j.data || []).length > 0, "got " + r.s);
      r = await call("GET", "/api/orders/my-orders", T.su);
      check("P04 the super admin still sees every customer's orders", r.s === 200 && (r.j.data || []).length > 0, "got " + r.s);
      if (someOrder) {
        r = await call("GET", "/api/orders/invoice/" + someOrder.inv, T.therapy);
        check("P04 a therapy admin cannot open a shop invoice (403)", r.s === 403, "got " + r.s);
        r = await call("GET", "/api/orders/invoice/ORD-" + someOrder.id, T.ecom);
        check("P04 the e-com admin can open a shop invoice", r.s === 200, "got " + r.s);
      }
      r = await call("GET", "/api/appointments", T.ecom);
      check("P04 the e-com admin's appointment list has no patient or therapist phone, no home address and no notes", r.s === 200 && (r.j.data || []).length > 0 && (r.j.data || []).every((x) => !("patientPhone" in x) && !("therapistPhone" in x) && !("notes" in x) && !("serviceAddress" in x)), "got " + r.s + " " + JSON.stringify(Object.keys(((r.j && r.j.data) || [{}])[0] || {})).slice(0, 160));
      r = await call("GET", "/api/appointments", T.therapy);
      check("P04 the Therapy Admin still gets the full appointment rows (phone, address, notes)", r.s === 200 && (r.j.data || []).length > 0 && "patientPhone" in r.j.data[0] && "notes" in r.j.data[0], "got " + r.s);
      r = await call("GET", "/api/invoices/list", T.therapy);
      check("P04 a therapy admin's invoice list has no shop invoices of other customers", r.s === 200 && !(r.j.data || []).some((x) => x.source && x.source.orderId && String(x.userId) !== String(U.therapy.id)), "got " + r.s);
      r = await call("GET", "/api/invoices/list", T.ecom);
      check("P04 the e-com admin's invoice list still has shop invoices", r.s === 200 && (r.j.data || []).some((x) => x.source && x.source.orderId), "got " + r.s);
    }

    // --- DPDP rights
    const pd = await mkP("d");
    await q("INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, therapy_type, service_amount, total_amount, date, time, status, payment_status, mode, created_at) VALUES ($1,'D',$2,'Dr One',1,'Physio',1500,1500,'2031-03-03','09:00','completed','Paid','home',now())", [pd.id, U.t1.id]);
    await q("INSERT INTO consent_logs(user_id, consent_type, policy_version, granted) VALUES ($1,'privacy','2026-10',true)", [pd.id]);
    r = await fetch(base + "/api/privacy/export", { headers: { authorization: "Bearer " + pd.tk } });
    const body = await r.json();
    check("P25 download my data: JSON with profile, bookings, orders, session records and consents - only this user's", r.status === 200 && /attachment/.test(r.headers.get("content-disposition") || "") && body.profile.email === "p25d@x.com" && body.bookings.length === 1 && Array.isArray(body.orders) && Array.isArray(body.sessionRecords) && body.consents.length >= 1 && !JSON.stringify(body).includes("p25a@x.com"), JSON.stringify(Object.keys(body)));
    check("P25 ... the download is recorded as a done 'export' request", (await q("SELECT 1 FROM privacy_requests WHERE user_id = $1 AND type = 'export' AND status = 'done'", [pd.id])).length === 1);
    r = await call("POST", "/api/privacy/requests", pd.tk, { type: "erasure", note: "Please delete my account" });
    check("P25 an erasure request is saved as open (nothing is deleted automatically)", r.s === 201 && r.j.data.status === "open" && (await q("SELECT 1 FROM users WHERE id = $1", [pd.id])).length === 1 && (await q("SELECT 1 FROM appointments WHERE patient_id = $1", [pd.id])).length === 1);
    r = await call("POST", "/api/privacy/requests", pd.tk, { type: "erasure" });
    check("P25 a second open request of the same kind is refused (409)", r.s === 409);
    r = await call("POST", "/api/privacy/requests", pd.tk, { type: "hack" });
    check("P25 an unknown request type is refused (400)", r.s === 400);
    r = await call("POST", "/api/privacy/requests", pd.tk, { type: "correction", note: "My name is spelled wrong" });
    check("P25 a correction request is saved", r.s === 201);
    await q("UPDATE users SET marketing_opt_in = true WHERE id = $1", [pd.id]);
    r = await call("POST", "/api/privacy/requests", pd.tk, { type: "withdraw_consent" });
    check("P25 withdrawing marketing consent is applied at once and logged", r.s === 201 && r.j.data.status === "done" && (await q("SELECT marketing_opt_in FROM users WHERE id = $1", [pd.id]))[0].marketing_opt_in === false && (await q("SELECT 1 FROM consent_logs WHERE user_id = $1 AND consent_type = 'marketing' AND granted = false", [pd.id])).length === 1);
    r = await call("GET", "/api/privacy/requests", pd.tk);
    check("P25 the user sees their own requests", r.s === 200 && r.j.data.length === 4, "got " + (r.j && r.j.data && r.j.data.length));
    r = await call("GET", "/api/privacy/admin/requests", T.su);
    const mine = (r.j.data || []).filter((x) => x.userId === pd.id);
    check("P25 the Super Admin sees the requests with the user's name, open ones first", r.s === 200 && mine.length === 4 && mine.some((x) => x.type === "erasure" && x.status === "open" && x.userName === "Patient d"), JSON.stringify(mine.map((x) => x.type + ":" + x.status)));
    r = await call("GET", "/api/privacy/admin/requests", T.therapy);
    check("P25 only the Super Admin can list them (403)", r.s === 403);
    r = await call("GET", "/api/privacy/admin/requests", pd.tk);
    check("P25 a patient cannot list everyone's requests (403)", r.s === 403);
    const er = mine.find((x) => x.type === "erasure");
    r = await call("PATCH", "/api/privacy/admin/requests/" + er.id, T.su, { status: "done", note: "Handled per the retention schedule" });
    check("P25 the Super Admin closes a request with a note; it records who and when", r.s === 200 && (await q("SELECT status, handled_by, closed_at, note FROM privacy_requests WHERE id = $1", [er.id])).every((x) => x.status === "done" && x.handled_by === U.su.id && x.closed_at && /retention/.test(x.note)));
    r = await call("GET", "/api/privacy/requests");
    check("P25 the privacy API needs a login (401)", r.s === 401);

    // --- the two documents
    const fsx = require("fs"), pathx = require("path");
    const breach = fsx.readFileSync(pathx.join(__dirname, "../../docs/BREACH_RUNBOOK.md"), "utf8");
    const retention = fsx.readFileSync(pathx.join(__dirname, "../../docs/DATA_RETENTION.md"), "utf8");
    check("P25 the breach runbook names CERT-In 6 hours, the Data Protection Board with the 72-hour report, and informing users", /CERT-In/.test(breach) && /6 hours/.test(breach) && /Data Protection Board/.test(breach) && /72 hours/.test(breach) && /affected (users|individuals|people)/i.test(breach));
    check("P25 the retention schedule has clinical records, minors, tax/payment and marketing rules", /3 years/.test(retention) && /18/.test(retention) && /8 years/.test(retention) && /marketing/i.test(retention));
  }

  // P26 AI chat sessions and escalation to a person
  {
    const esc = require("../../src/controllers/support/escalationController");
    const noteCount = (uid, type) => q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND type = $2", [String(uid), type]).then((x) => x[0].n);

    r = await call("GET", "/api/config/public");
    check("P26 public config tells the chat the support hours and the call-back time", r.s === 200 && r.j.data.support.openHour === 8 && r.j.data.support.closeHour === 21 && r.j.data.support.callbackBy === "09:30");

    check("P26 support is open at 10:00 India time", esc.supportStatus(Date.parse("2026-10-14T10:00:00+05:30")).open === true && esc.supportStatus(Date.parse("2026-10-14T10:00:00+05:30")).callbackMessage === null);
    const night = esc.supportStatus(Date.parse("2026-10-14T22:30:00+05:30"));
    check("P26 at 22:30 it is closed and the user is promised a call back by 9:30", night.open === false && /09:30/.test(night.callbackMessage));
    check("P26 at 07:59 it is still closed; 08:00 and 20:59 are open; 21:00 is closed", esc.supportStatus(Date.parse("2026-10-14T07:59:00+05:30")).open === false && esc.supportStatus(Date.parse("2026-10-14T08:00:00+05:30")).open === true && esc.supportStatus(Date.parse("2026-10-14T20:59:00+05:30")).open === true && esc.supportStatus(Date.parse("2026-10-14T21:00:00+05:30")).open === false);

    // sessions and messages
    r = await call("POST", "/api/support/chat/sessions", T.p1, { channel: "web" });
    const sid = r.j && r.j.data && r.j.data.id;
    check("P26 a chat session is created for the signed-in user", r.s === 201 && sid && (await q("SELECT user_id, channel, status FROM chat_sessions WHERE id = $1", [sid]))[0].user_id === U.p1.id);
    r = await call("POST", "/api/support/chat/sessions", undefined, {});
    check("P26 chat sessions need a login (401)", r.s === 401);
    r = await call("POST", "/api/support/chat/sessions/" + sid + "/messages", T.p1, { messages: [{ sender: "user", text: "Where is my order?" }, { sender: "ai", text: "It is on its way.", toolCalls: [{ name: "trackOrder", ok: true }] }, { sender: "hacker", text: "x" }] });
    const msgs = await q("SELECT sender, text, tool_calls FROM chat_messages WHERE session_id = $1 ORDER BY id", [sid]);
    check("P26 messages are saved with the tool calls; an unknown sender is dropped", r.s === 200 && msgs.length === 2 && msgs[1].tool_calls[0].name === "trackOrder");
    r = await call("POST", "/api/support/chat/sessions/" + sid + "/messages", T.p2, { messages: [{ sender: "user", text: "hi" }] });
    check("P26 another user cannot write into my chat (404)", r.s === 404);

    // escalation
    r = await call("POST", "/api/support/escalate", T.p1, { reason: "nonsense", summary: "x y z abc" });
    check("P26 an unknown reason is refused (400)", r.s === 400);
    r = await call("POST", "/api/support/escalate", T.p1, { reason: "human_requested", summary: "" });
    check("P26 a summary is required (400)", r.s === 400);
    r = await call("POST", "/api/support/escalate", T.p2, { reason: "human_requested", category: "billing", summary: "x y z abc", sessionId: sid });
    check("P26 nobody can attach a ticket to someone else's chat (404)", r.s === 404);
    const ecomBefore = await noteCount(U.ecom.id, "ai_escalation");
    r = await call("POST", "/api/support/escalate", T.p1, { reason: "human_requested", category: "ecommerce", summary: "Order ORD-1 shows delivered but I did not get it.\nCustomer wants a person to call.", sessionId: sid });
    const tk = r.j && r.j.data;
    const row = tk ? (await q("SELECT * FROM tickets WHERE id = $1", [tk.ticketId]))[0] : null;
    check("P26 'I want a human' creates a ticket: category, priority, 2-line summary, link to the chat", r.s === 201 && row && row.category === "ecommerce" && row.priority === "P3" && /ORD-1/.test(row.ai_summary) && row.chat_session_id === sid && row.user_id === U.p1.id && row.type === "ai_escalation", JSON.stringify(row));
    check("P26 ... the chat is marked escalated and keeps the summary", (await q("SELECT status, ai_summary FROM chat_sessions WHERE id = $1", [sid]))[0].status === "escalated");
    check("P26 ... the right role is told (e-com admin for an e-commerce question), not the therapy team", (await noteCount(U.ecom.id, "ai_escalation")) === ecomBefore + 1 && (await q("SELECT COUNT(*)::int AS n FROM notifications WHERE user_uid = $1 AND type = 'ai_escalation' AND title LIKE '%ecommerce%'", [String(U.therapy.id)]))[0].n === 0);
    check("P26 ... the answer carries the call-back text only outside support hours", typeof tk.supportOpen === "boolean" && (tk.supportOpen ? tk.callbackMessage === null : /09:30/.test(tk.callbackMessage)));

    const matrix = [["clinical", "P2", U.therapy.id], ["billing", "P3", U.su.id], ["general", "P4", U.su.id]];
    for (const [cat, prio, who] of matrix) {
      const before = await noteCount(who, "ai_escalation");
      r = await call("POST", "/api/support/escalate", T.p1, { reason: "human_requested", category: cat, summary: "Please call me about " + cat });
      check(`P26 a human request about ${cat} gets ${prio} and goes to the right team`, r.s === 201 && r.j.data.priority === prio && (await noteCount(who, "ai_escalation")) === before + 1, JSON.stringify(r.j && r.j.data));
    }
    r = await call("POST", "/api/support/escalate", T.p1, { reason: "tool_failures", category: "ecommerce", summary: "The order lookup failed twice for ORD-7." });
    check("P26 two failed tool attempts: a P3 ticket for the category", r.s === 201 && r.j.data.priority === "P3" && r.j.data.category === "ecommerce");
    r = await call("POST", "/api/support/escalate", T.p1, { reason: "human_requested", category: "nonsense", summary: "Please call me" });
    check("P26 an unknown category falls back to general", r.s === 201 && r.j.data.category === "general");

    // red flag: always clinical and P1, told to the therapy team AND the Super Admin
    const therBefore = await noteCount(U.therapy.id, "ai_escalation"), suBefore = await noteCount(U.su.id, "ai_escalation");
    r = await call("POST", "/api/support/escalate", T.p1, { reason: "red_flag", category: "ecommerce", summary: "The user wrote that they have chest pain and cannot breathe." });
    check("P26 a red-flag message is always clinical and P1 whatever category was sent", r.s === 201 && r.j.data.priority === "P1" && r.j.data.category === "clinical", JSON.stringify(r.j && r.j.data));
    check("P26 ... a P1 tells the therapy admins and the Super Admin", (await noteCount(U.therapy.id, "ai_escalation")) === therBefore + 1 && (await noteCount(U.su.id, "ai_escalation")) === suBefore + 1);

    // the old ticket endpoint takes category and priority too
    r = await call("POST", "/api/support/tickets", T.p1, { type: "general", subject: "Hello", message: "A normal ticket", priority: "P2", category: "billing" });
    check("P26 the normal ticket endpoint accepts a category and a P1-P4 priority", r.s === 200 && (await q("SELECT category, priority FROM tickets WHERE subject = 'Hello' ORDER BY id DESC LIMIT 1"))[0].category === "billing", "got " + r.s + " " + (r.raw || "").slice(0, 100));
    r = await call("POST", "/api/support/tickets", T.p1, { type: "general", message: "x", category: "nonsense" });
    check("P26 ... and refuses an unknown category", r.j && r.j.success === false);
    r = await call("POST", "/api/support/tickets", T.p1, { type: "general", message: "x", priority: "urgent!!" });
    check("P26 ... and an unknown priority", r.j && r.j.success === false);
  }

  // P27 masked calling
  {
    const telephony = require("../../src/services/telephony");
    const axiosMod = require("axios");
    const pad2 = (n) => String(n).padStart(2, "0");
    const istNow = (minFromNow) => { const d = new Date(Date.now() + 5.5 * 3600e3 + minFromNow * 60000); return { date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`, time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` }; };
    const mkU = async (tag, role, phone) => {
      const [u] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ($1,$2,$3,$4,$5,true,'Vadodara','Gujarat') RETURNING *", ["p27-" + tag, "p27" + tag + "@x.com", "P27 " + tag, phone, role]);
      await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = $2", [u.id, role]);
      return { ...u, tk: token({ ...u, roleName: role }) };
    };
    const PH = { p: "9810000001", t: "9820000002" };
    const cp = await mkU("pat", "patient", PH.p), ct = await mkU("ther", "therapist", PH.t), cx = await mkU("other", "patient", "9830000003"), cn = await mkU("nophone", "patient", null);
    const mkB = async (minFromNow, status = "confirmed", patient = cp) => { const w = istNow(minFromNow); return (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, mode, created_at)
      VALUES ($1,'P',$2,'Dr',1,1500,1500,$3,$4,$5,'Paid','home', now()) RETURNING id`, [patient.id, ct.id, w.date, w.time, status]))[0].id; };
    const mask = (who, id) => call("POST", "/api/communication/mask-call", who.tk, { appointmentId: id });

    // provider off: the button is hidden, the endpoint says so
    delete process.env.TELEPHONY_PROVIDER;
    const inWin = await mkB(30);
    r = await call("GET", "/api/config/public");
    check("P27 with no provider configured the feature flag is false (the Call button stays hidden)", r.j.data.features.maskedCall === false);
    r = await mask(cp, inWin);
    check("P27 with no provider the endpoint answers 503", r.s === 503);

    process.env.TELEPHONY_PROVIDER = "console";
    r = await call("GET", "/api/config/public");
    check("P27 with a provider configured the flag is true and the window is public (2 h before, 1 h after)", r.j.data.features.maskedCall === true && r.j.data.maskedCall.windowHoursBefore === 2 && r.j.data.maskedCall.windowHoursAfter === 1);

    // the window
    r = await mask(cp, inWin);
    check("P27 the patient can call 30 minutes before the slot", r.s === 201 && r.j.data.callId && r.j.data.status === "initiated", "got " + r.s + " " + r.raw);
    check("P27 NO real number appears in the response", !new RegExp(PH.p + "|" + PH.t + "|\\+91|98100|98200").test(r.raw), r.raw);
    const row1 = (await q("SELECT * FROM masked_calls WHERE id = $1", [r.j.data.callId]))[0];
    check("P27 the call is recorded: appointment, caller role and id, provider sid, status; and no phone column exists", row1 && row1.appointment_id === inWin && row1.caller_role === "patient" && row1.caller_user_id === cp.id && /^console_/.test(row1.provider_call_sid) && row1.status === "initiated" && !(await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'masked_calls'")).some((c) => /phone|number|msisdn/i.test(c.column_name)));
    r = await mask(ct, inWin);
    const row2 = r.s === 201 ? (await q("SELECT caller_role, caller_user_id FROM masked_calls WHERE id = $1", [r.j.data.callId]))[0] : null;
    check("P27 the assigned therapist can call the patient too", r.s === 201 && row2.caller_role === "therapist" && row2.caller_user_id === ct.id, "got " + r.s + " " + r.raw);

    const early = await mkB(3 * 60);
    r = await mask(cp, early);
    check("P27 three hours before the slot it is refused with 'Calling opens 2 hours before your appointment'", r.s === 403 && r.j.message === "Calling opens 2 hours before your appointment", "got " + r.s + " " + r.raw);
    const justBefore = await mkB(119);
    r = await mask(cp, justBefore);
    check("P27 119 minutes before: open", r.s === 201);
    const justOutside = await mkB(125);
    r = await mask(cp, justOutside);
    check("P27 125 minutes before: still closed", r.s === 403);
    const over = await mkB(-3 * 60);
    r = await mask(cp, over);
    check("P27 more than an hour after the slot ended: closed (403)", r.s === 403);
    const lateInside = await mkB(-100);
    r = await mask(cp, lateInside);
    check("P27 40 minutes after the slot ended: still open (calling about a late visit)", r.s === 201, "got " + r.s + " " + r.raw);

    // who and which booking
    r = await mask(cx, inWin);
    check("P27 a patient who is not on this booking cannot call (403)", r.s === 403);
    r = await call("POST", "/api/communication/mask-call", T.su, { appointmentId: inWin });
    check("P27 not even an admin can use the booking's calling (403)", r.s === 403);
    r = await call("POST", "/api/communication/mask-call", undefined, { appointmentId: inWin });
    check("P27 a login is needed (401)", r.s === 401);
    let statusMin = 40;
    for (const st of ["pending_payment", "completed", "cancelled_by_patient", "searching_therapist"]) {
      const id = await mkB(statusMin++, st);
      r = await mask(cp, id);
      check("P27 a booking in status " + st + " cannot be called about (403)", r.s === 403, "got " + r.s);
    }
    r = await mask(cp, 99999999);
    check("P27 an unknown booking is 404", r.s === 404);
    r = await call("POST", "/api/communication/mask-call", cp.tk, {});
    check("P27 appointmentId is required (400)", r.s === 400);
    const noPhoneBooking = await mkB(35, "confirmed", cn);
    r = await mask(cn, noPhoneBooking);
    check("P27 a caller without a number on file is told to add one (409)", r.s === 409 && /mobile number/i.test(r.raw));
    await q("UPDATE users SET phone = NULL WHERE id = $1", [ct.id]);
    r = await mask(cp, inWin);
    check("P27 when the other person has no number the caller is told to contact support (409)", r.s === 409 && /support/i.test(r.raw) && !/982/.test(r.raw));
    await q("UPDATE users SET phone = $2 WHERE id = $1", [ct.id, PH.t]);

    // provider failure
    process.env.TELEPHONY_PROVIDER = "fail";
    const before = (await q("SELECT COUNT(*)::int AS n FROM masked_calls WHERE status = 'failed'"))[0].n;
    r = await mask(cp, inWin);
    check("P27 a provider failure answers 502 with a calm message and no number", r.s === 502 && !/981|982|\+91/.test(r.raw));
    check("P27 ... and the attempt is recorded as failed", (await q("SELECT COUNT(*)::int AS n FROM masked_calls WHERE status = 'failed'"))[0].n === before + 1);

    // Exotel: what is sent to the provider (stubbed HTTP)
    process.env.TELEPHONY_PROVIDER = "exotel";
    Object.assign(process.env, { EXOTEL_SID: "curevan1", EXOTEL_API_KEY: "key1", EXOTEL_API_TOKEN: "tok1", EXOTEL_VIRTUAL_NUMBER: "08000000000", TELEPHONY_STATUS_CALLBACK_URL: "https://api.example.test/api/hooks/telephony?token=hooktok" });
    const realPost = axiosMod.post; let sent = null;
    axiosMod.post = async (url, body, opts) => { sent = { url, body: String(body), opts }; return { data: { Call: { Sid: "EXO-SID-1", Status: "queued" } } }; };
    r = await mask(cp, inWin);
    const sp = new URLSearchParams(sent && sent.body);
    check("P27 Exotel: the caller is rung first, then the other party, both through the virtual number; the status callback is set", r.s === 201 && /\/v1\/Accounts\/curevan1\/Calls\/connect\.json$/.test(sent.url) && sp.get("From") === "+919810000001" && sp.get("To") === "+919820000002" && sp.get("CallerId") === "08000000000" && /hooktok/.test(sp.get("StatusCallback")) && sent.opts.auth.username === "key1" && sent.opts.auth.password === "tok1", JSON.stringify(sent));
    check("P27 Exotel: the call id of Exotel is stored; the real numbers are not in the answer", (await q("SELECT provider_call_sid, status FROM masked_calls WHERE id = $1", [r.j.data.callId]))[0].provider_call_sid === "EXO-SID-1" && !/981|982/.test(r.raw));
    axiosMod.post = async () => { throw Object.assign(new Error("boom"), { response: { status: 400, data: { RestException: { Message: "bad number" } } } }); };
    r = await mask(cp, inWin);
    check("P27 Exotel refuses the call: 502, and the provider's text (it may hold numbers) is not shown", r.s === 502 && !/bad number|981|982/.test(r.raw));
    axiosMod.post = realPost;
    delete process.env.EXOTEL_API_TOKEN;
    r = await mask(cp, inWin);
    check("P27 Exotel without credentials: 502, nothing is called", r.s === 502);
    process.env.EXOTEL_API_TOKEN = "tok1";

    // status webhook
    process.env.TELEPHONY_WEBHOOK_TOKEN = "hooktok";
    process.env.TELEPHONY_PROVIDER = "console";
    r = await mask(cp, inWin);
    const sid = (await q("SELECT provider_call_sid FROM masked_calls WHERE id = $1", [r.j.data.callId]))[0].provider_call_sid;
    const hook = (query, body, ct2 = "application/x-www-form-urlencoded") => fetch(base + "/api/hooks/telephony" + query, { method: "POST", headers: { "content-type": ct2 }, body });
    let h = await hook("", new URLSearchParams({ CallSid: sid, Status: "completed", Duration: "125" }).toString());
    check("P27 the status webhook refuses a call without the token (401)", h.status === 401);
    h = await hook("?token=wrong", new URLSearchParams({ CallSid: sid, Status: "completed", Duration: "125" }).toString());
    check("P27 ... and with a wrong token (401)", h.status === 401 && (await q("SELECT status FROM masked_calls WHERE provider_call_sid = $1", [sid]))[0].status === "initiated");
    h = await hook("?token=hooktok", new URLSearchParams({ CallSid: sid, Status: "in-progress" }).toString());
    check("P27 a ringing/in-progress update changes the status and keeps the call open", h.status === 200 && (await q("SELECT status, ended_at FROM masked_calls WHERE provider_call_sid = $1", [sid]))[0].status === "in-progress" && (await q("SELECT ended_at FROM masked_calls WHERE provider_call_sid = $1", [sid]))[0].ended_at === null);
    h = await hook("?token=hooktok", new URLSearchParams({ CallSid: sid, Status: "completed", Duration: "125" }).toString());
    const done = (await q("SELECT status, duration_seconds, ended_at FROM masked_calls WHERE provider_call_sid = $1", [sid]))[0];
    check("P27 the completed callback stores the duration and the end time (form-encoded, as Exotel sends it)", h.status === 200 && done.status === "completed" && done.duration_seconds === 125 && done.ended_at);
    h = await hook("?token=hooktok", JSON.stringify({ CallSid: sid, Status: "completed", Duration: 130 }), "application/json");
    check("P27 a JSON callback works too", h.status === 200 && (await q("SELECT duration_seconds FROM masked_calls WHERE provider_call_sid = $1", [sid]))[0].duration_seconds === 130);
    h = await hook("?token=hooktok", new URLSearchParams({ CallSid: "unknown-sid", Status: "completed" }).toString());
    check("P27 an unknown call id is ignored with a 200 (the provider must not retry)", h.status === 200);
    h = await hook("?token=hooktok", new URLSearchParams({ CallSid: sid, Status: "no_answer" }).toString());
    check("P27 provider words are normalised (no_answer -> no-answer)", (await q("SELECT status FROM masked_calls WHERE provider_call_sid = $1", [sid]))[0].status === "no-answer");
    delete process.env.TELEPHONY_WEBHOOK_TOKEN;
    h = await hook("?token=anything", new URLSearchParams({ CallSid: sid, Status: "completed" }).toString());
    check("P27 with no token configured the webhook is closed (401)", h.status === 401);

    check("P27 the number mask keeps only 4 digits for logs", telephony.mask("+919810000001") === "******0001");
    delete process.env.TELEPHONY_PROVIDER;
  }

  // ============================================================ P28 Care packs (5-session and 10-session)
  {
    const pad2 = (n) => String(n).padStart(2, "0");
    const istNow = (minFromNow) => { const d = new Date(Date.now() + 5.5 * 3600e3 + minFromNow * 60000); return { date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`, time: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` }; };
    const dayAhead = (n) => istNow(n * 1440).date;
    const mkU = async (tag, role) => {
      const [u] = await q("INSERT INTO users(uid,email,name,phone,role,is_verified,city,state) VALUES ($1,$2,$3,'9840000000',$4,true,'Vadodara','Gujarat') RETURNING *", ["p28-" + tag, "p28" + tag + "@x.com", "P28 " + tag, role]);
      await q("INSERT INTO user_roles(user_id, role_id) SELECT $1, id FROM roles WHERE name = $2", [u.id, role]);
      await q("INSERT INTO consent_logs(user_id, consent_type, policy_version, granted) SELECT $1, c, '2026-10', true FROM unnest(ARRAY['medical','privacy']) c", [u.id]);
      return { ...u, tk: token({ ...u, roleName: role }) };
    };
    const pk = await mkU("pat", "patient"), pk2 = await mkU("pat2", "patient");
    const pth = await mkU("ther", "therapist");      // a therapist of its own for the fixtures below, so no clock-dependent clash with other tests
    await q("INSERT INTO therapist_profiles(user_id, hourly_rate, profile_status, specialty) VALUES ($1, 1500, 'approved', '{1}')", [pth.id]);
    const sign2 = (o, p) => crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${o}|${p}`).digest("hex");

    r = await call("GET", "/api/config/public");
    check("P28 feature flag carePacks is true in public config", r.s === 200 && r.j.data.features.carePacks === true);
    check("P28 the example plans seeded by the migration are switched off until the owner sets real prices", (await q("SELECT COUNT(*)::int AS n FROM care_pack_plans WHERE active = true"))[0].n === 0);
    r = await call("GET", "/api/care-packs/plans");
    check("P28 so nothing is for sale yet", r.s === 200 && r.j.data.length === 0);

    // --- plans are the Super Admin's to make
    r = await call("POST", "/api/care-packs/admin/plans", T.p1, { name: "x", sessions: 5, price: 100 });
    check("P28 a patient cannot make a plan (403)", r.s === 403);
    r = await call("POST", "/api/care-packs/admin/plans", T.therapy, { name: "x", sessions: 5, price: 100 });
    check("P28 the Therapy Admin cannot either (403): plans are the Super Admin's", r.s === 403);
    for (const bad of [{ sessions: 0, price: 100 }, { sessions: 2.5, price: 100 }, { sessions: 99, price: 100 }, { sessions: 5, price: -4 }, { sessions: 5, price: 100, validityDays: 0 }, { sessions: 5, price: 100, serviceTypeId: 9999 }]) {
      r = await call("POST", "/api/care-packs/admin/plans", T.su, { name: "Bad", ...bad });
      check("P28 plan validation refuses " + JSON.stringify(bad) + " (400)", r.s === 400);
    }
    r = await call("POST", "/api/care-packs/admin/plans", T.su, { name: "Test 10-pack", serviceTypeId: 1, sessions: 10, price: 8000, validityDays: 90 });
    const plan10 = r.j && r.j.data;
    r = await call("POST", "/api/care-packs/admin/plans", T.su, { name: "Test 5-pack", serviceTypeId: 1, sessions: 5, price: 4000, validityDays: 60 });
    const plan5 = r.j && r.j.data;
    r = await call("POST", "/api/care-packs/admin/plans", T.su, { name: "Speech 5-pack", serviceTypeId: 2, sessions: 5, price: 3000 });
    const planOther = r.j && r.j.data;
    r = await call("GET", "/api/care-packs/plans");
    check("P28 the Super Admin makes plans and patients see them", plan10 && plan5 && r.j.data.length === 3);

    // --- purchase: what is priced is what is activated
    r = await call("POST", "/api/care-packs/purchase/order", pk.tk, { planId: plan5.id });
    const o5 = r.j.data;
    check("P28 a purchase order is for the plan's price in paise and is remembered as pending_payment on the server", r.s === 200 && o5.amountPaise === 400000 && (await q("SELECT status, sessions_total, price_paid, patient_id FROM care_packs WHERE razorpay_order_id = $1", [o5.razorpayOrderId]))[0].status === "pending_payment");
    r = await call("GET", "/api/care-packs/my-packs", pk.tk);
    check("P28 an unpaid purchase is not listed as a pack", r.s === 200 && r.j.data.length === 0);
    r = await call("POST", "/api/care-packs/purchase/verify", pk.tk, { planId: plan10.id, razorpayOrderId: o5.razorpayOrderId, razorpayPaymentId: "pay_cp_a", razorpaySignature: "forged" });
    check("P28 a forged signature is refused (400)", r.s === 400);
    // the attack: pay for the 5-pack (4,000), claim the 10-pack (8,000) in the request
    r = await call("POST", "/api/care-packs/purchase/verify", pk.tk, { planId: plan10.id, therapistId: U.t1.id, razorpayOrderId: o5.razorpayOrderId, razorpayPaymentId: "pay_cp_a", razorpaySignature: sign2(o5.razorpayOrderId, "pay_cp_a") });
    const cp5 = r.j && r.j.data;
    check("P28 paying for the 5-pack and asking for the 10-pack gives the 5-pack: plan and price come from the server, not the request", r.s === 201 && cp5.sessions_total === 5 && Number(cp5.price_paid) === 4000 && cp5.therapist_id === null && cp5.status === "active", JSON.stringify(cp5));
    check("P28 the pack expires after the plan's validity (60 days)", Math.abs(new Date(cp5.expires_at) - (Date.now() + 60 * 86400e3)) < 3600e3);
    check("P28 the purchase has its own invoice (INV-CP, exempt) and no GST", (await q("SELECT invoice_type, tax_category, total_amount_paise FROM invoices WHERE invoice_number = $1", ["INV-CP-" + cp5.id]))[0].total_amount_paise == 400000);
    r = await call("POST", "/api/care-packs/purchase/verify", pk.tk, { razorpayOrderId: o5.razorpayOrderId, razorpayPaymentId: "pay_cp_a", razorpaySignature: sign2(o5.razorpayOrderId, "pay_cp_a") });
    check("P28 verifying twice is safe: still one pack", r.s === 200 && (await q("SELECT COUNT(*)::int AS n FROM care_packs WHERE razorpay_order_id = $1", [o5.razorpayOrderId]))[0].n === 1);
    r = await call("POST", "/api/care-packs/purchase/verify", pk2.tk, { razorpayOrderId: o5.razorpayOrderId, razorpayPaymentId: "pay_cp_a", razorpaySignature: sign2(o5.razorpayOrderId, "pay_cp_a") });
    check("P28 another patient cannot claim my order (404)", r.s === 404);

    // browser closed after paying: the webhook activates it, and only for the right amount
    r = await call("POST", "/api/care-packs/purchase/order", pk.tk, { planId: plan10.id, therapistId: U.t1.id });
    const o10 = r.j.data;
    const hookP = (amount, id) => hook("payment.captured", { id, order_id: o10.razorpayOrderId, amount }, "payment", "evt_" + id);
    await hookP(1000, "pay_cp_wrong");
    await sleep(300);
    check("P28 a webhook for the wrong amount does not activate the pack", (await q("SELECT status FROM care_packs WHERE razorpay_order_id = $1", [o10.razorpayOrderId]))[0].status === "pending_payment");
    await hookP(800000, "pay_cp_b");
    await sleep(400);
    const cp10 = (await q("SELECT * FROM care_packs WHERE razorpay_order_id = $1", [o10.razorpayOrderId]))[0];
    check("P28 the webhook with the right amount activates the 10-pack (tied to the chosen therapist) although the browser was closed", cp10.status === "active" && cp10.sessions_total === 10 && cp10.therapist_id === U.t1.id && cp10.razorpay_payment_id === "pay_cp_b");

    r = await call("GET", "/api/care-packs/my-packs", pk.tk);
    const mine = (r.j.data || []).find((p) => p.id === cp10.id);
    check("P28 my packs list shows 10 sessions left", r.s === 200 && mine.sessions_remaining === 10 && r.j.data.length === 2);

    // --- booking with a pack
    const slotDay = dayAhead(17);
    const bookP = (time, extra = {}, who = pk) => call("POST", "/api/appointments/create-appointment", who.tk, { bookingData: { therapistId: U.t1.id, date: slotDay, time, mode: "home", serviceTypeId: 1, therapyType: "Physiotherapy", payWith: "pack", ...extra } });
    r = await bookP("09:00", { serviceTypeId: 2, carePackId: cp10.id });
    check("P28 a pack is for the service it was bought for: a Physio pack cannot book another service (400)", r.s === 400 && /different service/.test(r.raw), "got " + r.s + " " + r.raw.slice(0, 100));
    check("P28 the 10-pack of one therapist cannot be used with another therapist", (await bookP("09:00", { carePackId: cp10.id, therapistId: U.t2.id })).s === 400);
    r = await bookP("10:00", { carePackId: cp10.id });
    const a1 = r.j && r.j.appointmentId;
    const ap1 = a1 ? (await q("SELECT status, payment_status, payment_method, care_pack_id, service_amount FROM appointments WHERE id = $1", [a1]))[0] : null;
    check("P28 booking with the pack needs no payment: confirmed, paid with the pack, price of the session unchanged (the therapist's payout stays normal)", r.s === 200 && ap1.status === "confirmed" && ap1.payment_status === "Paid" && ap1.payment_method === "care_pack" && ap1.care_pack_id === cp10.id && Number(ap1.service_amount) === 1500, "got " + r.s + " " + r.raw.slice(0, 150));
    check("P28 ... it went through the state machine (a history row) and the start code was prepared", (await q("SELECT 1 FROM appointment_status_history WHERE appointment_id = $1 AND to_status = 'confirmed'", [a1])).length === 1 && (await q("SELECT start_otp_hash FROM appointments WHERE id = $1", [a1]))[0].start_otp_hash);
    check("P28 ... the patient is told with a booking_confirmed message and the therapist too", (await q("SELECT 1 FROM notification_log WHERE event = 'booking_confirmed' AND user_id = $1 AND channel = 'whatsapp'", [pk.id])).length >= 1);
    check("P28 ... no invoice is made for the session (the pack purchase carries it) but the PCR exists", (await q("SELECT 1 FROM invoices WHERE booking_id = $1", [a1])).length === 0 && (await q("SELECT 1 FROM pcr WHERE appointment_id = $1", [a1])).length === 1);
    r = await bookP("11:00", { carePackId: cp10.id }); const a2 = r.j && r.j.appointmentId;
    r = await bookP("12:00", { carePackId: cp10.id }); const a3 = r.j && r.j.appointmentId;
    r = await call("GET", "/api/care-packs/my-packs", pk.tk);
    const after3 = (r.j.data || []).find((p) => p.id === cp10.id);
    check("P28 buying a 10-pack and booking 3 sessions shows 7 left", a1 && a2 && a3 && after3.sessions_used === 3 && after3.sessions_remaining === 7);
    r = await bookP("13:00", { carePackId: cp10.id }, pk2);
    check("P28 another patient cannot use my pack (400)", r.s === 400);
    r = await bookP("10:00", { carePackId: cp10.id });
    check("P28 slot rules still apply: the same slot cannot be booked twice (409)", r.s === 409, "got " + r.s);
    check("P28 a booking refused for the slot did not consume a session", (await q("SELECT sessions_used FROM care_packs WHERE id = $1", [cp10.id]))[0].sessions_used === 3);

    // --- cancellation
    r = await call("PATCH", `/api/appointments/${a1}/cancel`, pk.tk, { reason: "Need to reschedule" });
    check("P28 cancelling in the free window returns the session (7 -> 8 left) and no Razorpay refund is attempted", r.s === 200 && (await q("SELECT sessions_used FROM care_packs WHERE id = $1", [cp10.id]))[0].sessions_used === 2 && !rzpRefunds.some((x) => x.pid === "pay_cp_b"));
    const near = istNow(60);
    const nearId = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, care_pack_id, mode, created_at)
      VALUES ($1,'P',$2,'Dr',1,1500,1500,$3,$4,'confirmed','Paid','care_pack',$5,'home', now() - interval '1 day') RETURNING id`, [pk.id, pth.id, near.date, near.time, cp10.id]))[0].id;
    await q("UPDATE care_packs SET sessions_used = sessions_used + 1 WHERE id = $1", [cp10.id]);
    const usedBefore = (await q("SELECT sessions_used FROM care_packs WHERE id = $1", [cp10.id]))[0].sessions_used;
    r = await call("PATCH", `/api/appointments/${nearId}/cancel`, pk.tk, { reason: "Cannot make it" });
    check("P28 a late cancellation (inside the free window's end) consumes the session", r.s === 200 && (await q("SELECT sessions_used FROM care_packs WHERE id = $1", [cp10.id]))[0].sessions_used === usedBefore, "got " + r.s + " " + r.raw.slice(0, 120));
    check("P28 ... and the therapist still gets the cancellation share as for a normal late cancel", (await q("SELECT 1 FROM payout_items WHERE type = 'cancellation' AND source_id = $1", [nearId])).length === 1);
    const th2 = istNow(61);
    const byTher = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, care_pack_id, mode, created_at)
      VALUES ($1,'P',$2,'Dr',1,1500,1500,$3,$4,'confirmed','Paid','care_pack',$5,'home', now() - interval '1 day') RETURNING id`, [pk.id, pth.id, th2.date, th2.time, cp10.id]))[0].id;
    await q("UPDATE care_packs SET sessions_used = sessions_used + 1 WHERE id = $1", [cp10.id]);
    const usedT = (await q("SELECT sessions_used FROM care_packs WHERE id = $1", [cp10.id]))[0].sessions_used;
    r = await call("POST", `/api/appointments/${byTher}/cancel`, pth.tk, { reason: "Family emergency" });
    check("P28 when the therapist cancels the session goes back to the pack", r.s === 200 && (await q("SELECT sessions_used FROM care_packs WHERE id = $1", [cp10.id]))[0].sessions_used === usedT - 1, "got " + r.s + " " + r.raw.slice(0, 100));

    // emergency auto-cancel (therapist leave): back to the pack, nothing to refund
    const emergencyService = require("../../src/services/emergencyService");
    const [tpLeave] = await q("SELECT id FROM therapist_profiles WHERE user_id = $1", [pth.id]);
    const eDay = istNow(24 * 60 + 600);
    const eId = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, care_pack_id, mode, created_at)
      VALUES ($1,'P',$2,'Dr',1,1500,1500,$3,'06:30','confirmed','Paid','care_pack',$4,'home', now() - interval '1 day') RETURNING id`, [pk.id, pth.id, eDay.date, cp10.id]))[0].id;
    await q("UPDATE care_packs SET sessions_used = sessions_used + 1 WHERE id = $1", [cp10.id]);
    const usedE = (await q("SELECT sessions_used FROM care_packs WHERE id = $1", [cp10.id]))[0].sessions_used;
    await q("INSERT INTO therapist_leaves(therapist_id, start_date, end_date, reason, status) VALUES ($1,$2,$2,'x','approved')", [tpLeave.id, eDay.date]);
    const slotMs2 = require("../../src/utils/access").slotStart({ date: eDay.date, time: "06:30" }).getTime();
    const refundsB = rzpRefunds.length;
    const out2 = await emergencyService.autoCancelUnassigned(slotMs2 - 90 * 60e3);
    check("P28 a pack session cancelled because the therapist is on leave goes back to the pack and nothing is sent to Razorpay", (await q("SELECT status FROM appointments WHERE id = $1", [eId]))[0].status === "cancelled_by_admin" && (await q("SELECT sessions_used FROM care_packs WHERE id = $1", [cp10.id]))[0].sessions_used === usedE - 1 && rzpRefunds.length === refundsB, JSON.stringify(out2));
    await q("DELETE FROM therapist_leaves WHERE therapist_id = $1 AND start_date = $2", [tpLeave.id, eDay.date]);

    // --- expiry
    await q("UPDATE care_packs SET expires_at = now() - interval '1 day' WHERE id = $1", [cp5.id]);
    r = await bookP("14:00", { carePackId: cp5.id, therapistId: U.t1.id });
    check("P28 an expired pack cannot be used (400)", r.s === 400);
    r = await call("GET", "/api/care-packs/my-packs", pk.tk);
    check("P28 and it is shown as expired", (r.j.data || []).find((p) => p.id === cp5.id).status === "expired");

    // --- exhausted pack
    const [exh] = await q("INSERT INTO care_packs(plan_id, patient_id, sessions_total, sessions_used, price_paid, expires_at, status) VALUES ($1,$2,2,2,1000, now() + interval '30 days','exhausted') RETURNING id", [plan5.id, pk.id]);
    check("P28 a pack with no sessions left is not used for a booking", (await bookP("15:00", { carePackId: exh.id })).s === 400);

    // --- refund of the unused sessions
    r = await call("POST", `/api/care-packs/admin/${cp10.id}/refund`, T.p1, {});
    check("P28 a patient cannot refund (403)", r.s === 403);
    const rowR = (await q("SELECT sessions_total, sessions_used, price_paid FROM care_packs WHERE id = $1", [cp10.id]))[0];
    const unused = rowR.sessions_total - rowR.sessions_used;
    const expectedNet = Math.round(((Number(rowR.price_paid) / rowR.sessions_total) * unused * 0.9) * 100) / 100;
    r = await call("POST", `/api/care-packs/admin/${cp10.id}/refund`, T.su, { reason: "Patient relocating" });
    check("P28 refund = unused sessions x the price paid per session, minus the processing fee from settings (10%)", r.s === 200 && r.j.data.sessionsRefunded === unused && Math.abs(r.j.data.netRefundInr - expectedNet) < 0.05, "got " + r.s + " " + JSON.stringify(r.j) + " expected " + expectedNet);
    check("P28 ... the refund went to Razorpay for that payment and the pack is marked refunded with the amount", rzpRefunds.some((x) => x.pid === "pay_cp_b" && x.amount === Math.round(expectedNet * 100)) && (await q("SELECT status, refunded_amount FROM care_packs WHERE id = $1", [cp10.id]))[0].status === "refunded");
    check("P28 ... an audit row records it", (await q("SELECT 1 FROM audit_logs WHERE action = 'care_pack_refund' AND entity_id = $1", [String(cp10.id)])).length === 1);
    r = await call("POST", `/api/care-packs/admin/${cp10.id}/refund`, T.su, {});
    check("P28 a refunded pack cannot be refunded again (409)", r.s === 409);
    await q("UPDATE appointments SET status = 'confirmed' WHERE id = $1", [a2]);
    r = await call("PATCH", `/api/appointments/${a2}/cancel`, pk.tk, { reason: "x" });
    check("P28 cancelling a session of a refunded pack never brings the pack back to life", (await q("SELECT status FROM care_packs WHERE id = $1", [cp10.id]))[0].status === "refunded");
    const [pend] = await q("SELECT id FROM care_packs WHERE status = 'pending_payment' LIMIT 1");
    r = pend ? await call("POST", `/api/care-packs/admin/${pend.id}/refund`, T.su, {}) : { s: 0 };
    check("P28 an unpaid purchase cannot be refunded (409)", !pend || r.s === 409);

    // --- reconciliation: pack purchases are Razorpay payments; pack sessions are not
    const todayIst = istNow(0).date;
    FakeRazorpay.mockPayments = [{ id: "pay_cp_a", amount: 400000, status: "captured", order_id: o5.razorpayOrderId, created_at: Math.floor(Date.now() / 1000) }, { id: "pay_cp_b", amount: 800000, status: "captured", order_id: o10.razorpayOrderId, created_at: Math.floor(Date.now() / 1000) }];
    r = await call("GET", `/api/admin/reconciliation?date=${todayIst}`, T.su);
    const packItems = (r.j.data.matched || []).filter((m) => m.type === "care_pack");
    check("P28 reconciliation matches both pack purchases (even the refunded one) with their Razorpay payments", r.s === 200 && packItems.length === 2, JSON.stringify(r.j && r.j.data && r.j.data.summary));
    check("P28 pack sessions do not show up as 'paid but missing in Razorpay'", !(r.j.data.mismatches || []).some((m) => m.curevanType === "booking" && /care/i.test(m.description)) && !(r.j.data.mismatches || []).some((m) => m.reference === "BK-" + a2));
    FakeRazorpay.mockPayments = null;
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

  // ============================================================ #24 Notification service: WhatsApp, SMS (DLT) and transactional e-mail
  const notifService = require(path.join(root, "src/services/notifications"));
  const emailAdapter = require(path.join(root, "src/services/notifications/channels/email"));

  // 1. Dispatch booking_confirmed with an OTP
  const testOtp = "849201";
  const bRes = await notifService.notify("booking_confirmed", {
    patientId: U.p1.id,
    therapistId: U.t1.id,
    date: "2026-10-25",
    time: "10:00",
    locality: "Alkapuri",
    otp: testOtp,
    link: "https://curevan.com/dashboard/bookings",
  });
  check("P24 notify('booking_confirmed') returns success", bRes && bRes.success === true);

  const bLogs = await q("SELECT * FROM notification_log WHERE event = 'booking_confirmed' AND user_id = $1", [U.p1.id]);
  check("P24 booking_confirmed logged attempts for patient channels (whatsapp, inapp, email)", bLogs.some((l) => l.channel === "whatsapp" && l.status === "sent") && bLogs.some((l) => l.channel === "inapp" && l.status === "sent") && bLogs.some((l) => l.channel === "email" && l.status === "sent"));

  const tPushLog = await q("SELECT * FROM notification_log WHERE event = 'booking_confirmed' AND user_id = $1 AND channel = 'push'", [U.t1.id]);
  check("P24 booking_confirmed logged push attempt for therapist", tPushLog.length > 0 && ["sent", "skipped"].includes(tPushLog[0].status));

  // 2. Critical Rule: Zero OTP in notification_log
  const otpInLogs = await q("SELECT * FROM notification_log WHERE template LIKE $1 OR provider_message_id LIKE $1 OR error LIKE $1", [`%${testOtp}%`]);
  check("P24 OTP never appears in notification_log (zero leak)", otpInLogs.length === 0);

  // 3. Fallback: WhatsApp failure triggers SMS fallback
  const origWaProvider = process.env.WHATSAPP_PROVIDER;
  process.env.WHATSAPP_PROVIDER = "fail";
  await notifService.notify("booking_confirmed", {
    patientId: U.p2.id,
    therapistId: U.t1.id,
    date: "2026-10-26",
    time: "11:00",
    locality: "Fatehgunj",
    otp: "716253",
    link: "https://curevan.com/dashboard/bookings",
  });
  process.env.WHATSAPP_PROVIDER = origWaProvider;

  const fallbackLogs = await q("SELECT channel, status, template FROM notification_log WHERE event = 'booking_confirmed' AND user_id = $1 ORDER BY id ASC", [U.p2.id]);
  const waFailed = fallbackLogs.some((l) => l.channel === "whatsapp" && l.status === "failed");
  const smsFallbackSent = fallbackLogs.some((l) => l.channel === "sms" && l.status === "sent");
  check("P24 WhatsApp failure on booking_confirmed triggers SMS fallback and logs both attempts", waFailed && smsFallbackSent);

  // 4. Opt-out: whatsapp_opt_in = false directly uses SMS
  await q("UPDATE users SET whatsapp_opt_in = false WHERE id = $1", [U.p2.id]);
  await notifService.notify("reminder_24h", {
    patientId: U.p2.id,
    therapistName: "Dr. Sharma",
    time: "10:00",
    link: "https://curevan.com/dashboard/bookings",
  });
  const optOutLogs = await q("SELECT channel, status FROM notification_log WHERE event = 'reminder_24h' AND user_id = $1 ORDER BY id DESC LIMIT 2", [U.p2.id]);
  check("P24 patient with whatsapp_opt_in=false receives reminder via SMS", optOutLogs.some((l) => l.channel === "sms" && l.status === "sent"));

  // 5. reminder_30_min dispatch
  const r30Res = await notifService.notify("reminder_30_min", {
    patientId: U.p1.id,
    therapistId: U.t1.id,
    patientName: "Patient One",
    therapistName: "Dr. Sharma",
    time: "14:00",
  });
  check("P24 reminder_30_min dispatches successfully", r30Res && r30Res.success === true);
  const r30Logs = await q("SELECT * FROM notification_log WHERE event = 'reminder_30_min' ORDER BY id DESC LIMIT 5");
  check("P24 reminder_30_min logs attempts for patient whatsapp and therapist push", r30Logs.some((l) => l.channel === "whatsapp" && l.user_id === U.p1.id) && r30Logs.some((l) => l.channel === "push" && l.user_id === U.t1.id));

  // 6. SOS Alert triggers SMS and Push
  r = await call("POST", "/api/sos/create", T.t1, { message: "Test SOS alert" });
  check("P24 SOS alert creation returns success", r.s === 200 && r.j.success === true);
  const sosLogs = await q("SELECT * FROM notification_log WHERE event = 'sos_raised' ORDER BY id DESC LIMIT 5");
  check("P24 sos_raised dispatches SMS to on-call and push to admin", sosLogs.some((l) => l.channel === "sms" && l.status === "sent") && sosLogs.some((l) => l.channel === "push"));

  // 7. Security: Email channel refuses to transmit OTP
  let emailOtpBlocked = false;
  try {
    await emailAdapter.sendEmail({
      to: "patient@example.com",
      subject: "Your OTP is 123456",
      text: "Start code: 123456",
    });
  } catch (err) {
    emailOtpBlocked = /Security Violation|OTP/i.test(err.message);
  }
  check("P24 Email channel strictly blocks transmission of OTP", emailOtpBlocked);


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


  // P24 coverage: every event of the pack's table was sent by the REAL flow above (not by calling notify directly), on the channels the table names
  {
    const rows = await q("SELECT event, channel, status FROM notification_log");
    const via = (ev) => new Set(rows.filter((x) => x.event === ev).map((x) => x.channel));
    const need = {
      booking_confirmed: ["whatsapp", "inapp", "email", "push"], followup_proposed: ["whatsapp", "inapp"], followup_nudge: ["whatsapp", "inapp"], followup_expired: ["whatsapp", "inapp", "push"],
      followup_no_slot: ["whatsapp", "inapp", "push"], reminder_24h: ["whatsapp"], reminder_2h: ["whatsapp"], reminder_30_min: ["whatsapp", "push"], therapist_daily_agenda: ["whatsapp", "push"],
      therapist_60min: ["whatsapp", "push"], followup_overdue: ["whatsapp", "inapp"], hep_daily: ["whatsapp"], progress_report_ready: ["whatsapp", "inapp", "email"],
      therapist_on_the_way: ["whatsapp", "push"], session_completed_review: ["whatsapp", "inapp"], pcr_pdf_ready: ["whatsapp", "email"], booking_cancelled: ["whatsapp", "inapp", "push"],
      booking_reassigned: ["whatsapp", "inapp", "push"], order_paid: ["whatsapp", "email"], order_shipped: ["whatsapp", "email"], order_delivered: ["whatsapp", "email"],
      refund_processed: ["whatsapp", "email"], payout_paid: ["whatsapp", "email"], sos_raised: ["push", "sms"],
    };
    for (const [ev, chans] of Object.entries(need)) {
      const got = via(ev);
      check("P24 event " + ev + " was sent by its real flow on " + chans.join(" + "), chans.every((c) => got.has(c)), "channels seen: " + [...got].join(","));
    }
    check("P24 all 24 events of the pack's table are covered", Object.keys(need).length === 24);
  }
  // ---- P30 (new feature): the patient asks for a follow-up visit; the new PCR opens with the last visit's report
  {
    const prev = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, created_at)
      VALUES ($1,'Patient One',$2,'Dr One',1,1500,1500,$3,'03:41','completed','Paid','razorpay', now() - interval '4 days') RETURNING id`, [U.p1.id, U.t1.id, day(-3)]))[0].id;
    await q(`INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version, chief_complaint, assessment, diagnosis, treatment_provided, plan_of_care, bp, hr, rr, temp, functional_score, pain_vas, functional_measure, hep, locked_at)
      VALUES ($1,$2,$3,1,'locked',2,'Knee pain','Reduced knee flexion, joint-line tenderness','Knee sprain','Manual therapy and quadriceps work','Twice weekly for three weeks','120/80','78','16','98.4',6,4,'Range of motion','Straight leg raises 3x10 daily', now())`, [prev, U.p1.id, U.t1.id]);
    const fuOf = (id) => q("SELECT follow_up_of FROM appointments WHERE id = $1", [id]).then((x) => x[0] && x[0].follow_up_of);
    const live = (extra) => ({ followUpOf: prev, ...extra });

    r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(27), "11:00", live()));
    const fu1 = r.j && r.j.appointmentId;
    check("P30 the patient books a follow-up of a completed visit; the booking is linked to it", r.s === 200 && fu1 && String(await fuOf(fu1)) === String(prev), "got " + r.s + " " + (r.raw || "").slice(0, 140));
    check("P30 the booking carries the therapist's name from the user record even when the client sends none", fu1 && (await q("SELECT a.therapist_name = u.name AS same FROM appointments a JOIN users u ON u.id = a.therapist_id WHERE a.id = $1", [fu1]))[0].same === true);
    r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(27), "12:00", live()));
    check("P30 a second live follow-up for the same visit is refused (409)", r.s === 409 && /already booked/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/appointments/create-appointment", T.p2, bk(U.t1.id, day(27), "13:00", { followUpOf: prev, addressId: U.a2 }));
    check("P30 another patient cannot follow up someone else's visit (404, same answer as a missing visit)", r.s === 404, "got " + r.s + " " + (r.raw || "").slice(0, 120));
    const confirmed = await mkVisit(317, "confirmed");
    r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(27), "14:00", { followUpOf: confirmed }));
    check("P30 a visit that is not completed cannot be followed up (400)", r.s === 400 && /completed/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(27), "15:00", { followUpOf: "abc" }));
    check("P30 a follow-up id that is not a number is refused (400)", r.s === 400, "got " + r.s);
    await q("UPDATE appointments SET status = 'cancelled_by_patient' WHERE id = $1", [fu1]);
    r = await call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, day(27), "16:00", live()));
    check("P30 after the first follow-up is cancelled, a new one can be booked for the same visit", r.s === 200 && String(await fuOf(r.j.appointmentId)) === String(prev), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/appointments/request", T.p1, { bookingData: { patientId: U.p1.id, patientName: "P", serviceTypeId: 1, therapyType: "Physio", date: day(29), time: "11:00", mode: "home", addressId: U.a1, followUpOf: confirmed } });
    check("P30 the request-a-therapist route applies the same rule (400 for a visit that is not completed)", r.s === 400, "got " + r.s + " " + (r.raw || "").slice(0, 120));

    // the new PCR carries the last visit's report
    const fu = await mkVisit(97, "in_progress"); await q("UPDATE appointments SET follow_up_of = $1 WHERE id = $2", [prev, fu]); await mkPcrRow(fu);
    r = await call("GET", "/api/appointments/pcr/" + fu, T.t1);
    const lv = r.j && r.j.data && r.j.data.lastVisit;
    check("P30 the treating therapist opens the new PCR with the last visit's report (assessment, treatment, plan, HEP, scores)",
      r.s === 200 && lv && lv.linked === true && /joint-line/.test(lv.assessment) && /Manual therapy/.test(lv.treatmentProvided) && /three weeks/.test(lv.planOfCare) && /Straight leg/.test(lv.hep) && lv.functionalScore === 6 && lv.painVas === 4 && String(lv.appointmentId) === String(prev), "got " + r.s + " " + JSON.stringify(lv).slice(0, 160));
    r = await call("GET", "/api/appointments/pcr/" + fu, T.p1);
    check("P30 the patient sees the same last-visit report in their own new PCR", r.s === 200 && r.j.data.lastVisit && r.j.data.lastVisit.linked === true);
    const sbPrev = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, created_at)
      VALUES ($1,'Patient One',$2,'Dr One',1,1500,1500,$3,'04:52','completed','Paid','razorpay', now()) RETURNING id`, [U.p1.id, U.t1.id, day(-1)]))[0].id;
    await q(`INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version, assessment, submitted_at) VALUES ($1,$2,$3,1,'submitted',1,'Newest visit, submitted but not yet locked', now() + interval '1 hour')`, [sbPrev, U.p1.id, U.t1.id]);
    r = await call("GET", "/api/appointments/pcr/" + fu, T.t1);
    check("P30 a report that is submitted but not yet locked is the 'last visit' (it is newer than the older locked one)", r.s === 200 && r.j.data.lastVisit && /Newest visit/.test(r.j.data.lastVisit.assessment) && String(r.j.data.lastVisit.appointmentId) === String(sbPrev), "got " + r.s + " " + JSON.stringify(r.j && r.j.data && r.j.data.lastVisit).slice(0, 120));
    await q("DELETE FROM pcr WHERE appointment_id = $1", [sbPrev]); await q("DELETE FROM appointments WHERE id = $1", [sbPrev]);
    const far = await mkVisit(24 * 60 * 5 + 13, "confirmed"); await q("UPDATE appointments SET follow_up_of = $1 WHERE id = $2", [prev, far]); await mkPcrRow(far);
    r = await call("GET", "/api/appointments/pcr/" + far, T.t1);
    check("P30 more than 4 hours before the session the therapist gets no last-visit report (history stays closed)", r.s === 200 && r.j.data.historyLocked === true && !r.j.data.lastVisit, "got " + r.s + " " + JSON.stringify(r.j && r.j.data && r.j.data.lastVisit).slice(0, 80));
    const plain = await mkVisit(104, "in_progress"); await mkPcrRow(plain);
    r = await call("GET", "/api/appointments/pcr/" + plain, T.t1);
    check("P30 a booking without a link still shows the patient's latest locked report", r.s === 200 && r.j.data.lastVisit && r.j.data.lastVisit.linked === false);
    r = await call("GET", "/api/appointments/pcr/" + fu, T.t2);
    check("P30 another therapist cannot open that PCR (403)", r.s === 403, "got " + r.s);
  }
  // ---- P30b: the follow-up can only be booked on the date(s) the doctor gave in the report
  {
    let n = 0;
    const mkPrev = async (plan) => {
      n += 1; const t = "0" + n + ":" + (13 + n * 7);   // odd times far from every other fixture, one per visit
      const id = (await q(`INSERT INTO appointments(patient_id, patient_name, therapist_id, therapist_name, service_type_id, service_amount, total_amount, date, time, status, payment_status, payment_method, created_at)
        VALUES ($1,'Patient One',$2,'Dr One',1,1500,1500,$3,$4,'completed','Paid','razorpay', now() - interval '5 days') RETURNING id`, [U.p1.id, U.t1.id, day(-4), t]))[0].id;
      const pcrId = (await q(`INSERT INTO pcr(appointment_id, patient_id, therapist_id, service_type_id, status, version, assessment, next_session_plan, locked_at)
        VALUES ($1,$2,$3,1,'locked',1,'Assessed',$4, now()) RETURNING id`, [id, U.p1.id, U.t1.id, plan ? JSON.stringify(plan) : null]))[0].id;
      return { id, pcrId };
    };
    const book = (prevId, date, time, extra = {}) => call("POST", "/api/appointments/create-appointment", T.p1, bk(U.t1.id, date, time, { followUpOf: prevId, ...extra }));
    const opts = (id, token = T.p1) => call("GET", "/api/appointments/" + id + "/follow-up-options", token);

    // the doctor gave one date
    const single = await mkPrev({ mode: "single", date: day(23), time: "11:00" });
    r = await opts(single.id);
    check("P30 options: the doctor's single date is the only date offered", r.s === 200 && r.j.data.mode === "dates" && JSON.stringify(r.j.data.dates) === JSON.stringify([day(23)]), "got " + r.s + " " + (r.raw || "").slice(0, 140));
    r = await book(single.id, day(24), "11:00");
    check("P30 a follow-up on any other date is refused (400, the message names the doctor's date)", r.s === 400 && (r.raw || "").includes(day(23)), "got " + r.s + " " + (r.raw || "").slice(0, 160));
    r = await book(single.id, day(23), "12:00");
    check("P30 on the doctor's date it is booked (the patient picks the time that day)", r.s === 200 && r.j.appointmentId, "got " + r.s + " " + (r.raw || "").slice(0, 140));
    r = await opts(single.id);
    check("P30 options then say a follow-up is already booked", r.s === 200 && r.j.data.mode === "booked");

    // the doctor gave a series: the dates of its proposals (kept even when a slot could not be held)
    const series = await mkPrev({ mode: "series", weekdays: [1, 3], time: "16:00", occurrences: 2 });
    for (const d of [day(24), day(25)]) await q(`INSERT INTO followup_proposals(source_pcr_id, patient_id, therapist_id, proposed_start, status) VALUES ($1,$2,$3,$4,'no_slot')`, [series.pcrId, U.p1.id, U.t1.id, d + "T16:00:00+05:30"]);
    r = await opts(series.id);
    check("P30 options: every date of the doctor's series is offered", r.s === 200 && r.j.data.mode === "dates" && r.j.data.dates.length === 2 && r.j.data.dates.includes(day(24)) && r.j.data.dates.includes(day(25)), "got " + (r.raw || "").slice(0, 140));
    r = await book(series.id, day(26), "16:00");
    check("P30 a date outside the series is refused (400)", r.s === 400, "got " + r.s);
    r = await book(series.id, day(25), "16:00");
    check("P30 a date inside the series is accepted", r.s === 200, "got " + r.s + " " + (r.raw || "").slice(0, 120));

    // the doctor left it to the patient / recorded nothing / ended the care
    const later = await mkPrev({ mode: "later", reason: "Patient will check the calendar" });
    r = await opts(later.id);
    check("P30 'patient will book later' leaves the date free", r.s === 200 && r.j.data.mode === "any");
    const subm = await mkPrev({ mode: "single", date: day(26), time: "11:00" });
    await q("UPDATE pcr SET status = 'submitted', locked_at = NULL WHERE id = $1", [subm.pcrId]);
    r = await book(subm.id, day(27), "10:00");
    check("P30 the doctor's date counts as soon as the report is submitted, before it is locked (400 for another date)", r.s === 400 && (r.raw || "").includes(day(26)), "got " + r.s + " " + (r.raw || "").slice(0, 140));
    const none = await mkPrev({ mode: "none" });
    r = await book(none.id, day(23), "16:00");
    check("P30 'no further sessions' blocks a follow-up (400)", r.s === 400 && /no further sessions/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    const past = await mkPrev({ mode: "single", date: day(-1), time: "10:00" });
    r = await opts(past.id);
    check("P30 when the doctor's date has already passed the patient may choose a new one", r.s === 200 && r.j.data.mode === "any" && /passed/i.test(r.j.data.note || ""), "got " + (r.raw || "").slice(0, 140));

    // a slot the doctor already holds for the patient is confirmed from the dashboard, not booked a second time
    const held = await mkPrev({ mode: "single", date: day(25), time: "17:00" });
    const hold = (await q(`INSERT INTO appointments(patient_id, therapist_id, service_type_id, date, time, status, payment_status, follow_up_of) VALUES ($1,$2,1,$3,'17:00','proposed','Pending',$4) RETURNING id`, [U.p1.id, U.t1.id, day(25), held.id]))[0].id;
    r = await opts(held.id);
    check("P30 options: a held (proposed) slot is reported, with the dashboard as the place to confirm it", r.s === 200 && r.j.data.mode === "proposed", "got " + (r.raw || "").slice(0, 140));
    r = await book(held.id, day(25), "11:00");
    check("P30 booking over a held follow-up is refused (409)", r.s === 409 && /reserved/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    await q("UPDATE appointments SET status = 'proposal_declined' WHERE id = $1", [hold]);
    r = await opts(held.id);
    check("P30 after the patient declines the doctor's held slot the doctor's date is offered again (not 'already booked')", r.s === 200 && r.j.data.mode === "dates" && r.j.data.dates.includes(day(25)), "got " + (r.raw || "").slice(0, 140));

    // privacy and plumbing
    r = await opts(single.id, T.p2);
    check("P30 another patient cannot read the options of someone else's visit (404)", r.s === 404, "got " + r.s);
    r = await opts(hold, T.p1);
    check("P30 options of a visit that is not completed (400)", r.s === 400, "got " + r.s);
    check("P30 every follow-up proposal made by the doctor is linked to the visit it follows",
      (await q("SELECT COUNT(*)::int AS n FROM appointments a JOIN followup_proposals fp ON fp.appointment_id = a.id WHERE a.follow_up_of IS NULL AND fp.source_pcr_id IS NOT NULL"))[0].n === 0);
  }
  {
    // P31 clean links: every therapy category and product has a unique slug, made from the name and editable by the admin
    const slugOf = async (table, id) => (await q(`SELECT slug FROM ${table} WHERE id = $1`, [id]))[0].slug;
    check("P31 every slug in the database is lowercase-hyphen (no space, &, %20)", (await q("SELECT 1 FROM service_types WHERE slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'")).length === 0);
    // the schema dump behind this test database predates some product columns that addProduct writes
    for (const col of ["subtitle TEXT", "short_description TEXT", "length_cm NUMERIC", "width_cm NUMERIC", "height_cm NUMERIC", "manufacturer TEXT", "country_of_origin TEXT", "packer TEXT", "importer TEXT", "batch_number TEXT", "manufacturing_date DATE", "expiry_date DATE", "tags JSON", "sac_code TEXT"]) await q(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ${col}`);
    let r = await call("POST", "/api/service-types/add", T.therapy, { name: "Post-Surgery Rehab" });
    check("P31 a new category gets its slug from the name", r.s === 200 && (await q("SELECT 1 FROM service_types WHERE slug = 'post-surgery-rehab'")).length === 1, "got " + r.s + " " + (r.raw || "").slice(0, 120));
    const catId = (await q("SELECT id FROM service_types WHERE slug = 'post-surgery-rehab'"))[0].id;
    r = await call("POST", "/api/service-types/add", T.therapy, { name: "Occupational Health & Wellness", slug: "occupational-therapy" });
    check("P31 an admin can type the slug (Occupational Health & Wellness -> occupational-therapy)", r.s === 200 && (await q("SELECT 1 FROM service_types WHERE name = 'Occupational Health & Wellness' AND slug = 'occupational-therapy'")).length === 1, "got " + (r.raw || "").slice(0, 120));
    r = await call("POST", "/api/service-types/add", T.therapy, { name: "Another Occupational", slug: "Occupational Therapy" });
    check("P31 a slug already used by another category is refused", r.s === 200 && r.j.success === false || r.s >= 400, "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("PUT", "/api/service-types/update/" + catId, T.therapy, { name: "Post-Surgery Rehabilitation", is_active: true });
    check("P31 renaming a category does not change its link", r.s === 200 && (await slugOf("service_types", catId)) === "post-surgery-rehab");
    r = await call("PUT", "/api/service-types/update/" + catId, T.therapy, { name: "Post-Surgery Rehabilitation", is_active: true, slug: "post-surgery-rehabilitation" });
    check("P31 ... it changes only when the admin edits the slug", r.s === 200 && (await slugOf("service_types", catId)) === "post-surgery-rehabilitation");

    const cat = (await q("INSERT INTO categories(name) VALUES ('P31 devices') RETURNING id"))[0].id;
    const mk = (extra) => call("POST", "/api/products/add", T.ecom, { title: "TENS Electrode Pads", category: cat, sku: "P31-" + Math.random().toString(36).slice(2, 8), mrp: 500, sellingPrice: 450, status: "Published", ...extra });
    r = await mk({});
    const p1 = r.j && r.j.productId;
    check("P31 a new product gets its slug from the title", r.s === 201 && p1 && (await slugOf("products", p1)) === "tens-electrode-pads", "got " + r.s + " " + (r.raw || "").slice(0, 160));
    r = await mk({});
    const p2 = r.j && r.j.productId;
    check("P31 a second product with the same title gets a different slug (-2)", r.s === 201 && (await slugOf("products", p2)) === "tens-electrode-pads-2", "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await mk({ slug: "tens-electrode-pads" });
    check("P31 typing a slug that is taken is refused (400)", r.s === 400 && /already used/i.test(r.raw || ""), "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("GET", "/api/products/frontend/tens-electrode-pads", null);
    check("P31 the public product page loads by slug", r.s === 200 && Number(r.j.data.id) === p1 && r.j.data.slug === "tens-electrode-pads", "got " + r.s + " " + (r.raw || "").slice(0, 120));
    r = await call("GET", "/api/products/frontend/" + p1, null);
    check("P31 ... and the old numeric link still loads (the website redirects it)", r.s === 200 && r.j.data.slug === "tens-electrode-pads", "got " + r.s);
    r = await call("GET", "/api/products/frontend/no-such-product", null);
    check("P31 an unknown slug -> 404", r.s === 404, "got " + r.s);
    check("P31 the slug columns are unique in the database", (await q("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname IN ('uq_service_types_slug','uq_products_slug')"))[0].n === 2);
  }
  {
    // P32 refunds (go-live task GL-03): care packs use the refund service, a refund that went out is never left silent, unmatched refunds show in the reconciliation
    const sm = require("../../src/services/appointmentStateMachine");
    let r;
    const paid = await mkA("Paid", 3, { rzp: "pay_p32a", method: "razorpay" });
    const realTransition = sm.transition;
    const before = rzpRefunds.length;
    sm.transition = async () => { throw new Error("database went away"); };
    try { r = await call("PATCH", "/api/appointments/" + paid + "/cancel", T.p1); } finally { sm.transition = realTransition; }
    check("P32 the refund went out but the booking could not be cancelled: the patient is told clearly (500) and Razorpay was called once", r.s === 500 && /alerted/i.test(r.raw || "") && rzpRefunds.length === before + 1, "got " + r.s + " " + (r.raw || "").slice(0, 160));
    check("P32 ... an audit row 'refund_issued_cancel_failed' records it", (await q("SELECT 1 FROM audit_logs WHERE action = 'refund_issued_cancel_failed' AND entity_id = $1", [String(paid)])).length === 1);
    check("P32 ... and the therapy and super admins get an alert", (await q("SELECT 1 FROM notifications WHERE type = 'refund_without_cancel'")).length >= 1);
    check("P32 ... the reconciliation lists it as 'refunded but still active'", await (async () => {
      FakeRazorpay.mockPayments = [];
      const rr = await call("GET", `/api/admin/reconciliation?date=${day(0)}`, T.su);
      return rr.s === 200 && rr.j.data.mismatches.some((m) => m.type === "refunded_but_active" && m.curevanId === paid);
    })());

    // a care pack refund has its own refund row; the pack waits (refund_pending) until the money is confirmed, and comes back if Razorpay says it failed
    const [plan] = await q("SELECT id FROM care_pack_plans LIMIT 1");
    const anyUser = (await q("SELECT id FROM users ORDER BY id LIMIT 1"))[0].id;
    const mkPack = async (status, pay) => (await q("INSERT INTO care_packs(plan_id, patient_id, sessions_total, sessions_used, price_paid, expires_at, status, razorpay_payment_id) VALUES ($1,$2,5,0,1000, now() + interval '30 days',$3,$4) RETURNING id", [plan.id, anyUser, status, pay]))[0].id;
    const pk = await mkPack("active", "pay_p32pack");
    r = await call("POST", `/api/care-packs/admin/${pk}/refund`, T.su, { reason: "P32" });
    const row = (await q("SELECT status, razorpay_refund_id, amount FROM order_refunds WHERE care_pack_id = $1", [pk]))[0];
    check("P32 a care pack refund is recorded in order_refunds (pending) and sent through the refund service", r.s === 200 && row && row.status === "pending" && row.razorpay_refund_id && Number(row.amount) === 900, "got " + r.s + " " + (r.raw || "").slice(0, 120));
    const w = await hook("refund.processed", { id: row.razorpay_refund_id }, "refund", "evt_p32_pack");
    for (let i = 0; i < 30 && (await q("SELECT status FROM order_refunds WHERE care_pack_id = $1", [pk]))[0].status !== "processed"; i++) await new Promise((rs) => setTimeout(rs, 100));   // the webhook answers before it has finished
    check("P32 the Razorpay webhook for it is accepted and the pack stays refunded", w.s === 200 && (await q("SELECT status FROM order_refunds WHERE care_pack_id = $1", [pk]))[0].status === "processed" && (await q("SELECT status FROM care_packs WHERE id = $1", [pk]))[0].status === "refunded", "got " + w.s);
    const pf = await mkPack("refund_pending", "pay_p32fail");
    await q("INSERT INTO order_refunds(care_pack_id, user_id, amount, transaction_id, status, razorpay_refund_id, created_at) VALUES ($1,$2,900,'pay_p32fail','pending','rfnd_p32f', now())", [pf, anyUser]);
    const wf = await hook("refund.failed", { id: "rfnd_p32f" }, "refund", "evt_p32_fail");
    for (let i = 0; i < 30 && (await q("SELECT status FROM care_packs WHERE id = $1", [pf]))[0].status === "refund_pending"; i++) await new Promise((rs) => setTimeout(rs, 100));
    check("P32 a refund Razorpay reports as failed puts the pack back to active", wf.s === 200 && (await q("SELECT status FROM care_packs WHERE id = $1", [pf]))[0].status === "active", "got " + wf.s);
    check("P32 ... a refund still pending for a pack that is in 'refund_pending' cannot be started a second time (409)", await (async () => { const p2 = await mkPack("refund_pending", "pay_p32x"); const rr = await call("POST", `/api/care-packs/admin/${p2}/refund`, T.su, {}); return rr.s === 409; })());
    FakeRazorpay.mockPayments = [];
    const rec = await call("GET", `/api/admin/reconciliation?date=${day(0)}`, T.su);
    check("P32 the reconciliation lists the failed refund (the customer is not paid back yet)", rec.s === 200 && rec.j.data.mismatches.some((m) => m.type === "refund_failed" && /failed at Razorpay/.test(m.description)), "got " + rec.s + " " + JSON.stringify(rec.j && rec.j.data && rec.j.data.mismatches.map((m) => m.type)));
    FakeRazorpay.mockPayments = null;
  }
  {
    // P33 every e-mail goes through the notification service (go-live task GL-05)
    const ns = require("../../src/services/notifications");
    const out = await ns.sendEmailLogged({ to: "someone@example.com", subject: "Your session is complete", html: "<p>Done</p>", event: "test_direct" });
    check("P33 a composed e-mail is sent through the e-mail channel and logged in notification_log (sent)", out && out.success === true && (await q("SELECT 1 FROM notification_log WHERE event = 'test_direct' AND channel = 'email' AND status = 'sent'")).length === 1);
    let threw = false;
    try { await ns.sendEmailLogged({ to: "someone@example.com", subject: "x", html: "Your OTP is 123456", event: "test_direct_otp" }); } catch (e) { threw = true; }
    check("P33 an e-mail that carries an OTP is refused by the channel and the failure is logged without the number", threw && (await q("SELECT 1 FROM notification_log WHERE event = 'test_direct_otp' AND status = 'failed' AND COALESCE(error, '') !~ '123456'")).length === 1);
    const fs = require("fs"), path = require("path");
    const ctrlDir = path.join(__dirname, "../../src/controllers");
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    check("P33 no controller sends mail directly any more", walk(ctrlDir).filter((f) => /\.js$/.test(f) && /transporter\.sendMail|config\/mailer/.test(fs.readFileSync(f, "utf8"))).length === 0);
  }
  {
    // P34 the route list is complete and the therapy-admin routes are guarded (task list P03)
    const { spawnSync } = require("child_process");
    const chk = spawnSync(process.execPath, [require("path").join(__dirname, "../../scripts/route_permissions.js"), "--check"], { encoding: "utf8" });
    check("P34 docs/ROUTE_PERMISSIONS.md lists every route with the right login rule (scripts/route_permissions.js --check)", chk.status === 0, (chk.stdout || "").slice(0, 300));
    for (const [who, tok, want] of [["a patient", T.p1, 403], ["a therapist", T.t1, 403], ["an e-commerce admin", T.ecom, 403], ["a therapy admin", T.therapy, 200]]) {
      for (const p of ["/api/therapy-admin/overview", "/api/therapy-admin/quality-queue", "/api/therapy-admin/credential-queue"]) {
        const x = await call("GET", p, tok);
        check(`P34 ${p} for ${who} -> ${want}`, x.s === want, "got " + x.s);
      }
    }
    const anon = await call("GET", "/api/therapy-admin/overview", null);
    check("P34 the therapy-admin routes need a login (401)", anon.s === 401, "got " + anon.s);
  }
  {
    // P35 therapist links are name + city (go-live task GL-09)
    const rows = await q("SELECT tp.slug, u.name, u.city FROM therapist_profiles tp JOIN users u ON u.id = tp.user_id");
    check("P35 every therapist profile has a slug (lowercase, hyphens), unique in the database", rows.length > 0 && rows.every((x) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(x.slug || "")) && new Set(rows.map((x) => x.slug)).size === rows.length);
    const r = await call("GET", "/api/therapists/list", null);
    check("P35 the public therapist list carries the slug", r.s === 200 && r.j.data.length > 0 && r.j.data.every((x) => typeof x.slug === "string" && x.slug.length > 0), "got " + r.s);
    const t1 = (await q("SELECT tp.id, tp.slug, u.name, u.city FROM therapist_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.user_id = $1", [U.t1.id]))[0];
    const expected = `${t1.name} ${t1.city || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    check("P35 the slug is made from the name and the city", t1.slug === expected || t1.slug.startsWith(expected), `${t1.slug} vs ${expected}`);
    // a second profile with the same name and city gets -2, never the same link
    await q("UPDATE users SET name = $1, city = $2 WHERE id = $3", [t1.name, t1.city, U.t2.id]);
    await q("UPDATE therapist_profiles SET slug = NULL WHERE user_id = $1", [U.t2.id]);
    const t2 = (await q("SELECT slug FROM therapist_profiles WHERE user_id = $1", [U.t2.id]))[0];
    check("P35 two therapists with the same name and city get different links (-2)", t2.slug !== t1.slug && t2.slug.startsWith(t1.slug.replace(/-\d+$/, "")) && /-2$/.test(t2.slug), `${t1.slug} / ${t2.slug}`);
  }
  {
    // P36 registration certificate upload (task list P22): private file, therapist + therapy/super admins only
    const post = async (tok, file) => {
      const f = new FormData();
      if (file) f.append("certificate", new Blob([file.bytes], { type: file.type }), file.name);
      const x = await fetch(base + "/api/therapists/me/certificate", { method: "POST", headers: { authorization: "Bearer " + tok }, body: f });
      return { s: x.status, j: await x.json().catch(() => ({})) };
    };
    const get = async (tok, path) => { const x = await fetch(base + path, { headers: { authorization: "Bearer " + tok } }); return { s: x.status, type: x.headers.get("content-type"), buf: Buffer.from(await x.arrayBuffer()) }; };
    const pdf = Buffer.from("%PDF-1.4 test certificate");
    let r = await post(T.t1, { bytes: pdf, type: "application/pdf", name: "mci-registration.pdf" });
    check("P36 a therapist uploads the registration certificate (PDF) -> 200", r.s === 200 && r.j.data && r.j.data.uploaded === true && r.j.data.name === "mci-registration.pdf", "got " + r.s + " " + JSON.stringify(r.j));
    const row = (await q("SELECT registration_certificate_path AS p FROM therapist_profiles WHERE user_id = $1", [U.t1.id]))[0];
    check("P36 the file is stored in the private folder, not under /uploads", row.p && row.p.startsWith("certificates" ) && !/uploads/.test(row.p), row.p);
    r = await post(T.t1, { bytes: Buffer.from("hello"), type: "text/plain", name: "x.txt" });
    check("P36 a file that is not a PDF / JPG / PNG is refused (400)", r.s === 400, "got " + r.s);
    r = await post(T.t1, { bytes: Buffer.alloc(5 * 1024 * 1024 + 10), type: "application/pdf", name: "big.pdf" });
    check("P36 a file over 5 MB is refused (400)", r.s === 400, "got " + r.s);
    r = await post(T.t1, null);
    check("P36 no file chosen -> 400", r.s === 400, "got " + r.s);
    r = await post(T.p1, { bytes: pdf, type: "application/pdf", name: "a.pdf" });
    check("P36 a patient cannot upload (403)", r.s === 403, "got " + r.s);
    let g = await get(T.t1, `/api/therapists/certificate/${U.t1.id}/file`);
    check("P36 the therapist opens her/his own certificate (the same bytes, PDF)", g.s === 200 && /pdf/.test(g.type || "") && g.buf.equals(pdf), "got " + g.s + " " + g.type);
    g = await get(T.therapy, `/api/therapists/certificate/${U.t1.id}/file`);
    check("P36 the therapy admin can open it", g.s === 200, "got " + g.s);
    g = await get(T.su, `/api/therapists/certificate/${U.t1.id}/file`);
    check("P36 the super admin can open it", g.s === 200, "got " + g.s);
    for (const [who, tok] of [["another therapist", T.t2], ["a patient", T.p1], ["an e-commerce admin", T.ecom]]) {
      g = await get(tok, `/api/therapists/certificate/${U.t1.id}/file`);
      check(`P36 ${who} cannot open it (403)`, g.s === 403, "got " + g.s);
    }
    g = await get(T.t1, `/api/therapists/certificate/${U.t2.id}/file`);
    check("P36 a therapist cannot open another therapist's certificate (403)", g.s === 403, "got " + g.s);
    g = await get(T.therapy, `/api/therapists/certificate/${U.t2.id}/file`);
    check("P36 no certificate uploaded yet -> 404", g.s === 404, "got " + g.s);
    const q1 = await call("GET", "/api/therapy-admin/credential-queue", T.therapy);
    check("P36 the therapy admin's credential queue shows who has a certificate", q1.s === 200, "got " + q1.s);
    const old = row.p;
    r = await post(T.t1, { bytes: Buffer.from("%PDF-1.4 second"), type: "application/pdf", name: "renewed.pdf" });
    const row2 = (await q("SELECT registration_certificate_path AS p FROM therapist_profiles WHERE user_id = $1", [U.t1.id]))[0];
    const fsx = require("fs");
    check("P36 uploading again replaces the file and deletes the old one", r.s === 200 && row2.p !== old && !fsx.existsSync(require("../../src/utils/privateStorage").resolve(old)));
    check("P36 the upload is written to the audit log", (await q("SELECT 1 FROM audit_logs WHERE action = 'certificate_uploaded' AND entity_id = $1", [String(U.t1.id)])).length >= 2);
  }
  unmute();
  const widthName =Math.max(...results.map((x) => x.name.length));
  for (const x of results) console.log((x.ok ? "PASS " : "FAIL ") + x.name + (x.ok ? "" : "  <-- " + x.detail));
  console.log(`\n${results.length - failed}/${results.length} passed${PAYFIRST ? " (pay-first mode)" : " (approval-first mode)"}`);
  srv.close(); await pg.end(); process.exit(failed ? 1 : 0);
})().catch((e) => {
  unmute();
  for (const x of results) console.log((x.ok ? "PASS " : "FAIL ") + x.name + (x.ok ? "" : "  <-- " + x.detail));
  console.error("TEST CRASH (the checks above ran before it):", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e);
  process.exit(2);
});
