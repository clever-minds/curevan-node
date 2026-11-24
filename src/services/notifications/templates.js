/**
 * Approved notification templates for Curevan (P24, P30).
 * Utility and Authentication templates approved for Meta WhatsApp Cloud API and TRAI DLT SMS.
 * Marketing text is strictly forbidden inside utility templates.
 * OTP / Start Code is restricted to AUTHENTICATION category templates only.
 */

const DLT_ENTITY_ID = process.env.DLT_ENTITY_ID || "";
const DLT_SENDER_ID = process.env.DLT_SENDER_ID || "CURVAN";
const SUPPORT_LINE = "Need help? Call +91 95144 46292";

const TEMPLATES = {
  // 1. Booking confirmed (Patient) - Start Code removed (P30)
  booking_confirmed: {
    name: "booking_confirmed",
    category: "UTILITY",
    metaTemplateName: "curevan_booking_confirmed_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan home session with {{2}} is confirmed for {{3}} at {{4}} in {{5}}. View session details: {{6}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "therapist_name", "date", "time", "locality", "link"],
    samples: ["Aarav", "Dr Sharma", "2026-11-25", "10:00 AM", "Alkapuri", "https://www.curevan.com/dashboard/bookings"],
    dltTemplateId: process.env.DLT_TID_BOOKING_CONFIRMED || "",
    dltEntityId: DLT_ENTITY_ID,
    dltSenderId: DLT_SENDER_ID,
    dltApprovedText: "Your Curevan home session with {#var#} is confirmed for {#var#} at {#var#}. Details: {#var#} - Curevan",
    formatWhatsApp: ({ patientName, therapistName, date, time, locality, link }) =>
      `Namaste ${patientName || "there"}, your Curevan home session with ${therapistName || "your therapist"} is confirmed for ${date} at ${time}${locality ? ` in ${locality}` : ""}. View session details: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatSms: ({ therapistName, date, time, link }) =>
      `Your Curevan home session with ${therapistName || "therapist"} is confirmed for ${date} at ${time}. Details: ${link || "https://www.curevan.com/dashboard/bookings"} - Curevan`,
    formatEmail: ({ patientName, therapistName, date, time, locality, link }) => ({
      subject: "Your Curevan Home Session is Confirmed",
      text: `Hello ${patientName || "Patient"},\n\nYour home therapy session with ${therapistName || "your therapist"} is confirmed for ${date} at ${time}${locality ? ` in ${locality}` : ""}.\n\nWhen the therapist arrives, view your secure start code in your patient dashboard.\n\nView booking: ${link || "https://www.curevan.com/dashboard/bookings"}\n\nTeam Curevan`,
      html: `<h3>Your Curevan Home Session is Confirmed</h3><p>Hello ${patientName || "Patient"},</p><p>Your session with <strong>${therapistName || "your therapist"}</strong> is confirmed for <strong>${date} at ${time}</strong>${locality ? ` in ${locality}` : ""}.</p><p><em>For safety, your Start Code is available inside your secure patient dashboard when the therapist arrives.</em></p><p><a href="${link || "https://www.curevan.com/dashboard/bookings"}">View Booking Details</a></p><p>Warm regards,<br>Team Curevan</p>`,
    }),
  },

  // 2. Start Code (Patient AUTHENTICATION template, P30)
  start_code: {
    name: "start_code",
    category: "AUTHENTICATION",
    metaTemplateName: "curevan_start_code",
    metaApprovedText: "Hello {{1}}, your Curevan verification code is {{2}}. For your security, do not share this code.",
    variables: ["patient_name", "start_code"],
    samples: ["Aarav", "4829"],
    dltTemplateId: process.env.DLT_TID_START_CODE || "",
    dltEntityId: DLT_ENTITY_ID,
    dltSenderId: DLT_SENDER_ID,
    dltApprovedText: "Your Curevan session Start Code is {#var#}. Share it with your therapist only upon arrival. - Curevan",
    formatWhatsApp: ({ patientName, otp }) =>
      `Hello ${patientName || "there"}, your Curevan verification code is ${otp}. For your security, do not share this code.`,
    formatSms: ({ otp }) =>
      `Your Curevan session Start Code is ${otp}. Share it with your therapist only upon arrival. - Curevan`,
  },

  // 3. New booking alert (Therapist)
  therapist_new_booking: {
    name: "therapist_new_booking",
    category: "UTILITY",
    metaTemplateName: "curevan_therapist_new_booking_v1",
    metaApprovedText: `Hello {{1}}, you have a new confirmed Curevan session on {{2}} at {{3}} in {{4}}. View details: {{5}}\n${SUPPORT_LINE}`,
    variables: ["therapist_name", "date", "time", "locality", "link"],
    samples: ["Dr Sharma", "2026-11-25", "10:00 AM", "Alkapuri", "https://www.curevan.com/dashboard/therapist/schedule"],
    formatWhatsApp: ({ therapistName, date, time, locality, link }) =>
      `Hello ${therapistName || "Therapist"}, you have a new confirmed Curevan session on ${date} at ${time}${locality ? ` in ${locality}` : ""}. View details: ${link || "https://www.curevan.com/dashboard/therapist/schedule"}\n${SUPPORT_LINE}`,
  },

  // 4. New booking alert (Therapy Admin)
  admin_new_booking: {
    name: "admin_new_booking",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_new_booking_v1",
    metaApprovedText: `Hello {{1}}, a new Curevan booking #{{2}} has been confirmed for {{3}} at {{4}}. View booking: {{5}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "booking_id", "date", "time", "link"],
    samples: ["Admin", "101", "2026-11-25", "10:00 AM", "https://www.curevan.com/dashboard/therapy-admin"],
    formatWhatsApp: ({ adminName, bookingId, date, time, link }) =>
      `Hello ${adminName || "Admin"}, a new Curevan booking #${bookingId || ""} has been confirmed for ${date} at ${time}. View booking: ${link || "https://www.curevan.com/dashboard/therapy-admin"}\n${SUPPORT_LINE}`,
  },

  // 5. Booking payment received (Patient)
  booking_payment_received: {
    name: "booking_payment_received",
    category: "UTILITY",
    metaTemplateName: "curevan_booking_payment_patient_v1",
    metaApprovedText: `Namaste {{1}}, thank you! We received your payment of INR {{2}} for Curevan booking #{{3}}. View details: {{4}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "amount", "booking_id", "link"],
    samples: ["Aarav", "1500", "101", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, amount, bookingId, link }) =>
      `Namaste ${patientName || "there"}, thank you! We received your payment of INR ${amount} for Curevan booking #${bookingId}. View details: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
  },

  // 6. Booking payment received (Therapy Admin)
  admin_booking_payment: {
    name: "admin_booking_payment",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_booking_payment_v1",
    metaApprovedText: `Hello {{1}}, payment of INR {{2}} received for Curevan booking #{{3}}. View details: {{4}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "amount", "booking_id", "link"],
    samples: ["Admin", "1500", "101", "https://www.curevan.com/dashboard/therapy-admin"],
    formatWhatsApp: ({ adminName, amount, bookingId, link }) =>
      `Hello ${adminName || "Admin"}, payment of INR ${amount} received for Curevan booking #${bookingId}. View details: ${link || "https://www.curevan.com/dashboard/therapy-admin"}\n${SUPPORT_LINE}`,
  },

  // 7. 24h reminder (Patient)
  reminder_24h: {
    name: "reminder_24h",
    category: "UTILITY",
    metaTemplateName: "curevan_reminder_24h_v1",
    metaApprovedText: `Namaste {{1}}, reminder: your Curevan home session with {{2}} is tomorrow at {{3}}. View booking: {{4}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "therapist_name", "time", "link"],
    samples: ["Aarav", "Dr Sharma", "10:00 AM", "https://www.curevan.com/dashboard/bookings"],
    dltTemplateId: process.env.DLT_TID_REMINDER_24H || "",
    dltEntityId: DLT_ENTITY_ID,
    dltSenderId: DLT_SENDER_ID,
    dltApprovedText: "Reminder: Your Curevan home therapy session with {#var#} is tomorrow at {#var#}. Details: {#var#} - Curevan",
    formatWhatsApp: ({ patientName, therapistName, time, link }) =>
      `Namaste ${patientName || "there"}, reminder: your Curevan home session with ${therapistName || "your therapist"} is tomorrow at ${time}. View booking: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatSms: ({ therapistName, time, link }) =>
      `Reminder: Your Curevan home session with ${therapistName || "therapist"} is tomorrow at ${time}. Details: ${link || "https://www.curevan.com"} - Curevan`,
  },

  // 8. 2h reminder (Patient) - Start Code sent via separate start_code template
  reminder_2h: {
    name: "reminder_2h",
    category: "UTILITY",
    metaTemplateName: "curevan_reminder_2h_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan home session with {{2}} starts in 2 hours at {{3}}. View booking: {{4}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "therapist_name", "time", "link"],
    samples: ["Aarav", "Dr Sharma", "10:00 AM", "https://www.curevan.com/dashboard/bookings"],
    dltTemplateId: process.env.DLT_TID_REMINDER_2H || "",
    dltEntityId: DLT_ENTITY_ID,
    dltSenderId: DLT_SENDER_ID,
    dltApprovedText: "Your Curevan home therapy session with {#var#} starts in 2 hours at {#var#}. Check your app for details. - Curevan",
    formatWhatsApp: ({ patientName, therapistName, time, link }) =>
      `Namaste ${patientName || "there"}, your Curevan home session with ${therapistName || "your therapist"} starts in 2 hours at ${time}. View booking: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatSms: ({ therapistName, time }) =>
      `Your Curevan home session with ${therapistName || "therapist"} starts in 2 hours at ${time}. Check your app for details. - Curevan`,
  },

  // 9. 24h reminder (Therapist)
  therapist_reminder_24h: {
    name: "therapist_reminder_24h",
    category: "UTILITY",
    metaTemplateName: "curevan_therapist_reminder_24h_v1",
    metaApprovedText: `Hello {{1}}, reminder: your scheduled Curevan session is tomorrow at {{2}}. View schedule: {{3}}\n${SUPPORT_LINE}`,
    variables: ["therapist_name", "time", "link"],
    samples: ["Dr Sharma", "10:00 AM", "https://www.curevan.com/dashboard/therapist/schedule"],
    formatWhatsApp: ({ therapistName, time, link }) =>
      `Hello ${therapistName || "Therapist"}, reminder: your scheduled Curevan session is tomorrow at ${time}. View schedule: ${link || "https://www.curevan.com/dashboard/therapist/schedule"}\n${SUPPORT_LINE}`,
  },

  // 10. 2h reminder (Therapist)
  therapist_reminder_2h: {
    name: "therapist_reminder_2h",
    category: "UTILITY",
    metaTemplateName: "curevan_therapist_reminder_2h_v1",
    metaApprovedText: `Hello {{1}}, reminder: your scheduled Curevan session starts in 2 hours at {{2}}. View schedule: {{3}}\n${SUPPORT_LINE}`,
    variables: ["therapist_name", "time", "link"],
    samples: ["Dr Sharma", "10:00 AM", "https://www.curevan.com/dashboard/therapist/schedule"],
    formatWhatsApp: ({ therapistName, time, link }) =>
      `Hello ${therapistName || "Therapist"}, reminder: your scheduled Curevan session starts in 2 hours at ${time}. View schedule: ${link || "https://www.curevan.com/dashboard/therapist/schedule"}\n${SUPPORT_LINE}`,
  },

  // 11. 30min reminder (Patient)
  reminder_30_min: {
    name: "reminder_30_min",
    category: "UTILITY",
    metaTemplateName: "curevan_reminder_30min_v1",
    metaApprovedText: `Namaste {{1}}, your therapist {{2}} will arrive in approximately 30 minutes for your Curevan session at {{3}}. View booking: {{4}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "therapist_name", "time", "link"],
    samples: ["Aarav", "Dr Sharma", "10:00 AM", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, therapistName, time, link }) =>
      `Namaste ${patientName || "there"}, your therapist ${therapistName || "your therapist"} will arrive in approximately 30 minutes for your Curevan session at ${time}. View booking: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatPush: ({ patientName, time }) => ({
      title: "Session starting in 30 minutes",
      body: `Your session with ${patientName || "patient"} starts at ${time}. Please verify travel time.`,
    }),
  },

  // 12. Therapist on the way (Patient)
  therapist_on_the_way: {
    name: "therapist_on_the_way",
    category: "UTILITY",
    metaTemplateName: "curevan_therapist_ontheway_v1",
    metaApprovedText: `Namaste {{1}}, your therapist {{2}} is on the way to your home for the {{3}} Curevan session. View booking: {{4}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "therapist_name", "time", "link"],
    samples: ["Aarav", "Dr Sharma", "10:00 AM", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, therapistName, time, link }) =>
      `Namaste ${patientName || "there"}, your therapist ${therapistName || "your therapist"} is on the way to your home for the ${time} Curevan session. View booking: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatPush: ({ therapistName, time }) => ({
      title: "Therapist on the way",
      body: `${therapistName || "Your therapist"} is on the way for your ${time} appointment.`,
    }),
  },

  // 13. Session completed review (Patient)
  session_completed_review: {
    name: "session_completed_review",
    category: "UTILITY",
    metaTemplateName: "curevan_session_completed_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan session with {{2}} is complete. How did it go? Rate your experience: {{3}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "therapist_name", "link"],
    samples: ["Aarav", "Dr Sharma", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, therapistName, link }) =>
      `Namaste ${patientName || "there"}, your Curevan session with ${therapistName || "your therapist"} is complete. How did it go? Rate your experience: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatInApp: ({ therapistName, link }) => ({
      title: "Rate your session",
      message: `Your session with ${therapistName || "your therapist"} has concluded. Leave a review.`,
      link: link || "/dashboard/bookings",
    }),
  },

  // 14. Progress report ready (Patient & Caregiver)
  progress_report_ready: {
    name: "progress_report_ready",
    category: "UTILITY",
    metaTemplateName: "curevan_progress_report_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan progress report from Dr {{2}} is ready. View report: {{3}}\n${SUPPORT_LINE}`,
    variables: ["recipient_name", "therapist_name", "link"],
    samples: ["Aarav", "Dr Sharma", "https://www.curevan.com/dashboard/patient/progress"],
    formatWhatsApp: ({ patientName, therapistName, link }) =>
      `Namaste ${patientName || "there"}, your Curevan progress report from Dr ${therapistName || "your therapist"} is ready. View report: ${link || "https://www.curevan.com/dashboard/patient/progress"}\n${SUPPORT_LINE}`,
    formatEmail: ({ patientName, therapistName, link }) => ({
      subject: "Your Clinical Progress Report is Ready",
      text: `Hello ${patientName || "Patient"},\n\nYour clinical progress report compiled by Dr ${therapistName || "your therapist"} has been released.\n\nView report: ${link || "https://www.curevan.com/dashboard/patient/progress"}\n\nTeam Curevan`,
      html: `<h3>Clinical Progress Report Ready</h3><p>Hello ${patientName || "Patient"},</p><p>Your latest clinical progress evaluation from <strong>Dr ${therapistName || "your therapist"}</strong> is now ready for review.</p><p><a href="${link || "https://www.curevan.com/dashboard/patient/progress"}">View Progress Report</a></p><p>Team Curevan</p>`,
    }),
    formatInApp: () => ({
      title: "Progress report ready",
      message: "Your latest clinical progress report has been published by your therapist.",
      link: "/dashboard/patient/progress",
    }),
  },

  // 15. PCR summary ready (Patient)
  pcr_pdf_ready: {
    name: "pcr_pdf_ready",
    category: "UTILITY",
    metaTemplateName: "curevan_pcr_ready_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan visit summary for session #{{2}} on {{3}} is ready. View summary: {{4}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "session_number", "date", "link"],
    samples: ["Aarav", "1", "2026-11-25", "https://www.curevan.com/dashboard/patient/health-records"],
    formatWhatsApp: ({ patientName, sessionNumber, date, link }) =>
      `Namaste ${patientName || "there"}, your Curevan visit summary for session #${sessionNumber || ""} on ${date || ""} is ready. View summary: ${link || "https://www.curevan.com/dashboard/patient/health-records"}\n${SUPPORT_LINE}`,
    formatEmail: ({ patientName, sessionNumber, date, link }) => ({
      subject: `Your PCR Summary - Session #${sessionNumber || ""}`,
      text: `Hello ${patientName || "Patient"},\n\nYour Patient Care Record (PCR) documentation for session #${sessionNumber || ""} conducted on ${date || ""} has been finalized.\n\nView record: ${link || "https://www.curevan.com/dashboard/patient/health-records"}\n\nTeam Curevan`,
      html: `<h3>Patient Care Record (PCR) Finalized</h3><p>Hello ${patientName || "Patient"},</p><p>Your PCR summary for session #${sessionNumber || ""} conducted on ${date || ""} is now available in your portal.</p><p><a href="${link || "https://www.curevan.com/dashboard/patient/health-records"}">Access Health Records</a></p>`,
    }),
  },

  // 16. Booking cancelled (Patient)
  booking_cancelled: {
    name: "booking_cancelled",
    category: "UTILITY",
    metaTemplateName: "curevan_booking_cancelled_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan booking for {{2}} at {{3}} has been cancelled. Reason: {{4}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "date", "time", "reason"],
    samples: ["Aarav", "2026-11-25", "10:00 AM", "Patient reschedule"],
    formatWhatsApp: ({ patientName, date, time, reason }) =>
      `Namaste ${patientName || "there"}, your Curevan booking for ${date} at ${time} has been cancelled.${reason ? ` Reason: ${reason}` : ""}\n${SUPPORT_LINE}`,
    formatInApp: ({ date, time }) => ({
      title: "Booking cancelled",
      message: `Your appointment on ${date} at ${time} was cancelled.`,
      link: "/dashboard/bookings",
    }),
  },

  // 17. Booking cancelled (Therapist)
  therapist_booking_cancelled: {
    name: "therapist_booking_cancelled",
    category: "UTILITY",
    metaTemplateName: "curevan_therapist_booking_cancelled_v1",
    metaApprovedText: `Hello {{1}}, your Curevan session on {{2}} at {{3}} has been cancelled. Reason: {{4}}\n${SUPPORT_LINE}`,
    variables: ["therapist_name", "date", "time", "reason"],
    samples: ["Dr Sharma", "2026-11-25", "10:00 AM", "Patient reschedule"],
    formatWhatsApp: ({ therapistName, date, time, reason }) =>
      `Hello ${therapistName || "Therapist"}, your Curevan session on ${date} at ${time} has been cancelled.${reason ? ` Reason: ${reason}` : ""}\n${SUPPORT_LINE}`,
  },

  // 18. Booking cancelled (Therapy Admin)
  admin_booking_cancelled: {
    name: "admin_booking_cancelled",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_booking_cancelled_v1",
    metaApprovedText: `Hello {{1}}, Curevan booking #{{2}} for {{3}} at {{4}} has been cancelled. Reason: {{5}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "booking_id", "date", "time", "reason"],
    samples: ["Admin", "101", "2026-11-25", "10:00 AM", "Patient reschedule"],
    formatWhatsApp: ({ adminName, bookingId, date, time, reason }) =>
      `Hello ${adminName || "Admin"}, Curevan booking #${bookingId || ""} for ${date} at ${time} has been cancelled.${reason ? ` Reason: ${reason}` : ""}\n${SUPPORT_LINE}`,
  },

  // 19. Booking reassigned (Patient)
  booking_reassigned: {
    name: "booking_reassigned",
    category: "UTILITY",
    metaTemplateName: "curevan_booking_reassigned_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan session on {{2}} at {{3}} has been reassigned to {{4}}. View details: {{5}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "date", "time", "new_therapist_name", "link"],
    samples: ["Aarav", "2026-11-25", "10:00 AM", "Dr Patel", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, date, time, newTherapistName, link }) =>
      `Namaste ${patientName || "there"}, your Curevan session on ${date} at ${time} has been reassigned to ${newTherapistName || "a certified therapist"}. View details: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatInApp: ({ date, time, newTherapistName }) => ({
      title: "Therapist Reassigned",
      message: `Your appointment on ${date} at ${time} has been reassigned to ${newTherapistName || "your therapist"}.`,
      link: "/dashboard/bookings",
    }),
  },

  // 20. Follow-up proposed (Patient)
  followup_proposed: {
    name: "followup_proposed",
    category: "UTILITY",
    metaTemplateName: "curevan_followup_proposed_v1",
    metaApprovedText: `Namaste {{1}}, {{2}} has recommended your next Curevan session for {{3}} at {{4}}. Confirm slot: {{5}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "therapist_name", "date", "time", "link"],
    samples: ["Aarav", "Dr Sharma", "2026-11-28", "10:00 AM", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, therapistName, date, time, link }) =>
      `Namaste ${patientName || "there"}, ${therapistName || "your therapist"} has recommended your next Curevan session for ${date} at ${time}. Confirm slot: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatInApp: ({ therapistName, date, time, count, link }) => ({
      title: "Recommended session reserved",
      message: count > 1
        ? `${therapistName || "Your therapist"} recommends ${count} sessions starting ${date} at ${time}. Confirm to keep these slots.`
        : `${therapistName || "Your therapist"} recommended your next session for ${date} at ${time}. Confirm to keep the slot.`,
      link: link || "/dashboard/bookings",
    }),
  },

  // 21. Follow-up nudge (Patient)
  followup_nudge: {
    name: "followup_nudge",
    category: "UTILITY",
    metaTemplateName: "curevan_followup_nudge_v1",
    metaApprovedText: `Namaste {{1}}, your recommended Curevan session on {{2}} at {{3}} is still reserved. Confirm slot: {{4}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "date", "time", "link"],
    samples: ["Aarav", "2026-11-28", "10:00 AM", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, date, time, link }) =>
      `Namaste ${patientName || "there"}, your recommended Curevan session on ${date} at ${time} is still reserved. Confirm slot: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatInApp: ({ link }) => ({
      title: "Keep your next session",
      message: "Your recommended session is still waiting for you. Confirm soon to keep the slot.",
      link: link || "/dashboard/bookings",
    }),
  },

  // 22. Follow-up expired (Patient)
  followup_expired: {
    name: "followup_expired",
    category: "UTILITY",
    metaTemplateName: "curevan_followup_expired_v1",
    metaApprovedText: `Namaste {{1}}, the slot reserved for your Curevan session on {{2}} has expired. Book again: {{3}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "date", "link"],
    samples: ["Aarav", "2026-11-28", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, date, link }) =>
      `Namaste ${patientName || "there"}, the slot reserved for your Curevan session on ${date} has expired. Book again: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatInApp: () => ({
      title: "A recommended session was released",
      message: "The slot we held for your next session was released because it was not confirmed in time. You can book again anytime.",
      link: "/dashboard/bookings",
    }),
  },

  // 23. Follow-up no slot (Patient)
  followup_no_slot: {
    name: "followup_no_slot",
    category: "UTILITY",
    metaTemplateName: "curevan_followup_noslot_v1",
    metaApprovedText: `Namaste {{1}}, your therapist recommended a Curevan session, but no matching slot was open. Select a slot: {{2}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "link"],
    samples: ["Aarav", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, link }) =>
      `Namaste ${patientName || "there"}, your therapist recommended a Curevan session, but no matching slot was open. Select a slot: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatInApp: () => ({
      title: "Select an alternate slot",
      message: "Your recommended session had no open slot. Tap to choose another time.",
      link: "/dashboard/bookings",
    }),
  },

  // 24. Follow-up overdue (Patient)
  followup_overdue: {
    name: "followup_overdue",
    category: "UTILITY",
    metaTemplateName: "curevan_followup_overdue_v1",
    metaApprovedText: `Namaste {{1}}, it has been a while since your last Curevan session. Book your next appointment: {{2}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "link"],
    samples: ["Aarav", "https://www.curevan.com/dashboard/bookings"],
    formatWhatsApp: ({ patientName, link }) =>
      `Namaste ${patientName || "there"}, it has been a while since your last Curevan session. Book your next appointment: ${link || "https://www.curevan.com/dashboard/bookings"}\n${SUPPORT_LINE}`,
    formatInApp: () => ({
      title: "Time to book your next session",
      message: "It has been a while since your last session. Book your next one to keep your recovery on track.",
      link: "/dashboard/bookings",
    }),
  },

  // 25. Home exercises daily reminder (Patient)
  hep_daily: {
    name: "hep_daily",
    category: "UTILITY",
    metaTemplateName: "curevan_hep_daily_v1",
    metaApprovedText: `Namaste {{1}}, time for your prescribed Curevan home exercises. View exercises: {{2}}\n${SUPPORT_LINE}`,
    variables: ["patient_name", "link"],
    samples: ["Aarav", "https://www.curevan.com/dashboard/patient/progress"],
    formatWhatsApp: ({ patientName, link }) =>
      `Namaste ${patientName || "there"}, time for your prescribed Curevan home exercises. View exercises: ${link || "https://www.curevan.com/dashboard/patient/progress"}\n${SUPPORT_LINE}`,
    formatPush: () => ({
      title: "Time for your home exercises",
      body: "A few minutes of your exercises today keeps your recovery on track.",
    }),
  },

  // 26. Order paid (Customer)
  order_paid: {
    name: "order_paid",
    category: "UTILITY",
    metaTemplateName: "curevan_order_paid_v1",
    metaApprovedText: `Namaste {{1}}, thank you! We received your payment of INR {{2}} for Curevan order #{{3}}. Track order: {{4}}\n${SUPPORT_LINE}`,
    variables: ["customer_name", "amount", "order_number", "link"],
    samples: ["Aarav", "999", "501", "https://www.curevan.com/dashboard/orders"],
    formatWhatsApp: ({ customerName, amount, orderNumber, link }) =>
      `Namaste ${customerName || "Customer"}, thank you! We received your payment of INR ${amount} for Curevan order #${orderNumber}. Track order: ${link || "https://www.curevan.com/dashboard/orders"}\n${SUPPORT_LINE}`,
    formatEmail: ({ customerName, amount, orderNumber, link }) => ({
      subject: `Order Confirmation #${orderNumber}`,
      text: `Hello ${customerName || "Customer"},\n\nThank you for shopping at Curevan. We have received your payment of INR ${amount} for Order #${orderNumber}.\n\nTrack order: ${link || "https://www.curevan.com/dashboard/orders"}\n\nTeam Curevan`,
      html: `<h3>Order Confirmation #${orderNumber}</h3><p>Hello ${customerName || "Customer"},</p><p>We received your payment of <strong>INR ${amount}</strong> for Order #${orderNumber}.</p><p><a href="${link || "https://www.curevan.com/dashboard/orders"}">Track Order</a></p>`,
    }),
  },

  // 27. New order alert (E-com Admin)
  admin_new_order: {
    name: "admin_new_order",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_new_order_v1",
    metaApprovedText: `Hello {{1}}, new paid Curevan shop order #{{2}} received for INR {{3}}. View order: {{4}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "order_number", "amount", "link"],
    samples: ["Admin", "501", "999", "https://www.curevan.com/dashboard/ecom-admin/orders"],
    formatWhatsApp: ({ adminName, orderNumber, amount, link }) =>
      `Hello ${adminName || "Admin"}, new paid Curevan shop order #${orderNumber} received for INR ${amount}. View order: ${link || "https://www.curevan.com/dashboard/ecom-admin/orders"}\n${SUPPORT_LINE}`,
  },

  // 28. Order shipped (Customer)
  order_shipped: {
    name: "order_shipped",
    category: "UTILITY",
    metaTemplateName: "curevan_order_shipped_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan order #{{2}} has been shipped via {{3}}. Tracking AWB: {{4}}. Track here: {{5}}\n${SUPPORT_LINE}`,
    variables: ["customer_name", "order_number", "courier", "awb", "link"],
    samples: ["Aarav", "501", "BlueDart", "123456789", "https://www.curevan.com/dashboard/orders"],
    formatWhatsApp: ({ customerName, orderNumber, courier, awb, link }) =>
      `Namaste ${customerName || "Customer"}, your Curevan order #${orderNumber} has been shipped via ${courier || "courier"}. Tracking AWB: ${awb || ""}. Track here: ${link || "https://www.curevan.com/dashboard/orders"}\n${SUPPORT_LINE}`,
    formatEmail: ({ customerName, orderNumber, courier, awb, link }) => ({
      subject: `Order #${orderNumber} Shipped`,
      text: `Hello ${customerName || "Customer"},\n\nYour order #${orderNumber} has been handed over to ${courier || "our courier partner"}. AWB: ${awb || ""}.\n\nTrack: ${link || "https://www.curevan.com/dashboard/orders"}\n\nTeam Curevan`,
      html: `<h3>Your Order Has Shipped</h3><p>Hello ${customerName || "Customer"},</p><p>Order #${orderNumber} is on its way via ${courier || "courier"}. AWB: <strong>${awb || ""}</strong>.</p><p><a href="${link || "https://www.curevan.com/dashboard/orders"}">Track Shipment</a></p>`,
    }),
  },

  // 29. Order delivered (Customer)
  order_delivered: {
    name: "order_delivered",
    category: "UTILITY",
    metaTemplateName: "curevan_order_delivered_v1",
    metaApprovedText: `Namaste {{1}}, your Curevan order #{{2}} has been delivered. You have 7 days to report issues or request a return: {{3}}\n${SUPPORT_LINE}`,
    variables: ["customer_name", "order_number", "link"],
    samples: ["Aarav", "501", "https://www.curevan.com/dashboard/orders"],
    formatWhatsApp: ({ customerName, orderNumber, link }) =>
      `Namaste ${customerName || "Customer"}, your Curevan order #${orderNumber} has been delivered. You have 7 days to report issues or request a return: ${link || "https://www.curevan.com/dashboard/orders"}\n${SUPPORT_LINE}`,
    formatEmail: ({ customerName, orderNumber, link }) => ({
      subject: `Order #${orderNumber} Delivered`,
      text: `Hello ${customerName || "Customer"},\n\nYour order #${orderNumber} has been delivered. You can initiate a return within 7 days if required.\n\nView order: ${link || "https://www.curevan.com/dashboard/orders"}\n\nTeam Curevan`,
      html: `<h3>Your Order is Delivered</h3><p>Hello ${customerName || "Customer"},</p><p>Order #${orderNumber} has been delivered. You have 7 days to report issues or request returns.</p><p><a href="${link || "https://www.curevan.com/dashboard/orders"}">View Order</a></p>`,
    }),
  },

  // 30. Order delivered alert (E-com Admin)
  admin_order_delivered: {
    name: "admin_order_delivered",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_order_delivered_v1",
    metaApprovedText: `Hello {{1}}, Curevan shop order #{{2}} has been marked delivered. View order: {{3}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "order_number", "link"],
    samples: ["Admin", "501", "https://www.curevan.com/dashboard/ecom-admin/orders"],
    formatWhatsApp: ({ adminName, orderNumber, link }) =>
      `Hello ${adminName || "Admin"}, Curevan shop order #${orderNumber} has been marked delivered. View order: ${link || "https://www.curevan.com/dashboard/ecom-admin/orders"}\n${SUPPORT_LINE}`,
  },

  // 31. Return requested alert (E-com Admin)
  admin_return_request: {
    name: "admin_return_request",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_return_request_v1",
    metaApprovedText: `Hello {{1}}, a return has been requested for Curevan order #{{2}}. Reason: {{3}}. View details: {{4}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "order_number", "reason", "link"],
    samples: ["Admin", "501", "Damaged item", "https://www.curevan.com/dashboard/ecom-admin/returns"],
    formatWhatsApp: ({ adminName, orderNumber, reason, link }) =>
      `Hello ${adminName || "Admin"}, a return has been requested for Curevan order #${orderNumber}. Reason: ${reason || "return requested"}. View details: ${link || "https://www.curevan.com/dashboard/ecom-admin/returns"}\n${SUPPORT_LINE}`,
  },

  // 32. Refund processed (Customer)
  refund_processed: {
    name: "refund_processed",
    category: "UTILITY",
    metaTemplateName: "curevan_refund_processed_v1",
    metaApprovedText: `Namaste {{1}}, a refund of INR {{2}} has been initiated for Curevan transaction {{3}} (Ref: {{4}}).\n${SUPPORT_LINE}`,
    variables: ["customer_name", "amount", "reference", "refund_id"],
    samples: ["Aarav", "999", "Order 501", "rfnd_12345"],
    formatWhatsApp: ({ customerName, amount, reference, refundId }) =>
      `Namaste ${customerName || "Customer"}, a refund of INR ${amount} has been initiated for Curevan transaction ${reference || ""}${refundId ? ` (Ref: ${refundId})` : ""}.\n${SUPPORT_LINE}`,
    formatEmail: ({ customerName, amount, reference, refundId }) => ({
      subject: `Refund Initiated - INR ${amount}`,
      text: `Hello ${customerName || "Customer"},\n\nA refund of INR ${amount} has been initiated for ${reference || "your account"}${refundId ? ` (Refund ID: ${refundId})` : ""}.\n\nExpected within 5-7 business days.\n\nTeam Curevan`,
      html: `<h3>Refund Initiated</h3><p>Hello ${customerName || "Customer"},</p><p>A refund of <strong>INR ${amount}</strong> has been initiated for ${reference || "your account"}.</p><p>Refund ID: ${refundId || "N/A"}</p>`,
    }),
  },

  // 33. Low stock alert (E-com Admin)
  admin_low_stock: {
    name: "admin_low_stock",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_low_stock_v1",
    metaApprovedText: `Hello {{1}}, Curevan inventory alert: {{2}} items are below reorder level. Review stock: {{3}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "item_count", "link"],
    samples: ["Admin", "3", "https://www.curevan.com/dashboard/ecom-admin/inventory"],
    formatWhatsApp: ({ adminName, count, link }) =>
      `Hello ${adminName || "Admin"}, Curevan inventory alert: ${count || "several"} items are below reorder level. Review stock: ${link || "https://www.curevan.com/dashboard/ecom-admin/inventory"}\n${SUPPORT_LINE}`,
  },

  // 34. SOS alert (Super Admin & Therapy Admin)
  admin_sos: {
    name: "admin_sos",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_sos_v1",
    metaApprovedText: `Hello {{1}}, EMERGENCY: SOS alert raised for Curevan booking #{{2}} by therapist {{3}}. View location and details: {{4}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "booking_id", "therapist_name", "link"],
    samples: ["Admin", "101", "Dr Sharma", "https://www.curevan.com/dashboard/therapy-admin"],
    formatWhatsApp: ({ adminName, bookingId, therapistName, link }) =>
      `Hello ${adminName || "Admin"}, EMERGENCY: SOS alert raised for Curevan booking #${bookingId || ""} by therapist ${therapistName || "Therapist"}. View location and details: ${link || "https://www.curevan.com/dashboard/therapy-admin"}\n${SUPPORT_LINE}`,
  },

  // 35. Weekly payout paid (Therapist)
  payout_paid: {
    name: "payout_paid",
    category: "UTILITY",
    metaTemplateName: "curevan_payout_paid_v1",
    metaApprovedText: `Hello {{1}}, your weekly Curevan payout of INR {{2}} for {{3}} has been transferred. UTR: {{4}}. Statement: {{5}}\n${SUPPORT_LINE}`,
    variables: ["therapist_name", "amount", "week", "utr", "link"],
    samples: ["Dr Sharma", "12500", "2026-W47", "SBIN12345678", "https://www.curevan.com/dashboard/earnings"],
    formatWhatsApp: ({ therapistName, amount, week, utr, link }) =>
      `Hello ${therapistName || "Therapist"}, your weekly Curevan payout of INR ${amount} for ${week || ""} has been transferred. UTR: ${utr || ""}. Statement: ${link || "https://www.curevan.com/dashboard/earnings"}\n${SUPPORT_LINE}`,
    formatEmail: ({ therapistName, amount, week, utr, link }) => ({
      subject: `Payout Disbursed - Week of ${week || ""}`,
      text: `Dr ${therapistName || "Therapist"},\n\nYour weekly payout of INR ${amount} for the week of ${week || ""} has been transferred to your bank account.\n\nBank Reference UTR: ${utr || ""}\n\nDownload Statement: ${link || "https://www.curevan.com/dashboard/earnings"}\n\nTeam Curevan`,
      html: `<h3>Weekly Payout Disbursed</h3><p>Dr ${therapistName || "Therapist"},</p><p>Your weekly payout of <strong>INR ${amount}</strong> for the week of ${week || ""} has been processed.</p><p>Bank UTR: <code>${utr || "N/A"}</code></p><p><a href="${link || "https://www.curevan.com/dashboard/earnings"}">Download Payout Statement</a></p>`,
    }),
  },

  // 36. Therapist daily agenda (Therapist)
  therapist_daily_agenda: {
    name: "therapist_daily_agenda",
    category: "UTILITY",
    metaTemplateName: "curevan_therapist_agenda_v1",
    metaApprovedText: `Hello {{1}}, your Curevan schedule for today ({{2}}): {{3}}. View schedule: {{4}}\n${SUPPORT_LINE}`,
    variables: ["therapist_name", "date", "agenda_summary", "link"],
    samples: ["Dr Sharma", "2026-11-25", "3 home visits", "https://www.curevan.com/dashboard/therapist/schedule"],
    formatWhatsApp: ({ therapistName, date, agendaSummary, link }) =>
      `Hello ${therapistName || "Therapist"}, your Curevan schedule for today (${date}): ${agendaSummary}. View schedule: ${link || "https://www.curevan.com/dashboard/therapist/schedule"}\n${SUPPORT_LINE}`,
    formatPush: ({ agendaSummary }) => ({
      title: "Your sessions today",
      body: agendaSummary,
    }),
  },

  // 37. Therapist 60min reminder (Therapist)
  therapist_60min: {
    name: "therapist_60min",
    category: "UTILITY",
    metaTemplateName: "curevan_therapist_60min_v1",
    metaApprovedText: `Hello {{1}}, your Curevan session with {{2}} starts in 60 minutes at {{3}} in {{4}}. View details: {{5}}\n${SUPPORT_LINE}`,
    variables: ["therapist_name", "patient_name", "time", "city", "link"],
    samples: ["Dr Sharma", "Aarav", "10:00 AM", "Vadodara", "https://www.curevan.com/dashboard/therapist/schedule"],
    formatWhatsApp: ({ therapistName, patientName, time, city, link }) =>
      `Hello ${therapistName || "Therapist"}, your Curevan session with ${patientName || "patient"} starts in 60 minutes at ${time}${city ? ` in ${city}` : ""}. View details: ${link || "https://www.curevan.com/dashboard/therapist/schedule"}\n${SUPPORT_LINE}`,
    formatPush: ({ patientName, time, city }) => ({
      title: "Session starting soon",
      body: `Your Curevan home session with ${patientName || "patient"} starts at ${time}${city ? ` in ${city}` : ""}.`,
    }),
  },

  // 38. Therapist credential expiry (Therapist)
  therapist_credential_expiry: {
    name: "therapist_credential_expiry",
    category: "UTILITY",
    metaTemplateName: "curevan_therapist_credential_expiry_v1",
    metaApprovedText: `Hello {{1}}, your Curevan credential {{2}} is due to expire on {{3}}. Upload renewed document: {{4}}\n${SUPPORT_LINE}`,
    variables: ["therapist_name", "credential_type", "expiry_date", "link"],
    samples: ["Dr Sharma", "Physiotherapy License", "2026-12-31", "https://www.curevan.com/dashboard/therapist/profile"],
    formatWhatsApp: ({ therapistName, credentialType, expiryDate, link }) =>
      `Hello ${therapistName || "Therapist"}, your Curevan credential ${credentialType || "credential"} is due to expire on ${expiryDate}. Upload renewed document: ${link || "https://www.curevan.com/dashboard/therapist/profile"}\n${SUPPORT_LINE}`,
  },

  // 39. Therapist leave notice (Therapy Admin)
  admin_therapist_leave: {
    name: "admin_therapist_leave",
    category: "UTILITY",
    metaTemplateName: "curevan_admin_therapist_leave_v1",
    metaApprovedText: `Hello {{1}}, Curevan therapist {{2}} requested leave on {{3}}. Reassignment may be required. Review details: {{4}}\n${SUPPORT_LINE}`,
    variables: ["admin_name", "therapist_name", "date", "link"],
    samples: ["Admin", "Dr Sharma", "2026-11-26", "https://www.curevan.com/dashboard/therapy-admin"],
    formatWhatsApp: ({ adminName, therapistName, date, link }) =>
      `Hello ${adminName || "Admin"}, therapist ${therapistName || "Therapist"} requested leave on ${date}. Reassignment may be required. Review details: ${link || "https://www.curevan.com/dashboard/therapy-admin"}\n${SUPPORT_LINE}`,
  },

  // 40. Emergency SOS alert (On-call SMS & push)
  sos_raised: {
    name: "sos_raised",
    category: "UTILITY",
    dltTemplateId: process.env.DLT_TID_SOS || "",
    dltEntityId: DLT_ENTITY_ID,
    dltSenderId: DLT_SENDER_ID,
    dltApprovedText: "EMERGENCY ALERT: SOS raised by therapist Dr {#var#} (Phone: {#var#}) for Booking #{#var#} at {#var#}. Lat/Lng: {#var#},{#var#}. Action required immediately. - Curevan",
    variables: ["therapist_name", "phone", "booking_id", "time", "lat", "lng"],
    formatSms: ({ therapistName, phone, bookingId, time, lat, lng }) =>
      `EMERGENCY ALERT: SOS raised by therapist Dr ${therapistName || ""} (Phone: ${phone || ""}) for Booking #${bookingId || ""} at ${time || ""}. Lat/Lng: ${lat || ""},${lng || ""}. Action required immediately. - Curevan`,
    formatPush: ({ therapistName, bookingId }) => ({
      title: "🚨 SOS EMERGENCY ALERT",
      body: `Therapist Dr ${therapistName || ""} activated emergency alert on Booking #${bookingId || ""}.`,
      data: { type: "sos", bookingId: String(bookingId || "") },
    }),
  },
};

module.exports = { TEMPLATES, DLT_ENTITY_ID, DLT_SENDER_ID, SUPPORT_LINE };
