#!/usr/bin/env node
/**
 * WhatsApp Message Templates Sync & Management Script (P30).
 * Usage:
 *   node scripts/whatsapp_templates.js --list     List all templates and compare with Meta status
 *   node scripts/whatsapp_templates.js --submit   Submit new templates from registry to Meta Cloud API
 *
 * Safe handling:
 *   - Never prints or leaks access tokens or secrets.
 *   - Never deletes or modifies approved templates.
 *   - Respects WHATSAPP_GRAPH_VERSION and WHATSAPP_TEMPLATE_LANG.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const axios = require("axios");
const { TEMPLATES } = require("../src/services/notifications/templates");
const rules = require("../src/config/businessRules");

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const wabaId = process.env.WHATSAPP_WABA_ID;
const graphVersion = rules.whatsapp?.graphVersion || process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
const templateLang = rules.whatsapp?.templateLang || process.env.WHATSAPP_TEMPLATE_LANG || "en";

async function fetchMetaTemplates() {
  if (!token || !wabaId) {
    return {
      success: false,
      error: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_WABA_ID not configured in environment.",
      templates: [],
    };
  }

  try {
    const url = `https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates?limit=100`;
    const resp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    return { success: true, templates: resp.data?.data || [] };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return { success: false, error: msg, templates: [] };
  }
}

async function listTemplates() {
  console.log("=== Curevan WhatsApp Templates Registry & Meta Status ===");
  console.log(`Graph Version: ${graphVersion} | Language: ${templateLang}`);
  console.log(`WABA ID: ${wabaId ? wabaId : "(not configured)"}\n`);

  const metaRes = await fetchMetaTemplates();
  if (!metaRes.success) {
    console.warn(`[WARN] Meta API check skipped or unavailable: ${metaRes.error}`);
    console.log("Displaying local registry templates only:\n");
  }

  const metaMap = new Map();
  for (const t of metaRes.templates) {
    metaMap.set(t.name, t);
  }

  const rows = [];
  for (const [key, tmpl] of Object.entries(TEMPLATES)) {
    if (!tmpl.metaTemplateName) continue;
    const metaMatch = metaMap.get(tmpl.metaTemplateName);
    const metaStatus = metaMatch ? metaMatch.status : (metaRes.success ? "NOT_IN_META" : "UNKNOWN");
    const rejectionReason = metaMatch?.rejected_reason || metaMatch?.quality_score?.reasons?.join("; ") || "";

    rows.push({
      Event: key,
      "Template Name": tmpl.metaTemplateName,
      Category: tmpl.category,
      "Meta Status": metaStatus,
      "Rejection / Notes": rejectionReason,
    });
  }

  console.table(rows);
}

async function submitTemplates() {
  console.log("=== Submitting Unregistered Templates to Meta Cloud API ===");
  if (!token || !wabaId) {
    console.error("ERROR: WHATSAPP_ACCESS_TOKEN and WHATSAPP_WABA_ID must be set in .env to submit templates.");
    process.exit(1);
  }

  const metaRes = await fetchMetaTemplates();
  if (!metaRes.success) {
    console.error(`ERROR: Failed to fetch existing templates from Meta: ${metaRes.error}`);
    process.exit(1);
  }

  const existingNames = new Set(metaRes.templates.map((t) => t.name));
  const toSubmit = Object.values(TEMPLATES).filter(
    (tmpl) => tmpl.metaTemplateName && !existingNames.has(tmpl.metaTemplateName)
  );

  if (toSubmit.length === 0) {
    console.log("All registry templates are already registered in Meta. Nothing to submit.");
    return;
  }

  console.log(`Found ${toSubmit.length} template(s) to submit...\n`);

  for (const tmpl of toSubmit) {
    try {
      let payload;
      if (tmpl.category === "AUTHENTICATION") {
        // Meta Authentication template format (P30)
        payload = {
          name: tmpl.metaTemplateName,
          category: "AUTHENTICATION",
          language: templateLang,
          components: [
            {
              type: "BODY",
              add_security_recommendation: true,
            },
            {
              type: "BUTTONS",
              buttons: [
                {
                  type: "OTP",
                  otp_type: "COPY_CODE",
                  text: "Copy Code",
                },
              ],
            },
          ],
        };
      } else {
        // UTILITY template format with body & samples
        const sampleValues = tmpl.samples || tmpl.variables.map((v, i) => `Sample${i + 1}`);
        payload = {
          name: tmpl.metaTemplateName,
          category: tmpl.category || "UTILITY",
          language: templateLang,
          components: [
            {
              type: "BODY",
              text: tmpl.metaApprovedText,
              example: {
                body_text: [sampleValues],
              },
            },
          ],
        };
      }

      const postUrl = `https://graph.facebook.com/${graphVersion}/${wabaId}/message_templates`;
      const res = await axios.post(postUrl, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      console.log(`[SUBMITTED] ${tmpl.metaTemplateName} -> Meta ID: ${res.data?.id || "OK"}, Status: ${res.data?.status || "PENDING"}`);
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message || err.message;
      console.error(`[FAILED] ${tmpl.metaTemplateName} -> ${errorMsg}`);
    }
  }

  console.log("\nSubmission run complete. Run `npm run wa:templates` to verify current statuses.");
}

async function main() {
  const arg = process.argv[2];
  if (arg === "--list") {
    await listTemplates();
  } else if (arg === "--submit") {
    await submitTemplates();
  } else {
    console.log("Usage: node scripts/whatsapp_templates.js [--list | --submit]");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}

module.exports = { fetchMetaTemplates, listTemplates, submitTemplates };
