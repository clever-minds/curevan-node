// Clean link text: lowercase, hyphens, no symbols. "Post-Surgery Rehab" -> "post-surgery-rehab".
const { QueryTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const TABLES = new Set(["service_types", "products"]);

const slugify = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A slug no other row of `table` uses: the wanted one, else it with -2, -3 ... added. `excludeId` is the row being edited. */
async function uniqueSlug(table, wanted, { excludeId = null, fallback = "item", transaction } = {}) {
  if (!TABLES.has(table)) throw new Error(`uniqueSlug: unknown table ${table}`);
  const base = slugify(wanted) || fallback;
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const rows = await sequelize.query(
      `SELECT 1 FROM ${table} WHERE slug = :candidate AND (:excludeId::int IS NULL OR id <> :excludeId::int) LIMIT 1`,
      { replacements: { candidate, excludeId }, type: QueryTypes.SELECT, transaction }
    );
    if (!rows.length) return candidate;
  }
}

/** The slug to store: the one the admin typed (must be free, else an error), or one made from the name. */
async function chooseSlug(table, explicit, name, { excludeId = null, fallback, transaction } = {}) {
  if (!explicit) return uniqueSlug(table, name, { excludeId, fallback, transaction });
  const wanted = slugify(explicit);
  if (!wanted) throw new SlugError("Link name must contain letters or numbers");
  if ((await uniqueSlug(table, wanted, { excludeId, transaction })) !== wanted) throw new SlugError("This link name is already used by another item");
  return wanted;
}

class SlugError extends Error {}

module.exports = { slugify, uniqueSlug, chooseSlug, SlugError };
