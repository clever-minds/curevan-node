-- 0019 (P28): Care packs (5-session and 10-session upfront bundles)

CREATE TABLE IF NOT EXISTS care_pack_plans (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  service_type_id INT,
  sessions        INT NOT NULL CHECK (sessions > 0),
  price           NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  validity_days   INT NOT NULL DEFAULT 90 CHECK (validity_days > 0),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS care_packs (
  id                  SERIAL PRIMARY KEY,
  plan_id             INT NOT NULL REFERENCES care_pack_plans(id),
  patient_id          INT NOT NULL REFERENCES users(id),
  therapist_id        INT REFERENCES users(id),
  sessions_total      INT NOT NULL CHECK (sessions_total > 0),
  sessions_used       INT NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
  price_paid          NUMERIC(10,2) NOT NULL CHECK (price_paid >= 0),
  purchased_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exhausted', 'expired', 'refunded', 'cancelled')),
  razorpay_order_id   TEXT,
  razorpay_payment_id TEXT,
  refunded_amount     NUMERIC(10,2) DEFAULT 0,
  refund_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_care_packs_patient ON care_packs (patient_id, status);
CREATE INDEX IF NOT EXISTS idx_care_packs_therapist ON care_packs (therapist_id);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS care_pack_id INT REFERENCES care_packs(id);
CREATE INDEX IF NOT EXISTS idx_appointments_care_pack ON appointments (care_pack_id) WHERE care_pack_id IS NOT NULL;

-- Seed default 5-session and 10-session plans
INSERT INTO care_pack_plans (name, service_type_id, sessions, price, validity_days, active)
VALUES 
  ('5-Session Physio Care Pack', 1, 5, 4500.00, 90, true),
  ('10-Session Physio Care Pack', 1, 10, 8500.00, 90, true),
  ('5-Session Rehab Care Pack', NULL, 5, 4750.00, 90, true),
  ('10-Session Rehab Care Pack', NULL, 10, 9000.00, 90, true)
ON CONFLICT DO NOTHING;
