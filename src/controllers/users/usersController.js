const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");


// ✅ LIST USERS
exports.listUsers = async (req, res) => {
  try {
    const { role } = req.query;

    let whereClause = "";
    let replacements = {};

    if (role) {
      whereClause = "WHERE u.role = :role";
      replacements.role = role;
    }

    const users = await sequelize.query(
        `SELECT 
    u.id,
    u.name,
    u.email,
    u.role,
    u.status AS "isActive",
    u.created_at AS "createdAt",
    u.updated_at AS "updatedAt",
    ARRAY_REMOVE(ARRAY_AGG(r.name), NULL) AS roles
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
${whereClause}
GROUP BY u.id, u.name, u.email, u.role, u.status, u.created_at, u.updated_at
ORDER BY u.id DESC;
`,
        {
            replacements,
            type: QueryTypes.SELECT,
        }
        );


    return res.success(users, "Users fetched successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch users");
  }
};


// ✅ GET SINGLE USER
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const [user] = await sequelize.query(
      `SELECT 
         u.id,
         u.name,
         u.email,
         u.role,
         u.status AS "isActive",
         u.created_at AS "createdAt",
         u.updated_at AS "updatedAt"
       FROM users u
       WHERE u.id = :id`,
      {
        replacements: { id },
        type: QueryTypes.SELECT,
      }
    );

    if (!user) {
      return res.error("User not found");
    }

    return res.success(user, "User fetched successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch user");
  }
};


// ✅ ADD USER
exports.addUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.error("Name, email and password are required");
    }

    await sequelize.query(
      `INSERT INTO users (name, email, password, role)
       VALUES (:name, :email, :password, :role)`,
      {
        replacements: { name, email, password, role },
        type: QueryTypes.INSERT,
      }
    );

    return res.success(null, "User created successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to create user");
  }
};


// ✅ UPDATE USER
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, status } = req.body;

    await sequelize.query(
      `UPDATE users
       SET name = :name,
           email = :email,
           role = :role,
           status = :status,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        replacements: { id, name, email, role, status },
        type: QueryTypes.UPDATE,
      }
    );

    return res.success(null, "User updated successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to update user");
  }
};


// ✅ DELETE USER
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    await sequelize.query(
      `DELETE FROM users WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE,
      }
    );

    return res.success(null, "User deleted successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to delete user");
  }
};
