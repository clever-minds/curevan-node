// Periodic jobs of P17: reminders (5 min), hold expiry (10 min), overdue follow-ups (daily 09:00 IST).
const cron = require("node-cron");
const reminderService = require("../services/reminderService");
const followUpService = require("../services/followUpService");

const safe = (name, fn) => async () => {
  try {
    const out = await fn();
    if (out && Object.values(out).some((n) => n > 0)) console.log(`${name}:`, JSON.stringify(out));
  } catch (err) { console.error(`${name} failed:`, err.message); }
};

function start() {
  cron.schedule("*/5 * * * *", safe("reminders", () => reminderService.run()));
  cron.schedule("*/10 * * * *", safe("follow-up holds", () => followUpService.expireHolds()));
  cron.schedule("0 9 * * *", safe("overdue follow-ups", () => followUpService.markOverdue()), { timezone: "Asia/Kolkata" });
}

module.exports = { start };
