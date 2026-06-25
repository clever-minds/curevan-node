const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

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
    const { name, is_active, fa_icon, description } = req.body;

    if (!name) {
      return res.error("Name is required");
    }

    const isActive = is_active !== undefined ? is_active : true;

    await sequelize.query(
      `INSERT INTO service_types (name, is_active, fa_icon, description)
       VALUES (:name, :is_active, :fa_icon, :description)`,
      {
        replacements: { 
          name, 
          is_active: isActive, 
          fa_icon: fa_icon || null,
          description: description || null
        },
        type: QueryTypes.INSERT,
      }
    );

    return res.success(null, "Service type added successfully");
  } catch (error) {
    console.error("Add Service Type Error:", error);
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
    const { name, is_active, fa_icon, description } = req.body;

    if (!name) {
      return res.error("Name is required");
    }

    let updateQuery = `
       UPDATE service_types
       SET name = :name,
           is_active = :is_active,
           fa_icon = :fa_icon,
           description = :description,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id
    `;

    await sequelize.query(updateQuery, {
      replacements: { 
        id, 
        name, 
        is_active, 
        fa_icon: fa_icon || null,
        description: description || null
      },
      type: QueryTypes.UPDATE,
    });

    return res.success(null, "Service type updated successfully");
  } catch (error) {
    console.error("Update Service Type Error:", error);
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
