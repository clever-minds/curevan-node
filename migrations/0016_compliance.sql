-- 0016 (P25): GST treatment per service, invoice tax columns, DPDP requests, guardians of minors.
ALTER TABLE service_types ADD COLUMN IF NOT EXISTS tax_category TEXT DEFAULT 'exempt_clinical';   -- exempt_clinical | taxable_18
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_types_tax_category_check') THEN
    ALTER TABLE service_types ADD CONSTRAINT service_types_tax_category_check CHECK (tax_category IN ('exempt_clinical', 'taxable_18'));
  END IF;
END $$;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_category TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gst_amount   NUMERIC DEFAULT 0;

CREATE TABLE IF NOT EXISTS privacy_requests (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('export', 'correction', 'erasure', 'withdraw_consent')),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'rejected')),
  note       TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  closed_at  TIMESTAMPTZ,
  handled_by INT
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_user ON privacy_requests (user_id);

-- appointments already keep a date_of_birth per booking; the account gets one only if it has none yet
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;

CREATE TABLE IF NOT EXISTS patient_guardians (
  id              SERIAL PRIMARY KEY,
  patient_user_id INT NOT NULL,
  guardian_name   TEXT NOT NULL,
  relation        TEXT,
  phone           TEXT,
  consent_log_id  INT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_guardians_patient ON patient_guardians (patient_user_id);
