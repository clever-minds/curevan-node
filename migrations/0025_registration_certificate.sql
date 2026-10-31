-- 0025: a therapist's registration certificate. The file lives in the private storage folder (never under /uploads);
-- only the therapist and the therapy / super admins can open it.
ALTER TABLE therapist_profiles
  ADD COLUMN IF NOT EXISTS registration_certificate_path TEXT,
  ADD COLUMN IF NOT EXISTS registration_certificate_name TEXT,
  ADD COLUMN IF NOT EXISTS registration_certificate_uploaded_at TIMESTAMPTZ;
