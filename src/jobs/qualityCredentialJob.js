// Daily job for quality rule and credential expiry evaluation (P22)
const cron = require("node-cron");
const qualityService = require("../services/qualityService");
const emergencyService = require("../services/emergencyService");

function start() {
  // Run daily at 03:00 IST
  cron.schedule("0 3 * * *", async () => {
    try {
      await qualityService.evaluateAllTherapistsQuality();
      await qualityService.checkCredentialExpiryAll();
      console.log("Quality and credential daily evaluation completed.");
    } catch (err) {
      console.error("Quality and credential job failed:", err.message);
    }
  }, { timezone: "Asia/Kolkata" });

  // every 10 minutes: bookings of a therapist on leave that nobody took over, 2 hours before the slot -> cancelled, 100% refund (P22)
  cron.schedule("*/10 * * * *", async () => {
    try {
      const out = await emergencyService.autoCancelUnassigned();
      if (out.cancelled || out.failed) console.log("emergency auto-cancel:", JSON.stringify(out));
    } catch (err) { console.error("emergency auto-cancel failed:", err.message); }
  });
}

module.exports = { start };
