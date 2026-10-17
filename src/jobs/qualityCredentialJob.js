// Daily job for quality rule and credential expiry evaluation (P22)
const cron = require("node-cron");
const qualityService = require("../services/qualityService");

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
}

module.exports = { start };
