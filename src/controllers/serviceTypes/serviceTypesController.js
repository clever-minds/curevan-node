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
    const { name, is_active } = req.body;
    const icon_path = req.file ? req.file.filename : null;

    if (!name) {
      return res.error("Name is required");
    }

    const isActive = is_active !== undefined ? is_active : true;

    await sequelize.query(
      `INSERT INTO service_types (name, is_active, icon_path)
       VALUES (:name, :is_active, :icon_path)`,
      {
        replacements: { name, is_active: isActive, icon_path },
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
    const { name, is_active } = req.body;
    const icon_path = req.file ? req.file.filename : null;

    if (!name) {
      return res.error("Name is required");
    }

    let updateQuery = `
       UPDATE service_types
       SET name = :name,
           is_active = :is_active,
           updated_at = CURRENT_TIMESTAMP
    `;
    
    if (icon_path) {
      updateQuery += `, icon_path = :icon_path`;
    }
    
    updateQuery += ` WHERE id = :id`;

    await sequelize.query(updateQuery, {
      replacements: { id, name, is_active, icon_path },
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
