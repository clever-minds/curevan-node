-- 0020 (P28 follow-up): a purchase is remembered on the server before the customer pays, so what is activated is what was priced;
-- the example plans seeded by 0019 are switched off until the owner sets the real prices (owner decision D14).
ALTER TABLE care_packs ALTER COLUMN expires_at DROP NOT NULL;               -- a pack that is not paid yet has no expiry
ALTER TABLE care_packs DROP CONSTRAINT IF EXISTS care_packs_status_check;
ALTER TABLE care_packs ADD CONSTRAINT care_packs_status_check CHECK (status IN ('pending_payment', 'active', 'exhausted', 'expired', 'refunded', 'cancelled'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_care_packs_order ON care_packs (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_care_packs_payment ON care_packs (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

UPDATE care_pack_plans SET active = false
 WHERE (name, sessions, price) IN (('5-Session Physio Care Pack', 5, 4500.00), ('10-Session Physio Care Pack', 10, 8500.00), ('5-Session Rehab Care Pack', 5, 4750.00), ('10-Session Rehab Care Pack', 10, 9000.00));
