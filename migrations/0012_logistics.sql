-- 0012 (P19): courier events, delivery time, return inspection fields, non-returnable categories.
CREATE TABLE IF NOT EXISTS shipment_events (
  id          SERIAL PRIMARY KEY,
  shipment_id INT,
  awb         TEXT,
  status_id   INT,
  status      TEXT,
  payload     JSONB,
  event_time  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON shipment_events (shipment_id, event_time);
-- the same courier event delivered twice is stored once
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_events_dedupe ON shipment_events (awb, status, event_time) WHERE event_time IS NOT NULL AND awb IS NOT NULL;

ALTER TABLE orders    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS status_id    INT;

ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS photos             JSONB;
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS reason_code        TEXT;     -- damaged | defective | wrong_item | missing_part
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS inspected_at       TIMESTAMPTZ;
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS inspection_result  TEXT;     -- pass | fail
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS rejection_reason   TEXT;
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS reverse_awb        TEXT;
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS reverse_shipment_id INT;
ALTER TABLE order_returns ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ;
ALTER TABLE order_return_items ADD COLUMN IF NOT EXISTS quantity INT;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS non_returnable BOOLEAN DEFAULT false;
