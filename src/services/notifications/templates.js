/**
 * Approved notification templates for Curevan (P24).
 * Utility templates approved for Meta WhatsApp Cloud API and TRAI DLT SMS.
 * Marketing text is strictly forbidden inside utility templates.
 */

const DLT_ENTITY_ID = process.env.DLT_ENTITY_ID || "1401168900000012345";
const DLT_SENDER_ID = process.env.DLT_SENDER_ID || "CURVAN";

const TEMPLATES = {
  booking_confirmed: {
    name: "booking_confirmed",
    category: "utility",
    metaTemplateName: "curevan_booking_confirmed_v1",
    metaApprovedText: "Namaste {{1}}, your Curevan home session with {{2}} is confirmed for {{3}} at {{4}} in {{5}}. Please share your Start Code {{6}} with the therapist only when they arrive at your home. View session details: {{7}}",
    variables: ["patient_name", "therapist_name", "date", "time", "locality", "start_code", "link"],
    dltTemplateId: process.env.DLT_TID_BOOKING_CONFIRMED || "1407169000000001",
    dltEntityId: DLT_ENTITY_ID,
    dltSenderId: DLT_SENDER_ID,
    dltApprovedText: "Your Curevan home session with {#var#} is confirmed for {#var#} at {#var#}. Share Start Code {#var#} only when therapist arrives. - Curevan",
    formatWhatsApp: ({ patientName, therapistName, date, time, locality, otp, link }) =>
      `Namaste ${patientName || "there"}, your Curevan home session with ${therapistName || "your therapist"} is confirmed for ${date} at ${time}${locality ? ` in ${locality}` : ""}. Please share your Start Code ${otp} with the therapist only when they arrive at your home. View session details: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatSms: ({ therapistName, date, time, otp }) =>
      `Your Curevan home session with ${therapistName || "therapist"} is confirmed for ${date} at ${time}. Share Start Code ${otp} only when therapist arrives. - Curevan`,
    formatEmail: ({ patientName, therapistName, date, time, locality, link }) => ({
      subject: "Your Curevan Home Session is Confirmed",
      // Never send OTP in email (P24 global boundary rule)
      text: `Hello ${patientName || "Patient"},\n\nYour home therapy session with ${therapistName || "your therapist"} is confirmed for ${date} at ${time}${locality ? ` in ${locality}` : ""}.\n\nWhen the therapist arrives, view your secure start code in your patient dashboard.\n\nView booking: ${link || "https://curevan.com/dashboard/bookings"}\n\nTeam Curevan`,
      html: `<h3>Your Curevan Home Session is Confirmed</h3><p>Hello ${patientName || "Patient"},</p><p>Your session with <strong>${therapistName || "your therapist"}</strong> is confirmed for <strong>${date} at ${time}</strong>${locality ? ` in ${locality}` : ""}.</p><p><em>For safety, your Start Code is available inside your secure patient dashboard when the therapist arrives.</em></p><p><a href="${link || "https://curevan.com/dashboard/bookings"}">View Booking Details</a></p><p>Warm regards,<br>Team Curevan</p>`,
    }),
  },

  followup_proposed: {
    name: "followup_proposed",
    category: "utility",
    metaTemplateName: "curevan_followup_proposed_v1",
    metaApprovedText: "Namaste {{1}}, {{2}} has recommended your next session for {{3}} at {{4}}. We have reserved this slot for you. Confirm your slot here: {{5}}",
    variables: ["patient_name", "therapist_name", "date", "time", "link"],
    formatWhatsApp: ({ patientName, therapistName, date, time, link }) =>
      `Namaste ${patientName || "there"}, ${therapistName || "your therapist"} has recommended your next session for ${date} at ${time}. We have reserved this slot for you. Confirm your slot here: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatInApp: ({ therapistName, date, time, link }) => ({
      title: "Recommended session reserved",
      message: `${therapistName || "Your therapist"} recommended your next session for ${date} at ${time}. Confirm to keep the slot.`,
      link: link || "/dashboard/bookings",
    }),
  },

  followup_nudge: {
    name: "followup_nudge",
    category: "utility",
    metaTemplateName: "curevan_followup_nudge_v1",
    metaApprovedText: "Namaste {{1}}, your recommended session on {{2}} at {{3}} is still reserved. Confirm your session soon to keep the slot: {{4}}",
    variables: ["patient_name", "date", "time", "link"],
    formatWhatsApp: ({ patientName, date, time, link }) =>
      `Namaste ${patientName || "there"}, your recommended session on ${date} at ${time} is still reserved. Confirm your session soon to keep the slot: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatInApp: ({ link }) => ({
      title: "Keep your next session",
      message: "Your recommended session is still waiting for you. Confirm soon to keep the slot.",
      link: link || "/dashboard/bookings",
    }),
  },

  followup_expired: {
    name: "followup_expired",
    category: "utility",
    metaTemplateName: "curevan_followup_expired_v1",
    metaApprovedText: "Namaste {{1}}, the slot reserved for your session on {{2}} has been released because it was not confirmed in time. You can book again anytime: {{3}}",
    variables: ["patient_name", "date", "link"],
    formatWhatsApp: ({ patientName, date, link }) =>
      `Namaste ${patientName || "there"}, the slot reserved for your session on ${date} has been released because it was not confirmed in time. You can book again anytime: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatInApp: () => ({
      title: "A recommended session was released",
      message: "The slot we held for your next session was released because it was not confirmed in time. You can book again anytime.",
      link: "/dashboard/bookings",
    }),
  },

  followup_no_slot: {
    name: "followup_no_slot",
    category: "utility",
    metaTemplateName: "curevan_followup_noslot_v1",
    metaApprovedText: "Namaste {{1}}, your therapist recommended a session, but no matching slot was available. Please select an alternate slot here: {{2}}",
    variables: ["patient_name", "link"],
    formatWhatsApp: ({ patientName, link }) =>
      `Namaste ${patientName || "there"}, your therapist recommended a session, but no matching slot was available. Please select an alternate slot here: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatInApp: () => ({
      title: "Select an alternate slot",
      message: "Your recommended session had no open slot. Tap to choose another time.",
      link: "/dashboard/bookings",
    }),
  },

  reminder_24h: {
    name: "reminder_24h",
    category: "utility",
    metaTemplateName: "curevan_reminder_24h_v1",
    metaApprovedText: "Namaste {{1}}, reminder: your Curevan home therapy session with {{2}} is tomorrow at {{3}}. View booking: {{4}}",
    variables: ["patient_name", "therapist_name", "time", "link"],
    dltTemplateId: process.env.DLT_TID_REMINDER_24H || "1407169000000002",
    dltEntityId: DLT_ENTITY_ID,
    dltSenderId: DLT_SENDER_ID,
    dltApprovedText: "Reminder: Your Curevan home therapy session with {#var#} is tomorrow at {#var#}. Details: {#var#} - Curevan",
    formatWhatsApp: ({ patientName, therapistName, time, link }) =>
      `Namaste ${patientName || "there"}, reminder: your Curevan home therapy session with ${therapistName || "your therapist"} is tomorrow at ${time}. View booking: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatSms: ({ therapistName, time, link }) =>
      `Reminder: Your Curevan home therapy session with ${therapistName || "therapist"} is tomorrow at ${time}. Details: ${link || "https://curevan.com"} - Curevan`,
  },

  reminder_2h: {
    name: "reminder_2h",
    category: "utility",
    metaTemplateName: "curevan_reminder_2h_v1",
    metaApprovedText: "Namaste {{1}}, your Curevan home therapy session with {{2}} starts in 2 hours at {{3}}. Your start code is available in the app: {{4}}",
    variables: ["patient_name", "therapist_name", "time", "link"],
    dltTemplateId: process.env.DLT_TID_REMINDER_2H || "1407169000000003",
    dltEntityId: DLT_ENTITY_ID,
    dltSenderId: DLT_SENDER_ID,
    dltApprovedText: "Your Curevan home therapy session with {#var#} starts in 2 hours at {#var#}. Check your app for details. - Curevan",
    formatWhatsApp: ({ patientName, therapistName, time, link }) =>
      `Namaste ${patientName || "there"}, your Curevan home therapy session with ${therapistName || "your therapist"} starts in 2 hours at ${time}. Your start code is available in the app: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatSms: ({ therapistName, time }) =>
      `Your Curevan home therapy session with ${therapistName || "therapist"} starts in 2 hours at ${time}. Check your app for details. - Curevan`,
  },

  reminder_30_min: {
    name: "reminder_30_min",
    category: "utility",
    metaTemplateName: "curevan_reminder_30min_v1",
    metaApprovedText: "Namaste {{1}}, your therapist {{2}} will arrive in approximately 30 minutes for your session at {{3}}. Please be ready with your start code.",
    variables: ["patient_name", "therapist_name", "time"],
    formatWhatsApp: ({ patientName, therapistName, time }) =>
      `Namaste ${patientName || "there"}, your therapist ${therapistName || "your therapist"} will arrive in approximately 30 minutes for your session at ${time}. Please be ready with your start code.`,
    formatPush: ({ patientName, time }) => ({
      title: "Session starting in 30 minutes",
      body: `Your session with ${patientName || "patient"} starts at ${time}. Please verify travel time.`,
    }),
  },

  therapist_daily_agenda: {
    name: "therapist_daily_agenda",
    category: "utility",
    metaTemplateName: "curevan_therapist_agenda_v1",
    metaApprovedText: "Dr {{1}}, your Curevan schedule for today ({{2}}): {{3}}. View schedule: {{4}}",
    variables: ["therapist_name", "date", "agenda_summary", "link"],
    formatWhatsApp: ({ therapistName, date, agendaSummary, link }) =>
      `Dr ${therapistName || "Therapist"}, your Curevan schedule for today (${date}): ${agendaSummary}. View schedule: ${link || "https://curevan.com/dashboard/therapist/schedule"}`,
    formatPush: ({ agendaSummary }) => ({
      title: "Your sessions today",
      body: agendaSummary,
    }),
  },

  therapist_60min: {
    name: "therapist_60min",
    category: "utility",
    metaTemplateName: "curevan_therapist_60min_v1",
    metaApprovedText: "Dr {{1}}, your session with {{2}} starts in 60 minutes at {{3}} in {{4}}. View details: {{5}}",
    variables: ["therapist_name", "patient_name", "time", "city", "link"],
    formatWhatsApp: ({ therapistName, patientName, time, city, link }) =>
      `Dr ${therapistName || "Therapist"}, your session with ${patientName || "patient"} starts in 60 minutes at ${time}${city ? ` in ${city}` : ""}. View details: ${link || "https://curevan.com/dashboard/therapist/schedule"}`,
    formatPush: ({ patientName, time, city }) => ({
      title: "Session starting soon",
      body: `Your Curevan home session with ${patientName || "patient"} starts at ${time}${city ? ` in ${city}` : ""}.`,
    }),
  },

  followup_overdue: {
    name: "followup_overdue",
    category: "utility",
    metaTemplateName: "curevan_followup_overdue_v1",
    metaApprovedText: "Namaste {{1}}, it has been a while since your last session. Book your next appointment to keep your recovery plan on track: {{2}}",
    variables: ["patient_name", "link"],
    formatWhatsApp: ({ patientName, link }) =>
      `Namaste ${patientName || "there"}, it has been a while since your last session. Book your next appointment to keep your recovery plan on track: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatInApp: () => ({
      title: "Time to book your next session",
      message: "It has been a while since your last session. Book your next one to keep your recovery on track.",
      link: "/dashboard/bookings",
    }),
  },

  hep_daily: {
    name: "hep_daily",
    category: "utility",
    metaTemplateName: "curevan_hep_daily_v1",
    metaApprovedText: "Namaste {{1}}, time for your home exercises! A few minutes of prescribed exercises today keeps your recovery progressing: {{2}}",
    variables: ["patient_name", "link"],
    formatWhatsApp: ({ patientName, link }) =>
      `Namaste ${patientName || "there"}, time for your home exercises! A few minutes of prescribed exercises today keeps your recovery progressing: ${link || "https://curevan.com/dashboard/patient/progress"}`,
    formatPush: () => ({
      title: "Time for your home exercises",
      body: "A few minutes of your exercises today keeps your recovery on track.",
    }),
  },

  progress_report_ready: {
    name: "progress_report_ready",
    category: "utility",
    metaTemplateName: "curevan_progress_report_v1",
    metaApprovedText: "Namaste {{1}}, your clinical progress report from Dr {{2}} is ready. View your recovery milestones: {{3}}",
    variables: ["patient_name", "therapist_name", "link"],
    formatWhatsApp: ({ patientName, therapistName, link }) =>
      `Namaste ${patientName || "there"}, your clinical progress report from Dr ${therapistName || "your therapist"} is ready. View your recovery milestones: ${link || "https://curevan.com/dashboard/patient/progress"}`,
    formatEmail: ({ patientName, therapistName, link }) => ({
      subject: "Your Clinical Progress Report is Ready",
      text: `Hello ${patientName || "Patient"},\n\nYour clinical progress report compiled by Dr ${therapistName || "your therapist"} has been released.\n\nView report: ${link || "https://curevan.com/dashboard/patient/progress"}\n\nTeam Curevan`,
      html: `<h3>Clinical Progress Report Ready</h3><p>Hello ${patientName || "Patient"},</p><p>Your latest clinical progress evaluation from <strong>Dr ${therapistName || "your therapist"}</strong> is now ready for review.</p><p><a href="${link || "https://curevan.com/dashboard/patient/progress"}">View Progress Report</a></p><p>Team Curevan</p>`,
    }),
    formatInApp: () => ({
      title: "Progress report ready",
      message: "Your latest clinical progress report has been published by your therapist.",
      link: "/dashboard/patient/progress",
    }),
  },

  therapist_on_the_way: {
    name: "therapist_on_the_way",
    category: "utility",
    metaTemplateName: "curevan_therapist_ontheway_v1",
    metaApprovedText: "Namaste {{1}}, your therapist {{2}} is on the way to your home for the {{3}} session. Please keep your Start Code ready.",
    variables: ["patient_name", "therapist_name", "time"],
    formatWhatsApp: ({ patientName, therapistName, time }) =>
      `Namaste ${patientName || "there"}, your therapist ${therapistName || "your therapist"} is on the way to your home for the ${time} session. Please keep your Start Code ready.`,
    formatPush: ({ therapistName, time }) => ({
      title: "Therapist on the way",
      body: `${therapistName || "Your therapist"} is on the way for your ${time} appointment.`,
    }),
  },

  session_completed_review: {
    name: "session_completed_review",
    category: "utility",
    metaTemplateName: "curevan_session_completed_v1",
    metaApprovedText: "Namaste {{1}}, your session with {{2}} is complete. How did it go? Rate your experience and help us maintain quality care: {{3}}",
    variables: ["patient_name", "therapist_name", "link"],
    formatWhatsApp: ({ patientName, therapistName, link }) =>
      `Namaste ${patientName || "there"}, your session with ${therapistName || "your therapist"} is complete. How did it go? Rate your experience and help us maintain quality care: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatInApp: ({ therapistName, link }) => ({
      title: "Rate your session",
      message: `Your session with ${therapistName || "your therapist"} has concluded. Leave a review.`,
      link: link || "/dashboard/bookings",
    }),
  },

  pcr_pdf_ready: {
    name: "pcr_pdf_ready",
    category: "utility",
    metaTemplateName: "curevan_pcr_ready_v1",
    metaApprovedText: "Namaste {{1}}, your Patient Care Record (PCR) summary for session #{{2}} on {{3}} has been finalized. View record: {{4}}",
    variables: ["patient_name", "session_number", "date", "link"],
    formatWhatsApp: ({ patientName, sessionNumber, date, link }) =>
      `Namaste ${patientName || "there"}, your Patient Care Record (PCR) summary for session #${sessionNumber || ""} on ${date || ""} has been finalized. View record: ${link || "https://curevan.com/dashboard/patient/health-records"}`,
    formatEmail: ({ patientName, sessionNumber, date, link }) => ({
      subject: `Your PCR Summary - Session #${sessionNumber || ""}`,
      text: `Hello ${patientName || "Patient"},\n\nYour Patient Care Record (PCR) documentation for session #${sessionNumber || ""} conducted on ${date || ""} has been finalized.\n\nView record: ${link || "https://curevan.com/dashboard/patient/health-records"}\n\nTeam Curevan`,
      html: `<h3>Patient Care Record (PCR) Finalized</h3><p>Hello ${patientName || "Patient"},</p><p>Your PCR summary for session #${sessionNumber || ""} conducted on ${date || ""} is now available in your portal.</p><p><a href="${link || "https://curevan.com/dashboard/patient/health-records"}">Access Health Records</a></p>`,
    }),
  },

  booking_cancelled: {
    name: "booking_cancelled",
    category: "utility",
    metaTemplateName: "curevan_booking_cancelled_v1",
    metaApprovedText: "Namaste {{1}}, your booking for {{2}} at {{3}} has been cancelled. Reason: {{4}}",
    variables: ["patient_name", "date", "time", "reason"],
    formatWhatsApp: ({ patientName, date, time, reason }) =>
      `Namaste ${patientName || "there"}, your booking for ${date} at ${time} has been cancelled.${reason ? ` Reason: ${reason}` : ""}`,
    formatInApp: ({ date, time }) => ({
      title: "Booking cancelled",
      message: `Your appointment on ${date} at ${time} was cancelled.`,
      link: "/dashboard/bookings",
    }),
  },

  booking_reassigned: {
    name: "booking_reassigned",
    category: "utility",
    metaTemplateName: "curevan_booking_reassigned_v1",
    metaApprovedText: "Namaste {{1}}, your session on {{2}} at {{3}} has been reassigned to {{4}}. View details: {{5}}",
    variables: ["patient_name", "date", "time", "new_therapist_name", "link"],
    formatWhatsApp: ({ patientName, date, time, newTherapistName, link }) =>
      `Namaste ${patientName || "there"}, your session on ${date} at ${time} has been reassigned to ${newTherapistName || "a certified therapist"}. View details: ${link || "https://curevan.com/dashboard/bookings"}`,
    formatInApp: ({ date, time, newTherapistName }) => ({
      title: "Therapist Reassigned",
      message: `Your appointment on ${date} at ${time} has been reassigned to ${newTherapistName || "your therapist"}.`,
      link: "/dashboard/bookings",
    }),
  },

  order_paid: {
    name: "order_paid",
    category: "utility",
    metaTemplateName: "curevan_order_paid_v1",
    metaApprovedText: "Namaste {{1}}, thank you! We received your payment of INR {{2}} for Order #{{3}}. We will pack and ship your wellness items shortly. Track order: {{4}}",
    variables: ["customer_name", "amount", "order_number", "link"],
    formatWhatsApp: ({ customerName, amount, orderNumber, link }) =>
      `Namaste ${customerName || "Customer"}, thank you! We received your payment of INR ${amount} for Order #${orderNumber}. We will pack and ship your wellness items shortly. Track order: ${link || "https://curevan.com/dashboard/orders"}`,
    formatEmail: ({ customerName, amount, orderNumber, link }) => ({
      subject: `Order Confirmation #${orderNumber}`,
      text: `Hello ${customerName || "Customer"},\n\nThank you for shopping at Curevan. We have received your payment of INR ${amount} for Order #${orderNumber}.\n\nTrack order: ${link || "https://curevan.com/dashboard/orders"}\n\nTeam Curevan`,
      html: `<h3>Order Confirmation #${orderNumber}</h3><p>Hello ${customerName || "Customer"},</p><p>We received your payment of <strong>INR ${amount}</strong> for Order #${orderNumber}.</p><p><a href="${link || "https://curevan.com/dashboard/orders"}">Track Order</a></p>`,
    }),
  },

  order_shipped: {
    name: "order_shipped",
    category: "utility",
    metaTemplateName: "curevan_order_shipped_v1",
    metaApprovedText: "Namaste {{1}}, your Curevan order #{{2}} has been shipped via {{3}}. Tracking AWB: {{4}}. Track here: {{5}}",
    variables: ["customer_name", "order_number", "courier", "awb", "link"],
    formatWhatsApp: ({ customerName, orderNumber, courier, awb, link }) =>
      `Namaste ${customerName || "Customer"}, your Curevan order #${orderNumber} has been shipped via ${courier || "courier"}. Tracking AWB: ${awb || ""}. Track here: ${link || "https://curevan.com/dashboard/orders"}`,
    formatEmail: ({ customerName, orderNumber, courier, awb, link }) => ({
      subject: `Order #${orderNumber} Shipped`,
      text: `Hello ${customerName || "Customer"},\n\nYour order #${orderNumber} has been handed over to ${courier || "our courier partner"}. AWB: ${awb || ""}.\n\nTrack: ${link || "https://curevan.com/dashboard/orders"}\n\nTeam Curevan`,
      html: `<h3>Your Order Has Shipped</h3><p>Hello ${customerName || "Customer"},</p><p>Order #${orderNumber} is on its way via ${courier || "courier"}. AWB: <strong>${awb || ""}</strong>.</p><p><a href="${link || "https://curevan.com/dashboard/orders"}">Track Shipment</a></p>`,
    }),
  },

  order_delivered: {
    name: "order_delivered",
    category: "utility",
    metaTemplateName: "curevan_order_delivered_v1",
    metaApprovedText: "Namaste {{1}}, your Curevan order #{{2}} has been delivered. You have 7 days to report any issues or request a return: {{3}}",
    variables: ["customer_name", "order_number", "link"],
    formatWhatsApp: ({ customerName, orderNumber, link }) =>
      `Namaste ${customerName || "Customer"}, your Curevan order #${orderNumber} has been delivered. You have 7 days to report any issues or request a return: ${link || "https://curevan.com/dashboard/orders"}`,
    formatEmail: ({ customerName, orderNumber, link }) => ({
      subject: `Order #${orderNumber} Delivered`,
      text: `Hello ${customerName || "Customer"},\n\nYour order #${orderNumber} has been delivered. You can initiate a return within 7 days if required.\n\nView order: ${link || "https://curevan.com/dashboard/orders"}\n\nTeam Curevan`,
      html: `<h3>Your Order is Delivered</h3><p>Hello ${customerName || "Customer"},</p><p>Order #${orderNumber} has been delivered. You have 7 days to report issues or request returns.</p><p><a href="${link || "https://curevan.com/dashboard/orders"}">View Order</a></p>`,
    }),
  },

  refund_processed: {
    name: "refund_processed",
    category: "utility",
    metaTemplateName: "curevan_refund_processed_v1",
    metaApprovedText: "Namaste {{1}}, a refund of INR {{2}} has been initiated for {{3}} (Ref: {{4}}). It typically reflects in your bank account within 5-7 business days.",
    variables: ["customer_name", "amount", "reference", "refund_id"],
    formatWhatsApp: ({ customerName, amount, reference, refundId }) =>
      `Namaste ${customerName || "Customer"}, a refund of INR ${amount} has been initiated for ${reference || "your transaction"}${refundId ? ` (Ref: ${refundId})` : ""}. It typically reflects in your bank account within 5-7 business days.`,
    formatEmail: ({ customerName, amount, reference, refundId }) => ({
      subject: `Refund Initiated - INR ${amount}`,
      text: `Hello ${customerName || "Customer"},\n\nA refund of INR ${amount} has been initiated for ${reference || "your account"}${refundId ? ` (Refund ID: ${refundId})` : ""}.\n\nExpected within 5-7 business days.\n\nTeam Curevan`,
      html: `<h3>Refund Initiated</h3><p>Hello ${customerName || "Customer"},</p><p>A refund of <strong>INR ${amount}</strong> has been initiated for ${reference || "your account"}.</p><p>Refund ID: ${refundId || "N/A"}</p>`,
    }),
  },

  payout_paid: {
    name: "payout_paid",
    category: "utility",
    metaTemplateName: "curevan_payout_paid_v1",
    metaApprovedText: "Dr {{1}}, your weekly payout of INR {{2}} for the week of {{3}} has been transferred. Bank UTR: {{4}}. Statement: {{5}}",
    variables: ["therapist_name", "amount", "week", "utr", "link"],
    formatWhatsApp: ({ therapistName, amount, week, utr, link }) =>
      `Dr ${therapistName || "Therapist"}, your weekly payout of INR ${amount} for the week of ${week || ""} has been transferred. Bank UTR: ${utr || ""}. Statement: ${link || "https://curevan.com/dashboard/earnings"}`,
    formatEmail: ({ therapistName, amount, week, utr, link }) => ({
      subject: `Payout Disbursed - Week of ${week || ""}`,
      text: `Dr ${therapistName || "Therapist"},\n\nYour weekly payout of INR ${amount} for the week of ${week || ""} has been transferred to your bank account.\n\nBank Reference UTR: ${utr || ""}\n\nDownload Statement: ${link || "https://curevan.com/dashboard/earnings"}\n\nTeam Curevan`,
      html: `<h3>Weekly Payout Disbursed</h3><p>Dr ${therapistName || "Therapist"},</p><p>Your weekly payout of <strong>INR ${amount}</strong> for the week of ${week || ""} has been processed.</p><p>Bank UTR: <code>${utr || "N/A"}</code></p><p><a href="${link || "https://curevan.com/dashboard/earnings"}">Download Payout Statement</a></p>`,
    }),
  },

  sos_raised: {
    name: "sos_raised",
    category: "utility",
    dltTemplateId: process.env.DLT_TID_SOS || "1407169000000004",
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

module.exports = { TEMPLATES, DLT_ENTITY_ID, DLT_SENDER_ID };
