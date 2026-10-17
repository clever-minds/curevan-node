// Central business rules for Curevan (Himaya Care Pvt. Ltd.).
// Every value is an owner decision (see Owner Decisions D1-D18). Change values here,
// not in controllers. Modules start reading from this file in later tasks (P12+).
module.exports = Object.freeze({
  legalEntity: Object.freeze({                                  // D1 - owner to fill the empty fields
    name: 'Himaya Care Pvt. Ltd.',
    tradeName: 'Curevan',
    gstin: '',
    cin: '',
    pan: '',
    addressLine1: '',
    city: 'Vadodara',
    state: 'Gujarat',
    pin: '',
    phone: '',
    email: 'accounts@curevan.com',
  }),
  booking: Object.freeze({ directBookingNeedsApproval: process.env.DIRECT_BOOKING_NEEDS_APPROVAL === 'true' }),   // false (default, as in handoff pack P07) = patient pays immediately; true = optional approval-first flow
  consent: Object.freeze({ policyVersion: '2026-10', adultAge: 18 }),                          // P25: version stored with every consent; below adultAge a guardian must consent
  warehouseState: 'Gujarat',                                    // GST: CGST+SGST inside this state, IGST outside
  session: Object.freeze({ slotMinutes: 60, timerMinutes: 60, minLeadHours: 4, maxAdvanceDays: 30 }),   // D10
  visit: Object.freeze({ travelFromMinutesBefore: 45 }),                                                // P12
  otp: Object.freeze({ length: 4, validFromHoursBefore: 2, maxAttempts: 5 }),                            // D8
  cancellation: Object.freeze({                                 // D2
    freeHoursBefore: 12,
    partialHoursBefore: 2,
    partialChargePct: 50,
    lateChargePct: 100,
    graceMinutesAfterBooking: 10,
    therapistLateMinutes: 30,                                   // therapist not 'arrived' this long after the slot start -> patient cancels free
  }),
  payout: Object.freeze({                                       // D4 D5 D7
    standardFeePct: 0,
    premiumFeePct: 10,
    gstOnFeePct: 18,
    tdsPct: 0.1,
    tdsAnnualThresholdInr: 500000,
    pgChargePct: 0,
    payoutWeekday: 'FRIDAY',
  }),
  shop: Object.freeze({ freeShippingThresholdInr: 499, flatShippingFeeInr: 50, returnWindowDays: 7 }),   // D3 D11
  affiliate: Object.freeze({ patientDiscountPct: 10, therapistCommissionPct: 5, eligibleAfterDeliveryDays: 7 }), // D13
  followUp: Object.freeze({ holdHours: 24, mustConfirmHoursBefore: 12, nudgeAfterHours: 12, overdueGraceDays: 2, maxSeriesSessions: 12 }),     // D16 (P17)
  reminders: Object.freeze({ patientHoursBefore: [24, 2], therapistAgendaHour: 7, therapistMinutesBefore: 60, hepReminderHour: 18 }),            // D16 (P17)
  quality: Object.freeze({ windowRatings: 20, minRatings: 10, coachingBelow: 4.5, reviewBelow: 4.0 }),  // D9
  outcomeSummary: Object.freeze({ minPlansPerGroup: 5 }),                                              // groups with fewer plans are hidden (P22)
  emergency: Object.freeze({ radiusKm: 8, autoCancelHoursBefore: 2, lookAheadDays: 1 }),                // therapist leave: replacement radius, auto-cancel window, days looked ahead (P22)
  maskedCall: Object.freeze({ windowHoursBefore: 2, windowHoursAfter: 1 }),                              // D12
  carePacks: Object.freeze({ defaultValidityDays: 90, cancellationRefundProcessingFeePct: 10 }),         // D14 (P28): 90-day validity, up to 10% processing fee
  features: Object.freeze({ carePacks: true }),                                                           // enabled by P28
  support: Object.freeze({ openHour: 8, closeHour: 21, callbackBy: '09:30' }),
  ai: Object.freeze({ modelId: process.env.AI_MODEL_ID || '' }),                                         // set at go-live
});
