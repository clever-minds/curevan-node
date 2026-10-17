// Exotel provider: POST /v1/Accounts/{sid}/Calls/connect.json. Exotel rings `From` first and, when it answers, rings `To`; the caller id
// shown to both is the virtual number (EXOTEL_VIRTUAL_NUMBER). Credentials come from the environment only.
const axios = require("axios");

async function connect({ from, to, callId }) {
  const sid = process.env.EXOTEL_SID;
  const key = process.env.EXOTEL_API_KEY;
  const token = process.env.EXOTEL_API_TOKEN;
  const virtual = process.env.EXOTEL_VIRTUAL_NUMBER;
  if (!sid || !key || !token || !virtual) throw new (require("./index").TelephonyError)("Exotel is not configured");

  const host = process.env.EXOTEL_SUBDOMAIN || "api.exotel.com";
  const callback = process.env.TELEPHONY_STATUS_CALLBACK_URL;        // https://api.curevan.com/api/hooks/telephony?token=...
  const body = new URLSearchParams({ From: from, To: to, CallerId: virtual, CustomField: String(callId), CallType: "trans" });
  if (callback) body.set("StatusCallback", callback);

  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {                 // one retry on a network error
    try {
      const { data } = await axios.post(`https://${host}/v1/Accounts/${encodeURIComponent(sid)}/Calls/connect.json`, body.toString(), {
        auth: { username: key, password: token },
        headers: { "content-type": "application/x-www-form-urlencoded" },
        timeout: 8000,
      });
      const call = data && data.Call;
      if (!call || !call.Sid) throw new Error("Exotel gave no call id");
      return { sid: String(call.Sid), status: String(call.Status || "queued"), provider: "exotel" };
    } catch (err) {
      lastErr = err;
      if (err.response && err.response.status < 500) break;           // a refusal is not retried
      if (attempt === 1) await new Promise((r) => setTimeout(r, 200));
    }
  }
  const T = require("./index").TelephonyError;
  throw new T(`Exotel failed: ${lastErr && lastErr.response && lastErr.response.data ? "request refused" : (lastErr && lastErr.message) || "unknown error"}`);
}

module.exports = { connect };
