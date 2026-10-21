-- 0011 (P18): weekly payout batches, the columns the backend payout engine needs, premium approval.
CREATE TABLE IF NOT EXISTS payout_batches (
  id           SERIAL PRIMARY KEY,
  therapist_id INT NOT NULL,
  week_start   DATE NOT NULL,
  week_end     DATE NOT NULL,
  gross        NUMERIC DEFAULT 0,
  platform_fee NUMERIC DEFAULT 0,
  gst_on_fee   NUMERIC DEFAULT 0,
  tds          NUMERIC DEFAULT 0,
  adjustments  NUMERIC DEFAULT 0,
  net          NUMERIC DEFAULT 0,
  status       TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'approved', 'on_hold', 'paid')),
  approved_by  INT,
  approved_at  TIMESTAMPTZ,
  utr          TEXT,
  paid_at      TIMESTAMPTZ,
  hold_reason  TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (therapist_id, week_start)
);

-- payout_items exist in production; these make sure every column the engine writes is there (also on a fresh database)
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS type                     TEXT DEFAULT 'service';   -- service | cancellation | affiliate (P20)
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS patient_id               INT;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS service_type_id          TEXT;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS platform_fee_pct         NUMERIC;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS gst_on_platform_fee      NUMERIC DEFAULT 0;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS pre_tds_payable          NUMERIC;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS tds_deducted             NUMERIC DEFAULT 0;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS pg_charge                NUMERIC DEFAULT 0;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS currency                 TEXT DEFAULT 'INR';
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS membership_plan_snapshot TEXT;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS created_at               TIMESTAMPTZ DEFAULT now();
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS batch_id                 INT;
ALTER TABLE payout_items ADD COLUMN IF NOT EXISTS cancellation_share       NUMERIC DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_payout_items_batch ON payout_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_payout_items_therapist_week ON payout_items (therapist_id, week_start);
-- one service payout per booking, one cancellation payout per booking
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payout_items GROUP BY type, source_id HAVING COUNT(*) > 1) THEN
    RAISE NOTICE 'P18: duplicate payout lines exist - unique index NOT created. Resolve them, then create uq_payout_items_source_type by hand.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_items_source_type ON payout_items (type, source_id);
  END IF;
END $$;

-- membership: only standard / premium exist; premium needs an admin's approval
ALTER TABLE therapist_profiles ADD COLUMN IF NOT EXISTS premium_requested_at TIMESTAMPTZ;
ALTER TABLE therapist_profiles ADD COLUMN IF NOT EXISTS premium_approved_by  INT;
UPDATE therapist_profiles SET membership_plan = 'standard' WHERE membership_plan IS NULL OR membership_plan NOT IN ('standard', 'premium');
