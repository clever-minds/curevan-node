// Calendar files (handoff pack P17). Entries carry only "Curevan home session", a first name, the time and the locality -
// never a diagnosis or a clinical note.
const { createEvents } = require("ics");
const access = require("../utils/access");
const rules = require("../config/businessRules");

const firstName = (n) => String(n || "").trim().split(/\s+/)[0];

/** one booking row (with city + status) as an ics event for the patient or the therapist */
function eventFor(a, viewer) {
  const start = access.slotStart(a);
  if (!start) return null;
  const tentative = a.status === "proposed";
  const who = viewer === "therapist" ? `with ${firstName(a.patient_name) || "your patient"}` : `with ${a.therapist_name || "your therapist"}`;
  const d = new Date(start.getTime());
  return {
    uid: `curevan-appt-${a.id}@curevan.com`,
    title: `Curevan home session${tentative ? " (tentative)" : ""}`,
    description: `Curevan home session ${who}.${tentative ? " Not confirmed yet." : ""}`,
    location: a.city || undefined,
    start: [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()],
    startInputType: "utc", startOutputType: "utc",
    duration: { minutes: rules.session.slotMinutes },
    status: tentative ? "TENTATIVE" : "CONFIRMED",
  };
}

/** @param bookings rows; @param viewer "patient" | "therapist", or a function of the row */
function buildCalendar(bookings, viewer) {
  const events = bookings.map((b) => eventFor(b, typeof viewer === "function" ? viewer(b) : viewer)).filter(Boolean);
  const { error, value } = createEvents(events.length ? events : [], { calName: "Curevan sessions" });
  if (error) throw error;
  // an empty feed is still a valid calendar
  return value || "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Curevan//Sessions//EN\r\nEND:VCALENDAR\r\n";
}

module.exports = { buildCalendar, eventFor };
