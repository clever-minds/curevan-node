// AI chat sessions and the hand-over to a human (handoff pack P26). The chat itself runs in the website's server code and
// reaches this API with the user's own token; nothing here trusts the AI: who the user is comes from the token.
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const rules = require("../../config/businessRules");
const notificationStore = require("../../services/notificationStore");

const REASONS = ["human_requested", "tool_failures", "red_flag"];
const CATEGORIES = ["clinical", "ecommerce", "billing", "general"];
const ROLE_FOR = { clinical: ["admin.therapy"], ecommerce: ["admin.ecom"], billing: ["admin.super"], general: ["admin.super"] };
// default priority when the user only asks for a person: a clinical question is more urgent than a general one
const PRIORITY_FOR = { clinical: "P2", billing: "P3", ecommerce: "P3", general: "P4" };

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const fail = (res, status, message) => res.status(status).json({ success: false, error: message, message });
const pad = (n) => String(n).padStart(2, "0");

/** Support is staffed openHour:00 to closeHour:00 India time; outside it the user is promised a call back by callbackBy. */
function supportStatus(now = Date.now()) {
  const d = new Date(now + 5.5 * 3600e3);
  const hour = d.getUTCHours();
  const open = hour >= rules.support.openHour && hour < rules.support.closeHour;
  return {
    open,
    callbackMessage: open ? null : `Our team is offline now (we are available ${pad(rules.support.openHour)}:00 to ${pad(rules.support.closeHour)}:00). We will call you back by ${rules.support.callbackBy}.`,
  };
}

// POST /api/support/chat/sessions
exports.startSession = async (req, res) => {
  try {
    const [row] = await q(`INSERT INTO chat_sessions (user_id, channel) VALUES (:me, :channel) RETURNING id, status`, { me: req.user.id, channel: String((req.body || {}).channel || "web").slice(0, 20) });
    return res.status(201).json({ success: true, data: row });
  } catch (err) { console.error("startSession:", err.message); return fail(res, 500, "Could not start the chat"); }
};

// POST /api/support/chat/sessions/:id/messages  { messages: [{ sender, text, toolCalls? }], aiSummary? }
exports.addMessages = async (req, res) => {
  try {
    const [session] = await q(`SELECT id, user_id FROM chat_sessions WHERE id = :id`, { id: req.params.id });
    if (!session || Number(session.user_id) !== Number(req.user.id)) return fail(res, 404, "Chat not found");
    const list = Array.isArray((req.body || {}).messages) ? req.body.messages.slice(0, 20) : [];
    for (const m of list) {
      if (!["user", "ai", "system"].includes(m.sender)) continue;
      await q(`INSERT INTO chat_messages (session_id, sender, text, tool_calls) VALUES (:id, :sender, :text, :tools::jsonb) RETURNING id`,
        { id: session.id, sender: m.sender, text: String(m.text || "").slice(0, 4000), tools: m.toolCalls ? JSON.stringify(m.toolCalls).slice(0, 8000) : null });
    }
    await q(`UPDATE chat_sessions SET updated_at = NOW(), ai_summary = COALESCE(:summary, ai_summary) WHERE id = :id RETURNING id`, { id: session.id, summary: req.body.aiSummary ? String(req.body.aiSummary).slice(0, 600) : null });
    return res.json({ success: true });
  } catch (err) { console.error("addMessages:", err.message); return fail(res, 500, "Could not save the messages"); }
};

// POST /api/support/escalate  { reason, category?, summary, sessionId? }
exports.escalate = async (req, res) => {
  try {
    const { reason, summary, sessionId } = req.body || {};
    if (!REASONS.includes(reason)) return fail(res, 400, `reason must be one of ${REASONS.join(", ")}`);
    const text = String(summary || "").trim();
    if (text.length < 5) return fail(res, 400, "A short summary is needed");

    let category = CATEGORIES.includes((req.body || {}).category) ? req.body.category : "general";
    if (reason === "red_flag") category = "clinical";                       // a red-flag message is always clinical and always P1
    const priority = reason === "red_flag" ? "P1" : reason === "tool_failures" ? "P3" : PRIORITY_FOR[category];

    let sid = null;
    if (sessionId) {
      const [s] = await q(`SELECT id, user_id FROM chat_sessions WHERE id = :id`, { id: sessionId });
      if (!s || Number(s.user_id) !== Number(req.user.id)) return fail(res, 404, "Chat not found");
      sid = s.id;
    }
    const [ticket] = await q(
      `INSERT INTO tickets (user_id, type, topic, subject, message, priority, category, ai_summary, chat_session_id, status)
       VALUES (:me, 'ai_escalation', :category, :subject, :message, :priority, :category, :summary, :sid, 'open') RETURNING id, priority, category`,
      { me: req.user.id, category, subject: `AI chat: ${reason.replace("_", " ")} (${category})`, message: text, priority, summary: text.slice(0, 600), sid }
    );
    if (sid) await q(`UPDATE chat_sessions SET status = 'escalated', ai_summary = :summary, updated_at = NOW() WHERE id = :id RETURNING id`, { id: sid, summary: text.slice(0, 600) });

    const roles = priority === "P1" ? [...new Set([...ROLE_FOR[category], "admin.super"])] : ROLE_FOR[category];
    await notificationStore.notifyRoles(roles, {
      type: "ai_escalation",
      title: `${priority} ticket from the AI chat (${category})`,
      message: text.slice(0, 200),
      link: "/dashboard/admin/support-tickets",
      data: { ticketId: ticket.id },
    }).catch((e) => console.error("escalation notify failed:", e.message));

    const status = supportStatus();
    return res.status(201).json({ success: true, data: { ticketId: ticket.id, priority: ticket.priority, category: ticket.category, supportOpen: status.open, callbackMessage: status.callbackMessage } });
  } catch (err) { console.error("escalate:", err.message); return fail(res, 500, "Could not hand this over to our team"); }
};

exports.supportStatus = supportStatus;
