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
  warehouseState: 'Gujarat',                                    // GST: CGST+SGST inside this state, IGST outside
  session: Object.freeze({ slotMinutes: 60, timerMinutes: 60, minLeadHours: 4, maxAdvanceDays: 30 }),   // D10
  otp: Object.freeze({ length: 4, validFromHoursBefore: 2, maxAttempts: 5 }),                            // D8
  cancellation: Object.freeze({                                 // D2
    freeHoursBefore: 12,
    partialHoursBefore: 2,
    partialChargePct: 50,
    lateChargePct: 100,
    graceMinutesAfterBooking: 10,
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
  quality: Object.freeze({ windowRatings: 20, minRatings: 10, coachingBelow: 4.5, reviewBelow: 4.0 }),  // D9
  maskedCall: Object.freeze({ windowHoursBefore: 2, windowHoursAfter: 1 }),                              // D12
  support: Object.freeze({ openHour: 8, closeHour: 21, callbackBy: '09:30' }),
  ai: Object.freeze({ modelId: process.env.AI_MODEL_ID || '' }),                                         // set at go-live
});
