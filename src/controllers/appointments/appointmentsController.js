const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

// ✅ LIST APPOINTMENTS
exports.listAppointments = async (req, res) => {
  try {
    const filters = req.query;

    // Example filters: status, mode, therapistId
    const whereClauses = [];
    const replacements = {};

    if (filters.status) {
      whereClauses.push(`a.status = :status`);
      replacements.status = filters.status;
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
         a.verification_status AS "verificationStatus"
       FROM appointments a
       WHERE a.id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    if (!appt) return res.error("Appointment not found");

    return res.success(appt, "Appointment fetched successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch appointment");
  }
};

// ✅ LIST APPOINTMENTS FOR USER
exports.listAppointmentsForUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.query; // 'patient' or 'therapist'

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
         a.verification_status AS "verificationStatus"
       FROM appointments a
       WHERE ${field} = :userId
       ORDER BY a.date DESC`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    return res.success(appointments, "User appointments fetched successfully");
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
exports.createBookingAndInvoice = async (req, res) => {
  const { bookingData, paymentDetails } = req.body;

  const t = await sequelize.transaction(); // start transaction

  try {
    if (!bookingData || !paymentDetails) {
      return res.status(400).json({ success: false, error: "Booking data and payment details required" });
    }

    // --------------------------
    // 1️⃣ Insert appointment
    // --------------------------
      const [rows] = await sequelize.query(
      `INSERT INTO appointments (
        patient_id, patient_name, date_of_birth, therapist_id, therapist_name, service_type_id, therapy_type,
        service_amount, total_amount, date, time, mode, notes, service_address_id,
        status, verification_status, payment_status, pcr_status, created_at
      ) VALUES (
        :patientId, :patientName, :dateofbirth, :therapistId, :therapistName, :serviceTypeId, :therapyType,
        :serviceAmount, :totalAmount, :date, :time, :mode, :notes, :serviceAddress,
        :status, :verificationStatus, :paymentStatus, :pcrStatus, NOW()
      ) RETURNING id`,
      {
        replacements: {
          patientId: bookingData.patientId,
          patientName: bookingData.patientName,
          dateofbirth: bookingData.dateofBirth,
          therapistId: bookingData.therapistId,
          therapistName: bookingData.therapist,
          serviceTypeId: bookingData.serviceTypeId,
          therapyType: bookingData.therapyType,
          serviceAmount: bookingData.serviceAmount,
          totalAmount: bookingData.totalAmount,
          date: bookingData.date,
          time: bookingData.time,
          mode: bookingData.mode,
          notes: bookingData.notes || null,
          serviceAddress: bookingData.addressId, 
          status: "Pending",
          verificationStatus: "Pending",
          paymentStatus: "Paid",
          pcrStatus: "not_started",
        },
        type: sequelize.QueryTypes.INSERT,
        transaction: t,
      }
    );
    const appointmentId = rows[0]?.id;
    if (!appointmentId) throw new Error("Failed to get appointmentId");

    // --------------------------
    // 2️⃣ Insert invoice
    // --------------------------
    const invoiceNumber = await getNextInvoiceNumber("service");

    const [invoiceRows] = await sequelize.query(
      `INSERT INTO invoices (
        invoice_number, status, user_id, booking_id, issued_at, total_amount_paise
      ) VALUES (
        :invoiceNumber, :status, :userId, :appointmentId, NOW(), :totalAmountPaise
      ) RETURNING id`,
      {
        replacements: {
          invoiceNumber,
          status: "issued",
          userId: bookingData.patientId,
          appointmentId,
          totalAmountPaise: (bookingData.totalAmount || 0) * 100,
        },
        type: sequelize.QueryTypes.INSERT,
        transaction: t,
      }
    );

    const invoiceId = invoiceRows[0]?.id;

    // --------------------------
    // 3️⃣ Automatically Insert into PCR table
    // --------------------------
    await sequelize.query(
      `INSERT INTO pcr (
        appointment_id, patient_id, therapist_id, service_type_id,
        chief_complaint, assessment, diagnosis,
        treatment_provided, plan_of_care,
        bp, hr, rr, temp,
        status, version, created_at, locked_at, history
      ) VALUES (
        :bookingId, :patientId, :therapistId, :serviceTypeId,
        '', '', '', '', '',
        '', '', '', '',
        'not_started', 1, NOW(), NOW(), '[]'
      )`,
      {
        replacements: {
          bookingId: appointmentId,
          patientId: bookingData.patientId,
          therapistId: bookingData.therapistId,
          serviceTypeId: bookingData.serviceTypeId,
        },
        type: sequelize.QueryTypes.INSERT,
        transaction: t,
      }
    );

    // --------------------------
    // ✅ Commit transaction
    // --------------------------
    await t.commit();

    return res.json({ success: true, appointmentId, invoiceId });

  } catch (error) {
    // --------------------------
    // ❌ Rollback transaction if any error
    // --------------------------
    await t.rollback();
    console.error("Error creating booking, invoice, and PCR:", error);
    return res.status(500).json({ success: false, error: "Failed to create booking" });
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

    const response = {
      ...pcr,
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
exports.updatePcr = async (req, res) => {
  const { appointmentId } = req.params;
  const data = req.body;

  if (!appointmentId) {
    return res.error("PCR Id is required", 400);
  }

  const t = await sequelize.transaction();

  try {
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

    const updatedData = {
      chief_complaint: data.chiefComplaint ?? existing.chief_complaint,
      assessment: data.assessment ?? existing.assessment,
      diagnosis: data.diagnosis ?? existing.diagnosis,
      treatment_provided: data.treatmentProvided ?? existing.treatment_provided,
      plan_of_care: data.planOfCare ?? existing.plan_of_care,
      bp: data?.bp ?? existing.bp,
      hr: data?.hr ?? existing.hr,
      rr: data?.rr ?? existing.rr,
      temp: data?.temp ?? existing.temp,
      status: data.status ?? existing.status,
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
          assessment: data.assessment ?? existing.assessment,
          diagnosis: data.diagnosis ?? existing.diagnosis,
          treatment_provided: data.treatmentProvided ?? existing.treatment_provided,
          plan_of_care: data.planOfCare ?? existing.plan_of_care,
          bp: data?.bp ?? existing.bp,
          hr: data?.hr ?? existing.hr,
          rr: data?.rr ?? existing.rr,
          temp: data?.temp ?? existing.temp,
          status: data.status ?? existing.status,
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

    await sequelize.query(
      `UPDATE appointments
       SET pcr_status = :status
       WHERE id = :appointmentId`,
      {
        replacements: { status: updatedData.status, appointmentId },
        type: QueryTypes.UPDATE,
        transaction: t
      }
    );

    await t.commit();
    return res.success("PCR updated successfully");

  } catch (error) {
    await t.rollback();
    console.error("Error updating PCR:", error);
    return res.error("Failed to update PCR", 500);
  }
};