-- 0022: clean links. Every therapy category and product gets a unique slug (lowercase, hyphens, no symbols), so links need no %20 / %26.
-- Journal entries already have a slug. Existing rows are filled from their name; a duplicate gets "-<id>" added.
ALTER TABLE service_types ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS slug TEXT;

-- the SEO sheet names this one explicitly
UPDATE service_types SET slug = 'occupational-therapy' WHERE slug IS NULL AND name = 'Occupational Health & Wellness';

WITH base AS (
  SELECT id, COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''), 'category') AS s
  FROM service_types WHERE slug IS NULL
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY id) AS rn FROM base
)
UPDATE service_types t
SET slug = CASE WHEN r.rn = 1 AND NOT EXISTS (SELECT 1 FROM service_types x WHERE x.slug = r.s) THEN r.s ELSE r.s || '-' || t.id END
FROM ranked r WHERE t.id = r.id;

WITH base AS (
  SELECT id, COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), ''), 'product') AS s
  FROM products WHERE slug IS NULL
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY id) AS rn FROM base
)
UPDATE products p
SET slug = CASE WHEN r.rn = 1 AND NOT EXISTS (SELECT 1 FROM products x WHERE x.slug = r.s) THEN r.s ELSE r.s || '-' || p.id END
FROM ranked r WHERE p.id = r.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_types_slug ON service_types (slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_slug ON products (slug);
