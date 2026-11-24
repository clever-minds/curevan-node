/**
 * Unified Notification Dispatcher (P24, P30).
 * Coordinates multi-channel delivery across WhatsApp, SMS (DLT), Email, Push and In-App.
 * Strictly adheres to:
 *   - DPDP & Meta policy: WhatsApp messages are sent only if recipient has whatsapp_opt_in === true.
 *   - Admin alerts sent via WhatsApp only to users with that role + phone + whatsapp_opt_in === true.
 *   - Caregivers (P16) receive same patient updates, except Start Code.
 *   - Start Code (OTP) is restricted to AUTHENTICATION template, sent only to patient within the start-code window.
 *   - No Start Code in booking_confirmed (WhatsApp or SMS) or in any email or log.
 *   - WhatsApp failure on critical transactional messages triggers automatic SMS fallback once.
 *   - Deduplication key prevents duplicate sends.
 */
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const rules = require("../../config/businessRules");
const { TEMPLATES } = require("./templates");
const { sendWhatsApp } = require("./channels/whatsapp");
const { sendSms } = require("./channels/sms");
const { sendEmail } = require("./channels/email");
const { sendPush } = require("./channels/push");
const { sendInApp } = require("./channels/inapp");

async function getUser(userId) {
  if (!userId) return null;
  const [u] = await sequelize.query(
    `SELECT id, name, phone, email, fcm_token, whatsapp_opt_in, marketing_opt_in, reminder_prefs
     FROM users WHERE id = :id`,
    { replacements: { id: userId }, type: QueryTypes.SELECT }
  );
  return u || null;
}

async function getAdminUsers(roleNames) {
  return sequelize.query(
    `SELECT DISTINCT u.id, u.name, u.phone, u.email, u.fcm_token, u.whatsapp_opt_in
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name IN (:roles)`,
    { replacements: { roles: roleNames }, type: QueryTypes.SELECT }
  );
}

async function getAdminWhatsAppUsers(roleName) {
  const allowedRoles = rules.notifications?.adminWhatsAppRoles || {};
  if (!allowedRoles[roleName]) return [];

  return sequelize.query(
    `SELECT DISTINCT u.id, u.name, u.phone, u.whatsapp_opt_in
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name = :roleName AND u.phone IS NOT NULL AND u.whatsapp_opt_in = true`,
    { replacements: { roleName }, type: QueryTypes.SELECT }
  );
}

async function getConsentedCaregivers(patientId) {
  if (!patientId) return [];
  try {
    return await sequelize.query(
      `SELECT u.id, u.name, u.phone, u.email, u.fcm_token, u.whatsapp_opt_in
       FROM patient_caregivers pc
       JOIN users u ON u.id = pc.caregiver_user_id
       WHERE pc.patient_user_id = :p AND pc.revoked_at IS NULL AND pc.activated_at IS NOT NULL AND pc.can_view_progress`,
      { replacements: { p: patientId }, type: QueryTypes.SELECT }
    );
  } catch {
    return [];
  }
}

async function isDuplicate(dedupeKey) {
  if (!dedupeKey) return false;
  try {
    const [row] = await sequelize.query(
      `SELECT id FROM notification_log WHERE dedupe_key = :dedupeKey LIMIT 1`,
      { replacements: { dedupeKey }, type: QueryTypes.SELECT }
    );
    return Boolean(row);
  } catch {
    return false;
  }
}

async function logAttempt({ userId, event, channel, template, status, providerMessageId, error, dedupeKey }) {
  try {
    // Sanitization: Ensure NO OTP is ever written into logs (P24 global boundary rule)
    const sanitizedError = error
      ? String(error)
          .replace(/\b\d{4,6}\b/g, "[REDACTED]")
          .slice(0, 500)
      : null;

    await sequelize.query(
      `INSERT INTO notification_log (user_id, event, channel, template, status, provider_message_id, dedupe_key, error, created_at)
       VALUES (:uid, :event, :channel, :template, :status, :msgId, :dedupeKey, :err, NOW())`,
      {
        replacements: {
          uid: userId || null,
          event,
          channel,
          template: template || null,
          status,
          msgId: providerMessageId ? String(providerMessageId).slice(0, 255) : null,
          dedupeKey: dedupeKey || null,
          err: sanitizedError,
        },
        type: QueryTypes.INSERT,
      }
    );
  } catch (err) {
    console.error("Failed to record notification_log:", err.message);
  }
}

/**
 * Main dispatcher entry point: notify(event, payload)
 */
async function notify(event, payload = {}) {
  const tmpl = TEMPLATES[event];
  if (!tmpl && !["booking_confirmed", "sos_raised", "admin_low_stock"].includes(event)) {
    console.warn(`[notify] Unknown event '${event}'`);
    return { success: false, error: `Unknown event: ${event}` };
  }

  const entityId = payload.bookingId || payload.appointmentId || payload.orderId || payload.batchId || payload.patientId || payload.userId || "";

  try {
    switch (event) {
      // 1. booking_confirmed:
      // Patient: WhatsApp (NO OTP) + SMS fallback (NO OTP) + InApp + Email (NO OTP)
      // Caregivers: WhatsApp (NO OTP)
      // Therapist: WhatsApp (if opted in) + Push + InApp
      // Therapy Admin: WhatsApp (if opted in) + InApp
      case "booking_confirmed": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);
        const bookingLink = payload.link || "https://www.curevan.com/dashboard/bookings";

        // Patient & Consented Caregivers
        if (patient) {
          const caregivers = await getConsentedCaregivers(patient.id);
          const patientRecipients = [{ ...patient, isPrimary: true }, ...caregivers.map((c) => ({ ...c, isPrimary: false }))];

          for (const recipient of patientRecipients) {
            const dedupeKey = `booking_confirmed_patient_${entityId}_${recipient.id}_whatsapp`;
            if (await isDuplicate(dedupeKey)) continue;

            const waText = tmpl.formatWhatsApp({
              patientName: recipient.name,
              therapistName: payload.therapistName || therapist?.name,
              date: payload.date,
              time: payload.time,
              locality: payload.locality,
              link: bookingLink,
            });

            let waSuccess = false;
            // WhatsApp attempt (strictly opt-in only)
            if (recipient.phone && recipient.whatsapp_opt_in === true) {
              try {
                const res = await sendWhatsApp({
                  to: recipient.phone,
                  text: waText,
                  templateName: tmpl.metaTemplateName,
                  templateParams: [
                    recipient.name || "there",
                    payload.therapistName || therapist?.name || "therapist",
                    payload.date,
                    payload.time,
                    payload.locality || "Home",
                    bookingLink,
                  ],
                });
                await logAttempt({
                  userId: recipient.id,
                  event,
                  channel: "whatsapp",
                  template: tmpl.metaTemplateName,
                  status: "sent",
                  providerMessageId: res.messageId,
                  dedupeKey,
                });
                waSuccess = true;
              } catch (err) {
                await logAttempt({
                  userId: recipient.id,
                  event,
                  channel: "whatsapp",
                  template: tmpl.metaTemplateName,
                  status: "failed",
                  error: err.message,
                  dedupeKey,
                });
              }
            } else {
              await logAttempt({
                userId: recipient.id,
                event,
                channel: "whatsapp",
                template: tmpl.metaTemplateName,
                status: "skipped",
                error: "User not opted in to WhatsApp",
                dedupeKey,
              });
            }

            // Primary patient gets SMS fallback if WhatsApp failed or not opted in (WITHOUT OTP)
            if (recipient.isPrimary && !waSuccess && recipient.phone) {
              const smsDedupeKey = `booking_confirmed_patient_${entityId}_${recipient.id}_sms`;
              if (!(await isDuplicate(smsDedupeKey))) {
                const smsText = tmpl.formatSms({
                  therapistName: payload.therapistName || therapist?.name,
                  date: payload.date,
                  time: payload.time,
                  link: bookingLink,
                });
                try {
                  const res = await sendSms({
                    to: recipient.phone,
                    text: smsText,
                    dltTemplateId: tmpl.dltTemplateId,
                    dltEntityId: tmpl.dltEntityId,
                    dltSenderId: tmpl.dltSenderId,
                  });
                  await logAttempt({
                    userId: recipient.id,
                    event,
                    channel: "sms",
                    template: tmpl.dltTemplateId,
                    status: "sent",
                    providerMessageId: res.messageId,
                    dedupeKey: smsDedupeKey,
                  });
                } catch (err) {
                  await logAttempt({
                    userId: recipient.id,
                    event,
                    channel: "sms",
                    template: tmpl.dltTemplateId,
                    status: "failed",
                    error: err.message,
                    dedupeKey: smsDedupeKey,
                  });
                }
              }
            }

            // In-App for primary patient
            if (recipient.isPrimary) {
              const inAppDedupeKey = `booking_confirmed_patient_${entityId}_${recipient.id}_inapp`;
              if (!(await isDuplicate(inAppDedupeKey))) {
                try {
                  const res = await sendInApp({
                    userId: recipient.id,
                    type: "booking",
                    title: "Booking Confirmed",
                    message: `Your session with ${payload.therapistName || therapist?.name || "therapist"} on ${payload.date} at ${payload.time} is confirmed.`,
                    link: "/dashboard/bookings",
                  });
                  await logAttempt({
                    userId: recipient.id,
                    event,
                    channel: "inapp",
                    template: "booking_confirmed",
                    status: "sent",
                    providerMessageId: res.notificationId,
                    dedupeKey: inAppDedupeKey,
                  });
                } catch (err) {
                  await logAttempt({ userId: recipient.id, event, channel: "inapp", status: "failed", error: err.message, dedupeKey: inAppDedupeKey });
                }
              }

              // E-Mail for primary patient (WITHOUT OTP)
              if (recipient.email) {
                const emailDedupeKey = `booking_confirmed_patient_${entityId}_${recipient.id}_email`;
                if (!(await isDuplicate(emailDedupeKey))) {
                  const mail = tmpl.formatEmail({
                    patientName: recipient.name,
                    therapistName: payload.therapistName || therapist?.name,
                    date: payload.date,
                    time: payload.time,
                    locality: payload.locality,
                    link: bookingLink,
                  });
                  try {
                    const res = await sendEmail({
                      to: recipient.email,
                      subject: mail.subject,
                      text: mail.text,
                      html: mail.html,
                    });
                    await logAttempt({
                      userId: recipient.id,
                      event,
                      channel: "email",
                      template: "booking_confirmed_email",
                      status: "sent",
                      providerMessageId: res.messageId,
                      dedupeKey: emailDedupeKey,
                    });
                  } catch (err) {
                    await logAttempt({ userId: recipient.id, event, channel: "email", status: "failed", error: err.message, dedupeKey: emailDedupeKey });
                  }
                }
              }
            }
          }
        }

        // Therapist: WhatsApp (if opted in) + Push + In-App
        if (therapist) {
          const therapistTmpl = TEMPLATES.therapist_new_booking;
          const waDedupeKey = `booking_confirmed_therapist_${entityId}_${therapist.id}_whatsapp`;
          if (therapistTmpl && !(await isDuplicate(waDedupeKey))) {
            if (therapist.phone && therapist.whatsapp_opt_in === true) {
              try {
                const schedLink = "https://www.curevan.com/dashboard/therapist/schedule";
                const waText = therapistTmpl.formatWhatsApp({
                  therapistName: therapist.name,
                  date: payload.date,
                  time: payload.time,
                  locality: payload.locality,
                  link: schedLink,
                });
                const res = await sendWhatsApp({
                  to: therapist.phone,
                  text: waText,
                  templateName: therapistTmpl.metaTemplateName,
                  templateParams: [therapist.name || "Doctor", payload.date, payload.time, payload.locality || "Home", schedLink],
                });
                await logAttempt({
                  userId: therapist.id,
                  event,
                  channel: "whatsapp",
                  template: therapistTmpl.metaTemplateName,
                  status: "sent",
                  providerMessageId: res.messageId,
                  dedupeKey: waDedupeKey,
                });
              } catch (err) {
                await logAttempt({ userId: therapist.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey: waDedupeKey });
              }
            } else {
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", status: "skipped", error: "Therapist not opted in to WhatsApp", dedupeKey: waDedupeKey });
            }
          }

          const pushDedupeKey = `booking_confirmed_therapist_${entityId}_${therapist.id}_push`;
          if (!(await isDuplicate(pushDedupeKey))) {
            try {
              const pRes = await sendPush({
                userId: therapist.id,
                title: "New Confirmed Booking",
                body: `Session with ${payload.patientName || patient?.name || "Patient"} on ${payload.date} at ${payload.time}.`,
                data: { type: "booking", appointmentId: String(payload.appointmentId || "") },
              });
              await logAttempt({
                userId: therapist.id,
                event,
                channel: "push",
                status: pRes.success ? "sent" : "skipped",
                providerMessageId: pRes.messageId,
                error: pRes.error,
                dedupeKey: pushDedupeKey,
              });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "push", status: "failed", error: err.message, dedupeKey: pushDedupeKey });
            }
          }

          const inAppDedupeKey = `booking_confirmed_therapist_${entityId}_${therapist.id}_inapp`;
          if (!(await isDuplicate(inAppDedupeKey))) {
            try {
              const iRes = await sendInApp({
                userId: therapist.id,
                type: "booking",
                title: "New Confirmed Session",
                message: `You have a confirmed session with ${payload.patientName || patient?.name || "Patient"} on ${payload.date} at ${payload.time}.`,
                link: "/dashboard/therapist/schedule",
              });
              await logAttempt({
                userId: therapist.id,
                event,
                channel: "inapp",
                status: "sent",
                providerMessageId: iRes.notificationId,
                dedupeKey: inAppDedupeKey,
              });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "inapp", status: "failed", error: err.message, dedupeKey: inAppDedupeKey });
            }
          }
        }

        // Therapy Admin: WhatsApp (if opted in) + In-App
        const therapyAdmins = await getAdminWhatsAppUsers("admin.therapy");
        const adminTmpl = TEMPLATES.admin_new_booking;
        for (const admin of therapyAdmins) {
          const adminDedupeKey = `booking_confirmed_admin_${entityId}_${admin.id}_whatsapp`;
          if (adminTmpl && !(await isDuplicate(adminDedupeKey))) {
            try {
              const adminLink = "https://www.curevan.com/dashboard/therapy-admin";
              const text = adminTmpl.formatWhatsApp({
                adminName: admin.name,
                bookingId: entityId,
                date: payload.date,
                time: payload.time,
                link: adminLink,
              });
              const res = await sendWhatsApp({
                to: admin.phone,
                text,
                templateName: adminTmpl.metaTemplateName,
                templateParams: [admin.name || "Admin", String(entityId), payload.date, payload.time, adminLink],
              });
              await logAttempt({
                userId: admin.id,
                event,
                channel: "whatsapp",
                template: adminTmpl.metaTemplateName,
                status: "sent",
                providerMessageId: res.messageId,
                dedupeKey: adminDedupeKey,
              });
            } catch (err) {
              await logAttempt({ userId: admin.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey: adminDedupeKey });
            }
          }
        }
        break;
      }

      // 2. booking_payment_received: Patient: WhatsApp; Therapy Admin: WhatsApp
      case "booking_payment_received": {
        const patient = await getUser(payload.patientId || payload.userId);
        const bookingLink = payload.link || "https://www.curevan.com/dashboard/bookings";
        if (patient && patient.phone && patient.whatsapp_opt_in === true) {
          const dedupeKey = `booking_payment_patient_${entityId}_${patient.id}_whatsapp`;
          if (!(await isDuplicate(dedupeKey))) {
            const patientTmpl = TEMPLATES.booking_payment_received;
            try {
              const text = patientTmpl.formatWhatsApp({
                patientName: patient.name,
                amount: payload.amount,
                bookingId: entityId,
                link: bookingLink,
              });
              const res = await sendWhatsApp({
                to: patient.phone,
                text,
                templateName: patientTmpl.metaTemplateName,
                templateParams: [patient.name || "there", String(payload.amount), String(entityId), bookingLink],
              });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: patientTmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey });
            }
          }
        }

        const therapyAdmins = await getAdminWhatsAppUsers("admin.therapy");
        const adminTmpl = TEMPLATES.admin_booking_payment;
        for (const admin of therapyAdmins) {
          const dedupeKey = `booking_payment_admin_${entityId}_${admin.id}_whatsapp`;
          if (adminTmpl && !(await isDuplicate(dedupeKey))) {
            try {
              const adminLink = "https://www.curevan.com/dashboard/therapy-admin";
              const text = adminTmpl.formatWhatsApp({
                adminName: admin.name,
                amount: payload.amount,
                bookingId: entityId,
                link: adminLink,
              });
              const res = await sendWhatsApp({
                to: admin.phone,
                text,
                templateName: adminTmpl.metaTemplateName,
                templateParams: [admin.name || "Admin", String(payload.amount), String(entityId), adminLink],
              });
              await logAttempt({ userId: admin.id, event, channel: "whatsapp", template: adminTmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: admin.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey });
            }
          }
        }
        break;
      }

      // 3. reminder_24h & reminder_2h:
      // Patient: WhatsApp utility + SMS fallback
      // In 2h: Patient ONLY gets separate AUTHENTICATION template curevan_start_code (inside start-code window)
      // Therapist: WhatsApp utility (NO code) + Push
      case "reminder_24h":
      case "reminder_2h": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);
        const bookingLink = payload.link || "https://www.curevan.com/dashboard/bookings";

        // Patient & Caregivers
        if (patient) {
          const caregivers = await getConsentedCaregivers(patient.id);
          const patientRecipients = [{ ...patient, isPrimary: true }, ...caregivers.map((c) => ({ ...c, isPrimary: false }))];

          for (const recipient of patientRecipients) {
            const dedupeKey = `${event}_patient_${entityId}_${recipient.id}_whatsapp`;
            if (await isDuplicate(dedupeKey)) continue;

            const waText = tmpl.formatWhatsApp({
              patientName: recipient.name,
              therapistName: payload.therapistName || therapist?.name,
              time: payload.time,
              link: bookingLink,
            });

            let waOk = false;
            if (recipient.phone && recipient.whatsapp_opt_in === true) {
              try {
                const res = await sendWhatsApp({
                  to: recipient.phone,
                  text: waText,
                  templateName: tmpl.metaTemplateName,
                  templateParams: [recipient.name || "there", payload.therapistName || therapist?.name || "therapist", payload.time, bookingLink],
                });
                await logAttempt({ userId: recipient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
                waOk = true;
              } catch (err) {
                await logAttempt({ userId: recipient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
              }
            } else {
              await logAttempt({ userId: recipient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "skipped", error: "User not opted in to WhatsApp", dedupeKey });
            }

            // SMS fallback for primary patient
            if (recipient.isPrimary && !waOk && recipient.phone) {
              const smsDedupeKey = `${event}_patient_${entityId}_${recipient.id}_sms`;
              if (!(await isDuplicate(smsDedupeKey))) {
                const smsText = tmpl.formatSms({
                  therapistName: payload.therapistName || therapist?.name,
                  time: payload.time,
                  link: bookingLink,
                });
                try {
                  const res = await sendSms({
                    to: recipient.phone,
                    text: smsText,
                    dltTemplateId: tmpl.dltTemplateId,
                    dltEntityId: tmpl.dltEntityId,
                    dltSenderId: tmpl.dltSenderId,
                  });
                  await logAttempt({ userId: recipient.id, event, channel: "sms", template: tmpl.dltTemplateId, status: "sent", providerMessageId: res.messageId, dedupeKey: smsDedupeKey });
                } catch (err) {
                  await logAttempt({ userId: recipient.id, event, channel: "sms", template: tmpl.dltTemplateId, status: "failed", error: err.message, dedupeKey: smsDedupeKey });
                }
              }
            }
          }

          // In reminder_2h: Send Start Code via AUTHENTICATION template ONLY to primary patient (inside start-code window)
          if (event === "reminder_2h" && payload.otp && patient.phone) {
            const startCodeDedupeKey = `start_code_${entityId}_${patient.id}_whatsapp`;
            if (!(await isDuplicate(startCodeDedupeKey))) {
              const startCodeTmpl = TEMPLATES.start_code;
              let waOtpSent = false;
              if (patient.whatsapp_opt_in === true) {
                try {
                  const otpText = startCodeTmpl.formatWhatsApp({ patientName: patient.name, otp: payload.otp });
                  const res = await sendWhatsApp({
                    to: patient.phone,
                    text: otpText,
                    templateName: startCodeTmpl.metaTemplateName,
                    components: [
                      {
                        type: "body",
                        parameters: [
                          { type: "text", text: patient.name || "Patient" },
                          { type: "text", text: String(payload.otp) },
                        ],
                      },
                      {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: String(payload.otp) }],
                      },
                    ],
                  });
                  await logAttempt({
                    userId: patient.id,
                    event: "start_code",
                    channel: "whatsapp",
                    template: startCodeTmpl.metaTemplateName,
                    status: "sent",
                    providerMessageId: res.messageId,
                    dedupeKey: startCodeDedupeKey,
                  });
                  waOtpSent = true;
                } catch (err) {
                  await logAttempt({ userId: patient.id, event: "start_code", channel: "whatsapp", status: "failed", error: err.message, dedupeKey: startCodeDedupeKey });
                }
              }

              // SMS fallback for start code if WhatsApp failed
              if (!waOtpSent && patient.phone) {
                const smsOtpDedupeKey = `start_code_${entityId}_${patient.id}_sms`;
                if (!(await isDuplicate(smsOtpDedupeKey))) {
                  const smsOtpText = startCodeTmpl.formatSms({ otp: payload.otp });
                  try {
                    const res = await sendSms({
                      to: patient.phone,
                      text: smsOtpText,
                      dltTemplateId: startCodeTmpl.dltTemplateId,
                      dltEntityId: startCodeTmpl.dltEntityId,
                      dltSenderId: startCodeTmpl.dltSenderId,
                    });
                    await logAttempt({
                      userId: patient.id,
                      event: "start_code",
                      channel: "sms",
                      template: startCodeTmpl.dltTemplateId,
                      status: "sent",
                      providerMessageId: res.messageId,
                      dedupeKey: smsOtpDedupeKey,
                    });
                  } catch (err) {
                    await logAttempt({ userId: patient.id, event: "start_code", channel: "sms", status: "failed", error: err.message, dedupeKey: smsOtpDedupeKey });
                  }
                }
              }
            }
          }
        }

        // Therapist: 24h & 2h reminders (NO OTP / code)
        if (therapist) {
          const therapistEvent = event === "reminder_24h" ? "therapist_reminder_24h" : "therapist_reminder_2h";
          const therapistTmpl = TEMPLATES[therapistEvent];
          const waDedupeKey = `${therapistEvent}_${entityId}_${therapist.id}_whatsapp`;

          if (therapistTmpl && !(await isDuplicate(waDedupeKey))) {
            if (therapist.phone && therapist.whatsapp_opt_in === true) {
              try {
                const schedLink = "https://www.curevan.com/dashboard/therapist/schedule";
                const waText = therapistTmpl.formatWhatsApp({ therapistName: therapist.name, time: payload.time, link: schedLink });
                const res = await sendWhatsApp({
                  to: therapist.phone,
                  text: waText,
                  templateName: therapistTmpl.metaTemplateName,
                  templateParams: [therapist.name || "Doctor", payload.time, schedLink],
                });
                await logAttempt({ userId: therapist.id, event: therapistEvent, channel: "whatsapp", template: therapistTmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey: waDedupeKey });
              } catch (err) {
                await logAttempt({ userId: therapist.id, event: therapistEvent, channel: "whatsapp", status: "failed", error: err.message, dedupeKey: waDedupeKey });
              }
            } else {
              await logAttempt({ userId: therapist.id, event: therapistEvent, channel: "whatsapp", status: "skipped", error: "Therapist not opted in to WhatsApp", dedupeKey: waDedupeKey });
            }
          }

          const pushDedupeKey = `${therapistEvent}_${entityId}_${therapist.id}_push`;
          if (!(await isDuplicate(pushDedupeKey))) {
            try {
              const res = await sendPush({
                userId: therapist.id,
                title: event === "reminder_24h" ? "Session Tomorrow" : "Session in 2 Hours",
                body: `Curevan session at ${payload.time}.`,
                data: { type: "reminder", appointmentId: String(entityId) },
              });
              await logAttempt({ userId: therapist.id, event: therapistEvent, channel: "push", status: res.success ? "sent" : "skipped", providerMessageId: res.messageId, dedupeKey: pushDedupeKey });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event: therapistEvent, channel: "push", status: "failed", error: err.message, dedupeKey: pushDedupeKey });
            }
          }
        }
        break;
      }

      // 4. reminder_30_min: Patient: WhatsApp; Therapist: Push
      case "reminder_30_min": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);
        const bookingLink = payload.link || "https://www.curevan.com/dashboard/bookings";

        if (patient) {
          const dedupeKey = `reminder_30min_patient_${entityId}_${patient.id}_whatsapp`;
          if (patient.phone && patient.whatsapp_opt_in === true && !(await isDuplicate(dedupeKey))) {
            const text = tmpl.formatWhatsApp({
              patientName: patient.name,
              therapistName: payload.therapistName || therapist?.name,
              time: payload.time,
              link: bookingLink,
            });
            try {
              const res = await sendWhatsApp({
                to: patient.phone,
                text,
                templateName: tmpl.metaTemplateName,
                templateParams: [patient.name || "there", payload.therapistName || therapist?.name || "your therapist", payload.time, bookingLink],
              });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
            }
          }
        }

        if (therapist) {
          const pushDedupeKey = `reminder_30min_therapist_${entityId}_${therapist.id}_push`;
          if (!(await isDuplicate(pushDedupeKey))) {
            const p = tmpl.formatPush({ patientName: patient?.name, time: payload.time });
            try {
              const res = await sendPush({ userId: therapist.id, title: p.title, body: p.body, data: { type: "reminder" } });
              await logAttempt({ userId: therapist.id, event, channel: "push", status: res.success ? "sent" : "skipped", providerMessageId: res.messageId, dedupeKey: pushDedupeKey });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "push", status: "failed", error: err.message, dedupeKey: pushDedupeKey });
            }
          }
        }
        break;
      }

      // 5. therapist agenda & 60min
      case "therapist_daily_agenda":
      case "therapist_60min": {
        const therapist = await getUser(payload.therapistId || payload.userId);
        if (therapist) {
          const pushDedupeKey = `${event}_${entityId}_${therapist.id}_push`;
          if (!(await isDuplicate(pushDedupeKey))) {
            const p = event === "therapist_daily_agenda"
              ? tmpl.formatPush({ agendaSummary: payload.agendaSummary || payload.message })
              : tmpl.formatPush({ patientName: payload.patientName, time: payload.time, city: payload.city });
            try {
              const res = await sendPush({ userId: therapist.id, title: p.title, body: p.body, data: { type: "reminder" } });
              await logAttempt({ userId: therapist.id, event, channel: "push", status: res.success ? "sent" : "skipped", providerMessageId: res.messageId, dedupeKey: pushDedupeKey });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "push", status: "failed", error: err.message, dedupeKey: pushDedupeKey });
            }
          }

          const waDedupeKey = `${event}_${entityId}_${therapist.id}_whatsapp`;
          if (therapist.phone && therapist.whatsapp_opt_in === true && !(await isDuplicate(waDedupeKey))) {
            const schedLink = "https://www.curevan.com/dashboard/therapist/schedule";
            const waText = event === "therapist_daily_agenda"
              ? tmpl.formatWhatsApp({ therapistName: therapist.name, date: payload.date, agendaSummary: payload.agendaSummary, link: schedLink })
              : tmpl.formatWhatsApp({ therapistName: therapist.name, patientName: payload.patientName, time: payload.time, city: payload.city, link: schedLink });
            const waParams = event === "therapist_daily_agenda"
              ? [therapist.name || "Doctor", payload.date, payload.agendaSummary || "Your schedule", schedLink]
              : [therapist.name || "Doctor", payload.patientName || "Patient", payload.time, payload.city || "Vadodara", schedLink];
            try {
              const res = await sendWhatsApp({
                to: therapist.phone,
                text: waText,
                templateName: tmpl.metaTemplateName,
                templateParams: waParams,
              });
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey: waDedupeKey });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey: waDedupeKey });
            }
          }
        }
        break;
      }

      // 6. therapist_on_the_way: Patient & Caregivers: WhatsApp + Push
      case "therapist_on_the_way": {
        const patient = await getUser(payload.patientId || payload.userId);
        const bookingLink = payload.link || "https://www.curevan.com/dashboard/bookings";
        if (patient) {
          const caregivers = await getConsentedCaregivers(patient.id);
          const recipients = [patient, ...caregivers];

          for (const r of recipients) {
            const dedupeKey = `therapist_ontheway_${entityId}_${r.id}_whatsapp`;
            if (r.phone && r.whatsapp_opt_in === true && !(await isDuplicate(dedupeKey))) {
              const text = tmpl.formatWhatsApp({ patientName: r.name, therapistName: payload.therapistName, time: payload.time, link: bookingLink });
              try {
                const res = await sendWhatsApp({
                  to: r.phone,
                  text,
                  templateName: tmpl.metaTemplateName,
                  templateParams: [r.name || "there", payload.therapistName || "Therapist", payload.time, bookingLink],
                });
                await logAttempt({ userId: r.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
              } catch (err) {
                await logAttempt({ userId: r.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
              }
            }
          }

          const pushDedupeKey = `therapist_ontheway_${entityId}_${patient.id}_push`;
          if (!(await isDuplicate(pushDedupeKey))) {
            const p = tmpl.formatPush({ therapistName: payload.therapistName, time: payload.time });
            try {
              const pRes = await sendPush({ userId: patient.id, title: p.title, body: p.body, data: { type: "booking" } });
              await logAttempt({ userId: patient.id, event, channel: "push", status: pRes.success ? "sent" : "skipped", providerMessageId: pRes.messageId, dedupeKey: pushDedupeKey });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "push", status: "failed", error: err.message, dedupeKey: pushDedupeKey });
            }
          }
        }
        break;
      }

      // 7. session_completed_review: Patient: WhatsApp + in-app
      case "session_completed_review": {
        const patient = await getUser(payload.patientId || payload.userId);
        const bookingLink = payload.link || "https://www.curevan.com/dashboard/bookings";
        if (patient) {
          const dedupeKey = `session_completed_${entityId}_${patient.id}_whatsapp`;
          if (patient.phone && patient.whatsapp_opt_in === true && !(await isDuplicate(dedupeKey))) {
            const text = tmpl.formatWhatsApp({ patientName: patient.name, therapistName: payload.therapistName, link: bookingLink });
            try {
              const res = await sendWhatsApp({
                to: patient.phone,
                text,
                templateName: tmpl.metaTemplateName,
                templateParams: [patient.name || "there", payload.therapistName || "your therapist", bookingLink],
              });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
            }
          }

          const inAppDedupeKey = `session_completed_${entityId}_${patient.id}_inapp`;
          if (tmpl.formatInApp && !(await isDuplicate(inAppDedupeKey))) {
            try {
              const inApp = tmpl.formatInApp({ therapistName: payload.therapistName, link: bookingLink });
              const res = await sendInApp({ userId: patient.id, type: "review", title: inApp.title, message: inApp.message, link: inApp.link });
              await logAttempt({ userId: patient.id, event, channel: "inapp", template: event, status: "sent", providerMessageId: res.notificationId, dedupeKey: inAppDedupeKey });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "inapp", status: "failed", error: err.message, dedupeKey: inAppDedupeKey });
            }
          }
        }
        break;
      }

      // 8. progress_report_ready & pcr_pdf_ready
      case "progress_report_ready":
      case "pcr_pdf_ready": {
        const patient = await getUser(payload.patientId || payload.userId);
        const caregivers = event === "progress_report_ready" ? await getConsentedCaregivers(patient?.id) : [];
        const recipients = [patient, ...caregivers].filter(Boolean);
        const reportLink = payload.link || "https://www.curevan.com/dashboard/patient/progress";

        for (const r of recipients) {
          const dedupeKey = `${event}_${entityId}_${r.id}_whatsapp`;
          if (r.phone && r.whatsapp_opt_in === true && !(await isDuplicate(dedupeKey))) {
            const text = event === "progress_report_ready"
              ? tmpl.formatWhatsApp({ patientName: r.name, therapistName: payload.therapistName, link: reportLink })
              : tmpl.formatWhatsApp({ patientName: r.name, sessionNumber: payload.sessionNumber, date: payload.date, link: reportLink });
            const params = event === "progress_report_ready"
              ? [r.name || "there", payload.therapistName || "Doctor", reportLink]
              : [r.name || "there", String(payload.sessionNumber || "1"), payload.date || "", reportLink];
            try {
              const res = await sendWhatsApp({ to: r.phone, text, templateName: tmpl.metaTemplateName, templateParams: params });
              await logAttempt({ userId: r.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: r.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
            }
          }

          if (r.email && tmpl.formatEmail) {
            const emailDedupeKey = `${event}_${entityId}_${r.id}_email`;
            if (!(await isDuplicate(emailDedupeKey))) {
              try {
                const mail = event === "progress_report_ready"
                  ? tmpl.formatEmail({ patientName: r.name, therapistName: payload.therapistName, link: reportLink })
                  : tmpl.formatEmail({ patientName: r.name, sessionNumber: payload.sessionNumber, date: payload.date, link: reportLink });
                const res = await sendEmail({ to: r.email, subject: mail.subject, text: mail.text, html: mail.html });
                await logAttempt({ userId: r.id, event, channel: "email", template: `${event}_email`, status: "sent", providerMessageId: res.messageId, dedupeKey: emailDedupeKey });
              } catch (err) {
                await logAttempt({ userId: r.id, event, channel: "email", status: "failed", error: err.message, dedupeKey: emailDedupeKey });
              }
            }
          }
        }
        break;
      }

      // 9. booking_cancelled / booking_reassigned:
      // Patient: WhatsApp + Caregivers
      // Therapist: WhatsApp (if cancelled) + Push + InApp
      // Therapy Admin: WhatsApp (if cancelled) + InApp
      case "booking_cancelled":
      case "booking_reassigned": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);
        const oldTherapist = await getUser(payload.oldTherapistId);
        const bookingLink = payload.link || "https://www.curevan.com/dashboard/bookings";

        if (patient) {
          const caregivers = await getConsentedCaregivers(patient.id);
          const recipients = [patient, ...caregivers];

          for (const r of recipients) {
            const dedupeKey = `${event}_patient_${entityId}_${r.id}_whatsapp`;
            if (r.phone && r.whatsapp_opt_in === true && !(await isDuplicate(dedupeKey))) {
              const text = event === "booking_cancelled"
                ? tmpl.formatWhatsApp({ patientName: r.name, date: payload.date, time: payload.time, reason: payload.reason })
                : tmpl.formatWhatsApp({ patientName: r.name, date: payload.date, time: payload.time, newTherapistName: payload.newTherapistName, link: bookingLink });
              const params = event === "booking_cancelled"
                ? [r.name || "there", payload.date, payload.time, payload.reason || "Patient request"]
                : [r.name || "there", payload.date, payload.time, payload.newTherapistName || "Doctor", bookingLink];
              try {
                const res = await sendWhatsApp({ to: r.phone, text, templateName: tmpl.metaTemplateName, templateParams: params });
                await logAttempt({ userId: r.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
              } catch (err) {
                await logAttempt({ userId: r.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
              }
            }
          }
        }

        // Therapist alerts
        const therapistsToNotify = [therapist, oldTherapist].filter(Boolean);
        for (const t of therapistsToNotify) {
          if (event === "booking_cancelled" && TEMPLATES.therapist_booking_cancelled) {
            const tTmpl = TEMPLATES.therapist_booking_cancelled;
            const dedupeKey = `booking_cancelled_therapist_${entityId}_${t.id}_whatsapp`;
            if (t.phone && t.whatsapp_opt_in === true && !(await isDuplicate(dedupeKey))) {
              try {
                const text = tTmpl.formatWhatsApp({ therapistName: t.name, date: payload.date, time: payload.time, reason: payload.reason });
                const res = await sendWhatsApp({ to: t.phone, text, templateName: tTmpl.metaTemplateName, templateParams: [t.name || "Doctor", payload.date, payload.time, payload.reason || "Cancelled"] });
                await logAttempt({ userId: t.id, event, channel: "whatsapp", template: tTmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
              } catch (err) {
                await logAttempt({ userId: t.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey });
              }
            }
          }

          const pushDedupeKey = `${event}_therapist_${entityId}_${t.id}_push`;
          if (!(await isDuplicate(pushDedupeKey))) {
            try {
              const pRes = await sendPush({
                userId: t.id,
                title: event === "booking_cancelled" ? "Booking Cancelled" : "Booking Reassigned",
                body: `Session on ${payload.date} at ${payload.time} has been ${event === "booking_cancelled" ? "cancelled" : "reassigned"}.`,
              });
              await logAttempt({ userId: t.id, event, channel: "push", status: pRes.success ? "sent" : "skipped", providerMessageId: pRes.messageId, dedupeKey: pushDedupeKey });
            } catch (err) {
              await logAttempt({ userId: t.id, event, channel: "push", status: "failed", error: err.message, dedupeKey: pushDedupeKey });
            }
          }
        }

        // Therapy Admin alerts
        if (event === "booking_cancelled" && TEMPLATES.admin_booking_cancelled) {
          const adminTmpl = TEMPLATES.admin_booking_cancelled;
          const therapyAdmins = await getAdminWhatsAppUsers("admin.therapy");
          for (const a of therapyAdmins) {
            const dedupeKey = `booking_cancelled_admin_${entityId}_${a.id}_whatsapp`;
            if (!(await isDuplicate(dedupeKey))) {
              try {
                const text = adminTmpl.formatWhatsApp({ adminName: a.name, bookingId: entityId, date: payload.date, time: payload.time, reason: payload.reason });
                const res = await sendWhatsApp({ to: a.phone, text, templateName: adminTmpl.metaTemplateName, templateParams: [a.name || "Admin", String(entityId), payload.date, payload.time, payload.reason || "Cancelled"] });
                await logAttempt({ userId: a.id, event, channel: "whatsapp", template: adminTmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
              } catch (err) {
                await logAttempt({ userId: a.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey });
              }
            }
          }
        }
        break;
      }

      // 10. followup workflows (proposed, nudge, expired, no_slot, overdue)
      case "followup_proposed":
      case "followup_nudge":
      case "followup_expired":
      case "followup_no_slot":
      case "followup_overdue": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);
        const link = payload.link || "https://www.curevan.com/dashboard/bookings";

        if (patient) {
          const dedupeKey = `${event}_patient_${entityId}_${patient.id}_whatsapp`;
          if (patient.phone && patient.whatsapp_opt_in === true && tmpl?.formatWhatsApp && !(await isDuplicate(dedupeKey))) {
            const text = tmpl.formatWhatsApp({
              patientName: patient.name,
              therapistName: payload.therapistName || therapist?.name,
              date: payload.date,
              time: payload.time,
              link,
            });
            const params = event === "followup_proposed"
              ? [patient.name || "there", payload.therapistName || therapist?.name || "your therapist", payload.date, payload.time, link]
              : event === "followup_nudge"
              ? [patient.name || "there", payload.date, payload.time, link]
              : event === "followup_expired"
              ? [patient.name || "there", payload.date, link]
              : [patient.name || "there", link];
            try {
              const res = await sendWhatsApp({ to: patient.phone, text, templateName: tmpl.metaTemplateName, templateParams: params });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
            }
          }
        }
        break;
      }

      // 11. order workflows (paid, shipped, delivered, return_request, refund)
      case "order_paid":
      case "order_shipped":
      case "order_delivered":
      case "refund_processed":
      case "return_requested": {
        const customer = await getUser(payload.userId || payload.customerId);
        const trackLink = payload.link || "https://www.curevan.com/dashboard/orders";

        // Customer WhatsApp
        if (customer && customer.phone && customer.whatsapp_opt_in === true && tmpl?.formatWhatsApp) {
          const dedupeKey = `${event}_customer_${entityId}_${customer.id}_whatsapp`;
          if (!(await isDuplicate(dedupeKey))) {
            const text = tmpl.formatWhatsApp({
              customerName: customer.name,
              amount: payload.amount,
              orderNumber: payload.orderNumber || entityId,
              courier: payload.courier,
              awb: payload.awb,
              reference: payload.reference,
              refundId: payload.refundId,
              link: trackLink,
            });
            const params = event === "order_paid"
              ? [customer.name || "Customer", String(payload.amount), String(payload.orderNumber || entityId), trackLink]
              : event === "order_shipped"
              ? [customer.name || "Customer", String(payload.orderNumber || entityId), payload.courier || "courier", payload.awb || "", trackLink]
              : event === "order_delivered"
              ? [customer.name || "Customer", String(payload.orderNumber || entityId), trackLink]
              : [customer.name || "Customer", String(payload.amount), String(payload.reference || entityId), String(payload.refundId || "")] ;
            try {
              const res = await sendWhatsApp({ to: customer.phone, text, templateName: tmpl.metaTemplateName, templateParams: params });
              await logAttempt({ userId: customer.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: customer.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
            }
          }
        }

        // Customer Email
        if (customer && customer.email && tmpl?.formatEmail) {
          const emailDedupeKey = `${event}_customer_${entityId}_${customer.id}_email`;
          if (!(await isDuplicate(emailDedupeKey))) {
            try {
              const mail = tmpl.formatEmail({
                customerName: customer.name,
                amount: payload.amount,
                orderNumber: payload.orderNumber || entityId,
                courier: payload.courier,
                awb: payload.awb,
                reference: payload.reference,
                refundId: payload.refundId,
                link: trackLink,
              });
              const res = await sendEmail({ to: customer.email, subject: mail.subject, text: mail.text, html: mail.html });
              await logAttempt({ userId: customer.id, event, channel: "email", template: `${event}_email`, status: "sent", providerMessageId: res.messageId, dedupeKey: emailDedupeKey });
            } catch (err) {
              await logAttempt({ userId: customer.id, event, channel: "email", status: "failed", error: err.message, dedupeKey: emailDedupeKey });
            }
          }
        }

        // E-com Admin WhatsApp alerts
        const ecomAdmins = await getAdminWhatsAppUsers("admin.ecom");
        let adminEventTmpl = null;
        let adminParams = [];

        if (event === "order_paid" && TEMPLATES.admin_new_order) {
          adminEventTmpl = TEMPLATES.admin_new_order;
          adminParams = [String(payload.orderNumber || entityId), String(payload.amount), "https://www.curevan.com/dashboard/ecom-admin/orders"];
        } else if (event === "order_delivered" && TEMPLATES.admin_order_delivered) {
          adminEventTmpl = TEMPLATES.admin_order_delivered;
          adminParams = [String(payload.orderNumber || entityId), "https://www.curevan.com/dashboard/ecom-admin/orders"];
        } else if (event === "return_requested" && TEMPLATES.admin_return_request) {
          adminEventTmpl = TEMPLATES.admin_return_request;
          adminParams = [String(payload.orderNumber || entityId), payload.reason || "Return request", "https://www.curevan.com/dashboard/ecom-admin/returns"];
        }

        if (adminEventTmpl) {
          for (const adm of ecomAdmins) {
            const dedupeKey = `${adminEventTmpl.name}_${entityId}_${adm.id}_whatsapp`;
            if (!(await isDuplicate(dedupeKey))) {
              try {
                const text = adminEventTmpl.formatWhatsApp({
                  adminName: adm.name,
                  orderNumber: payload.orderNumber || entityId,
                  amount: payload.amount,
                  reason: payload.reason,
                  link: adminParams[adminParams.length - 1],
                });
                const res = await sendWhatsApp({
                  to: adm.phone,
                  text,
                  templateName: adminEventTmpl.metaTemplateName,
                  templateParams: [adm.name || "Admin", ...adminParams],
                });
                await logAttempt({ userId: adm.id, event, channel: "whatsapp", template: adminEventTmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
              } catch (err) {
                await logAttempt({ userId: adm.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey });
              }
            }
          }
        }
        break;
      }

      // 12. low stock alert (E-com Admin, daily max 1 send)
      case "admin_low_stock": {
        const todayStr = new Date().toISOString().slice(0, 10);
        const ecomAdmins = await getAdminWhatsAppUsers("admin.ecom");
        const adminTmpl = TEMPLATES.admin_low_stock;
        const link = "https://www.curevan.com/dashboard/ecom-admin/inventory";

        for (const adm of ecomAdmins) {
          const dedupeKey = `admin_low_stock_${todayStr}_${adm.id}_whatsapp`;
          if (adminTmpl && !(await isDuplicate(dedupeKey))) {
            try {
              const text = adminTmpl.formatWhatsApp({ adminName: adm.name, count: payload.count || "several", link });
              const res = await sendWhatsApp({
                to: adm.phone,
                text,
                templateName: adminTmpl.metaTemplateName,
                templateParams: [adm.name || "Admin", String(payload.count || "several"), link],
              });
              await logAttempt({ userId: adm.id, event, channel: "whatsapp", template: adminTmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: adm.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey });
            }
          }
        }
        break;
      }

      // 13. payout_paid: Therapist: WhatsApp + Email
      case "payout_paid": {
        const therapist = await getUser(payload.therapistId || payload.userId);
        const stmtLink = payload.link || "https://www.curevan.com/dashboard/earnings";
        if (therapist) {
          const dedupeKey = `payout_paid_${entityId}_${therapist.id}_whatsapp`;
          if (therapist.phone && therapist.whatsapp_opt_in === true && !(await isDuplicate(dedupeKey))) {
            const text = tmpl.formatWhatsApp({
              therapistName: therapist.name,
              amount: payload.amount,
              week: payload.week,
              utr: payload.utr,
              link: stmtLink,
            });
            try {
              const res = await sendWhatsApp({
                to: therapist.phone,
                text,
                templateName: tmpl.metaTemplateName,
                templateParams: [therapist.name || "Doctor", String(payload.amount), payload.week || "", payload.utr || "", stmtLink],
              });
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
            }
          }

          if (therapist.email) {
            const emailDedupeKey = `payout_paid_${entityId}_${therapist.id}_email`;
            if (!(await isDuplicate(emailDedupeKey))) {
              try {
                const mail = tmpl.formatEmail({
                  therapistName: therapist.name,
                  amount: payload.amount,
                  week: payload.week,
                  utr: payload.utr,
                  link: stmtLink,
                });
                const res = await sendEmail({ to: therapist.email, subject: mail.subject, text: mail.text, html: mail.html });
                await logAttempt({ userId: therapist.id, event, channel: "email", template: "payout_paid_email", status: "sent", providerMessageId: res.messageId, dedupeKey: emailDedupeKey });
              } catch (err) {
                await logAttempt({ userId: therapist.id, event, channel: "email", status: "failed", error: err.message, dedupeKey: emailDedupeKey });
              }
            }
          }
        }
        break;
      }

      // 14. sos_raised: Super Admin & Therapy Admin: WhatsApp + Push + On-call SMS
      case "sos_raised": {
        const onCallPhone = process.env.ONCALL_PHONE || "919876543210";
        const smsDedupeKey = `sos_raised_${entityId}_oncall_sms`;
        if (!(await isDuplicate(smsDedupeKey))) {
          const smsText = tmpl.formatSms({
            therapistName: payload.therapistName,
            phone: payload.phone,
            bookingId: payload.bookingId || entityId,
            time: payload.time || new Date().toLocaleTimeString("en-IN"),
            lat: payload.lat,
            lng: payload.lng,
          });
          try {
            const res = await sendSms({
              to: onCallPhone,
              text: smsText,
              dltTemplateId: tmpl.dltTemplateId,
              dltEntityId: tmpl.dltEntityId,
              dltSenderId: tmpl.dltSenderId,
            });
            await logAttempt({ userId: null, event, channel: "sms", template: tmpl.dltTemplateId, status: "sent", providerMessageId: res.messageId, dedupeKey: smsDedupeKey });
          } catch (err) {
            await logAttempt({ userId: null, event, channel: "sms", template: tmpl.dltTemplateId, status: "failed", error: err.message, dedupeKey: smsDedupeKey });
          }
        }

        // WhatsApp alerts to Super Admin & Therapy Admin
        const sosAdmins = [
          ...(await getAdminWhatsAppUsers("admin.super")),
          ...(await getAdminWhatsAppUsers("admin.therapy")),
        ];
        const adminTmpl = TEMPLATES.admin_sos;
        const mapLink = "https://www.curevan.com/dashboard/therapy-admin";

        for (const a of sosAdmins) {
          const dedupeKey = `sos_raised_admin_${entityId}_${a.id}_whatsapp`;
          if (adminTmpl && !(await isDuplicate(dedupeKey))) {
            try {
              const text = adminTmpl.formatWhatsApp({
                adminName: a.name,
                bookingId: payload.bookingId || entityId,
                therapistName: payload.therapistName,
                link: mapLink,
              });
              const res = await sendWhatsApp({
                to: a.phone,
                text,
                templateName: adminTmpl.metaTemplateName,
                templateParams: [a.name || "Admin", String(payload.bookingId || entityId), payload.therapistName || "Therapist", mapLink],
              });
              await logAttempt({ userId: a.id, event, channel: "whatsapp", template: adminTmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: a.id, event, channel: "whatsapp", status: "failed", error: err.message, dedupeKey });
            }
          }
        }

        // Push to clinical admins
        const allAdmins = await getAdminUsers(["admin.super", "admin.therapy"]);
        for (const a of allAdmins) {
          const pushDedupeKey = `sos_raised_admin_${entityId}_${a.id}_push`;
          if (!(await isDuplicate(pushDedupeKey))) {
            try {
              const p = tmpl.formatPush({ therapistName: payload.therapistName, bookingId: payload.bookingId || entityId });
              const res = await sendPush({ userId: a.id, title: p.title, body: p.body, data: p.data });
              await logAttempt({ userId: a.id, event, channel: "push", status: res.success ? "sent" : "skipped", providerMessageId: res.messageId, dedupeKey: pushDedupeKey });
            } catch (err) {
              await logAttempt({ userId: a.id, event, channel: "push", status: "failed", error: err.message, dedupeKey: pushDedupeKey });
            }
          }
        }
        break;
      }

      // Default fallback
      default: {
        const user = await getUser(payload.userId || payload.patientId || payload.therapistId);
        if (user) {
          const dedupeKey = `${event}_${entityId}_${user.id}_whatsapp`;
          if (user.phone && user.whatsapp_opt_in === true && tmpl?.formatWhatsApp && !(await isDuplicate(dedupeKey))) {
            const text = tmpl.formatWhatsApp({
              patientName: user.name,
              therapistName: payload.therapistName,
              date: payload.date,
              time: payload.time,
              sessionNumber: payload.sessionNumber,
              newTherapistName: payload.newTherapistName,
              link: payload.link,
              reason: payload.reason,
            });
            try {
              const res = await sendWhatsApp({ to: user.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: user.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId, dedupeKey });
            } catch (err) {
              await logAttempt({ userId: user.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message, dedupeKey });
            }
          }

          if (tmpl?.formatInApp) {
            const inAppDedupeKey = `${event}_${entityId}_${user.id}_inapp`;
            if (!(await isDuplicate(inAppDedupeKey))) {
              try {
                const inApp = tmpl.formatInApp(payload);
                const res = await sendInApp({ userId: user.id, type: "system", title: inApp.title, message: inApp.message, link: inApp.link });
                await logAttempt({ userId: user.id, event, channel: "inapp", template: event, status: "sent", providerMessageId: res.notificationId, dedupeKey: inAppDedupeKey });
              } catch (err) {
                await logAttempt({ userId: user.id, event, channel: "inapp", status: "failed", error: err.message, dedupeKey: inAppDedupeKey });
              }
            }
          }
        }
        break;
      }
    }
    return { success: true, event };
  } catch (err) {
    console.error(`Notification dispatch failed for event '${event}':`, err.message);
    return { success: false, event, error: err.message };
  }
}

/**
 * Direct email sender helper (logged).
 */
async function sendEmailLogged({ to, subject, html, text, attachments, userId = null, event = "direct_email" }) {
  const template = String(subject || "").slice(0, 80);
  try {
    const out = await sendEmail({ to, subject, html, text, attachments });
    await logAttempt({ userId, event, channel: "email", template, status: "sent", providerMessageId: out && out.messageId });
    return out;
  } catch (err) {
    await logAttempt({ userId, event, channel: "email", template, status: "failed", error: err && err.message });
    throw err;
  }
}

module.exports = { notify, logAttempt, getUser, sendEmailLogged, getAdminWhatsAppUsers, isDuplicate };
