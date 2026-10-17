const { QueryTypes } = require("sequelize");
const access = require("../../utils/access");
const razorpay = require("../../services/razorpayService");
const rules = require("../../config/businessRules");
const stateMachine = require("../../services/appointmentStateMachine");
const otpService = require("../../services/otpService");
const slotService = require("../../services/slotService");
const cancellationService = require("../../services/cancellationService");
const pcrService = require("../../services/pcrService");
const clinicalService = require("../../services/clinicalService");
const payoutService = require("../../services/payoutService");
const { generatePcrPdf } = require("../../services/pcrPdfService");
const { STATUS } = stateMachine;
const refundService = require("../../services/refundService");
const notificationStore = require("../../services/notificationStore");
const notifications = require("../../services/notifications");
const { sequelize } = require("../../config/db");
const transporter = require("../../config/mailer");
const firebaseNotifier = require("../../utils/firebaseNotifier");


// ✅ LIST APPOINTMENTS
exports.listAppointments = async (req, res) => {
  try {
    const filters = req.query;

    // Example filters: status, mode, therapistId
    const whereClauses = [];
    const replacements = {};

    if (filters.status) {
      whereClauses.push(`a.status = :status`);
      replacements.status = stateMachine.normalize(filters.status);
    }
    if (filters.mode) {
      whereClauses.push(`a.mode = :mode`);
      replacements.mode = filters.mode;
    }
    if (filters.therapistId) {
      whereClauses.push(`a.therapist_id = :therapistId`);
      replacements.therapistId = filters.therapistId;
    }

    const whereQuery = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const appointments = await sequelize.query(
      `SELECT 
         a.id,
         a.patient_id AS "patientId",
         a.patient_name AS "patientName",
         a.patient_phone AS "patientPhone",
         a.therapist_id AS "therapistId",
         a.therapist_name AS "therapist",
         a.therapist_phone AS "therapistPhone",
         a.service_type_id AS "serviceTypeId",
         a.therapy_type AS "therapyType",
         a.service_amount AS "serviceAmount",
         a.total_amount AS "totalAmount",
         a.clinic_id AS "clinicId",
         a.date,
         a.start_time AS "startTime",
         a.end_time AS "endTime",
         a.time,
         a.mode,
         a.status,
         a.cancellation_reason AS "cancellationReason",
         a.notes,
         a.created_at AS "createdAt",
         a.service_address_id AS "serviceAddress",
         a.payment_status AS "paymentStatus",
         a.pcr_status AS "pcrStatus",
         a.verification_status AS "verificationStatus"
       FROM appointments a
       ${whereQuery}
       ORDER BY a.date DESC`,
      { replacements, type: QueryTypes.SELECT }
    );

    return res.success(appointments, "Appointments fetched successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch appointments");
  }
};

// ✅ GET APPOINTMENT BY ID
exports.getAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.error("Appointment ID required");

    const [appt] = await sequelize.query(
      `SELECT 
         a.id,
         a.patient_id AS "patientId",
         a.patient_name AS "patientName",
         a.patient_phone AS "patientPhone",
         a.therapist_id AS "therapistId",
         a.therapist_name AS "therapist",
         a.therapist_phone AS "therapistPhone",
         a.service_type_id AS "serviceTypeId",
         a.therapy_type AS "therapyType",
         a.service_amount AS "serviceAmount",
         a.total_amount AS "totalAmount",
         a.clinic_id AS "clinicId",
         a.date,
         a.start_time AS "startTime",
         a.end_time AS "endTime",
         a.time,
         a.mode,
         a.status,
         a.cancellation_reason AS "cancellationReason",
         a.notes,
         a.created_at AS "createdAt",
         a.service_address_id AS "serviceAddress",
         a.payment_status AS "paymentStatus",
         a.pcr_status AS "pcrStatus",
         a.verification_status AS "verificationStatus",
         a.session_started_at AS "sessionStartedAt",
         a.travel_started_at AS "travelStartedAt",
         a.arrived_at AS "arrivedAt",
         a.completed_at AS "completedAt",
         CASE WHEN oa.id IS NULL THEN NULL ELSE jsonb_build_object(
           'fullAddress', oa.full_address, 'city', oa.city, 'state', oa.state, 'pincode', oa.pincode,
           'lat', to_jsonb(oa)->'lat', 'lng', to_jsonb(oa)->'lng') END AS "serviceAddressDetail"
       FROM appointments a
       LEFT JOIN order_addresses oa ON oa.id = a.service_address_id
       WHERE a.id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!appt) return res.error("Appointment not found", 404);
    if (!access.canAccessAppointment(req.user, appt)) return res.error("Forbidden", 403);

    return res.success(access.sanitizeAppointmentForViewer(req.user, appt), "Appointment fetched successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch appointment");
  }
};

// ✅ LIST PCRs (admin.therapy / admin.super) - filters: bookingId, status, therapistId
exports.listPcrs = async (req, res) => {
  try {
    const { bookingId, status, therapistId } = req.query;
    const where = [];
    const replacements = {};
    if (bookingId) { where.push("pcr.appointment_id = :bookingId"); replacements.bookingId = Number(bookingId); }
    if (status) { where.push("pcr.status = :status"); replacements.status = status; }
    if (therapistId) { where.push("pcr.therapist_id = :therapistId"); replacements.therapistId = Number(therapistId); }

    const rows = await sequelize.query(
      `SELECT
         pcr.appointment_id            AS "id",
         pcr.patient_id                AS "patientId",
         pcr.therapist_id              AS "therapistId",
         a.patient_name                AS "patientFullName",
         a.therapist_name              AS "therapistName",
         pcr.service_type_id           AS "serviceTypeId",
         pcr.chief_complaint           AS "chiefComplaint",
         pcr.assessment                AS "assessment",
         pcr.diagnosis                 AS "diagnosis",
         pcr.treatment_provided        AS "treatmentProvided",
         pcr.plan_of_care              AS "planOfCare",
         pcr.status                    AS "status",
         pcr.version                   AS "version",
         pcr.created_at                AS "createdAt",
         pcr.locked_at                 AS "lockedAt",
         pcr.locked_by                 AS "lockedBy",
         pcr.next_treatment_date       AS "nextTreatmentDate"
       FROM pcr
       JOIN appointments a ON a.id = pcr.appointment_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY pcr.created_at DESC`,
      { replacements, type: QueryTypes.SELECT }
    );
    return res.success(rows, "PCRs fetched successfully");
  } catch (error) {
    console.error("listPcrs error:", error);
    return res.error("Failed to fetch PCRs");
  }
};

// ✅ LIST APPOINTMENTS FOR USER
exports.listAppointmentsForUser = async (req, res) => {
  try {
    const { role } = req.query; // 'patient' or 'therapist'
    // Non-admins can only list their own appointments, whatever id is in the URL.
    const userId = access.isAdmin(req.user) ? req.params.userId : req.user.id;

    if (!userId || !role) return res.error("User ID and role required");

    const field = role === "patient" ? "a.patient_id" : "a.therapist_id";

    const appointments = await sequelize.query(
      `SELECT 
         a.id,
         a.patient_id AS "patientId",
         a.patient_name AS "patientName",
         a.patient_phone AS "patientPhone",
         a.therapist_id AS "therapistId",
         a.therapist_name AS "therapist",
         a.therapist_phone AS "therapistPhone",
         a.service_type_id AS "serviceTypeId",
         a.therapy_type AS "therapyType",
         a.service_amount AS "serviceAmount",
         a.total_amount AS "totalAmount",
         a.clinic_id AS "clinicId",
         a.date,
         a.start_time AS "startTime",
         a.end_time AS "endTime",
         a.time,
         a.mode,
         a.status,
         a.cancellation_reason AS "cancellationReason",
         a.notes,
         a.created_at AS "createdAt",
         a.payment_status AS "paymentStatus",
         a.pcr_status AS "pcrStatus",
         a.verification_status AS "verificationStatus",
         a.session_started_at AS "sessionStartedAt",
         a.travel_started_at AS "travelStartedAt",
         a.arrived_at AS "arrivedAt",
         a.completed_at AS "completedAt",
         CASE WHEN oa.id IS NULL THEN NULL ELSE jsonb_build_object(
           'fullAddress', oa.full_address, 'city', oa.city, 'state', oa.state, 'pincode', oa.pincode,
           'lat', to_jsonb(oa)->'lat', 'lng', to_jsonb(oa)->'lng') END AS "serviceAddressDetail",
         tr.rating,
         tr.review
       FROM appointments a
       LEFT JOIN therapist_reviews tr ON tr.appointment_id = a.id
       LEFT JOIN order_addresses oa ON oa.id = a.service_address_id
       WHERE ${field} = :userId
       ORDER BY a.date DESC`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    return res.success(
      appointments.map((a) => access.sanitizeAppointmentForViewer(req.user, a)),
      "User appointments fetched successfully"
    );
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch user appointments");
  }
};

async function getNextInvoiceNumber(type = "service") {
  const series = type === "goods" ? "ORD" : "BK";
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `INV-${series}-${randomNum}`;
}
/* =====================================================
   STEP A - direct booking (or "Pay now" for an accepted request)
   POST /api/appointments/create-appointment
   The price is read from the server (therapist rate). Any amount,
   status or payment field in the body is ignored. No invoice / PCR /
   notification is created here - that happens when the payment is verified.
===================================================== */
exports.createBookingAndInvoice = async (req, res) => {
  const { bookingData = {}, appointmentId: payForId } = req.body || {};
  const t = await sequelize.transaction();

  try {
    let appointmentId;
    let amount;

    if (payForId) {
      // ---- pay for an existing, accepted and still unpaid request
      const [appt] = await sequelize.query(
        `SELECT id, patient_id, status, payment_status, service_amount FROM appointments WHERE id = :id FOR UPDATE`,
        { replacements: { id: payForId }, type: QueryTypes.SELECT, transaction: t }
      );
      if (!appt) { await t.rollback(); return res.status(404).json({ success: false, error: "Appointment not found" }); }
      if (!access.same(appt.patient_id, req.user.id)) { await t.rollback(); return res.status(403).json({ success: false, error: "Forbidden" }); }
      if (appt.payment_status === "Paid") { await t.rollback(); return res.status(400).json({ success: false, error: "Already paid" }); }
      if (![STATUS.ACCEPTED_UNPAID, STATUS.PROPOSED].includes(appt.status)) {
        await t.rollback();
        return res.status(400).json({ success: false, error: "This request is not waiting for payment" });
      }
      appointmentId = appt.id;
      amount = Number(appt.service_amount);
    } else {
      // ---- new direct booking
      if (!bookingData.therapistId) {
        await t.rollback();
        return res.status(400).json({ success: false, error: "therapistId is required (use /request to let Curevan find a therapist)" });
      }

      const [therapist] = await sequelize.query(
        `SELECT hourly_rate FROM therapist_profiles WHERE user_id = :therapistId AND profile_status = 'approved'`,
        { replacements: { therapistId: bookingData.therapistId }, type: QueryTypes.SELECT, transaction: t }
      );
      if (!therapist) { await t.rollback(); return res.status(404).json({ success: false, error: "Therapist not found" }); }
      amount = Number(therapist.hourly_rate);
      if (!(amount > 0)) { await t.rollback(); return res.status(400).json({ success: false, error: "This therapist has no price set yet" }); }

      // working hours, leave, double booking, 4-hour lead time and 30-day limit are all checked here, inside the transaction
      await slotService.assertSlotBookable(bookingData.therapistId, bookingData.date, bookingData.time, { transaction: t });

      // patients book for themselves; only an admin may book on behalf of someone
      const patientId = access.isAdmin(req.user) && bookingData.patientId ? bookingData.patientId : req.user.id;

      const [rows] = await sequelize.query(
        `INSERT INTO appointments (
          patient_id, patient_name, date_of_birth, therapist_id, therapist_name, service_type_id, therapy_type,
          service_amount, total_amount, date, time, mode, notes, service_address_id,
          status, verification_status, payment_status, pcr_status, reports, price_source, created_at
        ) VALUES (
          :patientId, :patientName, :dateofbirth, :therapistId, :therapistName, :serviceTypeId, :therapyType,
          :amount, :amount, :date, :time, :mode, :notes, :serviceAddress,
          :initialStatus, 'Pending', 'Pending', 'not_started', :reports, 'therapist_rate', NOW()
        ) RETURNING id`,
        {
          replacements: {
            patientId,
            patientName: bookingData.patientName || null,
            dateofbirth: bookingData.dateofBirth || null,
            therapistId: bookingData.therapistId,
            therapistName: bookingData.therapist || null,
            serviceTypeId: bookingData.serviceTypeId || null,
            therapyType: bookingData.therapyType || null,
            amount,
            initialStatus: rules.booking.directBookingNeedsApproval ? STATUS.SEARCHING : STATUS.PENDING_PAYMENT,
            date: bookingData.date || null,
            time: bookingData.time || null,
            mode: bookingData.mode || null,
            notes: bookingData.notes || null,
            serviceAddress: bookingData.addressId || null,
            reports: bookingData.reports ? JSON.stringify(bookingData.reports) : null,
          },
          type: sequelize.QueryTypes.INSERT,
          transaction: t,
        }
      );
      appointmentId = rows[0]?.id;
      if (!appointmentId) throw new Error("Failed to get appointmentId");
    }

    // Therapist approval comes first: nothing to pay yet. The patient pays after the therapist accepts.
    if (!payForId && rules.booking.directBookingNeedsApproval) {
      await t.commit();
      return res.json({ success: true, appointmentId, requiresApproval: true });
    }

    const amountPaise = Math.round(amount * 100);
    const rzpOrder = await razorpay.createOrder(amountPaise, `appt-${appointmentId}`, { appointmentId: String(appointmentId) });

    await sequelize.query(
      `UPDATE appointments SET razorpay_order_id = :rzpId WHERE id = :id`,
      { replacements: { rzpId: rzpOrder.id, id: appointmentId }, type: QueryTypes.UPDATE, transaction: t }
    );

    await t.commit();
    return res.json({
      success: true,
      appointmentId,
      razorpayOrderId: rzpOrder.id,
      amountPaise,
      keyId: razorpay.getKeyId(),
    });
  } catch (error) {
    await t.rollback();
    if (error instanceof slotService.SlotError) return res.status(error.httpStatus).json({ success: false, error: error.message });
    if (slotService.isSlotConflict(error)) return res.status(409).json({ success: false, error: "Slot no longer available" });
    console.error("Error creating booking:", error);
    return res.status(500).json({ success: false, error: "Failed to create booking" });
  }
};

/* =====================================================
   Called once a booking payment is VERIFIED (paymentsController).
   Creates the invoice and the empty PCR, and sends the notifications.
===================================================== */
exports.finalizePaidBooking = async (appt, transaction) => {
  const invoiceNumber = `INV-BK-${appt.id}`;
  const [existing] = await sequelize.query(
    `SELECT id FROM invoices WHERE booking_id = :id LIMIT 1`,
    { replacements: { id: appt.id }, type: QueryTypes.SELECT, transaction }
  );
  let invoiceId = existing ? existing.id : null;
  if (!existing) {
    const [invoiceRows] = await sequelize.query(
      `INSERT INTO invoices (invoice_number, status, user_id, booking_id, issued_at, total_amount_paise)
       VALUES (:invoiceNumber, 'issued', :userId, :id, NOW(), :paise) RETURNING id`,
      {
        replacements: { invoiceNumber, userId: appt.patient_id, id: appt.id, paise: Math.round(Number(appt.total_amount) * 100) },
        type: QueryTypes.INSERT,
        transaction,
      }
    );
    invoiceId = invoiceRows[0]?.id;
  }

  const [pcrExists] = await sequelize.query(
    `SELECT 1 FROM pcr WHERE appointment_id = :id LIMIT 1`,
    { replacements: { id: appt.id }, type: QueryTypes.SELECT, transaction }
  );
  if (!pcrExists) {
    await sequelize.query(
      `INSERT INTO pcr (
        appointment_id, patient_id, therapist_id, service_type_id,
        chief_complaint, assessment, diagnosis, treatment_provided, plan_of_care,
        bp, hr, rr, temp, status, version, created_at, locked_at, history
      ) VALUES (
        :id, :patientId, :therapistId, :serviceTypeId,
        '', '', '', '', '', '', '', '', '',
        'not_started', 1, NOW(), NOW(), '[]'
      )`,
      {
        replacements: { id: appt.id, patientId: appt.patient_id, therapistId: appt.therapist_id, serviceTypeId: appt.service_type_id },
        type: QueryTypes.INSERT,
        transaction,
      }
    );
  }
  return { invoiceId, invoiceNumber };
};

// Push + e-mail after the payment commit (best effort, never fails the payment).
exports.notifyPaidBooking = async (appt) => {
  try {
    let otp = appt.start_otp;
    if (!otp && appt.id) {
      const issued = otpService.issue(appt.id);
      otp = issued.otp;
      await sequelize.query(`UPDATE appointments SET start_otp_hash = :hash WHERE id = :id`, {
        replacements: { hash: issued.hash, id: appt.id },
        type: QueryTypes.UPDATE,
      });
    }

    const dateStr = appt.date instanceof Date ? appt.date.toISOString().slice(0, 10) : appt.date;

    await notifications.notify("booking_confirmed", {
      appointmentId: appt.id,
      patientId: appt.patient_id,
      therapistId: appt.therapist_id,
      patientName: appt.patient_name,
      therapistName: appt.therapist_name,
      date: dateStr,
      time: appt.time,
      locality: appt.locality || appt.city,
      otp,
      link: "https://curevan.com/dashboard/bookings",
    });
  } catch (err) {
    console.error("Failed to dispatch booking_confirmed notification:", err.message);
  }
};

// exports.getPCRByBookingId = async (req, res) => {
//   const { appointmentId } = req.params;

//   if (!appointmentId) {
//     return res.error("appointmentId is required", 400); // 400 Bad Request
//   }

//     try {
//       // Fetch PCR along with patient and therapist names
//     const rows = await sequelize.query(
//     `SELECT 
//       pcr.*, 
//       a.patient_name AS "patientFullName",
//       a.date_of_birth AS "dob",   -- if you store DOB in appointments
//       a.therapist_name AS "therapistFullName"
//     FROM pcr
//     JOIN appointments a ON a.id = pcr.appointment_id
//     WHERE pcr.appointment_id = :appointmentId
//     LIMIT 1`,
//     {
//       replacements: { appointmentId },
//       type: sequelize.QueryTypes.SELECT,
//     }
//   );

//     if (!rows || rows.length === 0) {
//       return res.error("PCR not found", 404); // 404 Not Found
//     }

//     return res.success(rows[0], "PCR fetched successfully"); // 200 OK
//   } catch (error) {
//     console.error("Error fetching PCR:", error);
//     return res.error("Failed to fetch PCR", 500); // 500 Internal Server Error
//   }
// };

// exports.updatePcr = async (req, res) => {
//   const { appointmentId } = req.params;
//   const data = req.body;

//   if (!appointmentId) return res.error("Pcr Id is required", 400);;

//   try {
//     // 1️⃣ Fetch current PCR to track version and history
//     const [current] = await sequelize.query(
//       `SELECT * FROM pcr WHERE appointment_id = :appointmentId LIMIT 1`,
//       { replacements: { appointmentId }, type: QueryTypes.SELECT }
//     );

//     if (!current) return res.status(404).json({ success: false, error: "PCR not found" });

//     // 2️⃣ Prepare new values
//     const updatedData = {
//       chief_complaint: data.chiefComplaint ?? current.chief_complaint,
//       assessment: data.assessment ?? current.assessment,
//       diagnosis: data.diagnosis ?? current.diagnosis,
//       treatment_provided: data.treatmentProvided ?? current.treatment_provided,
//       plan_of_care: data.planOfCare ?? current.plan_of_care,
//       bp: data.vitals?.bp ?? current.bp,
//       hr: data.vitals?.hr ?? current.hr,
//       rr: data.vitals?.rr ?? current.rr,
//       temp: data.vitals?.temp ?? current.temp,
//       status: data.status ?? current.status,
//       locked_by: data.lockedBy ?? current.locked_by,
//       locked_at: data.lockedAt ?? current.locked_at,
//       version: (current.version || 1) + 1,
//       history: JSON.stringify([
//         ...(current.history || []),
//         {
//           version: current.version,
//           chief_complaint: current.chief_complaint,
//           assessment: current.assessment,
//           diagnosis: current.diagnosis,
//           treatment_provided: current.treatment_provided,
//           plan_of_care: current.plan_of_care,
//           bp: current.bp,
//           hr: current.hr,
//           rr: current.rr,
//           temp: current.temp,
//           status: current.status,
//           locked_by: current.locked_by,
//           locked_at: current.locked_at,
//           updated_at: new Date(),
//         },
//       ]),
//     };

//     // 3️⃣ Update PCR
//     await sequelize.query(
//       `UPDATE pcr
//        SET
//          chief_complaint = :chief_complaint,
//          assessment = :assessment,
//          diagnosis = :diagnosis,
//          treatment_provided = :treatment_provided,
//          plan_of_care = :plan_of_care,
//          bp = :bp,
//          hr = :hr,
//          rr = :rr,
//          temp = :temp,
//          status = :status,
//          locked_by = :locked_by,
//          locked_at = :locked_at,
//          version = :version,
//          history = :history
//        WHERE appointment_id = :appointmentId`,
//       {
//         replacements: { ...updatedData, appointmentId },
//         type: QueryTypes.UPDATE,
//       }
//     );

//      return res.success("PCR updated successfully"); // 200 OK
//   } catch (error) {
//     console.error("Error updating PCR:", error);
//     return res.error("Failed to fetch PCR", 500);
//   }
// };

exports.getPCRByBookingId = async (req, res) => {
  const { appointmentId } = req.params;

  if (!appointmentId) {
    return res.error("appointmentId is required", 400);
  }

  try {
    const [owner] = await sequelize.query(
      `SELECT patient_id, therapist_id, status, date, time, start_time FROM appointments WHERE id = :appointmentId`,
      { replacements: { appointmentId }, type: QueryTypes.SELECT }
    );
    if (!owner) return res.error("PCR not found", 404);
    const allowed =
      access.isClinicalAdmin(req.user) ||
      access.same(owner.patient_id, req.user.id) ||
      access.same(owner.therapist_id, req.user.id);
    if (!allowed) return res.error("Forbidden", 403);

    const rows = await sequelize.query(
      `SELECT 
        pcr.*, 
        a.patient_name       AS "patientFullName",
        a.date_of_birth      AS "dob",
        a.therapist_name     AS "therapistFullName",
        pcr.incident_date    AS "incidentDate",
        pcr.incident_location AS "incidentLocation",
        pcr.next_treatment_date AS "nextTreatmentDate",
        pcr.therapist_name   AS "therapistName",
        pcr.chief_complaint  AS "chiefComplaint",
        pcr.treatment_provided AS "treatmentProvided",
        pcr.plan_of_care     AS "planOfCare",
        pcr.service_type_id  AS "therapyType",
        pcr.upload_attachment_id AS "uploadAttachmentId",
        pcr.signature_confirmation AS "signatureConfirmation",
        m.file_path          AS attachment
      FROM pcr
      JOIN appointments a ON a.id = pcr.appointment_id
      LEFT JOIN media m ON m.id = pcr.upload_attachment_id
      WHERE pcr.appointment_id = :appointmentId
      LIMIT 1`,
      {
        replacements: { appointmentId },
        type: QueryTypes.SELECT,
      }
    );

    if (!rows || rows.length === 0) {
      return res.error("PCR not found", 404);
    }

    const pcr = rows[0];

    // P15: the treating therapist sees clinical history only from 4 hours before the session
    const asTherapist = !access.isClinicalAdmin(req.user) && access.same(owner.therapist_id, req.user.id);
    let baseline = pcr.baseline;
    let historyLocked = false;
    if (asTherapist) {
      if (!pcrService.historyOpen(owner)) {
        baseline = null;
        historyLocked = true;
      } else if (!baseline) {
        baseline = await pcrService.carryForwardBaseline(owner.patient_id, appointmentId);
        if (baseline) {
          await sequelize.query(`UPDATE pcr SET baseline = :baseline::jsonb WHERE id = :id`, { replacements: { baseline: JSON.stringify(baseline), id: pcr.id }, type: QueryTypes.UPDATE });
        }
      }
    }
    await pcrService.logAccess(pcr.id, req.user.id, "view");

    // P16: the treatment plan this visit belongs to and the outcome measures due today
    let treatmentPlan = null;
    let dueMeasures = [];
    let sessionNumber = pcr.session_number ?? null;
    const sessionType = pcr.session_type || "follow_up";
    if (!historyLocked) {
      const planId = await clinicalService.linkAppointment(appointmentId);
      if (planId) {
        [treatmentPlan] = await sequelize.query(`SELECT id, condition, affected_side, planned_sessions, frequency_per_week, review_every_sessions, status FROM treatment_plans WHERE id = :id`, { replacements: { id: planId }, type: QueryTypes.SELECT });
        sessionNumber = await clinicalService.sessionNumberFor(planId, pcr.id);
        dueMeasures = await clinicalService.dueMeasures({ id: planId, review_every_sessions: treatmentPlan.review_every_sessions }, sessionType, sessionNumber);
      }
    }

    const response = {
      ...pcr,
      baseline,
      historyLocked,
      sessionType,
      sessionNumber,
      treatmentPlan: treatmentPlan || null,
      dueMeasures: dueMeasures.map((m) => ({ planMeasureId: m.plan_measure_id, measureId: m.measure_id, code: m.code, name: m.name, side: m.side, item: m.item, scaleType: m.scale_type, min: m.min_value === null ? null : Number(m.min_value), max: m.max_value === null ? null : Number(m.max_value), unit: m.unit, instructions: m.instructions, subItems: m.sub_items, lastValue: m.last_value })),
      functionalScore: pcr.functional_score ?? null,
      painVas: pcr.pain_vas ?? null,
      functionalMeasure: pcr.functional_measure ?? '',
      hep: pcr.hep ?? '',
      contentHash: undefined,
      pdf_path: undefined,
      content_hash: undefined,
      bp:   pcr.bp   ?? '',
      hr:   pcr.hr   ?? '',
      rr:   pcr.rr   ?? '',
      temp: pcr.temp ?? '',
      signatureConfirmation: pcr.signatureConfirmation ?? false,
      attachment: pcr.uploadAttachmentId
        ? [{ id: pcr.uploadAttachmentId, url: pcr.attachment }]
        : [],
    };

    return res.success(response, "PCR fetched successfully");
  } catch (error) {
    console.error("Error fetching PCR:", error);
    return res.error("Failed to fetch PCR", 500);
  }
};



// ==========================================
// UPDATE PCR
// ==========================================
// exports.updatePcr = async (req, res) => {
//   const { appointmentId } = req.params;
//   const data = req.body;

//   if (!appointmentId) {
//     return res.error("PCR Id is required", 400);
//   }

//   const t = await sequelize.transaction();

//   try {
//     const current = await sequelize.query(
//       `SELECT * FROM pcr WHERE appointment_id = :appointmentId LIMIT 1`,
//       {
//         replacements: { appointmentId },
//         type: QueryTypes.SELECT,
//         transaction: t
//       }
//     );

//     if (!current || current.length === 0) {
//       await t.rollback();
//       return res.status(404).json({ success: false, error: "PCR not found" });
//     }

//     const existing = current[0];

//     const updatedData = {
//       chief_complaint: data.chiefComplaint ?? existing.chief_complaint,
//       assessment: data.assessment ?? existing.assessment,
//       diagnosis: data.diagnosis ?? existing.diagnosis,
//       treatment_provided: data.treatmentProvided ?? existing.treatment_provided,
//       plan_of_care: data.planOfCare ?? existing.plan_of_care,
//       bp: data?.bp ?? existing.bp,
//       hr: data?.hr ?? existing.hr,
//       rr: data?.rr ?? existing.rr,
//       temp: data?.temp ?? existing.temp,
//       status: data.status ?? existing.status,
//       locked_by: data.lockedBy ?? existing.locked_by,
//       locked_at: data.lockedAt ?? existing.locked_at,
//       incident_date: data.incidentDate ?? existing.incident_date,
//       incident_location: data.incidentLocation ?? existing.incident_location,
//       next_treatment_date: data.nextTreatmentDate ?? existing.next_treatment_date,
//       upload_attachment_id: data.upload_attachment_id ?? existing.upload_attachment_id,
//       therapist_name: data.therapistName ?? existing.therapist_name,
//       signature_confirmation: data.signatureConfirmation ?? existing.signature_confirmation,
//       version: (existing.version || 1) + 1,
//       history: JSON.stringify([
//         ...(existing.history || []),
//         {
//           version: existing.version,
//           assessment: data.assessment ?? existing.assessment,
//           diagnosis: data.diagnosis ?? existing.diagnosis,
//           treatment_provided: data.treatmentProvided ?? existing.treatment_provided,
//           plan_of_care: data.planOfCare ?? existing.plan_of_care,
//           bp: data?.bp ?? existing.bp,
//           hr: data?.hr ?? existing.hr,
//           rr: data?.rr ?? existing.rr,
//           temp: data?.temp ?? existing.temp,
//           status: data.status ?? existing.status,
//           locked_by: data.lockedBy ?? existing.locked_by,
//           locked_at: data.lockedAt ?? existing.locked_at,
//           incident_date: data.incidentDate ?? existing.incident_date,
//           incident_location: data.incidentLocation ?? existing.incident_location,
//           next_treatment_date: data.nextTreatmentDate ?? existing.next_treatment_date,
//           upload_attachment_id: data.upload_attachment_id ?? existing.upload_attachment_id,
//           therapist_name: data.therapistName ?? existing.therapist_name,
//           signature_confirmation: data.signatureConfirmation ?? existing.signature_confirmation,
//           updated_at: new Date(),
//         },
//       ]),
//     };

//     await sequelize.query(
//       `UPDATE pcr
//        SET
//          chief_complaint = :chief_complaint,
//          assessment = :assessment,
//          diagnosis = :diagnosis,
//          treatment_provided = :treatment_provided,
//          plan_of_care = :plan_of_care,
//          bp = :bp,
//          hr = :hr,
//          rr = :rr,
//          temp = :temp,
//          status = :status,
//          locked_by = :locked_by,
//          locked_at = :locked_at,
//          incident_date = :incident_date,
//          incident_location = :incident_location,
//          next_treatment_date = :next_treatment_date,
//          upload_attachment_id = :upload_attachment_id,
//          therapist_name = :therapist_name,
//          signature_confirmation = :signature_confirmation,
//          version = :version,
//          history = :history
//        WHERE appointment_id = :appointmentId`,
//       {
//         replacements: { ...updatedData, appointmentId },
//         type: QueryTypes.UPDATE,
//         transaction: t
//       }
//     );

//     await sequelize.query(
//       `UPDATE appointments
//        SET pcr_status = :status
//        WHERE id = :appointmentId`,
//       {
//         replacements: { status: updatedData.status, appointmentId },
//         type: QueryTypes.UPDATE,
//         transaction: t
//       }
//     );

//     await t.commit();
//     return res.success("PCR updated successfully");

//   } catch (error) {
//     await t.rollback();
//     console.error("Error updating PCR:", error);
//     return res.error("Failed to update PCR", 500);
//   }
// };


exports.updatePcr = async (req, res) => {
  const { appointmentId } = req.params;
  const data = req.body || {};

  if (!appointmentId) {
    return res.status(400).json({ success: false, error: "PCR Id is required" });
  }

  // Ownership: assigned therapist (while not locked) or clinical admin (lock / unlock / return).
  const [owner] = await sequelize.query(
    `SELECT patient_id, therapist_id, status, date, time, start_time FROM appointments WHERE id = :appointmentId`,
    { replacements: { appointmentId }, type: QueryTypes.SELECT }
  );
  if (!owner) return res.status(404).json({ success: false, error: "PCR not found" });
  const clinicalAdmin = access.isClinicalAdmin(req.user);
  const assignedTherapist = access.same(owner.therapist_id, req.user.id);
  if (!clinicalAdmin && !assignedTherapist) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  // P15: the therapist can write the PCR only after the start code was verified
  if (!clinicalAdmin && !pcrService.therapistCanEdit(owner)) {
    return res.status(403).json({ success: false, error: "You can edit the PCR once the session has started (start code verified)" });
  }

  const t = await sequelize.transaction();

  try {
    // 1️⃣ Fetch current PCR record
    const current = await sequelize.query(
      `SELECT * FROM pcr WHERE appointment_id = :appointmentId LIMIT 1`,
      {
        replacements: { appointmentId },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    if (!current || current.length === 0) {
      await t.rollback();
      return res.status(404).json({ success: false, error: "PCR not found" });
    }

    const existing = current[0];

    if (!clinicalAdmin) {
      const requested = String(data.status || "").toLowerCase();
      if (String(existing.status || "").toLowerCase() === "locked") {
        await t.rollback();
        return res.status(403).json({ success: false, error: "PCR is locked" });
      }
      if (requested === "locked" || requested === "returned") {
        await t.rollback();
        return res.status(403).json({ success: false, error: "Only an admin can lock or return a PCR" });
      }
      // a therapist cannot set lock metadata
      delete data.lockedBy;
      delete data.lockedAt;
    }

    // P15: required fields on submit; a reason when an admin returns or unlocks a PCR
    const requestedStatus = String(data.status || "").toLowerCase();
    const merged = {
      bp: data.bp ?? existing.bp, hr: data.hr ?? existing.hr, rr: data.rr ?? existing.rr, temp: data.temp ?? existing.temp,
      assessment: data.assessment ?? existing.assessment, treatment_provided: data.treatmentProvided ?? existing.treatment_provided,
      hep: data.hep ?? existing.hep,
      functional_score: data.functionalScore ?? existing.functional_score, pain_vas: data.painVas ?? existing.pain_vas,
    };
    if (requestedStatus === "submitted" || (requestedStatus === "locked" && !existing.submitted_at && String(existing.status).toLowerCase() !== "submitted")) {
      const missing = pcrService.missingForSubmit(merged);
      if (missing.length) {
        await t.rollback();
        return res.status(400).json({ success: false, error: `Please complete: ${missing.join(", ")}`, missing });
      }
    }
    const reopening = requestedStatus === "returned" || (String(existing.status).toLowerCase() === "locked" && requestedStatus && requestedStatus !== "locked");
    if (reopening && String(data.reason || "").trim().length < 3) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "Please give a reason for returning or unlocking this PCR" });
    }

    // 2️⃣ Submitting (or locking) the PCR is what completes the visit: pcr_pending -> completed
    const statusLower = String(data.status || "").toLowerCase();
    const finishesVisit = statusLower === "submitted" || statusLower === "locked";
    const [apptNow] = await sequelize.query(
      `SELECT status FROM appointments WHERE id = :appointmentId`,
      { replacements: { appointmentId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (finishesVisit && apptNow && apptNow.status !== STATUS.PCR_PENDING && apptNow.status !== STATUS.COMPLETED && !clinicalAdmin) {
      await t.rollback();
      return res.status(409).json({ success: false, error: "Complete the session first, then submit the PCR" });
    }
    const completeNow = finishesVisit && apptNow && apptNow.status === STATUS.PCR_PENDING;
    const normalizedStatus = completeNow ? STATUS.COMPLETED : null;

    // 3️⃣ PCR table raw status
    const pcrStatusToSave = data.status ?? existing.status;

    // 4️⃣ Prepare updated data for PCR table
    const updatedData = {
      chief_complaint: data.chiefComplaint ?? existing.chief_complaint,
      assessment: data.assessment ?? existing.assessment,
      diagnosis: data.diagnosis ?? existing.diagnosis,
      treatment_provided: data.treatmentProvided ?? existing.treatment_provided,
      plan_of_care: data.planOfCare ?? existing.plan_of_care,
      bp: data.bp ?? existing.bp,
      hr: data.hr ?? existing.hr,
      rr: data.rr ?? existing.rr,
      temp: data.temp ?? existing.temp,
      status: pcrStatusToSave, // raw PCR status
      locked_by: data.lockedBy ?? existing.locked_by,
      locked_at: data.lockedAt ?? existing.locked_at,
      incident_date: data.incidentDate ?? existing.incident_date,
      incident_location: data.incidentLocation ?? existing.incident_location,
      next_treatment_date: data.nextTreatmentDate ?? existing.next_treatment_date,
      upload_attachment_id: data.upload_attachment_id ?? existing.upload_attachment_id,
      therapist_name: data.therapistName ?? existing.therapist_name,
      signature_confirmation: data.signatureConfirmation ?? existing.signature_confirmation,
      version: (existing.version || 1) + 1,
      history: JSON.stringify([
        ...(existing.history || []),
        {
          version: existing.version,
          chief_complaint: data.chiefComplaint ?? existing.chief_complaint,
          assessment: data.assessment ?? existing.assessment,
          diagnosis: data.diagnosis ?? existing.diagnosis,
          treatment_provided: data.treatmentProvided ?? existing.treatment_provided,
          plan_of_care: data.planOfCare ?? existing.plan_of_care,
          bp: data.bp ?? existing.bp,
          hr: data.hr ?? existing.hr,
          rr: data.rr ?? existing.rr,
          temp: data.temp ?? existing.temp,
          status: pcrStatusToSave,
          locked_by: data.lockedBy ?? existing.locked_by,
          locked_at: data.lockedAt ?? existing.locked_at,
          incident_date: data.incidentDate ?? existing.incident_date,
          incident_location: data.incidentLocation ?? existing.incident_location,
          next_treatment_date: data.nextTreatmentDate ?? existing.next_treatment_date,
          upload_attachment_id: data.upload_attachment_id ?? existing.upload_attachment_id,
          therapist_name: data.therapistName ?? existing.therapist_name,
          signature_confirmation: data.signatureConfirmation ?? existing.signature_confirmation,
          updated_at: new Date(),
        },
      ]),
    };

    // 5️⃣ Update PCR table
    await sequelize.query(
      `UPDATE pcr
       SET
         chief_complaint = :chief_complaint,
         assessment = :assessment,
         diagnosis = :diagnosis,
         treatment_provided = :treatment_provided,
         plan_of_care = :plan_of_care,
         bp = :bp,
         hr = :hr,
         rr = :rr,
         temp = :temp,
         status = :status,
         locked_by = :locked_by,
         locked_at = :locked_at,
         incident_date = :incident_date,
         incident_location = :incident_location,
         next_treatment_date = :next_treatment_date,
         upload_attachment_id = :upload_attachment_id,
         therapist_name = :therapist_name,
         signature_confirmation = :signature_confirmation,
         version = :version,
         history = :history
       WHERE appointment_id = :appointmentId`,
      {
        replacements: { ...updatedData, appointmentId },
        type: QueryTypes.UPDATE,
        transaction: t
      }
    );

    // P15 columns: scores, HEP, baseline, timestamps
    const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
    await sequelize.query(
      `UPDATE pcr SET
         functional_score = COALESCE(:fs, functional_score),
         pain_vas = COALESCE(:pv, pain_vas),
         functional_measure = COALESCE(:fm, functional_measure),
         hep = COALESCE(:hep, hep),
         baseline = COALESCE(:baseline::jsonb, baseline),
         submitted_at = CASE WHEN :isSubmit AND submitted_at IS NULL THEN NOW() ELSE submitted_at END,
         locked_at = CASE WHEN :isLock THEN NOW() WHEN :reopening THEN NULL ELSE locked_at END
       WHERE appointment_id = :appointmentId`,
      {
        replacements: {
          fs: num(data.functionalScore), pv: num(data.painVas), fm: data.functionalMeasure ?? null, hep: data.hep ?? null,
          baseline: data.baseline ? JSON.stringify(data.baseline) : null,
          isSubmit: requestedStatus === "submitted" || requestedStatus === "locked", isLock: requestedStatus === "locked", reopening,
          appointmentId,
        },
        type: QueryTypes.UPDATE,
        transaction: t,
      }
    );

    // P16: session type / plan link, due outcome measures on submit
    const clinical = await clinicalService.onPcrSave({
      t, pcr: existing, userId: req.user.id, data, submitting: requestedStatus === "submitted",
      appointment: { id: appointmentId, therapist_id: owner.therapist_id, patient_id: owner.patient_id },
    });

    // 6️⃣ Update appointments table
    await sequelize.query(
      `UPDATE appointments SET pcr_status = :pcr_status WHERE id = :appointmentId`,
      { replacements: { pcr_status: pcrStatusToSave, appointmentId }, type: QueryTypes.UPDATE, transaction: t }
    );
    if (completeNow) {
      await stateMachine.transition(appointmentId, STATUS.COMPLETED, { system: true }, { transaction: t, note: "PCR submitted" });
      notifications.notify("session_completed_review", {
        patientId: owner.patient_id,
        therapistId: owner.therapist_id,
        therapistName: owner.therapist_name,
        link: "https://curevan.com/dashboard/bookings",
      }).catch(() => {});
    }

    // 7️⃣ Commit transaction
    await t.commit();

    if (clinical.followUp) {
      try { await require("../../services/followUpService").createProposals(clinical.followUp); }
      catch (fuErr) { console.error("follow-up proposals failed:", fuErr.message); }   // the PCR is saved either way; the therapist can re-plan
    }
    if (clinical.reportToMake) {
      try {
        await clinicalService.createReport(clinical.reportToMake);
        notifications.notify("progress_report_ready", {
          patientId: owner.patient_id,
          therapistId: owner.therapist_id,
          therapistName: owner.therapist_name,
          link: "https://curevan.com/dashboard/patient/progress",
        }).catch(() => {});
      }
      catch (reportErr) { console.error("progress report failed:", reportErr.message); }
    }

    let payoutInfo;   // set when this save locked the PCR
    // P15: access log, and on lock the content hash + the PDF summary
    const logAction = requestedStatus === "locked" ? "lock" : requestedStatus === "submitted" ? "submit" : reopening ? (requestedStatus === "returned" ? "return" : "unlock") : "edit";
    await pcrService.logAccess(existing.id, req.user.id, logAction, reopening ? String(data.reason).trim() : null);
    if (requestedStatus === "locked") {
      try {
        const [fresh] = await sequelize.query(`SELECT * FROM pcr WHERE id = :id`, { replacements: { id: existing.id }, type: QueryTypes.SELECT });
        const [appt] = await sequelize.query(`SELECT patient_name, therapist_name, date FROM appointments WHERE id = :id`, { replacements: { id: appointmentId }, type: QueryTypes.SELECT });
        const [therapist] = await sequelize.query(`SELECT u.name, tp.registration_no FROM users u LEFT JOIN therapist_profiles tp ON tp.user_id = u.id WHERE u.id = :id`, { replacements: { id: owner.therapist_id }, type: QueryTypes.SELECT });
        const pdfPath = await generatePcrPdf({ pcr: fresh, appointment: appt, therapist });
        await sequelize.query(`UPDATE pcr SET content_hash = :hash, pdf_path = :pdf WHERE id = :id`, { replacements: { hash: pcrService.contentHash(fresh), pdf: pdfPath, id: existing.id }, type: QueryTypes.UPDATE });
        notifications.notify("pcr_pdf_ready", { patientId: owner.patient_id, therapistId: owner.therapist_id, sessionNumber: fresh.session_number, date: appt.date instanceof Date ? appt.date.toISOString().slice(0, 10) : appt.date, link: "https://curevan.com/dashboard/patient/health-records" }).catch((e) => console.error("pcr_pdf_ready notify failed:", e.message));
      } catch (pdfErr) {
        console.error("PCR lock: hash/PDF failed:", pdfErr.message);   // the lock itself stands; the PDF can be regenerated on download
      }
      // P18: a locked PCR makes the session payable (payment, start code and lock are all checked there)
      try { const made = await payoutService.createItemForAppointment(appointmentId); payoutInfo = { created: made.created !== false, reason: made.created === false ? "A payout line already exists for this booking" : undefined }; }
      catch (payErr) {
        if (payErr instanceof payoutService.PayoutError) payoutInfo = { created: false, reason: payErr.message };
        else console.error("payout line failed:", payErr.message);
      }
    }

    // 8️⃣ Send Status Update Email (if status changed)
    try {
      if (normalizedStatus) {
        const [apptInfo] = await sequelize.query(
          `SELECT u.email, u.name as user_name 
           FROM appointments a 
           JOIN users u ON u.id = a.patient_id 
           WHERE a.id = :appointmentId`,
          { replacements: { appointmentId }, type: QueryTypes.SELECT }
        );

        if (apptInfo?.email) {
          await transporter.sendMail({
            from: `"Curevan Support" <${process.env.MAIL_USER}>`,
            to: apptInfo.email,
            subject: `Your session is complete`,
            html: `
              <h3>Appointment Update</h3>
              <p>Hi ${apptInfo.user_name},</p>
              <p>Your session is now <strong>completed</strong>.</p>
              <p>Sign in to your dashboard to view more details.</p>
            `
          });
        }
      }
    } catch (mailErr) {
      console.error("Failed to send appt status update email:", mailErr);
    }

    return res.status(200).json({ success: true, message: "PCR updated successfully", payout: payoutInfo });

  } catch (error) {
    await t.rollback();
    if (error instanceof clinicalService.ClinicalError) return res.status(error.httpStatus).json({ success: false, error: error.message, ...error.extra });
    if (error instanceof stateMachine.TransitionError) return res.status(error.httpStatus).json({ success: false, error: error.message });
    console.error("Error updating PCR:", error);
    return res.status(500).json({ success: false, error: "Failed to update PCR" });
  }
};

// ==========================================
// SERVICE-FIRST BOOKING FLOW
// ==========================================

// ✅ 1. CREATE BOOKING REQUEST (Status = Searching)
exports.createBookingRequest = async (req, res) => {
  const { bookingData } = req.body || {};

  try {
    if (!bookingData) {
      return res.status(400).json({ success: false, error: "Booking data required" });
    }

    // patients request for themselves; the price comes from the service type (set by the server),
    // otherwise it is fixed from the accepting therapist's rate when someone accepts.
    bookingData.patientId = access.isAdmin(req.user) && bookingData.patientId ? bookingData.patientId : req.user.id;
    const windowProblem = slotService.checkWindowRules(bookingData.date, slotService.toMinutes(bookingData.time));
    if (windowProblem) return res.status(400).json({ success: false, error: windowProblem });
    const [serviceType] = await sequelize.query(
      `SELECT base_price FROM service_types WHERE id = :id`,
      { replacements: { id: bookingData.serviceTypeId || 0 }, type: QueryTypes.SELECT }
    );
    const basePrice = serviceType && Number(serviceType.base_price) > 0 ? Number(serviceType.base_price) : 0;

    const [rows] = await sequelize.query(
      `INSERT INTO appointments (
        patient_id, patient_name, date_of_birth, service_type_id, therapy_type,
        service_amount, total_amount, date, time, mode, notes, service_address_id,
        status, verification_status, payment_status, pcr_status, reports, price_source, created_at
      ) VALUES (
        :patientId, :patientName, :dateofbirth, :serviceTypeId, :therapyType,
        :serviceAmount, :totalAmount, :date, :time, :mode, :notes, :serviceAddress,
        'searching_therapist', 'Not Verified', 'Pending', 'not_started', :reports, :priceSource, NOW()
      ) RETURNING id`,
      {
        replacements: {
          patientId: bookingData.patientId,
          patientName: bookingData.patientName,
          dateofbirth: bookingData.dateofBirth || null,
          serviceTypeId: bookingData.serviceTypeId,
          therapyType: bookingData.therapyType,
          serviceAmount: basePrice,
          totalAmount: basePrice,
          priceSource: basePrice > 0 ? "service_type" : "pending_match",
          date: bookingData.date,
          time: bookingData.time,
          mode: bookingData.mode,
          notes: bookingData.notes || null,
          serviceAddress: bookingData.addressId || null,
          reports: bookingData.reports ? JSON.stringify(bookingData.reports) : null,
        },
        type: QueryTypes.INSERT,
      }
    );
    const appointmentId = rows[0]?.id;

    try {
      // Fetch FCM tokens of ACTIVE therapists with matching specialty who are FREE at this date & time
      
      // --- Send Pending Email to Patient ---
      const [patientUser] = await sequelize.query(
        `SELECT email, name FROM users WHERE id = :patientId`,
        { replacements: { patientId: bookingData.patientId }, type: QueryTypes.SELECT }
      );
      if (patientUser && patientUser.email) {
        try {
          await transporter.sendMail({
            from: `"Curevan Appointments" <${process.env.MAIL_USER}>`,
            to: patientUser.email,
            subject: "Appointment Request Received (Pending)",
            html: `
              <h3>Appointment Request Pending</h3>
              <p>Hi ${patientUser.user_name || bookingData.patientName},</p>
              <p>Your request for a ${bookingData.therapyType} session on ${bookingData.date} at ${bookingData.time} has been received.</p>
              <p>Please wait for a therapist to accept your request. We will notify you once accepted.</p>
              <p>Thank you.</p>
            `
          });
        } catch (e) {
          console.error("Failed to send pending email", e);
        }
      }
      // -------------------------------------

      const tokensQuery = await sequelize.query(

        `SELECT u.fcm_token 
         FROM users u
         JOIN therapist_profiles tp ON tp.user_id = u.id
         WHERE u.role = 'therapist' 
           AND u.status = 'active'
           AND tp.profile_status = 'approved'
           AND u.fcm_token IS NOT NULL 
           AND :serviceTypeId::int = ANY(tp.specialty)
           AND NOT EXISTS (
          SELECT 1 FROM therapist_leaves tl
          JOIN therapist_profiles tp_tl ON tl.therapist_id = tp_tl.id
          WHERE tp_tl.user_id = u.id
            AND :bookingDate >= tl.start_date AND :bookingDate <= tl.end_date
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointments a2
             WHERE a2.therapist_id = u.id
               AND a2.date = :bookingDate
               AND a2.time = :bookingTime
               AND a2.status NOT IN ('completed', 'cancelled_by_patient', 'cancelled_by_therapist', 'cancelled_by_admin', 'cancelled_unpaid', 'no_show')
           )`,
        {
          replacements: { 
            serviceTypeId: bookingData.serviceTypeId,
            bookingDate: bookingData.date,
            bookingTime: bookingData.time
          },
          type: QueryTypes.SELECT
        }
      );
      const tokens = tokensQuery.map(row => row.fcm_token).filter(Boolean);

      if (tokens.length > 0) {
        await firebaseNotifier.sendToMultipleTherapists(
          tokens,
          "New Booking Request Available",
          `A new request for ${bookingData.therapyType} on ${bookingData.date} is available. Accept it before someone else does!`,
          { appointmentId: String(appointmentId), type: "service_first_booking" }
        );
      }
    } catch (fcmErr) {
      console.error("Failed to send service-first FCM notification:", fcmErr);
    }

    return res.json({ success: true, appointmentId, message: "Booking requested. Searching for therapists." });
  } catch (error) {
    if (slotService.isSlotConflict(error)) return res.status(409).json({ success: false, error: "Slot no longer available" });
    console.error("Error creating booking request:", error);
    return res.status(500).json({ success: false, error: "Failed to create booking request" });
  }
};

// ✅ 2. GET AVAILABLE REQUESTS (Matchmaking Logic)
exports.getAvailableRequests = async (req, res) => {
  try {
    // a therapist always sees the matches for themself; only an admin may ask for someone else
    const therapistId = access.isAdmin(req.user) ? req.query.therapistId : req.user.id;

    let query = `
       SELECT 
         a.id, a.patient_name AS "patientName", a.therapy_type AS "therapyType",
         a.date, a.time, a.mode, a.status, a.service_amount AS "serviceAmount",
         a.notes, a.created_at AS "createdAt", a.service_address_id AS "serviceAddress"
       FROM appointments a
       WHERE (a.status = 'searching_therapist' AND (a.therapist_id IS NULL OR a.therapist_id = :therapistId))
    `;

    if (therapistId) {
      query += `
        AND EXISTS (
          SELECT 1 FROM therapist_profiles tp
          WHERE tp.user_id = :therapistId
            AND a.service_type_id::int = ANY(tp.specialty)
        )
        AND NOT EXISTS (
          SELECT 1 FROM appointments a2
          WHERE a2.therapist_id = :therapistId
            AND a2.date = a.date 
            AND a2.time = a.time
            AND a2.status NOT IN ('completed', 'cancelled_by_patient', 'cancelled_by_therapist', 'cancelled_by_admin', 'cancelled_unpaid', 'no_show')
        )
      `;
    }

    query += ` ORDER BY a.created_at DESC`;

    const requests = await sequelize.query(query, {
      replacements: { therapistId },
      type: QueryTypes.SELECT
    });

    return res.success(requests, "Available requests fetched");
  } catch (error) {
    console.error("Error fetching available requests:", error);
    return res.error("Failed to fetch available requests");
  }
};

// ✅ 3. ACCEPT BOOKING REQUEST
exports.acceptBookingRequest = async (req, res) => {
  const { id } = req.params;
  // The accepting therapist is always the logged-in user (name/phone are read from the server).
  const therapistId = req.user.id;

  const t = await sequelize.transaction();

  try {
    const [appt] = await sequelize.query(
      `SELECT status, patient_id, patient_name, service_type_id, therapist_id, date, to_char(date, 'YYYY-MM-DD') AS date_ymd, time, price_source, service_amount
       FROM appointments WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction: t }
    );

    if (!appt) {
      await t.rollback();
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }

    // a booking addressed to a specific therapist can only be accepted by that therapist
    if (appt.therapist_id && !access.same(appt.therapist_id, therapistId)) {
      await t.rollback();
      return res.status(403).json({ success: false, error: "This booking is assigned to another therapist" });
    }

    const isAvailable = appt.status === STATUS.SEARCHING;

    if (!isAvailable) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "Appointment already accepted or cancelled" });
    }

    // the accepting therapist must really be free then (working hours, leave, no other booking)
    await slotService.assertSlotBookable(therapistId, appt.date_ymd, appt.time, { transaction: t, skipLead: true, ignoreAppointmentId: id });

    const [therapist] = await sequelize.query(
      `SELECT u.name, u.phone, tp.hourly_rate
       FROM users u LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
       WHERE u.id = :therapistId`,
      { replacements: { therapistId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!therapist) {
      await t.rollback();
      return res.status(403).json({ success: false, error: "Therapist profile not found" });
    }

    // Price: service-type price if configured, otherwise the accepting therapist's rate.
    let amount = Number(appt.service_amount) || 0;
    let priceSource = appt.price_source;
    if (priceSource !== "service_type" || !(amount > 0)) {
      amount = Number(therapist.hourly_rate) || 0;
      priceSource = "therapist_rate";
    }
    if (!(amount > 0)) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "Set your session rate in your profile before accepting requests" });
    }

    await sequelize.query(
      `UPDATE appointments
       SET therapist_id = :therapistId,
           therapist_name = :therapistName,
           therapist_phone = :therapistPhone,
           service_amount = :amount,
           total_amount = :amount,
           price_source = :priceSource
       WHERE id = :id`,
      {
        replacements: { id, therapistId, therapistName: therapist.name, therapistPhone: therapist.phone || null, amount, priceSource },
        type: QueryTypes.UPDATE,
        transaction: t
      }
    );

    await stateMachine.transition(id, STATUS.ACCEPTED_UNPAID, { id: therapistId, role: 'therapist', roles: ['therapist'] }, { transaction: t, note: 'accepted by therapist' });

    await t.commit();

    // Tell the patient to pay. (Invoice and PCR are created only after the payment is verified.)
    try {
      const [patient] = await sequelize.query(
        `SELECT email, name, fcm_token, id FROM users WHERE id = :id`,
        { replacements: { id: appt.patient_id }, type: QueryTypes.SELECT }
      );
      const link = `${process.env.FRONTEND_URL || ""}/dashboard/bookings`;
      if (patient) {
        await notificationStore.notify(patient.id, {
          type: "payment_required",
          title: "Therapist found",
          message: "Therapist found - please pay to confirm your session.",
          link: "/dashboard/bookings",
          data: { appointmentId: id },
        });
        if (patient.email) {
          await transporter.sendMail({
            from: `"Curevan Appointments" <${process.env.MAIL_FROM || process.env.MAIL_USER}>`,
            to: patient.email,
            subject: "Therapist found - please pay to confirm",
            html: `<p>Hi ${patient.name || ""},</p><p>${therapist.name} accepted your request for ${appt.date} at ${appt.time}.</p><p>Please pay to confirm your session: <a href="${link}">Pay now</a></p>`,
          });
        }
      }
    } catch (notifyErr) {
      console.error("Failed to notify patient of acceptance:", notifyErr.message);
    }

    return res.json({ success: true, message: "Booking accepted successfully" });
  } catch (error) {
    await t.rollback();
    if (error instanceof slotService.SlotError) return res.status(error.httpStatus === 400 ? 409 : error.httpStatus).json({ success: false, error: error.httpStatus === 400 ? `You cannot take this request: ${error.message}` : error.message });
    if (slotService.isSlotConflict(error)) return res.status(409).json({ success: false, error: "Slot no longer available" });
    console.error("Error accepting booking:", error);
    return res.status(500).json({ success: false, error: "Failed to accept booking" });
  }
};

// ✅ 3b. REJECT BOOKING REQUEST
exports.rejectBookingRequest = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const [appt] = await sequelize.query(
      `SELECT status, therapist_id, patient_id, date FROM appointments WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!appt) {
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }

    if (appt.status !== STATUS.SEARCHING || appt.therapist_id != userId) {
      return res.status(400).json({ success: false, error: "Invalid appointment or unauthorized" });
    }

    await stateMachine.transition(id, STATUS.CANCELLED_THERAPIST, req.user, { note: 'request declined by therapist' });

    return res.json({ success: true, message: "Booking request declined" });
  } catch (error) {
    console.error("Error rejecting booking:", error);
    return res.status(500).json({ success: false, error: "Failed to reject booking" });
  }
};

// ✅ Cancellation (policy engine, P14)
/* Who is cancelling decides the money (see services/cancellationService.js and businessRules.cancellation):
     patient    free >= 12 h before, 50% charge 12 h-2 h, 100% under 2 h, free in the first 10 minutes after booking,
                free when the therapist is more than 30 minutes late
     therapist  patient gets everything back and a reliability event is recorded (a reason is required)
     admin      patient gets everything back (a reason is required)
   The refund goes back through Razorpay first; if Razorpay refuses, nothing is cancelled. */
const CANCEL_COLUMNS = `id, status, therapist_id, patient_id, patient_name, therapist_name, date, time, start_time, created_at,
              service_amount, total_amount, payment_status, razorpay_payment_id, payment_method`;

function cancelRole(user, appt) {
  if (access.isClinicalAdmin(user)) return "admin";
  if (appt.therapist_id && access.same(appt.therapist_id, user.id)) return "therapist";
  if (access.same(appt.patient_id, user.id)) return "patient";
  return null;
}

// GET /api/appointments/:id/cancel-quote  - what it would cost to cancel right now
exports.getCancelQuote = async (req, res) => {
  try {
    const [appt] = await sequelize.query(`SELECT ${CANCEL_COLUMNS} FROM appointments WHERE id = :id`, { replacements: { id: req.params.id }, type: QueryTypes.SELECT });
    if (!appt) return res.status(404).json({ success: false, error: "Appointment not found" });
    const role = cancelRole(req.user, appt);
    if (!role) return res.status(403).json({ success: false, error: "Forbidden" });
    if (stateMachine.TERMINAL.includes(appt.status) || appt.status === STATUS.PCR_PENDING) {
      return res.status(409).json({ success: false, error: "This booking can no longer be cancelled" });
    }
    const q = cancellationService.quote(appt, role);
    return res.json({ success: true, data: { ...q, role, bookingId: appt.id, policy: rules.cancellation } });
  } catch (error) {
    console.error("Error quoting cancellation:", error.message);
    return res.status(500).json({ success: false, error: "Could not work out the cancellation charge" });
  }
};

exports.cancelAppointment = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const reason = String((req.body || {}).reason || "").trim().slice(0, 500);
  const contactSupport = () => res.status(400).json({ success: false, error: "Please contact support", message: "Please contact support" });

  try {
    const [appt] = await sequelize.query(`SELECT ${CANCEL_COLUMNS} FROM appointments WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
    if (!appt) {
      return res.status(404).json({ success: false, error: "Appointment not found", message: "Appointment not found" });
    }

    const role = cancelRole(req.user, appt);
    if (!role) {
      return res.status(403).json({ success: false, error: "Unauthorized to cancel this appointment", message: "Forbidden" });
    }
    if (stateMachine.TERMINAL.includes(appt.status) || appt.status === STATUS.PCR_PENDING) {
      return res.status(400).json({ success: false, error: "Appointment cannot be cancelled at this stage", message: "Appointment cannot be cancelled at this stage" });
    }
    if (role !== "patient" && reason.length < 3) {
      return res.status(400).json({ success: false, error: "Please give a reason for the cancellation", message: "Please give a reason for the cancellation" });
    }

    const q = cancellationService.quote(appt, role);

    // the patient confirmed a specific charge: if the clock moved it, show the new number instead of charging a different one
    const accepted = (req.body || {}).acceptedChargeInr;
    if (role === "patient" && accepted !== undefined && accepted !== null && Number(accepted) !== q.chargeInr) {
      return res.status(409).json({ success: false, error: "The cancellation charge has changed. Please check the new amount.", message: "The cancellation charge has changed", quote: q });
    }

    // refund first; if Razorpay refuses (or there is no online payment to refund) nothing is cancelled
    let refund = null;
    if (q.refundInr > 0) {
      try {
        refund = await refundService.refund({
          appointmentId: appt.id,
          amountInr: q.refundInr,
          reason: role === "patient" ? `Cancelled by patient (${q.band})` : `Cancelled by ${role}${reason ? ": " + reason : ""}`,
          actorId: userId,
        });
      } catch (err) {
        if (err instanceof refundService.RefundError) return contactSupport();
        throw err;
      }
    }

    const target = { patient: STATUS.CANCELLED_PATIENT, therapist: STATUS.CANCELLED_THERAPIST, admin: STATUS.CANCELLED_ADMIN }[role];
    const t = await sequelize.transaction();
    try {
      await stateMachine.transition(id, target, req.user, { transaction: t, note: reason || `Cancelled by ${role} (${q.band})` });
      await cancellationService.recordOutcome(appt, q, { actorId: userId, reason: reason || null, transaction: t });
      if (role === "therapist") await cancellationService.reliabilityEvent(appt.therapist_id, appt.id, "cancelled_by_therapist", t);
      await t.commit();
      if (q.chargeInr > 0) await payoutService.createItemForCancellation(appt.id).catch((e) => console.error("cancellation payout failed:", e.message));
    } catch (err) {
      await t.rollback();
      throw err;
    }

    // tell the other side (and the therapy team when a therapist drops out)
    const who = { patient: appt.patient_name || "The patient", therapist: appt.therapist_name || "The therapist", admin: "Curevan support" }[role];
    const dateText = appt.date instanceof Date ? appt.date.toISOString().slice(0, 10) : appt.date;
    await notifications.notify("booking_cancelled", {
      appointmentId: appt.id, patientId: appt.patient_id, therapistId: appt.therapist_id, date: dateText, time: appt.time,
      reason: role === "patient" ? undefined : reason, cancelledBy: role, cancelledByName: who, refundInr: q.refundInr, link: "https://curevan.com/dashboard/bookings",
    }).catch((e) => console.error("booking_cancelled notify failed:", e.message));
    if (role === "therapist") {
      await notificationStore.notifyRoles(["admin.therapy"], {
        type: "therapist_cancelled",
        title: "Therapist cancelled a booking",
        message: `${appt.therapist_name || "A therapist"} cancelled booking #${appt.id}: ${reason}`,
        link: "/dashboard/admin/appointments",
        data: { appointmentId: appt.id },
      }).catch((e) => console.error("admin alert failed:", e.message));
    }

    return res.json({
      success: true,
      message: "Appointment Cancelled",
      quote: q,
      refund: refund ? { refundId: refund.refundId, status: refund.status, amount: refund.amount } : undefined,
    });
  } catch (error) {
    if (error instanceof stateMachine.TransitionError) return res.status(error.httpStatus).json({ success: false, error: error.message, message: error.message });
    console.error("Error cancelling appointment:", error);
    return res.status(500).json({ success: false, error: "Failed to cancel appointment", message: "Failed to cancel appointment" });
  }
};

// ✅ 4. UPDATE APPOINTMENT STATUS (Tracking Flow)
/* A no-show is charged like a very late cancellation (businessRules.cancellation.lateChargePct);
   whatever is not charged goes back to the patient. A paid booking with a failed refund is left for support. */
async function settleNoShow(id, user) {
  const [appt] = await sequelize.query(`SELECT ${CANCEL_COLUMNS} FROM appointments WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
  if (!appt) return undefined;
  const q = cancellationService.quote(appt, "patient", Date.now(), { noShow: true });
  let refund = null;
  if (q.refundInr > 0) {
    try {
      refund = await refundService.refund({ appointmentId: appt.id, amountInr: q.refundInr, reason: "No-show settlement", actorId: user.id });
    } catch (err) {
      if (!(err instanceof refundService.RefundError)) throw err;
      console.error("no-show refund failed:", err.message);
    }
  }
  await cancellationService.recordOutcome(appt, q, { actorId: user.id, reason: "No-show" });
  if (q.chargeInr > 0) await payoutService.createItemForCancellation(appt.id).catch((e) => console.error("no-show payout failed:", e.message));
  return { band: q.band, chargeInr: q.chargeInr, refundInr: q.refundInr, refundStarted: !!refund };
}

exports.updateAppointmentStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ success: false, error: "status is required" });

  try {
    const [appt] = await sequelize.query(
      `SELECT patient_id, therapist_id FROM appointments WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!appt) return res.status(404).json({ success: false, error: "Appointment not found" });
    if (!access.canAccessAppointment(req.user, appt)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    if (String(stateMachine.normalize(status)).startsWith("cancelled")) {
      return res.status(400).json({ success: false, error: "Use the cancel option so the refund rules are applied" });
    }
    // the state machine decides who may do what; arrived -> in_progress is only possible through the OTP check
    const result = await stateMachine.transition(id, status, req.user);
    if (result.to === STATUS.ON_THE_WAY) {
      notifications.notify("therapist_on_the_way", {
        patientId: appt.patient_id,
        therapistId: appt.therapist_id,
        patientName: appt.patient_name,
        therapistName: appt.therapist_name,
        time: appt.time,
      }).catch(() => {});
    }
    let settlement;
    if (result.to === STATUS.NO_SHOW) settlement = await settleNoShow(id, req.user);
    return res.json({ success: true, message: `Status updated to ${result.to}`, status: result.to, settlement });
  } catch (error) {
    if (error instanceof stateMachine.TransitionError) {
      return res.status(error.httpStatus).json({ success: false, error: error.message });
    }
    console.error("Error updating status:", error);
    return res.status(500).json({ success: false, error: "Failed to update status" });
  }
};

// ✅ START-OF-SESSION OTP
/* Patient only, from `otp.validFromHoursBefore` before the slot until the slot ends.
   A fresh code is made on every request (the old one stops working); only its hash is stored. */
exports.getStartOtp = async (req, res) => {
  const { id } = req.params;
  try {
    const [appt] = await sequelize.query(
      `SELECT id, status, patient_id, therapist_id, date, time, start_time FROM appointments WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!appt) return res.status(404).json({ success: false, error: "Appointment not found" });
    if (!access.same(appt.patient_id, req.user.id)) return res.status(403).json({ success: false, error: "Forbidden" });
    if (![STATUS.CONFIRMED, STATUS.ON_THE_WAY, STATUS.ARRIVED].includes(appt.status)) {
      return res.status(409).json({ success: false, error: "A start code is not available for this booking" });
    }
    const start = access.slotStart(appt);
    const now = Date.now();
    const opensAt = start ? start.getTime() - rules.otp.validFromHoursBefore * 3600000 : null;
    const endsAt = start ? start.getTime() + rules.session.slotMinutes * 60000 : null;
    if (start && (now < opensAt || now > endsAt)) {
      return res.status(403).json({ success: false, error: `The start code is available from ${rules.otp.validFromHoursBefore} hours before your session` });
    }
    const { otp, hash } = otpService.issue(appt.id);
    await sequelize.query(`UPDATE appointments SET start_otp_hash = :hash WHERE id = :id`, { replacements: { hash, id }, type: QueryTypes.UPDATE });
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: { otp } });
  } catch (error) {
    console.error("Error issuing start code:", error.message);
    return res.status(500).json({ success: false, error: "Failed to get the start code" });
  }
};

// ✅ VERIFY START OTP (assigned therapist, status must be "arrived")
exports.verifyStartOtp = async (req, res) => {
  const { id } = req.params;
  const otp = String((req.body || {}).otp ?? "");
  const t = await sequelize.transaction();
  try {
    const [appt] = await sequelize.query(
      `SELECT id, status, patient_id, therapist_id, start_otp_hash, COALESCE(otp_attempts, 0) AS otp_attempts
       FROM appointments WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!appt) { await t.rollback(); return res.status(404).json({ success: false, error: "Appointment not found" }); }
    if (!access.same(appt.therapist_id, req.user.id)) { await t.rollback(); return res.status(403).json({ success: false, error: "Forbidden" }); }
    if (appt.status !== STATUS.ARRIVED) {
      await t.rollback();
      return res.status(409).json({ success: false, error: "You can start the session only after you have arrived" });
    }
    if (appt.otp_attempts >= rules.otp.maxAttempts) {
      await t.rollback();
      return res.status(423).json({ success: false, error: "Too many wrong codes. This booking is locked - support has been told." });
    }

    if (!otpService.matches(appt.id, otp, appt.start_otp_hash)) {
      const attempts = appt.otp_attempts + 1;
      await sequelize.query(`UPDATE appointments SET otp_attempts = :attempts WHERE id = :id`, { replacements: { attempts, id }, type: QueryTypes.UPDATE, transaction: t });
      await t.commit();
      if (attempts >= rules.otp.maxAttempts) {
        await notificationStore.notifyRoles(["admin.super", "admin.therapy"], {
          type: "otp_locked",
          title: "Start code locked",
          message: `Booking #${appt.id}: the therapist entered ${rules.otp.maxAttempts} wrong start codes. The booking is locked.`,
          link: "/dashboard/admin/appointments",
          data: { appointmentId: appt.id },
        }).catch((e) => console.error("otp lock alert failed:", e.message));
        return res.status(423).json({ success: false, error: "Too many wrong codes. This booking is locked - support has been told." });
      }
      return res.status(400).json({ success: false, error: "Wrong code", attemptsLeft: rules.otp.maxAttempts - attempts });
    }

    await stateMachine.transition(appt.id, STATUS.IN_PROGRESS, { system: true }, { transaction: t, note: "start code verified", extra: { otp_verified_at: new Date(), start_otp_hash: null } });
    await t.commit();
    return res.json({ success: true, message: "Session started" });
  } catch (error) {
    await t.rollback().catch(() => {});
    if (error instanceof stateMachine.TransitionError) return res.status(error.httpStatus).json({ success: false, error: error.message });
    console.error("Error verifying start code:", error.message);
    return res.status(500).json({ success: false, error: "Failed to verify the code" });
  }
};

// ✅ ADD REVIEW
exports.addReview = async (req, res) => {
  const { id } = req.params;
  const { rating, review } = req.body || {};

  try {
    const [appt] = await sequelize.query(
      `SELECT status, patient_id, therapist_id FROM appointments WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!appt) {
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }
    
    if (!access.same(appt.patient_id, req.user.id)) {
      return res.status(403).json({ success: false, error: "Only the patient of this booking can review it" });
    }

    if (appt.status !== STATUS.COMPLETED) {
      return res.status(400).json({ success: false, error: "You can only review completed sessions" });
    }

    // Check if review already exists for this appointment
    const [existing] = await sequelize.query(
      `SELECT id FROM therapist_reviews WHERE appointment_id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (existing) {
      // Update existing review
      await sequelize.query(
        `UPDATE therapist_reviews 
         SET rating = :rating, review = :review
         WHERE appointment_id = :id`,
        {
          replacements: { id, rating: Number(rating), review },
          type: QueryTypes.UPDATE
        }
      );
    } else {
      // Insert new review
      await sequelize.query(
        `INSERT INTO therapist_reviews (therapist_id, patient_id, appointment_id, rating, review)
         VALUES (:therapistId, :patientId, :id, :rating, :review)`,
        {
          replacements: { 
            therapistId: appt.therapist_id, 
            patientId: appt.patient_id, 
            id, 
            rating: Number(rating), 
            review 
          },
          type: QueryTypes.INSERT
        }
      );
    }

    return res.json({ success: true, message: "Review submitted successfully" });
  } catch (error) {
    console.error("Error submitting review:", error);
    return res.status(500).json({ success: false, error: "Failed to submit review" });
  }
};

// ✅ CONFIRM PAYMENT & THERAPIST PAYOUT
/* Admin-only: record an OFFLINE payment (cash / UPI / bank transfer) collected by staff.
   Online payments never come through here - they are confirmed by /api/payments/verify-booking. */
exports.confirmPayment = async (req, res) => {
  const { id } = req.params;
  const { paymentId, gateway } = req.body || {};
  try {
    if (!access.isAdmin(req.user)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    if (!/^manual_/.test(String(gateway || ""))) {
      return res.status(400).json({ success: false, error: "Only manual (offline) payments can be recorded here" });
    }
    const [appt] = await sequelize.query(
      `SELECT status, payment_status FROM appointments WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!appt) {
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }

    await sequelize.query(
      `UPDATE appointments SET payment_status = 'Paid', paid_at = NOW(), payment_method = :method WHERE id = :id`,
      { replacements: { id, method: gateway }, type: QueryTypes.UPDATE }
    );
    if ([STATUS.PENDING_PAYMENT, STATUS.ACCEPTED_UNPAID, STATUS.PROPOSED].includes(appt.status)) {
      await stateMachine.transition(id, STATUS.CONFIRMED, { system: true }, { note: "offline payment recorded by admin" });
    }

    await sequelize.query(
      `UPDATE payout_items SET state = 'paid' WHERE source_id = :id`,
      { replacements: { id: Number(id) }, type: QueryTypes.UPDATE }
    ).catch((err) => console.log('payout_items update warning:', err.message));

    return res.json({ success: true, message: "Payment confirmed and recorded successfully" });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Payment confirmation failed" });
  }
};

/* Periodic clean-up of bookings nobody paid for (called from cron.js every 10 minutes):
   - direct bookings unpaid for 30 minutes
   - accepted requests still unpaid 2 hours before the slot                          */
exports.cancelUnpaidAppointments = async () => {
  let cancelled = 0;
  const direct = await sequelize.query(
    `SELECT id FROM appointments
     WHERE status = 'pending_payment' AND payment_status = 'Pending'
       AND razorpay_order_id IS NOT NULL AND price_source = 'therapist_rate'
       AND created_at < NOW() - interval '30 minutes'`,
    { type: QueryTypes.SELECT }
  );
  for (const d of direct) {
    try { await stateMachine.transition(d.id, STATUS.CANCELLED_UNPAID, { system: true }, { note: "not paid within 30 minutes" }); cancelled += 1; }
    catch (e) { if (!(e instanceof stateMachine.TransitionError)) throw e; }
  }

  const accepted = await sequelize.query(
    `SELECT id, date, time, start_time FROM appointments
     WHERE status = 'accepted_unpaid' AND payment_status = 'Pending'`,
    { type: QueryTypes.SELECT }
  );
  for (const a of accepted) {
    const start = access.slotStart(a);
    if (start && start.getTime() - 2 * 3600 * 1000 <= Date.now()) {
      try { await stateMachine.transition(a.id, STATUS.CANCELLED_UNPAID, { system: true }, { note: "not paid 2 hours before the slot" }); cancelled += 1; }
      catch (e) { if (!(e instanceof stateMachine.TransitionError)) throw e; }
    }
  }
  return cancelled;
};


// ? Reschedule Appointment
exports.rescheduleAppointment = async (req, res) => {
    const { id } = req.params;
    const { date, time } = req.body;
    const userId = req.user.id;
  
    try {
      const [appt] = await sequelize.query(
        `SELECT status, patient_id, therapist_id FROM appointments WHERE id = :id`,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
  
      if (!appt) {
        return res.status(404).json({ success: false, error: "Appointment not found" });
      }
  
      const userRole = req.user.role;
      const isAdmin = ['superadmin', 'admin', 'super_admin', 'therapyAdmin'].includes(userRole);
      const isAssignedTherapist = (appt.therapist_id == userId);
      const isPatient = (appt.patient_id == userId);
        const isTherapist = (userRole === 'therapist');

        if (!isAdmin && !isAssignedTherapist && !isPatient && !isTherapist) {
        return res.status(403).json({ success: false, error: "Unauthorized to reschedule this appointment" });
      }
  
      if (stateMachine.TERMINAL.includes(appt.status) || appt.status === STATUS.PCR_PENDING) {
        return res.status(400).json({ success: false, error: "Cannot reschedule at this stage" });
      }
  
      // Update the appointment
      await sequelize.query(
        `UPDATE appointments SET date = :date, time = :time WHERE id = :id`,
        { replacements: { id, date, time }, type: QueryTypes.UPDATE }
      );
      
      // Fetch users for notifications
      const [patient] = await sequelize.query(`SELECT email, name, fcm_token FROM users WHERE id = :patientId`, { replacements: { patientId: appt.patient_id }, type: QueryTypes.SELECT });
      
      let therapist = null;
      if (appt.therapist_id) {
          const [t] = await sequelize.query(`SELECT email, name, fcm_token FROM users WHERE id = :therapistId`, { replacements: { therapistId: appt.therapist_id }, type: QueryTypes.SELECT });
          therapist = t;
      }
      
      const admins = await sequelize.query(`SELECT email, fcm_token FROM users WHERE role IN ('super_admin', 'admin', 'superadmin', 'therapyAdmin')`, { type: QueryTypes.SELECT });
      
      const mailSender = process.env.MAIL_USER ? `"Curevan Appointments" <${process.env.MAIL_USER}>` : '"Curevan Appointments" <noreply@curevan.com>';

      // Emails
      if (patient && patient.email) {
          transporter.sendMail({
              from: mailSender,
              to: patient.email,
              subject: "Your Appointment is Rescheduled",
              html: `<p>Hi ${patient.name || 'Patient'},</p><p>Your appointment has been successfully rescheduled to ${date} at ${time}.</p>`
          }).catch(e => console.error("Patient email error:", e));
      }
      
      if (therapist && therapist.email) {
          transporter.sendMail({
              from: mailSender,
              to: therapist.email,
              subject: "Appointment Rescheduled",
              html: `<p>Hi ${therapist.name || 'Therapist'},</p><p>An appointment previously assigned to you has been rescheduled by the patient to ${date} at ${time}. You have been unassigned from this session.</p>`
          }).catch(e => console.error("Therapist email error:", e));
      }
      
      for (const admin of admins) {
          if (admin.email) {
              transporter.sendMail({
                  from: mailSender,
                  to: admin.email,
                  subject: "System Alert: Appointment Rescheduled",
                  html: `<p>Hi Admin,</p><p>Appointment ID ${id} has been rescheduled to ${date} at ${time}. The status is now 'Searching Therapist'.</p>`
              }).catch(e => console.error("Admin email error:", e));
          }
      }
      
      // Notifications
      if (patient && patient.fcm_token) {
          firebaseNotifier.sendToTherapist(patient.fcm_token, "Appointment Rescheduled", `Your appointment is now on ${date} at ${time}`).catch(e => {});
      }
      
      if (therapist && therapist.fcm_token) {
          firebaseNotifier.sendToTherapist(therapist.fcm_token, "Appointment Rescheduled", `An appointment was rescheduled and you are unassigned.`).catch(e => {});
      }
      
      for (const admin of admins) {
          if (admin.fcm_token) {
              firebaseNotifier.sendToTherapist(admin.fcm_token, "Appointment Rescheduled", `Appointment #${id} is rescheduled to ${date} ${time}.`).catch(e => {});
          }
      }
  
      return res.json({ success: true, message: "Appointment rescheduled successfully" });
    } catch (error) {
      console.error("Error rescheduling appointment:", error);
      return res.status(500).json({ success: false, error: "Failed to reschedule appointment" });
    }
  };
