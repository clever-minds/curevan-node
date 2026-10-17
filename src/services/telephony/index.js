// Masked calling (handoff pack P27): the provider calls the caller first, then the other party, and both see only the virtual number.
// The vendor is chosen by TELEPHONY_PROVIDER (exotel | console | fail); nothing outside this folder knows which one it is.
// Real numbers go in here and are never returned to the browser or written to the logs.
const exotel = require("./exotel");

class TelephonyError extends Error {
  constructor(message) { super(message); this.name = "TelephonyError"; }
}

const providerName = () => String(process.env.TELEPHONY_PROVIDER || "").trim().toLowerCase();

/** True when a provider is configured: the website shows the Call button only then (features.maskedCall). */
const isLive = () => ["exotel", "console", "fail"].includes(providerName());      // "fail" is for tests: it behaves like a configured provider that always errors

/** The last 4 digits only: enough to debug, never enough to call. */
const mask = (n) => `******${String(n || "").replace(/\D/g, "").slice(-4)}`;

/**
 * Connect `from` (the caller) to `to` through the virtual number.
 * @returns {{ sid: string, status: string, provider: string }}
 */
async function connect({ from, to, callId }) {
  const name = providerName();
  if (name === "fail") throw new TelephonyError("Simulated telephony failure");
  if (name === "exotel") return exotel.connect({ from, to, callId });
  if (name === "console") {
    console.log(`[Telephony:console] call #${callId}: ${mask(from)} -> ${mask(to)} through the virtual number`);
    return { sid: `console_${callId}_${Date.now()}`, status: "initiated", provider: "console" };
  }
  throw new TelephonyError("Calling is not available right now");
}

/** Provider status words -> ours. Exotel: queued, ringing, in-progress, completed, failed, busy, no-answer, canceled. */
function normalizeStatus(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/_/g, "-");
  if (s === "completed" || s === "complete") return "completed";
  if (["queued", "initiated"].includes(s)) return "initiated";
  if (["ringing", "in-progress", "busy", "no-answer", "failed", "canceled"].includes(s)) return s;
  if (s === "cancelled") return "canceled";
  return s ? s.slice(0, 30) : "initiated";
}

module.exports = { connect, isLive, mask, normalizeStatus, providerName, TelephonyError };
