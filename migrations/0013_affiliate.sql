-- 0013 (P20): therapist affiliate (DR code) commissions.
-- coupons.therapist_id is the therapist PROFILE id (what the admin coupon form saves); affiliate_commissions.therapist_id is the therapist USER id (what payouts use).
CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id                SERIAL PRIMARY KEY,
  order_id          INT NOT NULL,
  order_item_id     INT NOT NULL,
  therapist_id      INT NOT NULL,
  coupon_id         INT,
  sale_amount       NUMERIC NOT NULL,          -- item taxable value after discount (no GST, no shipping)
  commission_pct    NUMERIC NOT NULL,
  commission_amount NUMERIC NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',     -- pending | eligible | paid | cancelled | cancelled_returned
  eligible_at       TIMESTAMPTZ,
  payout_batch_id   INT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_commission_item ON affiliate_commissions (order_item_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_commission_therapist ON affiliate_commissions (therapist_id, status);
CREATE INDEX IF NOT EXISTS idx_affiliate_commission_order ON affiliate_commissions (order_id);

-- the taxable value of each order line is kept when the order is made, so the commission never has to be re-derived
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS taxable_value NUMERIC;

