/**
 * Unified Notification Dispatcher (P24).
 * Coordinates multi-channel delivery across WhatsApp, SMS (DLT), Email, Push and In-App.
 * Strictly adheres to:
 *   - No marketing text in utility templates.
 *   - Never send OTP by email or log it.
 *   - WhatsApp failure -> SMS fallback for OTP and booking confirmation.
 *   - Every attempt logged in notification_log table.
 */
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
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
    `SELECT DISTINCT u.id, u.name, u.phone, u.email, u.fcm_token
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.name IN (:roles)`,
    { replacements: { roles: roleNames }, type: QueryTypes.SELECT }
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

async function logAttempt({ userId, event, channel, template, status, providerMessageId, error }) {
  try {
    // Sanitization: Ensure NO OTP is ever written into logs (P24 global boundary rule)
    const sanitizedError = error
      ? String(error)
          .replace(/\b\d{4,6}\b/g, "[REDACTED]")
          .slice(0, 500)
      : null;

    await sequelize.query(
      `INSERT INTO notification_log (user_id, event, channel, template, status, provider_message_id, error, created_at)
       VALUES (:uid, :event, :channel, :template, :status, :msgId, :err, NOW())`,
      {
        replacements: {
          uid: userId || null,
          event,
          channel,
          template: template || null,
          status,
          msgId: providerMessageId ? String(providerMessageId).slice(0, 255) : null,
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
  if (!tmpl) {
    console.warn(`[notify] Unknown event '${event}'`);
    return { success: false, error: `Unknown event: ${event}` };
  }

  try {
    switch (event) {
      // 1. booking_confirmed: Patient: WhatsApp (OTP) + SMS fallback (OTP) + InApp + Email (NO OTP). Therapist: Push + InApp.
      case "booking_confirmed": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);
        const otp = payload.otp || payload.startOtp || "";

        if (patient) {
          const waText = tmpl.formatWhatsApp({
            patientName: patient.name,
            therapistName: payload.therapistName || therapist?.name,
            date: payload.date,
            time: payload.time,
            locality: payload.locality,
            otp,
            link: payload.link,
          });

          // WhatsApp attempt
          let waSuccess = false;
          if (patient.phone && patient.whatsapp_opt_in !== false) {
            try {
              const res = await sendWhatsApp({
                to: patient.phone,
                text: waText,
                templateName: tmpl.metaTemplateName,
                templateParams: [
                  patient.name || "there",
                  payload.therapistName || therapist?.name || "therapist",
                  payload.date,
                  payload.time,
                  payload.locality || "Home",
                  otp,
                  payload.link || "https://curevan.com/dashboard/bookings",
                ],
              });
              await logAttempt({
                userId: patient.id,
                event,
                channel: "whatsapp",
                template: tmpl.metaTemplateName,
                status: "sent",
                providerMessageId: res.messageId,
              });
              waSuccess = true;
            } catch (err) {
              await logAttempt({
                userId: patient.id,
                event,
                channel: "whatsapp",
                template: tmpl.metaTemplateName,
                status: "failed",
                error: err.message,
              });
            }
          }

          // If WhatsApp failed or user opted out: fallback to SMS
          if (!waSuccess && patient.phone) {
            const smsText = tmpl.formatSms({
              therapistName: payload.therapistName || therapist?.name,
              date: payload.date,
              time: payload.time,
              otp,
            });
            try {
              const res = await sendSms({
                to: patient.phone,
                text: smsText,
                dltTemplateId: tmpl.dltTemplateId,
                dltEntityId: tmpl.dltEntityId,
                dltSenderId: tmpl.dltSenderId,
              });
              await logAttempt({
                userId: patient.id,
                event,
                channel: "sms",
                template: tmpl.dltTemplateId,
                status: "sent",
                providerMessageId: res.messageId,
              });
            } catch (err) {
              await logAttempt({
                userId: patient.id,
                event,
                channel: "sms",
                template: tmpl.dltTemplateId,
                status: "failed",
                error: err.message,
              });
            }
          }

          // In-App for Patient (safe link, code in dashboard)
          try {
            const res = await sendInApp({
              userId: patient.id,
              type: "booking",
              title: "Booking Confirmed",
              message: `Your session with ${payload.therapistName || therapist?.name || "therapist"} on ${payload.date} at ${payload.time} is confirmed.`,
              link: "/dashboard/bookings",
            });
            await logAttempt({
              userId: patient.id,
              event,
              channel: "inapp",
              template: "booking_confirmed",
              status: "sent",
              providerMessageId: res.notificationId,
            });
          } catch (err) {
            await logAttempt({ userId: patient.id, event, channel: "inapp", status: "failed", error: err.message });
          }

          // E-Mail for Patient (strictly WITHOUT OTP)
          if (patient.email) {
            const mail = tmpl.formatEmail({
              patientName: patient.name,
              therapistName: payload.therapistName || therapist?.name,
              date: payload.date,
              time: payload.time,
              locality: payload.locality,
              link: payload.link,
            });
            try {
              const res = await sendEmail({
                to: patient.email,
                subject: mail.subject,
                text: mail.text,
                html: mail.html,
              });
              await logAttempt({
                userId: patient.id,
                event,
                channel: "email",
                template: "booking_confirmed_email",
                status: "sent",
                providerMessageId: res.messageId,
              });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "email", status: "failed", error: err.message });
            }
          }
        }

        // Therapist: Push + In-App
        if (therapist) {
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
            });
          } catch (err) {
            await logAttempt({ userId: therapist.id, event, channel: "push", status: "failed", error: err.message });
          }

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
            });
          } catch (err) {
            await logAttempt({ userId: therapist.id, event, channel: "inapp", status: "failed", error: err.message });
          }
        }
        break;
      }

      // 2. reminders (24h, 2h): Patient: WhatsApp utility + SMS fallback
      case "reminder_24h":
      case "reminder_2h": {
        const patient = await getUser(payload.patientId || payload.userId);
        if (patient) {
          const waText = tmpl.formatWhatsApp({
            patientName: patient.name,
            therapistName: payload.therapistName,
            time: payload.time,
            link: payload.link,
          });

          let waOk = false;
          if (patient.phone && patient.whatsapp_opt_in !== false) {
            try {
              const res = await sendWhatsApp({ to: patient.phone, text: waText, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
              waOk = true;
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          // Fallback to SMS if WhatsApp failed or not opted in
          if (!waOk && patient.phone) {
            const smsText = tmpl.formatSms({
              therapistName: payload.therapistName,
              time: payload.time,
              link: payload.link,
            });
            try {
              const res = await sendSms({
                to: patient.phone,
                text: smsText,
                dltTemplateId: tmpl.dltTemplateId,
                dltEntityId: tmpl.dltEntityId,
                dltSenderId: tmpl.dltSenderId,
              });
              await logAttempt({ userId: patient.id, event, channel: "sms", template: tmpl.dltTemplateId, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "sms", template: tmpl.dltTemplateId, status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 3. reminder_30_min: Patient: WhatsApp; Therapist: Push
      case "reminder_30_min": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);

        if (patient && patient.phone && patient.whatsapp_opt_in !== false) {
          const text = tmpl.formatWhatsApp({
            patientName: patient.name,
            therapistName: payload.therapistName || therapist?.name,
            time: payload.time,
          });
          try {
            const res = await sendWhatsApp({ to: patient.phone, text, templateName: tmpl.metaTemplateName });
            await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
          } catch (err) {
            await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
          }
        }

        if (therapist) {
          const p = tmpl.formatPush({ patientName: patient?.name, time: payload.time });
          try {
            const res = await sendPush({ userId: therapist.id, title: p.title, body: p.body, data: { type: "reminder" } });
            await logAttempt({ userId: therapist.id, event, channel: "push", status: res.success ? "sent" : "skipped", providerMessageId: res.messageId });
          } catch (err) {
            await logAttempt({ userId: therapist.id, event, channel: "push", status: "failed", error: err.message });
          }
        }
        break;
      }

      // 4. therapist reminders: agenda & 60min (Therapist: WhatsApp or Push)
      case "therapist_daily_agenda":
      case "therapist_60min": {
        const therapist = await getUser(payload.therapistId || payload.userId);
        if (therapist) {
          const p = event === "therapist_daily_agenda"
            ? tmpl.formatPush({ agendaSummary: payload.agendaSummary || payload.message })
            : tmpl.formatPush({ patientName: payload.patientName, time: payload.time, city: payload.city });

          try {
            const res = await sendPush({ userId: therapist.id, title: p.title, body: p.body, data: { type: "reminder" } });
            await logAttempt({ userId: therapist.id, event, channel: "push", status: res.success ? "sent" : "skipped", providerMessageId: res.messageId });
          } catch (err) {
            await logAttempt({ userId: therapist.id, event, channel: "push", status: "failed", error: err.message });
          }

          if (therapist.phone && therapist.whatsapp_opt_in !== false) {
            const waText = event === "therapist_daily_agenda"
              ? tmpl.formatWhatsApp({ therapistName: therapist.name, date: payload.date, agendaSummary: payload.agendaSummary, link: payload.link })
              : tmpl.formatWhatsApp({ therapistName: therapist.name, patientName: payload.patientName, time: payload.time, city: payload.city, link: payload.link });
            try {
              const res = await sendWhatsApp({ to: therapist.phone, text: waText, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 5. followup workflows:
      // - followup_proposed / followup_nudge: WhatsApp + in-app
      // - followup_expired / followup_no_slot: Patient: WhatsApp + in-app; Therapist: push + in-app
      // - followup_overdue: Patient: WhatsApp + in-app; Therapist: in-app; Admin: in-app
      case "followup_proposed":
      case "followup_nudge":
      case "followup_expired":
      case "followup_no_slot":
      case "followup_overdue": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);

        if (patient) {
          if (patient.phone && patient.whatsapp_opt_in !== false && tmpl.formatWhatsApp) {
            const text = tmpl.formatWhatsApp({
              patientName: patient.name,
              therapistName: payload.therapistName || therapist?.name,
              date: payload.date,
              time: payload.time,
              link: payload.link,
            });
            try {
              const res = await sendWhatsApp({ to: patient.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          if (tmpl.formatInApp) {
            const inApp = tmpl.formatInApp({
              therapistName: payload.therapistName || therapist?.name,
              date: payload.date,
              time: payload.time,
              count: payload.count,
              link: payload.link,
            });
            try {
              const res = await sendInApp({ userId: patient.id, type: event, title: inApp.title, message: inApp.message, link: inApp.link });
              await logAttempt({ userId: patient.id, event, channel: "inapp", template: event, status: "sent", providerMessageId: res.notificationId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "inapp", status: "failed", error: err.message });
            }
          }
        }

        // Therapist push & in-app for expired / no slot
        if ((event === "followup_expired" || event === "followup_no_slot") && therapist) {
          try {
            const pRes = await sendPush({
              userId: therapist.id,
              title: event === "followup_no_slot" ? "Recommended slot unavailable" : "Reserved slot released",
              body: event === "followup_no_slot" ? "A recommended slot was no longer open." : "Recommended slot expired without confirmation.",
            });
            await logAttempt({ userId: therapist.id, event, channel: "push", status: pRes.success ? "sent" : "skipped", providerMessageId: pRes.messageId });
          } catch (err) {
            await logAttempt({ userId: therapist.id, event, channel: "push", status: "failed", error: err.message });
          }

          try {
            const iRes = await sendInApp({
              userId: therapist.id,
              type: event,
              title: event === "followup_no_slot" ? "Slot unavailable" : "Slot released",
              message: event === "followup_no_slot" ? "A recommended slot was not held." : "A held slot has expired.",
              link: "/dashboard/therapist/schedule",
            });
            await logAttempt({ userId: therapist.id, event, channel: "inapp", status: "sent", providerMessageId: iRes.notificationId });
          } catch (err) {
            await logAttempt({ userId: therapist.id, event, channel: "inapp", status: "failed", error: err.message });
          }
        }

        // Overdue also notifies therapist & therapy admin in-app
        if (event === "followup_overdue") {
          if (therapist) {
            try {
              const res = await sendInApp({
                userId: therapist.id,
                type: "clinical_alert",
                title: "Overdue Follow-up",
                message: `Patient ${patient?.name || ""} has no upcoming session booked.`,
                link: "/dashboard/therapist/my-dashboard",
              });
              await logAttempt({ userId: therapist.id, event, channel: "inapp", template: "followup_overdue_therapist", status: "sent", providerMessageId: res.notificationId });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "inapp", status: "failed", error: err.message });
            }
          }

          const admins = await getAdminUsers(["admin.therapy", "admin.super"]);
          for (const a of admins) {
            try {
              const res = await sendInApp({
                userId: a.id,
                type: "clinical_alert",
                title: "Overdue Follow-up Alert",
                message: `Patient #${payload.patientId || ""} has no subsequent session booked.`,
                link: "/dashboard/therapy-admin/overdue",
              });
              await logAttempt({ userId: a.id, event, channel: "inapp", template: "followup_overdue_admin", status: "sent", providerMessageId: res.notificationId });
            } catch (err) {
              await logAttempt({ userId: a.id, event, channel: "inapp", status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 6. hep_daily (Patient: WhatsApp or push - opt-in only)
      case "hep_daily": {
        const patient = await getUser(payload.patientId || payload.userId);
        if (patient) {
          const p = tmpl.formatPush();
          try {
            const pRes = await sendPush({ userId: patient.id, title: p.title, body: p.body, data: { type: "hep", link: payload.link } });
            await logAttempt({ userId: patient.id, event, channel: "push", status: pRes.success ? "sent" : "skipped", providerMessageId: pRes.messageId });
          } catch (err) {
            await logAttempt({ userId: patient.id, event, channel: "push", status: "failed", error: err.message });
          }

          if (patient.phone && patient.whatsapp_opt_in !== false) {
            const text = tmpl.formatWhatsApp({ patientName: patient.name, link: payload.link });
            try {
              const res = await sendWhatsApp({ to: patient.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 7. progress_report_ready: WhatsApp document + in-app + e-mail (to patient and consented caregiver)
      case "progress_report_ready": {
        const patient = await getUser(payload.patientId || payload.userId);
        const caregivers = await getConsentedCaregivers(payload.patientId || payload.userId);
        const recipients = [patient, ...caregivers].filter(Boolean);

        for (const r of recipients) {
          if (r.phone && r.whatsapp_opt_in !== false) {
            const text = tmpl.formatWhatsApp({ patientName: r.name, therapistName: payload.therapistName, link: payload.link });
            try {
              const res = await sendWhatsApp({ to: r.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: r.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: r.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          if (tmpl.formatInApp) {
            const inApp = tmpl.formatInApp();
            try {
              const res = await sendInApp({ userId: r.id, type: "clinical", title: inApp.title, message: inApp.message, link: inApp.link });
              await logAttempt({ userId: r.id, event, channel: "inapp", template: event, status: "sent", providerMessageId: res.notificationId });
            } catch (err) {
              await logAttempt({ userId: r.id, event, channel: "inapp", status: "failed", error: err.message });
            }
          }

          if (r.email) {
            const mail = tmpl.formatEmail({ patientName: r.name, therapistName: payload.therapistName, link: payload.link });
            try {
              const res = await sendEmail({ to: r.email, subject: mail.subject, text: mail.text, html: mail.html });
              await logAttempt({ userId: r.id, event, channel: "email", template: "progress_report_email", status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: r.id, event, channel: "email", status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 8. therapist_on_the_way: Patient: WhatsApp + push
      case "therapist_on_the_way": {
        const patient = await getUser(payload.patientId || payload.userId);
        if (patient) {
          if (patient.phone && patient.whatsapp_opt_in !== false) {
            const text = tmpl.formatWhatsApp({ patientName: patient.name, therapistName: payload.therapistName, time: payload.time });
            try {
              const res = await sendWhatsApp({ to: patient.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          const p = tmpl.formatPush({ therapistName: payload.therapistName, time: payload.time });
          try {
            const pRes = await sendPush({ userId: patient.id, title: p.title, body: p.body, data: { type: "booking" } });
            await logAttempt({ userId: patient.id, event, channel: "push", status: pRes.success ? "sent" : "skipped", providerMessageId: pRes.messageId });
          } catch (err) {
            await logAttempt({ userId: patient.id, event, channel: "push", status: "failed", error: err.message });
          }
        }
        break;
      }

      // 9. session_completed_review: Patient: WhatsApp + in-app
      case "session_completed_review": {
        const patient = await getUser(payload.patientId || payload.userId);
        if (patient) {
          if (patient.phone && patient.whatsapp_opt_in !== false) {
            const text = tmpl.formatWhatsApp({ patientName: patient.name, therapistName: payload.therapistName, link: payload.link });
            try {
              const res = await sendWhatsApp({ to: patient.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          if (tmpl.formatInApp) {
            const inApp = tmpl.formatInApp({ therapistName: payload.therapistName, link: payload.link });
            try {
              const res = await sendInApp({ userId: patient.id, type: "review", title: inApp.title, message: inApp.message, link: inApp.link });
              await logAttempt({ userId: patient.id, event, channel: "inapp", template: event, status: "sent", providerMessageId: res.notificationId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "inapp", status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 10. pcr_pdf_ready: Patient: WhatsApp document + e-mail
      case "pcr_pdf_ready": {
        const patient = await getUser(payload.patientId || payload.userId);
        if (patient) {
          if (patient.phone && patient.whatsapp_opt_in !== false) {
            const text = tmpl.formatWhatsApp({ patientName: patient.name, sessionNumber: payload.sessionNumber, date: payload.date, link: payload.link });
            try {
              const res = await sendWhatsApp({ to: patient.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          if (patient.email) {
            const mail = tmpl.formatEmail({ patientName: patient.name, sessionNumber: payload.sessionNumber, date: payload.date, link: payload.link });
            try {
              const res = await sendEmail({ to: patient.email, subject: mail.subject, text: mail.text, html: mail.html });
              await logAttempt({ userId: patient.id, event, channel: "email", template: "pcr_pdf_ready_email", status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "email", status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 11. booking_cancelled / reassigned:
      // - Patient: WhatsApp + in-app
      // - Therapist: push + in-app
      // - Admin: in-app
      case "booking_cancelled":
      case "booking_reassigned": {
        const patient = await getUser(payload.patientId || payload.userId);
        const therapist = await getUser(payload.therapistId);
        const oldTherapist = await getUser(payload.oldTherapistId);

        // Patient
        if (patient) {
          if (patient.phone && patient.whatsapp_opt_in !== false) {
            const text = tmpl.formatWhatsApp({
              patientName: patient.name,
              date: payload.date,
              time: payload.time,
              reason: payload.reason,
              newTherapistName: payload.newTherapistName,
              link: payload.link,
            });
            try {
              const res = await sendWhatsApp({ to: patient.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          if (tmpl.formatInApp) {
            const inApp = tmpl.formatInApp({
              date: payload.date,
              time: payload.time,
              newTherapistName: payload.newTherapistName,
            });
            try {
              const res = await sendInApp({ userId: patient.id, type: "booking", title: inApp.title, message: inApp.message, link: inApp.link });
              await logAttempt({ userId: patient.id, event, channel: "inapp", template: event, status: "sent", providerMessageId: res.notificationId });
            } catch (err) {
              await logAttempt({ userId: patient.id, event, channel: "inapp", status: "failed", error: err.message });
            }
          }
        }

        // Therapist: push + in-app
        const therapistsToNotify = [therapist, oldTherapist].filter(Boolean);
        for (const t of therapistsToNotify) {
          try {
            const pRes = await sendPush({
              userId: t.id,
              title: event === "booking_cancelled" ? "Booking Cancelled" : "Booking Reassigned",
              body: `Session on ${payload.date} at ${payload.time} has been ${event === "booking_cancelled" ? "cancelled" : "reassigned"}.`,
            });
            await logAttempt({ userId: t.id, event, channel: "push", status: pRes.success ? "sent" : "skipped", providerMessageId: pRes.messageId });
          } catch (err) {
            await logAttempt({ userId: t.id, event, channel: "push", status: "failed", error: err.message });
          }

          try {
            const iRes = await sendInApp({
              userId: t.id,
              type: "booking",
              title: event === "booking_cancelled" ? "Booking Cancelled" : "Booking Reassigned",
              message: `Booking on ${payload.date} at ${payload.time} was ${event === "booking_cancelled" ? "cancelled" : "reassigned"}.`,
              link: "/dashboard/therapist/schedule",
            });
            await logAttempt({ userId: t.id, event, channel: "inapp", status: "sent", providerMessageId: iRes.notificationId });
          } catch (err) {
            await logAttempt({ userId: t.id, event, channel: "inapp", status: "failed", error: err.message });
          }
        }

        // Admin: in-app
        const admins = await getAdminUsers(["admin.therapy", "admin.super"]);
        for (const a of admins) {
          try {
            const res = await sendInApp({
              userId: a.id,
              type: "system",
              title: event === "booking_cancelled" ? "Booking Cancelled" : "Booking Reassigned",
              message: `Appointment for ${patient?.name || "patient"} on ${payload.date} at ${payload.time} was ${event === "booking_cancelled" ? "cancelled" : "reassigned"}.`,
              link: "/dashboard/therapy-admin",
            });
            await logAttempt({ userId: a.id, event, channel: "inapp", template: `${event}_admin`, status: "sent", providerMessageId: res.notificationId });
          } catch (err) {
            await logAttempt({ userId: a.id, event, channel: "inapp", status: "failed", error: err.message });
          }
        }
        break;
      }

      // 12. order workflows (paid, shipped, delivered, refund): Patient: WhatsApp + Email
      case "order_paid":
      case "order_shipped":
      case "order_delivered":
      case "refund_processed": {
        const customer = await getUser(payload.userId || payload.customerId);
        if (customer) {
          if (customer.phone && customer.whatsapp_opt_in !== false && tmpl.formatWhatsApp) {
            const text = tmpl.formatWhatsApp({
              customerName: customer.name,
              amount: payload.amount,
              orderNumber: payload.orderNumber,
              courier: payload.courier,
              awb: payload.awb,
              reference: payload.reference,
              refundId: payload.refundId,
              link: payload.link,
            });
            try {
              const res = await sendWhatsApp({ to: customer.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: customer.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: customer.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          if (customer.email && tmpl.formatEmail) {
            const mail = tmpl.formatEmail({
              customerName: customer.name,
              amount: payload.amount,
              orderNumber: payload.orderNumber,
              courier: payload.courier,
              awb: payload.awb,
              reference: payload.reference,
              refundId: payload.refundId,
              link: payload.link,
            });
            try {
              const res = await sendEmail({ to: customer.email, subject: mail.subject, text: mail.text, html: mail.html });
              await logAttempt({ userId: customer.id, event, channel: "email", template: `${event}_email`, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: customer.id, event, channel: "email", status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 13. payout_paid: Therapist: WhatsApp + Email
      case "payout_paid": {
        const therapist = await getUser(payload.therapistId || payload.userId);
        if (therapist) {
          if (therapist.phone && therapist.whatsapp_opt_in !== false) {
            const text = tmpl.formatWhatsApp({
              therapistName: therapist.name,
              amount: payload.amount,
              week: payload.week,
              utr: payload.utr,
              link: payload.link,
            });
            try {
              const res = await sendWhatsApp({ to: therapist.phone, text, templateName: tmpl.metaTemplateName });
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          if (therapist.email) {
            const mail = tmpl.formatEmail({
              therapistName: therapist.name,
              amount: payload.amount,
              week: payload.week,
              utr: payload.utr,
              link: payload.link,
            });
            try {
              const res = await sendEmail({ to: therapist.email, subject: mail.subject, text: mail.text, html: mail.html });
              await logAttempt({ userId: therapist.id, event, channel: "email", template: "payout_paid_email", status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: therapist.id, event, channel: "email", status: "failed", error: err.message });
            }
          }
        }
        break;
      }

      // 14. sos_raised: Admin: Push + SMS to on-call phone
      case "sos_raised": {
        const onCallPhone = process.env.ONCALL_PHONE || "919876543210";
        const smsText = tmpl.formatSms({
          therapistName: payload.therapistName,
          phone: payload.phone,
          bookingId: payload.bookingId,
          time: payload.time || new Date().toLocaleTimeString("en-IN"),
          lat: payload.lat,
          lng: payload.lng,
        });

        // SMS to on-call
        try {
          const res = await sendSms({
            to: onCallPhone,
            text: smsText,
            dltTemplateId: tmpl.dltTemplateId,
            dltEntityId: tmpl.dltEntityId,
            dltSenderId: tmpl.dltSenderId,
          });
          await logAttempt({ userId: null, event, channel: "sms", template: tmpl.dltTemplateId, status: "sent", providerMessageId: res.messageId });
        } catch (err) {
          await logAttempt({ userId: null, event, channel: "sms", template: tmpl.dltTemplateId, status: "failed", error: err.message });
        }

        // Push to clinical admins
        const admins = await getAdminUsers(["admin.super", "admin.therapy"]);
        for (const a of admins) {
          const p = tmpl.formatPush({ therapistName: payload.therapistName, bookingId: payload.bookingId });
          try {
            const res = await sendPush({ userId: a.id, title: p.title, body: p.body, data: p.data });
            await logAttempt({ userId: a.id, event, channel: "push", status: res.success ? "sent" : "skipped", providerMessageId: res.messageId });
          } catch (err) {
            await logAttempt({ userId: a.id, event, channel: "push", status: "failed", error: err.message });
          }
        }
        break;
      }

      // Generic fallback
      default: {
        const user = await getUser(payload.userId || payload.patientId || payload.therapistId);
        if (user) {
          if (user.phone && user.whatsapp_opt_in !== false && tmpl?.formatWhatsApp) {
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
              await logAttempt({ userId: user.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: user.id, event, channel: "whatsapp", template: tmpl.metaTemplateName, status: "failed", error: err.message });
            }
          }

          if (tmpl?.formatInApp) {
            const inApp = tmpl.formatInApp(payload);
            try {
              const res = await sendInApp({ userId: user.id, type: "system", title: inApp.title, message: inApp.message, link: inApp.link });
              await logAttempt({ userId: user.id, event, channel: "inapp", template: event, status: "sent", providerMessageId: res.notificationId });
            } catch (err) {
              await logAttempt({ userId: user.id, event, channel: "inapp", status: "failed", error: err.message });
            }
          }

          if (user.email && tmpl?.formatEmail) {
            const mail = tmpl.formatEmail(payload);
            try {
              const res = await sendEmail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
              await logAttempt({ userId: user.id, event, channel: "email", template: `${event}_email`, status: "sent", providerMessageId: res.messageId });
            } catch (err) {
              await logAttempt({ userId: user.id, event, channel: "email", status: "failed", error: err.message });
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

module.exports = { notify, logAttempt, getUser };
