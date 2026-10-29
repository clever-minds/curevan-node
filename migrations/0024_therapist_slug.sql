-- 0024: a therapist's page link is name + city ("dr-meera-sharma-vadodara"), unique, made once when the profile is created and kept after that.
ALTER TABLE therapist_profiles ADD COLUMN IF NOT EXISTS slug TEXT;

WITH base AS (
  SELECT tp.id,
         COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(trim(COALESCE(u.name, '') || ' ' || COALESCE(u.city, ''))), '[^a-z0-9]+', '-', 'g')), ''), 'therapist') AS s
  FROM therapist_profiles tp LEFT JOIN users u ON u.id = tp.user_id
  WHERE tp.slug IS NULL
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY id) AS rn FROM base
)
UPDATE therapist_profiles tp
SET slug = CASE WHEN r.rn = 1 AND NOT EXISTS (SELECT 1 FROM therapist_profiles x WHERE x.slug = r.s) THEN r.s ELSE r.s || '-' || tp.id END
FROM ranked r WHERE tp.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_therapist_profiles_slug ON therapist_profiles (slug);

-- profiles created later get their slug here, whichever code path inserts them
CREATE OR REPLACE FUNCTION therapist_profile_slug() RETURNS trigger AS $fn$
DECLARE base TEXT; cand TEXT; n INT := 1;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(trim(COALESCE(u.name, '') || ' ' || COALESCE(u.city, ''))), '[^a-z0-9]+', '-', 'g')), ''), 'therapist')
    INTO base FROM users u WHERE u.id = NEW.user_id;
  base := COALESCE(base, 'therapist');
  cand := base;
  WHILE EXISTS (SELECT 1 FROM therapist_profiles WHERE slug = cand AND id IS DISTINCT FROM NEW.id) LOOP
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  NEW.slug := cand;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_therapist_profile_slug ON therapist_profiles;
CREATE TRIGGER trg_therapist_profile_slug BEFORE INSERT OR UPDATE OF slug ON therapist_profiles
  FOR EACH ROW EXECUTE FUNCTION therapist_profile_slug();
