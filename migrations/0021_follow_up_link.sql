-- 0021: a patient-requested follow-up visit points to the visit it follows, so the new PCR can show that visit's report.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS follow_up_of INT REFERENCES appointments(id);
CREATE INDEX IF NOT EXISTS idx_appointments_follow_up_of ON appointments (follow_up_of) WHERE follow_up_of IS NOT NULL;
