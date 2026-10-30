-- 0023: care-pack refunds go through the refund service (their own refund row, so the Razorpay webhook and the reconciliation can see them),
-- a pack can wait for its refund ('refund_pending'), and a product can be marked non-returnable.
ALTER TABLE order_refunds ADD COLUMN IF NOT EXISTS care_pack_id INT REFERENCES care_packs(id);
CREATE INDEX IF NOT EXISTS order_refunds_care_pack_idx ON order_refunds (care_pack_id) WHERE care_pack_id IS NOT NULL;

ALTER TABLE care_packs DROP CONSTRAINT IF EXISTS care_packs_status_check;
ALTER TABLE care_packs ADD CONSTRAINT care_packs_status_check CHECK (status IN ('pending_payment', 'active', 'exhausted', 'expired', 'refund_pending', 'refunded', 'cancelled'));

ALTER TABLE products ADD COLUMN IF NOT EXISTS non_returnable BOOLEAN NOT NULL DEFAULT false;
