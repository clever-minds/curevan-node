const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const { chooseSlug, SlugError } = require("../../utils/slug");

// ✅ LIST SERVICE TYPES
exports.listServiceTypes = async (req, res) => {
  try {
    const serviceTypes = await sequelize.query(
      `SELECT * FROM service_types ORDER BY id ASC`,
      {
        type: QueryTypes.SELECT,
      }
    );

    return res.success(serviceTypes, "Service types fetched successfully");
  } catch (error) {
    console.error("List Service Types Error:", error);
    return res.error("Failed to fetch service types");
  }
};

// ✅ ADD SERVICE TYPE
exports.addServiceType = async (req, res) => {
  try {
    const { name, is_active, fa_icon, description, tax_category, slug } = req.body;

    if (!name) {
      return res.error("Name is required");
    }
    if (tax_category !== undefined && !["exempt_clinical", "taxable_18"].includes(tax_category)) {
      return res.error("tax_category must be exempt_clinical or taxable_18");
    }

    const finalSlug = await chooseSlug("service_types", slug, name, { fallback: "category" });
    const isActive = is_active !== undefined ? is_active : true;

    await sequelize.query(
      `INSERT INTO service_types (name, slug, is_active, fa_icon, description, tax_category)
       VALUES (:name, :slug, :is_active, :fa_icon, :description, :tax_category)`,
      {
        replacements: { 
          name, 
          slug: finalSlug,
          is_active: isActive, 
          fa_icon: fa_icon || null,
          description: description || null,
          tax_category: tax_category || "exempt_clinical"
        },
        type: QueryTypes.INSERT,
      }
    );

    return res.success(null, "Service type added successfully");
  } catch (error) {
    console.error("Add Service Type Error:", error);
    if (error instanceof SlugError) return res.error(error.message);
    if (error.name === 'SequelizeUniqueConstraintError' || (error.parent && error.parent.code === '23505')) {
       return res.error("Service type with this name already exists");
    }
    return res.error("Failed to add service type");
  }
};

// ✅ UPDATE SERVICE TYPE
exports.updateServiceType = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_active, fa_icon, description, tax_category, slug } = req.body;

    if (!name) {
      return res.error("Name is required");
    }
    if (tax_category !== undefined && !["exempt_clinical", "taxable_18"].includes(tax_category)) {
      return res.error("tax_category must be exempt_clinical or taxable_18");
    }

    // a link that is already out in the world changes only when the admin edits the slug itself
    const finalSlug = slug ? await chooseSlug("service_types", slug, name, { excludeId: Number(id) }) : null;
    let updateQuery = `
       UPDATE service_types
       SET name = :name,
           slug = COALESCE(:slug, slug),
           is_active = :is_active,
           fa_icon = :fa_icon,
           description = :description,
           tax_category = COALESCE(:tax_category, tax_category),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id
    `;

    await sequelize.query(updateQuery, {
      replacements: { 
        id, 
        name, 
        slug: finalSlug,
        is_active, 
        fa_icon: fa_icon || null,
        description: description || null,
        tax_category: tax_category || null
      },
      type: QueryTypes.UPDATE,
    });

    return res.success(null, "Service type updated successfully");
  } catch (error) {
    console.error("Update Service Type Error:", error);
    if (error instanceof SlugError) return res.error(error.message);
    return res.error("Failed to update service type");
  }
};

// ✅ DELETE SERVICE TYPE
exports.deleteServiceType = async (req, res) => {
  try {
    const { id } = req.params;

    await sequelize.query(
      `DELETE FROM service_types WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE,
      }
    );

    return res.success(null, "Service type deleted successfully");
  } catch (error) {
    console.error("Delete Service Type Error:", error);
    return res.error("Failed to delete service type");
  }
};
