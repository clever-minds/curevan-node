const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const access = require("../../utils/access");

const TYPES = ["terms", "privacy", "medical", "marketing", "cookies"];

/* POST /api/consent/log   { consentType, version, granted? }
   Open to anonymous visitors (cookie banner); the user id comes from the token, never from the body. */
exports.logConsent = async (req, res) => {
  try {
    const { consentType, version } = req.body || {};
    const granted = req.body && req.body.granted === false ? false : true;
    if (!TYPES.includes(consentType)) {
      return res.status(400).json({ success: false, error: `consentType must be one of ${TYPES.join(", ")}`, message: "Invalid consent type" });
    }
    const user = access.optionalUser(req);

    await sequelize.query(
      `INSERT INTO consent_logs (user_id, consent_type, policy_version, granted, ip, user_agent)
       VALUES (:userId, :type, :version, :granted, :ip, :ua)`,
      {
        replacements: {
          userId: user ? user.id : null,
          type: consentType,
          version: version ? String(version).slice(0, 50) : null,
          granted,
          ip: req.ip || null,
          ua: String(req.headers["user-agent"] || "").slice(0, 300) || null,
        },
        type: QueryTypes.INSERT,
      }
    );
    return res.json({ success: true });
  } catch (error) {
    console.error("logConsent error:", error);
    return res.status(500).json({ success: false, error: "Could not save consent", message: "Could not save consent" });
  }
};

/* GET /api/consent/list?userId=&type=   (Super Admin) */
exports.listConsents = async (req, res) => {
  try {
    const where = [];
    const replacements = {};
    if (req.query.userId) { where.push("c.user_id = :userId"); replacements.userId = Number(req.query.userId); }
    if (req.query.type) { where.push("c.consent_type = :type"); replacements.type = req.query.type; }
    const rows = await sequelize.query(
      `SELECT c.id, c.user_id AS "userId", u.name AS "userName", c.consent_type AS "consentType",
              c.policy_version AS "version", c.granted, c.ip, c.created_at AS "createdAt"
       FROM consent_logs c LEFT JOIN users u ON u.id = c.user_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY c.created_at DESC LIMIT 1000`,
      { replacements, type: QueryTypes.SELECT }
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("listConsents error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch consent records" });
  }
};
