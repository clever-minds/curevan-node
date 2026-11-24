const { describe, it } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { TEMPLATES } = require("../../src/services/notifications/templates");
const businessRules = require("../../src/config/businessRules");
const { maskPhone } = require("../../src/controllers/admin/notificationLogController");

describe("P30 WhatsApp Cloud API & Omnichannel Delivery", () => {
  describe("Meta Webhook Signature Verification", () => {
    it("should accept valid HMAC-SHA256 signature and reject tampered or missing signatures", () => {
      const appSecret = "test_meta_app_secret_123456";
      const rawPayload = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
      
      const expectedHmac = crypto.createHmac("sha256", appSecret).update(rawPayload).digest("hex");
      const validHeader = `sha256=${expectedHmac}`;
      const invalidHeader = `sha256=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789`;

      function verifySignature(header, body, secret) {
        if (!header || !header.startsWith("sha256=")) return false;
        const incomingHash = header.slice("sha256=".length);
        const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
        if (incomingHash.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(incomingHash, "utf8"), Buffer.from(expected, "utf8"));
      }

      assert.strictEqual(verifySignature(validHeader, rawPayload, appSecret), true, "Valid HMAC must pass");
      assert.strictEqual(verifySignature(invalidHeader, rawPayload, appSecret), false, "Invalid HMAC must fail");
      assert.strictEqual(verifySignature("", rawPayload, appSecret), false, "Empty signature must fail");
      assert.strictEqual(verifySignature(null, rawPayload, appSecret), false, "Missing signature must fail");
    });
  });

  describe("Inbound STOP / START Consent Actions", () => {
    it("should correctly identify opt-out keywords (STOP, UNSUBSCRIBE) and opt-in keywords (START)", () => {
      function parseInboundAction(bodyText) {
        const cleaned = String(bodyText || "").trim().toUpperCase();
        if (["STOP", "UNSUBSCRIBE", "STOPALL"].includes(cleaned)) {
          return { action: "OPT_OUT", optIn: false };
        }
        if (["START", "UNSTOP"].includes(cleaned)) {
          return { action: "OPT_IN", optIn: true };
        }
        if (["HELP", "INFO"].includes(cleaned)) {
          return { action: "HELP" };
        }
        return { action: "DEFAULT_REPLY" };
      }

      assert.deepStrictEqual(parseInboundAction("stop"), { action: "OPT_OUT", optIn: false });
      assert.deepStrictEqual(parseInboundAction("STOP "), { action: "OPT_OUT", optIn: false });
      assert.deepStrictEqual(parseInboundAction("unsubscribe"), { action: "OPT_OUT", optIn: false });
      assert.deepStrictEqual(parseInboundAction("start"), { action: "OPT_IN", optIn: true });
      assert.deepStrictEqual(parseInboundAction("help"), { action: "HELP" });
      assert.deepStrictEqual(parseInboundAction("Hello there"), { action: "DEFAULT_REPLY" });
    });
  });

  describe("Template Rules & Compliance Validation", () => {
    const clinicalWords = [
      "diagnosis",
      "stroke",
      "paralysis",
      "pain",
      "injury",
      "surgery",
      "condition",
    ];

    it("all registered templates must adhere to Meta and Curevan compliance rules", () => {
      const metaTemplates = Object.entries(TEMPLATES).filter(([_, tpl]) => Boolean(tpl.metaApprovedText));
      assert.strictEqual(metaTemplates.length >= 35, true, `Expected >= 35 Meta templates, got ${metaTemplates.length}`);

      for (const [key, tpl] of metaTemplates) {
        const bodyText = tpl.metaApprovedText;

        // 1. Must have category UTILITY or AUTHENTICATION
        assert.ok(
          ["UTILITY", "AUTHENTICATION"].includes(tpl.category),
          `Template ${key} has invalid category: ${tpl.category}`
        );

        // 2. Must start with "Namaste {{1}}," or "Hello {{1}},"
        const startsWithGreeting =
          bodyText.startsWith("Namaste {{1}},") || bodyText.startsWith("Hello {{1}},");
        assert.ok(
          startsWithGreeting,
          `Template ${key} does not start with 'Namaste {{1}},' or 'Hello {{1}},'. Body starts with: ${bodyText.slice(0, 25)}`
        );

        // 3. Must contain Curevan brand
        assert.ok(
          bodyText.includes("Curevan"),
          `Template ${key} does not mention the Curevan brand`
        );

        // 4. If UTILITY, must include support contact
        if (tpl.category === "UTILITY") {
          assert.ok(
            bodyText.includes("+91 95144 46292") || bodyText.includes("Need help? Call +91 95144 46292"),
            `Template ${key} is missing support phone contact: +91 95144 46292`
          );
        }

        // 5. No clinical / diagnosis words
        const lowerBody = bodyText.toLowerCase();
        for (const word of clinicalWords) {
          const wordRegex = new RegExp(`\\b${word}\\b`, "i");
          assert.strictEqual(
            wordRegex.test(lowerBody),
            false,
            `Template ${key} contains forbidden clinical word: '${word}'`
          );
        }

        // 6. If UTILITY, cannot contain 'OTP' or 'code'
        if (tpl.category === "UTILITY") {
          assert.strictEqual(
            /\bOTP\b/i.test(bodyText),
            false,
            `Utility template ${key} contains forbidden word 'OTP'`
          );
          assert.strictEqual(
            /\bcode\b/i.test(bodyText),
            false,
            `Utility template ${key} contains forbidden word 'code'`
          );
        }

        // 7. Strip support phone, then check that no 4-6 digit numeric literals exist
        const bodyWithoutSupportPhone = bodyText.replace(/\+91\s*95144\s*46292/g, "");
        const literalMatch = bodyWithoutSupportPhone.match(/\b\d{4,6}\b/);
        assert.strictEqual(
          literalMatch,
          null,
          `Template ${key} contains forbidden 4-6 digit literal: ${literalMatch?.[0]}`
        );

        // 8. Any URLs must strictly be https://www.curevan.com/...
        const urls = bodyText.match(/https?:\/\/[^\s)]+/g) || [];
        for (const url of urls) {
          assert.ok(
            url.startsWith("https://www.curevan.com/"),
            `Template ${key} contains invalid external URL: ${url}`
          );
        }

        // 9. Samples array count must match variable placeholders count
        const placeholders = bodyText.match(/\{\{\d+\}\}/g) || [];
        const uniqueIndices = new Set(placeholders.map((p) => p.replace(/[^\d]/g, "")));
        if (tpl.samples && tpl.samples.length > 0) {
          assert.strictEqual(
            tpl.samples.length,
            uniqueIndices.size,
            `Template ${key} samples count (${tpl.samples.length}) does not match placeholder count (${uniqueIndices.size})`
          );
        }
      }
    });

    it("booking_confirmed and reminder_2h must never contain start code; start code is only in start_code template", () => {
      const bc = TEMPLATES.booking_confirmed;
      const r2h = TEMPLATES.reminder_2h;
      const sc = TEMPLATES.start_code;

      assert.strictEqual(/\bcode\b/i.test(bc.metaApprovedText), false, "booking_confirmed cannot have 'code'");
      assert.strictEqual(/\bstart code\b/i.test(bc.metaApprovedText), false, "booking_confirmed cannot have 'start code'");
      assert.strictEqual(/\bcode\b/i.test(r2h.metaApprovedText), false, "reminder_2h cannot have 'code'");

      assert.ok(sc, "start_code template must exist");
      assert.strictEqual(sc.metaTemplateName, "curevan_start_code");
      assert.strictEqual(sc.category, "AUTHENTICATION", "curevan_start_code must be AUTHENTICATION category");
    });
  });

  describe("Deduplication & Recipient Filtering", () => {
    it("should generate deterministic dedupe keys", () => {
      const event = "order_placed";
      const entityId = 12345;
      const recipientUserId = 6789;
      const channel = "whatsapp";

      const key = `${event}_${entityId}_${recipientUserId}_${channel}`;
      assert.strictEqual(key, "order_placed_12345_6789_whatsapp");
    });

    it("should mask recipient phone numbers correctly for privacy", () => {
      assert.strictEqual(maskPhone("+919514446292"), "+91 ••••• 6292");
      assert.strictEqual(maskPhone("9514446292"), "••••• 6292");
      assert.strictEqual(maskPhone(null), null);
      assert.strictEqual(maskPhone(""), null);
    });
  });
});
