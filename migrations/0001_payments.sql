-- P06: server-verified payments for shop orders, coupon usage tracking, stock reservations.
-- Safe to re-run: every statement is idempotent.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS razorpay_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coupon_only_discount NUMERIC DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS orders_razorpay_order_id_uidx
  ON orders (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS razorpay_order_id   TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_signature  TEXT;

CREATE TABLE IF NOT EXISTS coupon_usages (
  id         SERIAL PRIMARY KEY,
  coupon_id  INT NOT NULL,
  user_id    INT NOT NULL,
  order_id   INT,
  discount   NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- a paid order can use a coupon only once (makes payment confirmation idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS coupon_usages_order_uidx
  ON coupon_usages (order_id)
  WHERE order_id IS NOT NULL;

-- Stock reserved for an order that is waiting for payment, so it can be released exactly.
CREATE TABLE IF NOT EXISTS order_stock_reservations (
  id           SERIAL PRIMARY KEY,
  order_id     INT NOT NULL,
  inventory_id INT NOT NULL,
  qty          INT NOT NULL,
  released_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_stock_reservations_order_idx
  ON order_stock_reservations (order_id);
