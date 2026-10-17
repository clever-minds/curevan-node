// Sunday 23:59 India time: group the week's payout lines into one batch per therapist (P18).
const cron = require("node-cron");
const payoutService = require("../services/payoutService");

function start() {
  cron.schedule("59 23 * * 0", async () => {
    try {
      const out = await payoutService.runWeeklyBatches();
      console.log("weekly payout batches:", JSON.stringify(out));
    } catch (err) { console.error("weekly payout job failed:", err.message); }
  }, { timezone: "Asia/Kolkata" });
}

module.exports = { start };
