const express = require("express");
const router = express.Router();
const rules = require("../config/businessRules");
const telephony = require("../services/telephony");

// Non-secret business values the apps need (timer length, OTP length, travel window). No login needed.
router.get("/public", (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    success: true,
    data: {
      session: { slotMinutes: rules.session.slotMinutes, timerMinutes: rules.session.timerMinutes, minLeadHours: rules.session.minLeadHours, maxAdvanceDays: rules.session.maxAdvanceDays },
      otp: { length: rules.otp.length, validFromHoursBefore: rules.otp.validFromHoursBefore, maxAttempts: rules.otp.maxAttempts },
      visit: { travelFromMinutesBefore: rules.visit.travelFromMinutesBefore },
      shop: { freeShippingThresholdInr: rules.shop.freeShippingThresholdInr, flatShippingFeeInr: rules.shop.flatShippingFeeInr, returnWindowDays: rules.shop.returnWindowDays },
      support: { openHour: rules.support.openHour, closeHour: rules.support.closeHour, callbackBy: rules.support.callbackBy },
      features: { maskedCall: telephony.isLive(), carePacks: rules.features.carePacks },
      maskedCall: { windowHoursBefore: rules.maskedCall.windowHoursBefore, windowHoursAfter: rules.maskedCall.windowHoursAfter },
      affiliate: { patientDiscountPct: rules.affiliate.patientDiscountPct, therapistCommissionPct: rules.affiliate.therapistCommissionPct, eligibleAfterDeliveryDays: rules.affiliate.eligibleAfterDeliveryDays },
      cancellation: {
        freeHoursBefore: rules.cancellation.freeHoursBefore,
        partialHoursBefore: rules.cancellation.partialHoursBefore,
        partialChargePct: rules.cancellation.partialChargePct,
        lateChargePct: rules.cancellation.lateChargePct,
        graceMinutesAfterBooking: rules.cancellation.graceMinutesAfterBooking,
        therapistLateMinutes: rules.cancellation.therapistLateMinutes,
      },
    },
  });
});

// Who issues the invoices (businessRules.legalEntity, owner decision D1). Empty fields stay empty: the website shows a warning instead of inventing numbers.
router.get("/legal-entity", (req, res) => {
  const e = rules.legalEntity;
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    success: true,
    data: { ...e, missing: ["gstin", "cin", "pan", "addressLine1", "pin", "phone"].filter((k) => !String(e[k] || "").trim()) },
  });
});

module.exports = router;
