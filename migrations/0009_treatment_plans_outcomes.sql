-- 0009 (P16): treatment plans, goals, standard outcome measures, results, progress reports, caregivers.
CREATE TABLE IF NOT EXISTS treatment_plans (
  id                     SERIAL PRIMARY KEY,
  patient_id             INT NOT NULL,
  primary_therapist_id   INT,
  service_type_id        INT,
  condition              TEXT,
  affected_side          TEXT CHECK (affected_side IN ('left', 'right', 'bilateral', 'na')),
  body_region            TEXT,
  onset_date             DATE,
  plan_start             DATE,
  planned_sessions       INT,
  frequency_per_week     SMALLINT,
  preferred_days         TEXT[],
  preferred_time         TIME,
  review_every_sessions  SMALLINT DEFAULT 5,
  expected_end           DATE,
  status                 TEXT DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'discharged', 'cancelled')),
  discharge_reason       TEXT,
  created_by             INT,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient ON treatment_plans (patient_id, status);

CREATE TABLE IF NOT EXISTS outcome_measures (
  id               SERIAL PRIMARY KEY,
  code             TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  specialty        TEXT,
  domain           TEXT,
  scale_type       TEXT CHECK (scale_type IN ('numeric', 'ordinal', 'percent', 'time_seconds', 'speed_mps', 'degrees')),
  min_value        NUMERIC,
  max_value        NUMERIC,
  unit             TEXT,
  higher_is_better BOOLEAN DEFAULT true,
  per_side         BOOLEAN DEFAULT false,
  sub_items        JSONB,
  frequency        TEXT CHECK (frequency IN ('every_session', 'review', 'baseline_discharge')),
  instructions     TEXT,
  licence_note     TEXT,
  active           BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS treatment_goals (
  id             SERIAL PRIMARY KEY,
  plan_id        INT NOT NULL,
  description    TEXT NOT NULL,
  measure_id     INT,
  baseline_value NUMERIC,
  target_value   NUMERIC,
  target_date    DATE,
  status         TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'achieved', 'partially_achieved', 'not_achieved', 'revised')),
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treatment_goals_plan ON treatment_goals (plan_id);

CREATE TABLE IF NOT EXISTS plan_measures (
  id         SERIAL PRIMARY KEY,
  plan_id    INT NOT NULL,
  measure_id INT NOT NULL,
  side       TEXT,
  item       TEXT
);
CREATE INDEX IF NOT EXISTS idx_plan_measures_plan ON plan_measures (plan_id);

CREATE TABLE IF NOT EXISTS outcome_results (
  id               SERIAL PRIMARY KEY,
  plan_id          INT NOT NULL,
  measure_id       INT NOT NULL,
  appointment_id   INT,
  pcr_id           INT,
  side             TEXT,
  item             TEXT,
  value            NUMERIC,
  assessment_point TEXT CHECK (assessment_point IN ('baseline', 'session', 'review', 'discharge')),
  recorded_by      INT,
  recorded_at      TIMESTAMPTZ DEFAULT now(),
  note             TEXT                       -- "could not assess" reason, or a remark
);
CREATE INDEX IF NOT EXISTS idx_outcome_results_series ON outcome_results (plan_id, measure_id, recorded_at);

CREATE TABLE IF NOT EXISTS progress_reports (
  id                     SERIAL PRIMARY KEY,
  plan_id                INT NOT NULL,
  report_type            TEXT CHECK (report_type IN ('review', 'discharge')),
  session_number         INT,
  summary                TEXT,
  therapist_id           INT,
  pdf_path               TEXT,
  shared_with_patient_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- family access: read-only link for one caregiver, activated by their first OTP (mobile) login, revocable
CREATE TABLE IF NOT EXISTS patient_caregivers (
  id                SERIAL PRIMARY KEY,
  patient_user_id   INT NOT NULL,
  caregiver_user_id INT NOT NULL,
  relation          TEXT,
  can_view_progress BOOLEAN DEFAULT true,
  consent_log_id    INT,
  activated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  revoked_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_patient_caregivers_patient ON patient_caregivers (patient_user_id);
CREATE INDEX IF NOT EXISTS idx_patient_caregivers_caregiver ON patient_caregivers (caregiver_user_id);

ALTER TABLE pcr          ADD COLUMN IF NOT EXISTS session_type      TEXT DEFAULT 'follow_up';   -- initial_assessment | follow_up | review | discharge
ALTER TABLE pcr          ADD COLUMN IF NOT EXISTS treatment_plan_id INT;
ALTER TABLE pcr          ADD COLUMN IF NOT EXISTS session_number    INT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS treatment_plan_id INT;
