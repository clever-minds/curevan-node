// Daily 02:00 India time: commissions whose return window has passed become eligible and join the payout queue (P20).
const cron = require("node-cron");
const affiliateService = require("../services/affiliateService");

function start() {
  cron.schedule("0 2 * * *", async () => {
    try {
      const n = await affiliateService.promoteEligible();
      if (n > 0) console.log(`affiliate commissions made eligible: ${n}`);
    } catch (err) { console.error("affiliate job failed:", err.message); }
  }, { timezone: "Asia/Kolkata" });
}

module.exports = { start };
