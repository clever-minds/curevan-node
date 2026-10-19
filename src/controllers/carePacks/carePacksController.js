const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const razorpay = require("../../services/razorpayService");
const rules = require("../../config/businessRules");
const access = require("../../utils/access");
const carePackService = require("../../services/carePackService");

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// List active plans for patients
exports.listPlans = async (req, res) => {
  try {
    const plans = await sequelize.query(
      `SELECT cpp.*, st.name AS service_type_name
       FROM care_pack_plans cpp
       LEFT JOIN service_types st ON st.id = cpp.service_type_id
       WHERE cpp.active = true
       ORDER BY cpp.sessions ASC, cpp.price ASC`,
      { type: QueryTypes.SELECT }
    );
    return res.json({ success: true, data: plans });
  } catch (err) {
    console.error("listPlans error:", err);
    return res.status(500).json({ success: false, error: "Failed to list care pack plans" });
  }
};

// Create the Razorpay order for a pack and remember what was priced (plan, patient, therapist) BEFORE the customer pays
exports.createPurchaseOrder = async (req, res) => {
  const { planId, therapistId } = req.body || {};
  if (!planId) return res.status(400).json({ success: false, error: "planId is required" });

  try {
    const [plan] = await sequelize.query(
      `SELECT * FROM care_pack_plans WHERE id = :planId AND active = true`,
      { replacements: { planId }, type: QueryTypes.SELECT }
    );
    if (!plan) return res.status(404).json({ success: false, error: "Care pack plan not found" });

    // a pack tied to one therapist: that therapist must be approved
    if (therapistId) {
      const [th] = await sequelize.query(
        `SELECT u.id FROM users u JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :therapistId AND u.role = 'therapist' AND tp.profile_status = 'approved'`,
        { replacements: { therapistId }, type: QueryTypes.SELECT }
      );
      if (!th) return res.status(404).json({ success: false, error: "Therapist not found" });
    }

    const price = Number(plan.price);
    const amountPaise = Math.round(price * 100);
    if (amountPaise < 100) return res.status(400).json({ success: false, error: "This plan has no price yet" });
    const receipt = `cp-${req.user.id}-${Date.now()}`.slice(0, 40);

    const rzpOrder = await razorpay.createOrder(amountPaise, receipt, { type: "care_pack", planId: String(plan.id), patientId: String(req.user.id) });

    await sequelize.query(
      `INSERT INTO care_packs (plan_id, patient_id, therapist_id, sessions_total, sessions_used, price_paid, status, razorpay_order_id)
       VALUES (:planId, :patientId, :therapistId, :sessions, 0, :price, 'pending_payment', :orderId)`,
      { replacements: { planId: plan.id, patientId: req.user.id, therapistId: therapistId || null, sessions: plan.sessions, price, orderId: rzpOrder.id }, type: QueryTypes.INSERT }
    );

    return res.json({
      success: true,
      data: {
        razorpayOrderId: rzpOrder.id,
        amountPaise,
        currency: "INR",
        plan: { id: plan.id, name: plan.name, sessions: plan.sessions, price, validityDays: plan.validity_days },
        keyId: razorpay.getKeyId(),
      },
    });
  } catch (err) {
    console.error("createPurchaseOrder error:", err);
    return res.status(500).json({ success: false, error: "Failed to create payment order" });
  }
};

// Verify the payment signature and activate the pack that was priced for that order (plan and price come from the server, not from this request)
exports.verifyPurchase = async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return res.status(400).json({ success: false, error: "Missing required payment parameters" });
  }
  if (!razorpay.verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return res.status(400).json({ success: false, error: "Invalid payment signature" });
  }

  const t = await sequelize.transaction();
  try {
    const out = await carePackService.activateByOrder({ razorpayOrderId, paymentId: razorpayPaymentId, userId: req.user.id, transaction: t });
    if (!out) { await t.rollback(); return res.status(404).json({ success: false, error: "Care pack purchase not found" }); }
    await t.commit();
    return res.status(out.already ? 200 : 201).json({ success: true, data: out.pack, message: out.already ? "Care pack already active" : "Care pack purchased successfully" });
  } catch (err) {
    await t.rollback();
    console.error("verifyPurchase error:", err);
    return res.status(500).json({ success: false, error: "Failed to verify purchase" });
  }
};

// List user's own care packs
exports.getMyPacks = async (req, res) => {
  try {
    // Auto-update expired packs
    await sequelize.query(
      `UPDATE care_packs 
       SET status = 'expired', updated_at = now() 
       WHERE patient_id = :userId AND status = 'active' AND expires_at < now()`,
      { replacements: { userId: req.user.id }, type: QueryTypes.UPDATE }
    );

    const packs = await sequelize.query(
      `SELECT 
         cp.*,
         cpp.name AS plan_name,
         cpp.service_type_id,
         st.name AS service_type_name,
         u.name AS therapist_name,
         (cp.sessions_total - cp.sessions_used) AS sessions_remaining
       FROM care_packs cp
       JOIN care_pack_plans cpp ON cpp.id = cp.plan_id
       LEFT JOIN service_types st ON st.id = cpp.service_type_id
       LEFT JOIN users u ON u.id = cp.therapist_id
       WHERE cp.patient_id = :userId AND cp.status <> 'pending_payment'
       ORDER BY 
         CASE WHEN cp.status = 'active' THEN 0 ELSE 1 END,
         cp.created_at DESC`,
      { replacements: { userId: req.user.id }, type: QueryTypes.SELECT }
    );

    return res.json({ success: true, data: packs });
  } catch (err) {
    console.error("getMyPacks error:", err);
    return res.status(500).json({ success: false, error: "Failed to get care packs" });
  }
};

// Single pack details
exports.getPackById = async (req, res) => {
  const { id } = req.params;
  try {
    const [pack] = await sequelize.query(
      `SELECT 
         cp.*,
         cpp.name AS plan_name,
         cpp.service_type_id,
         st.name AS service_type_name,
         u.name AS therapist_name,
         (cp.sessions_total - cp.sessions_used) AS sessions_remaining
       FROM care_packs cp
       JOIN care_pack_plans cpp ON cpp.id = cp.plan_id
       LEFT JOIN service_types st ON st.id = cpp.service_type_id
       LEFT JOIN users u ON u.id = cp.therapist_id
       WHERE cp.id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!pack) return res.status(404).json({ success: false, error: "Care pack not found" });

    // Authorization: owner or admin
    if (!access.isAdmin(req.user) && !access.same(pack.patient_id, req.user.id)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    return res.json({ success: true, data: pack });
  } catch (err) {
    console.error("getPackById error:", err);
    return res.status(500).json({ success: false, error: "Failed to get care pack" });
  }
};

// Admin: list all packs
exports.adminListPacks = async (req, res) => {
  try {
    const packs = await sequelize.query(
      `SELECT 
         cp.*,
         cpp.name AS plan_name,
         cpp.service_type_id,
         p.name AS patient_name,
         p.email AS patient_email,
         p.phone AS patient_phone,
         t.name AS therapist_name,
         (cp.sessions_total - cp.sessions_used) AS sessions_remaining
       FROM care_packs cp
       JOIN care_pack_plans cpp ON cpp.id = cp.plan_id
       JOIN users p ON p.id = cp.patient_id
       LEFT JOIN users t ON t.id = cp.therapist_id
       WHERE cp.status <> 'pending_payment'
       ORDER BY cp.created_at DESC`,
      { type: QueryTypes.SELECT }
    );
    return res.json({ success: true, data: packs });
  } catch (err) {
    console.error("adminListPacks error:", err);
    return res.status(500).json({ success: false, error: "Failed to list care packs" });
  }
};

// Admin: refund unused sessions pro-rata minus processing fee %
exports.adminRefundPack = async (req, res) => {
  const { id } = req.params;
  const { reason = "Admin approved refund" } = req.body || {};

  const t = await sequelize.transaction();
  try {
    const [pack] = await sequelize.query(
      `SELECT * FROM care_packs WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!pack) {
      await t.rollback();
      return res.status(404).json({ success: false, error: "Care pack not found" });
    }

    if (pack.status === "refunded") {
      await t.rollback();
      return res.status(409).json({ success: false, error: "Care pack has already been refunded" });
    }
    if (pack.status === "pending_payment" || pack.status === "cancelled") {
      await t.rollback();
      return res.status(409).json({ success: false, error: "This care pack was never paid" });
    }

    const sessionsUnused = pack.sessions_total - pack.sessions_used;
    if (sessionsUnused <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "No unused sessions to refund" });
    }

    if (!pack.razorpay_payment_id) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "No online payment id recorded for this pack" });
    }

    // Calculation per D14: Pro-rata at single-session price minus processing fee % (default 10%)
    const singleSessionPrice = Number(pack.price_paid) / pack.sessions_total;
    const grossRefund = singleSessionPrice * sessionsUnused;
    const feePct = rules.carePacks?.cancellationRefundProcessingFeePct ?? 10;
    const processingFee = (grossRefund * feePct) / 100;
    const netRefundInr = r2(grossRefund - processingFee);

    if (netRefundInr <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "Calculated refund amount is zero or negative" });
    }

    // Razorpay refund
    const refundPaise = Math.round(netRefundInr * 100);
    let rzpRefund;
    try {
      rzpRefund = await razorpay.refundPayment(pack.razorpay_payment_id, refundPaise, {
        carePackId: String(pack.id),
        sessionsRefunded: String(sessionsUnused),
        reason,
      });
    } catch (rzpErr) {
      await t.rollback();
      return res.status(502).json({ success: false, error: `Razorpay refund failed: ${rzpErr.message}` });
    }

    await sequelize.query(
      `UPDATE care_packs
       SET status = 'refunded',
           refunded_amount = :netRefundInr,
           refund_reason = :reason,
           updated_at = now()
       WHERE id = :id`,
      {
        replacements: { id: pack.id, netRefundInr, reason },
        type: QueryTypes.UPDATE,
        transaction: t,
      }
    );

    // Audit log
    await sequelize.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
       VALUES (:actorId, 'care_pack_refund', 'care_pack', :packId, :details)`,
      {
        replacements: {
          actorId: String(req.user.id),
          packId: String(pack.id),
          details: JSON.stringify({
            grossRefund,
            processingFee,
            netRefundInr,
            sessionsUnused,
            rzpRefundId: rzpRefund?.id,
            reason,
          }),
        },
        type: QueryTypes.INSERT,
        transaction: t,
      }
    );

    await t.commit();
    return res.json({
      success: true,
      data: {
        packId: pack.id,
        sessionsRefunded: sessionsUnused,
        grossRefund,
        processingFee,
        netRefundInr,
        razorpayRefundId: rzpRefund?.id,
      },
      message: `Refund of ₹${netRefundInr} for ${sessionsUnused} unused sessions processed successfully`,
    });
  } catch (err) {
    await t.rollback();
    console.error("adminRefundPack error:", err);
    return res.status(500).json({ success: false, error: "Failed to process pack refund" });
  }
};

// Admin: create care pack plan
exports.adminCreatePlan = async (req, res) => {
  const { name, serviceTypeId, sessions, price, validityDays = 90, active = true } = req.body || {};
  if (!name || !sessions || !price) {
    return res.status(400).json({ success: false, error: "name, sessions, and price are required" });
  }
  if (!Number.isInteger(Number(sessions)) || Number(sessions) < 1 || Number(sessions) > 60) return res.status(400).json({ success: false, error: "sessions must be a whole number from 1 to 60" });
  if (!(Number(price) > 0)) return res.status(400).json({ success: false, error: "price must be more than 0" });
  if (validityDays !== undefined && !(Number.isInteger(Number(validityDays)) && Number(validityDays) > 0)) return res.status(400).json({ success: false, error: "validityDays must be a whole number of days" });
  if (serviceTypeId) {
    const [st] = await sequelize.query(`SELECT id FROM service_types WHERE id = :id`, { replacements: { id: serviceTypeId }, type: QueryTypes.SELECT });
    if (!st) return res.status(400).json({ success: false, error: "Unknown service type" });
  }

  try {
    const [rows] = await sequelize.query(
      `INSERT INTO care_pack_plans (name, service_type_id, sessions, price, validity_days, active, created_at, updated_at)
       VALUES (:name, :serviceTypeId, :sessions, :price, :validityDays, :active, now(), now())
       RETURNING *`,
      {
        replacements: {
          name: String(name).trim(),
          serviceTypeId: serviceTypeId || null,
          sessions: Number(sessions),
          price: Number(price),
          validityDays: Number(validityDays) || 90,
          active: active !== false,
        },
        type: QueryTypes.INSERT,
      }
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("adminCreatePlan error:", err);
    return res.status(500).json({ success: false, error: "Failed to create plan" });
  }
};

// Admin: update care pack plan
exports.adminUpdatePlan = async (req, res) => {
  const { id } = req.params;
  const { name, serviceTypeId, sessions, price, validityDays, active } = req.body || {};

  try {
    const [existing] = await sequelize.query(`SELECT * FROM care_pack_plans WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
    if (!existing) return res.status(404).json({ success: false, error: "Plan not found" });

    await sequelize.query(
      `UPDATE care_pack_plans
       SET name = COALESCE(:name, name),
           service_type_id = COALESCE(:serviceTypeId, service_type_id),
           sessions = COALESCE(:sessions, sessions),
           price = COALESCE(:price, price),
           validity_days = COALESCE(:validityDays, validity_days),
           active = COALESCE(:active, active),
           updated_at = now()
       WHERE id = :id`,
      {
        replacements: {
          id,
          name: name !== undefined ? String(name).trim() : null,
          serviceTypeId: serviceTypeId !== undefined ? (serviceTypeId || null) : null,
          sessions: sessions !== undefined ? Number(sessions) : null,
          price: price !== undefined ? Number(price) : null,
          validityDays: validityDays !== undefined ? Number(validityDays) : null,
          active: active !== undefined ? Boolean(active) : null,
        },
        type: QueryTypes.UPDATE,
      }
    );

    const [updated] = await sequelize.query(`SELECT * FROM care_pack_plans WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("adminUpdatePlan error:", err);
    return res.status(500).json({ success: false, error: "Failed to update plan" });
  }
};
