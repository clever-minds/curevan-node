const { QueryTypes } = require("sequelize");
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
         a.verification_status AS "verificationStatus",
         tr.rating,
         tr.review
       FROM appointments a
       LEFT JOIN therapist_reviews tr ON tr.appointment_id = a.id
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
        status, verification_status, payment_status, pcr_status, reports, created_at
      ) VALUES (
        :patientId, :patientName, :dateofbirth, :therapistId, :therapistName, :serviceTypeId, :therapyType,
        :serviceAmount, :totalAmount, :date, :time, :mode, :notes, :serviceAddress,
        :status, :verificationStatus, :paymentStatus, :pcrStatus, :reports, NOW()
      ) RETURNING id`,
      {
        replacements: {
          patientId: bookingData.patientId || null,
          patientName: bookingData.patientName || null,
          dateofbirth: bookingData.dateofBirth || null,
          therapistId: bookingData.therapistId || null,
          therapistName: bookingData.therapist || null,
          serviceTypeId: bookingData.serviceTypeId || null,
          therapyType: bookingData.therapyType || null,
          serviceAmount: bookingData.serviceAmount || 0,
          totalAmount: bookingData.totalAmount || 0,
          date: bookingData.date || null,
          time: bookingData.time || null,
          mode: bookingData.mode || null,
          notes: bookingData.notes || null,
          serviceAddress: bookingData.addressId || null, 
          status: "Pending",
          verificationStatus: "Pending",
          paymentStatus: "Paid",
          pcrStatus: "not_started",
          reports: bookingData.reports ? JSON.stringify(bookingData.reports) : null,
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

    try {
      // Send Targeted Push Notification to the Therapist for Direct Booking
      if (bookingData.therapistId) {
        const [therapistInfo] = await sequelize.query(
          `SELECT fcm_token FROM users WHERE id = :therapistId`,
          { replacements: { therapistId: bookingData.therapistId }, type: QueryTypes.SELECT }
        );
        if (therapistInfo && therapistInfo.fcm_token) {
          await firebaseNotifier.sendToTherapist(
            therapistInfo.fcm_token,
            "New Direct Booking Assigned",
            `You have a new appointment with ${bookingData.patientName} on ${bookingData.date} at ${bookingData.time}.`,
            { appointmentId: String(appointmentId), type: "direct_booking" }
          );
        }
      } else {
        // Handle unassigned booking (Request a Therapist) - broadcast to nearby available therapists within 5km
        let lat, lng;
        if (bookingData.latitude && bookingData.longitude) {
          lat = parseFloat(bookingData.latitude);
          lng = parseFloat(bookingData.longitude);
        } else {
          const [patientInfo] = await sequelize.query(
            `SELECT latitude, longitude FROM users WHERE id = :patientId`,
            { replacements: { patientId: bookingData.patientId }, type: QueryTypes.SELECT }
          );
          if (patientInfo && patientInfo.latitude && patientInfo.longitude) {
            lat = parseFloat(patientInfo.latitude);
            lng = parseFloat(patientInfo.longitude);
          }
        }

        if (lat && lng) {
          // Find therapists within 5km who don't have an overlapping appointment
          const nearbyTherapists = await sequelize.query(
            `SELECT u.fcm_token, u.name
             FROM users u
             JOIN therapist_profiles tp ON tp.user_id = u.id
             WHERE u.role = 'therapist'
             AND u.fcm_token IS NOT NULL
             AND tp.lat IS NOT NULL
             AND tp.lng IS NOT NULL
             AND (
                 6371 * acos(
                     cos(radians(:lat)) * cos(radians(tp.lat)) *
                     cos(radians(tp.lng) - radians(:lng)) +
                     sin(radians(:lat)) * sin(radians(tp.lat))
                 )
             ) <= 5
             AND u.id NOT IN (
                 SELECT therapist_id FROM appointments 
                 WHERE date = :date 
                 AND time = :time
                 AND status != 'Cancelled'
                 AND therapist_id IS NOT NULL
             )`,
            {
              replacements: { 
                lat, 
                lng, 
                date: bookingData.date, 
                time: bookingData.time 
              },
              type: QueryTypes.SELECT
            }
          );

          console.log(`Found ${nearbyTherapists.length} available nearby therapists within 5km.`);

          for (const tp of nearbyTherapists) {
            await firebaseNotifier.sendToTherapist(
              tp.fcm_token,
              "New Appointment Request Nearby!",
              `A new appointment request is available nearby on ${bookingData.date} at ${bookingData.time}. Open the app to accept it.`,
              { 
                appointmentId: String(appointmentId), 
                type: "broadcast_booking",
                date: String(bookingData.date || ""),
                time: String(bookingData.time || ""),
                therapyType: String(bookingData.therapyType || "Therapy")
              }
            );
          }
        } else {
          console.log("Unassigned booking - patient has no lat/lng, cannot find nearby therapists.");
        }
      }
    } catch (fcmErr) {
      console.error("Failed to send FCM notifications:", fcmErr);
    }

    try {
      // Send Booking Confirmation Email
      const [patient] = await sequelize.query(
        `SELECT email FROM users WHERE id = :patientId`,
        { replacements: { patientId: bookingData.patientId }, type: QueryTypes.SELECT }
      );

      if (patient?.email) {
        await transporter.sendMail({
          from: `"Curevan Appointments" <${process.env.MAIL_USER}>`,
          to: patient.email,
          subject: "Your Appointment is Booked",
          html: `
            <h3>Booking Confirmation</h3>
            <p>Hi ${bookingData.patientName},</p>
            <p>Your appointment has been successfully booked.</p>
            <ul>
              <li><strong>Date:</strong> ${bookingData.date}</li>
              <li><strong>Time:</strong> ${bookingData.time}</li>
              <li><strong>Therapist:</strong> ${bookingData.therapist}</li>
              <li><strong>Service:</strong> ${bookingData.therapyType}</li>
              <li><strong>Total Amount:</strong> ₹${bookingData.totalAmount}</li>
            </ul>
            <p>Thank you for choosing Curevan.</p>
          `
        });
      }
    } catch (mailErr) {
      console.error("Failed to send booking email:", mailErr);
    }

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

    // 2️⃣ Normalize status ONLY for appointments table
    let normalizedStatus = existing.status; // default
    if (data.status) {
      const statusLower = data.status.toLowerCase();
      if (statusLower === "submitted") normalizedStatus = "Confirmed";
      else if (statusLower === "locked") normalizedStatus = "Completed";
    }

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

    // 6️⃣ Update appointments table
    await sequelize.query(
      `UPDATE appointments
       SET status = :status,
           pcr_status = :pcr_status
       WHERE id = :appointmentId`,
      {
        replacements: { 
          status: normalizedStatus,   // Confirmed / Completed
          pcr_status: pcrStatusToSave, // submitted / locked
          appointmentId 
        },
        type: QueryTypes.UPDATE,
        transaction: t
      }
    );

    // 7️⃣ Commit transaction
    await t.commit();

    // 8️⃣ Send Status Update Email (if status changed)
    try {
      if (normalizedStatus && normalizedStatus !== existing.status) {
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
            subject: `Your Appointment Status is now: ${normalizedStatus}`,
            html: `
              <h3>Appointment Update</h3>
              <p>Hi ${apptInfo.user_name},</p>
              <p>The status of your appointment has been updated to <strong>${normalizedStatus}</strong>.</p>
              <p>Sign in to your dashboard to view more details.</p>
            `
          });
        }
      }
    } catch (mailErr) {
      console.error("Failed to send appt status update email:", mailErr);
    }

    return res.status(200).json({ success: true, message: "PCR updated successfully" });

  } catch (error) {
    await t.rollback();
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

    const [rows] = await sequelize.query(
      `INSERT INTO appointments (
        patient_id, patient_name, date_of_birth, service_type_id, therapy_type,
        service_amount, total_amount, date, time, mode, notes, service_address_id,
        status, verification_status, payment_status, pcr_status, reports, created_at
      ) VALUES (
        :patientId, :patientName, :dateofbirth, :serviceTypeId, :therapyType,
        :serviceAmount, :totalAmount, :date, :time, :mode, :notes, :serviceAddress,
        'Searching Therapist', 'Not Verified', 'Pending', 'not_started', :reports, NOW()
      ) RETURNING id`,
      {
        replacements: {
          patientId: bookingData.patientId,
          patientName: bookingData.patientName,
          dateofbirth: bookingData.dateofBirth || null,
          serviceTypeId: bookingData.serviceTypeId,
          therapyType: bookingData.therapyType,
          serviceAmount: bookingData.serviceAmount || 0,
          totalAmount: bookingData.totalAmount || 0,
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
             SELECT 1 FROM appointments a2
             WHERE a2.therapist_id = u.id
               AND a2.date = :bookingDate
               AND a2.time = :bookingTime
               AND a2.status NOT IN ('Cancelled', 'Completed')
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
    console.error("Error creating booking request:", error);
    return res.status(500).json({ success: false, error: "Failed to create booking request" });
  }
};

// ✅ 2. GET AVAILABLE REQUESTS (Matchmaking Logic)
exports.getAvailableRequests = async (req, res) => {
  try {
    const { therapistId } = req.query;

    let query = `
       SELECT 
         a.id, a.patient_name AS "patientName", a.therapy_type AS "therapyType",
         a.date, a.time, a.mode, a.status, a.service_amount AS "serviceAmount",
         a.notes, a.created_at AS "createdAt", a.service_address_id AS "serviceAddress"
       FROM appointments a
       WHERE a.status IN ('Searching', 'Searching Therapist')
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
            AND a2.status NOT IN ('Cancelled', 'Completed')
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
  const { therapistId, therapistName, therapistPhone } = req.body || {};

  const t = await sequelize.transaction();

  try {
    const [appt] = await sequelize.query(
      `SELECT status, patient_id, service_type_id, therapist_id FROM appointments WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction: t }
    );

    if (!appt) {
      await t.rollback();
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }

    const isAvailable = 
      appt.status === 'Searching' || 
      appt.status === 'Searching Therapist' || 
      (appt.status === 'Pending' && !appt.therapist_id);

    if (!isAvailable) {
      await t.rollback();
      return res.status(400).json({ success: false, error: "Appointment already accepted or cancelled" });
    }

    await sequelize.query(
      `UPDATE appointments 
       SET therapist_id = :therapistId, 
           therapist_name = :therapistName, 
           therapist_phone = :therapistPhone,
           status = 'Accepted'
       WHERE id = :id`,
      {
        replacements: { id, therapistId, therapistName, therapistPhone: therapistPhone || null },
        type: QueryTypes.UPDATE,
        transaction: t
      }
    );

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
        replacements: {
          id,
          patientId: appt.patient_id,
          therapistId,
          serviceTypeId: appt.service_type_id
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    await t.commit();
    return res.json({ success: true, message: "Booking accepted successfully" });
  } catch (error) {
    await t.rollback();
    console.error("Error accepting booking:", error);
    return res.status(500).json({ success: false, error: "Failed to accept booking" });
  }
};

// ✅ 4. UPDATE APPOINTMENT STATUS (Tracking Flow)
exports.updateAppointmentStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {}; 

  try {
    await sequelize.query(
      `UPDATE appointments SET status = :status WHERE id = :id`,
      {
        replacements: { status, id },
        type: QueryTypes.UPDATE
      }
    );
    
    return res.json({ success: true, message: `Status updated to ${status}` });
  } catch (error) {
    console.error("Error updating status:", error);
    return res.status(500).json({ success: false, error: "Failed to update status" });
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
    
    if (appt.status !== 'Completed') {
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