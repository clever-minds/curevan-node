const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const razorpay = require("../../services/razorpayService");
const rules = require("../../config/businessRules");
const access = require("../../utils/access");

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

// Create Razorpay payment order for purchasing a pack
exports.createPurchaseOrder = async (req, res) => {
  const { planId, therapistId } = req.body || {};
  if (!planId) return res.status(400).json({ success: false, error: "planId is required" });

  try {
    const [plan] = await sequelize.query(
      `SELECT * FROM care_pack_plans WHERE id = :planId AND active = true`,
      { replacements: { planId }, type: QueryTypes.SELECT }
    );
    if (!plan) return res.status(404).json({ success: false, error: "Care pack plan not found" });

    // If a therapist is chosen, check they are approved
    if (therapistId) {
      const [th] = await sequelize.query(
        `SELECT id FROM users WHERE id = :therapistId AND role = 'therapist'`,
        { replacements: { therapistId }, type: QueryTypes.SELECT }
      );
      if (!th) return res.status(404).json({ success: false, error: "Therapist not found" });
    }

    const price = Number(plan.price);
    const amountPaise = Math.round(price * 100);
    const receipt = `cp-${req.user.id}-${Date.now()}`.slice(0, 40);

    const rzpOrder = await razorpay.createOrder(amountPaise, receipt, {
      type: "care_pack",
      planId: String(plan.id),
      patientId: String(req.user.id),
      therapistId: therapistId ? String(therapistId) : "",
    });

    return res.json({
      success: true,
      data: {
        razorpayOrderId: rzpOrder.id,
        amountPaise,
        currency: "INR",
        plan: {
          id: plan.id,
          name: plan.name,
          sessions: plan.sessions,
          price: Number(plan.price),
          validityDays: plan.validity_days,
        },
        keyId: razorpay.getKeyId(),
      },
    });
  } catch (err) {
    console.error("createPurchaseOrder error:", err);
    return res.status(500).json({ success: false, error: "Failed to create payment order" });
  }
};

// Verify payment signature and activate care pack
exports.verifyPurchase = async (req, res) => {
  const { planId, therapistId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
  if (!planId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return res.status(400).json({ success: false, error: "Missing required payment parameters" });
  }

  const valid = razorpay.verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!valid) {
    return res.status(400).json({ success: false, error: "Invalid payment signature" });
  }

  const t = await sequelize.transaction();
  try {
    const [plan] = await sequelize.query(
      `SELECT * FROM care_pack_plans WHERE id = :planId FOR UPDATE`,
      { replacements: { planId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!plan) {
      await t.rollback();
      return res.status(404).json({ success: false, error: "Care pack plan not found" });
    }

    // Check if this payment was already processed
    const [existing] = await sequelize.query(
      `SELECT * FROM care_packs WHERE razorpay_payment_id = :razorpayPaymentId LIMIT 1`,
      { replacements: { razorpayPaymentId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (existing) {
      await t.commit();
      return res.json({ success: true, data: existing, message: "Care pack already active" });
    }

    const validityDays = plan.validity_days || rules.carePacks?.defaultValidityDays || 90;
    const expiresAt = new Date(Date.now() + validityDays * 86400 * 1000);

    const [rows] = await sequelize.query(
      `INSERT INTO care_packs (
         plan_id, patient_id, therapist_id, sessions_total, sessions_used, price_paid,
         purchased_at, expires_at, status, razorpay_order_id, razorpay_payment_id, created_at, updated_at
       ) VALUES (
         :planId, :patientId, :therapistId, :sessionsTotal, 0, :pricePaid,
         now(), :expiresAt, 'active', :razorpayOrderId, :razorpayPaymentId, now(), now()
       ) RETURNING *`,
      {
        replacements: {
          planId: plan.id,
          patientId: req.user.id,
          therapistId: therapistId || null,
          sessionsTotal: plan.sessions,
          pricePaid: plan.price,
          expiresAt,
          razorpayOrderId,
          razorpayPaymentId,
        },
        type: QueryTypes.INSERT,
        transaction: t,
      }
    );

    const pack = rows[0];

    // Issue invoice
    const invoiceNumber = `INV-CP-${pack.id}`;
    await sequelize.query(
      `INSERT INTO invoices (invoice_number, invoice_type, status, user_id, issued_at, total_amount_paise)
       VALUES (:invoiceNumber, 'care_pack', 'issued', :userId, now(), :paise)
       ON CONFLICT DO NOTHING`,
      {
        replacements: {
          invoiceNumber,
          userId: req.user.id,
          paise: Math.round(Number(plan.price) * 100),
        },
        type: QueryTypes.INSERT,
        transaction: t,
      }
    );

    await t.commit();
    return res.status(201).json({ success: true, data: pack, message: "Care pack purchased successfully" });
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
       WHERE cp.patient_id = :userId
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
