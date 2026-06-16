const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const transporter = require("../../config/mailer");
const { v4: uuidv4 } = require('uuid');


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


exports.listTeamManagementUsers = async (req, res) => {
  try {
    const { role } = req.query;

    let whereClause = "WHERE u.role = 'admin'";
    let replacements = {};

    if (role) {
      whereClause += " AND u.role = :role";
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
      ORDER BY u.id DESC`,
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
      u.updated_at AS "updatedAt",
      ARRAY_REMOVE(ARRAY_AGG(r.name), NULL) AS roles
   FROM users u
   LEFT JOIN user_roles ur ON ur.user_id = u.id
   LEFT JOIN roles r ON r.id = ur.role_id
   WHERE u.id = :id
   GROUP BY u.id, u.name, u.email, u.role, u.status, u.created_at, u.updated_at`,
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


// ✅ INVITE ADMIN USER
exports.inviteAdminUser = async (req, res) => {
  try {
    const { email, roles, state_admin_name } = req.body;
    const actorId = req.user?.id;

    if (!email || !roles?.length || !state_admin_name) {
      return res.error("Email, roles and state name are required");
    }

    if (!actorId) return res.error("Invalid actor");

    // Check if email already exists
    const [existingUser] = await sequelize.query(
      `SELECT id FROM users WHERE email = :email`,
      {
        replacements: { email },
        type: QueryTypes.SELECT,
      }
    );

    if (existingUser) return res.error("A user with this email already exists");

    // Check if state already has an admin
    const [existingStateAdmin] = await sequelize.query(
      `SELECT id FROM users 
       WHERE state_admin_name = :state_admin_name 
         AND id IN (
           SELECT user_id FROM user_roles 
           WHERE role_id IN (SELECT id FROM roles WHERE name IN ('admin.ecom','admin.therapy'))
         )`,
      {
        replacements: { state_admin_name },
        type: QueryTypes.SELECT
      }
    );

    if (existingStateAdmin) {
      return res.error(`An admin for state "${state_admin_name}" already exists`);
    }

    // Generate UID & reset token
    const uid = `admin-${Date.now()}`;
    const resetToken = uuidv4();

    const [result] = await sequelize.query(
      `INSERT INTO users
       (uid, email, state_admin_name, reset_token, reset_token_expiry, created_at)
       VALUES (:uid, :email, :state_admin_name, :token, NOW() + interval '1 hour', NOW())
       RETURNING id`,
      {
        replacements: { uid, email, state_admin_name, token: resetToken },
        type: QueryTypes.INSERT,
      }
    );

    const userId = result[0].id;

    // Assign roles
    for (const roleName of roles) {
      const [role] = await sequelize.query(
        `SELECT id FROM roles WHERE name = :role`,
        { replacements: { role: roleName }, type: QueryTypes.SELECT }
      );

      if (role) {
        await sequelize.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES (:userId, :roleId)`,
          { replacements: { userId, roleId: role.id }, type: QueryTypes.INSERT }
        );
      }
    }

    const inviteLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"Admin Panel" <${process.env.MAIL_USER}>`,
      to: email,
      subject: "Admin Invitation",
      html: `
        <h2>You have been invited as Admin</h2>
        <p>Email: <b>${email}</b></p>
        <p>State: <b>${state_admin_name}</b></p>
        <a href="${inviteLink}">Setup Password</a>
      `
    });

    return res.success(null, "Admin invited successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to invite admin user");
  }
};

// usersController.js
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.error("Email is required");
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.error("User not found");
    }

    // Generate reset token (implement in User model)
    const resetToken = user.generatePasswordResetToken();
    await user.save();

    // Send reset email
    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    await sendEmail(user.email, "Password Reset Request", `Click here to reset: ${resetLink}`);

    return res.success(null, "Password reset link sent to your email");
  } catch (err) {
    return res.error("Failed to send password reset link");
  }
};



exports.updateUserRoles = async (req, res) => {
  try {
    const { id, roles } = req.body;

    if (!id) {
      return res.json({
        success: false,
        message: "User id is required"
      });
    }

    const [user] = await sequelize.query(
      `SELECT id FROM users WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.SELECT
      }
    );

    if (!user) {
      return res.json({
        success: false,
        message: "User not found"
      });
    }

    const userId = user.id;

    // remove old roles
    await sequelize.query(
      `DELETE FROM user_roles WHERE user_id = :userId`,
      {
        replacements: { userId },
        type: QueryTypes.DELETE
      }
    );

    let finalRoles = roles;

    if (!roles || roles.length === 0) {
      finalRoles = ["patient"];
    }

    // insert roles
    for (const roleName of finalRoles) {

      const [role] = await sequelize.query(
        `SELECT id FROM roles WHERE name = :name`,
        {
          replacements: { name: roleName },
          type: QueryTypes.SELECT
        }
      );

      if (role) {
        await sequelize.query(
          `INSERT INTO user_roles (user_id, role_id)
           VALUES (:userId, :roleId)`,
          {
            replacements: {
              userId,
              roleId: role.id
            },
            type: QueryTypes.INSERT
          }
        );
      }
    }

    return res.json({
      success: true,
      message: "Roles updated successfully"
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to update roles"
    });

  }
};

// exports.approveChangeRequest = async (req, res) => {
//   try {
//     const requestId = req.params.id;

//     // Fetch the change request
//     const [request] = await sequelize.query(
//       `SELECT * FROM change_requests WHERE id = :id`,
//       { replacements: { id: requestId }, type: sequelize.QueryTypes.SELECT }
//     );

//     if (!request) return res.error("Request not found");

//     const data = request;

//     // Parse changes safely
//     let changesObj;
//     if (typeof data.changes === "string") {
//       try {
//         changesObj = JSON.parse(data.changes);
//       } catch (err) {
//         console.error("Failed to parse changes JSON:", err);
//         return res.error("Invalid change request format");
//       }
//     } else if (typeof data.changes === "object" && data.changes !== null) {
//       changesObj = data.changes;
//     } else {
//       return res.error("Invalid change request format");
//     }

//     // Map fields to tables
//     const fieldToTableMap = {
//       // users
//       name: "users",
//       email: "users",
//       phone: "users",
//       role: "users",
//       date_of_birth: "users",
//       emergency_contact: "users",
//       address_line1: "users",
//       address_line2: "users",
//       city: "users",
//       state: "users",
//       pin: "users",
//       country: "users",
//       gender: "users",
//       email_notifications: "users",
//       push_notifications: "users",

//       // therapist_profiles
//       bio: "therapist_profiles",
//       image: "therapist_profiles",
//       service_radius_km: "therapist_profiles",
//       qualification: "therapist_profiles",
//       registration_no: "therapist_profiles",
//       experience_years: "therapist_profiles",
//       hourly_rate: "therapist_profiles",
//       membership_plan: "therapist_profiles",
//       pan_number: "therapist_profiles",
//       bank_account_number: "therapist_profiles",
//       bank_ifsc_code: "therapist_profiles",
//       profile_status: "therapist_profiles",
//       specialty: "therapist_profiles",
//       full_address: "therapist_profiles",
//       profile_image: "therapist_profiles",
//       kyc_id_proof: "therapist_profiles",
//       kyc_license: "therapist_profiles",
//       kyc_bank_proof: "therapist_profiles",

//       // therapist_availability
//       day_of_week: "therapist_availability",
//       is_enabled: "therapist_availability",
//       morning_start: "therapist_availability",
//       morning_end: "therapist_availability",
//       evening_start: "therapist_availability",
//       evening_end: "therapist_availability"
//     };

//     // Apply changes
//     for (const field in changesObj) {
//       const change = changesObj[field]; // { old, new }
//       const table = fieldToTableMap[field] || "users";

//       // Correct WHERE field for each table
//       const whereField =
//         table === "users"
//           ? "id"
//           : table === "therapist_profiles"
//           ? "user_id"
//           : table === "therapist_availability"
//           ? "therapist_id"
//           : "user_id";

//       await sequelize.query(
//         `UPDATE ${table} SET ${field} = :value WHERE ${whereField} = :userId`,
//         { replacements: { value: change.new, userId: data.user_id } }
//       );
//     }

//     // Mark request as approved
//     await sequelize.query(
//       `UPDATE change_requests
//        SET status='approved',
//            reviewer_id=:admin,
//            reviewed_at=NOW()
//        WHERE id=:id`,
//       { replacements: { id: requestId, admin: req.user.id } }
//     );

//     return res.success({}, "Change approved successfully");
//   } catch (error) {
//     console.error(error);
//     return res.error("Approval failed");
//   }
// };



// exports.approveThearipstChangeRequest = async (req, res) => {
//   const t = await sequelize.transaction();

//   try {
//     const requestId = req.params.id;

//     /* ---------- FETCH REQUEST ---------- */
//     const [request] = await sequelize.query(
//       `SELECT * FROM change_requests WHERE id = :id`,
//       {
//         replacements: { id: requestId },
//         type: sequelize.QueryTypes.SELECT,
//         transaction: t
//       }
//     );

//     if (!request) return res.error("Request not found");

//     /* ---------- PARSE CHANGES ---------- */
//     let changesObj =
//       typeof request.changes === "string"
//         ? JSON.parse(request.changes)
//         : request.changes;

//     if (!changesObj || typeof changesObj !== "object") {
//       return res.error("Invalid change request format");
//     }

//     /* ---------- GET PROFILE ID ---------- */
//     const [profile] = await sequelize.query(
//       `SELECT id FROM therapist_profiles WHERE user_id = :userId`,
//       {
//         replacements: { userId: request.user_id },
//         type: sequelize.QueryTypes.SELECT,
//         transaction: t
//       }
//     );

//     if (!profile) return res.error("Therapist profile not found");

//     const profileId = profile.id;

//     /* ---------- FIELD MAPPING ---------- */
//     const fieldMap = {
//       fullName: "name",
//       mobile: "phone",
//       line1: "address_line1",
//       line2: "address_line2",
//       fullAddress: "full_address",
//       lat: "latitude",
//       lng: "longitude",

//       panNumber: "pan_number",
//       registrationNo: "registration_no",
//       bankAccountNumber: "bank_account_number",
//       bankIfscCode: "bank_ifsc_code",
//       hourlyRate: "hourly_rate",
//       membershipPlan: "membership_plan",
//       serviceRadiusKm: "service_radius_km",
//       experienceYears: "experience_years"
//     };

//     /* ---------- TABLE MAPPING ---------- */
//     const fieldToTableMap = {
//       // users
//       name: "users",
//       email: "users",
//       phone: "users",
//       address_line1: "users",
//       address_line2: "users",
//       city: "users",
//       state: "users",
//       pin: "users",
//       latitude: "users",
//       longitude: "users",

//       // therapist_profiles
//       bio: "therapist_profiles",
//       qualification: "therapist_profiles",
//       registration_no: "therapist_profiles",
//       experience_years: "therapist_profiles",
//       hourly_rate: "therapist_profiles",
//       membership_plan: "therapist_profiles",
//       pan_number: "therapist_profiles",
//       bank_account_number: "therapist_profiles",
//       bank_ifsc_code: "therapist_profiles",
//       service_radius_km: "therapist_profiles",
//       specialty: "therapist_profiles",
//       full_address: "therapist_profiles"
//     };

//     /* ---------- APPLY FIELD UPDATES ---------- */
//     for (const field in changesObj) {
//       let value = changesObj[field]?.new;

//       // ❌ skip unwanted fields
//       if (["availability", "userId", "section"].includes(field)) continue;

//       const dbField = fieldMap[field] || field;
//       const table = fieldToTableMap[dbField];

//       // ❌ skip unknown fields
//       if (!table) continue;

//       const whereField = table === "users" ? "id" : "user_id";

//       // ✅ array fix
//       if (dbField === "specialty" && Array.isArray(value)) {
//         value = `{${value.join(",")}}`;
//       }

//       // ❌ skip object values
//       if (typeof value === "object" && value !== null) continue;

//       await sequelize.query(
//         `UPDATE ${table}
//          SET ${dbField} = :value
//          WHERE ${whereField} = :refId`,
//         {
//           replacements: {
//             value,
//             refId: request.user_id
//           },
//           transaction: t
//         }
//       );
//     }

//     /* ---------- AVAILABILITY UPDATE ---------- */
//     if (changesObj.availability?.new?.windows) {

//       const availability = changesObj.availability.new.windows;

//       // 🧹 delete old
//       await sequelize.query(
//         `DELETE FROM therapist_availability WHERE therapist_id = :id`,
//         {
//           replacements: { id: profileId },
//           transaction: t
//         }
//       );

//       // ➕ insert new
//       for (const day in availability) {
//         const slot = availability[day];

//         await sequelize.query(
//           `INSERT INTO therapist_availability
//           (therapist_id, day_of_week, is_enabled,
//            morning_start, morning_end,
//            evening_start, evening_end)
//           VALUES
//           (:therapist_id, :day, :enabled,
//            :m_start, :m_end,
//            :e_start, :e_end)`,
//           {
//             replacements: {
//               therapist_id: profileId,
//               day,
//               enabled: slot?.enabled ?? false,
//               m_start: slot?.morning?.start || null,
//               m_end: slot?.morning?.end || null,
//               e_start: slot?.evening?.start || null,
//               e_end: slot?.evening?.end || null
//             },
//             transaction: t
//           }
//         );
//       }
//     }

//     /* ---------- MARK APPROVED ---------- */
//     await sequelize.query(
//       `UPDATE change_requests
//        SET status='approved',
//            reviewer_id=:admin,
//            reviewed_at=NOW()
//        WHERE id=:id`,
//       {
//         replacements: {
//           id: requestId,
//           admin: req.user.id
//         },
//         transaction: t
//       }
//     );

//     await t.commit();

//     return res.success({}, "Change approved successfully");

//   } catch (error) {
//     await t.rollback();

//     console.error("❌ APPROVE ERROR:", error);

//     return res.error("Approval failed");
//   }
// };


exports.approveChangeRequest = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const requestId = req.params.id;

    /* ---------- FETCH CHANGE REQUEST ---------- */
    const [request] = await sequelize.query(
      `SELECT * FROM change_requests WHERE id = :id`,
      {
        replacements: { id: requestId },
        type: sequelize.QueryTypes.SELECT,
        transaction: t
      }
    );

    if (!request) return res.status(404).json({ error: "Request not found" });

    /* ---------- PARSE CHANGES JSON ---------- */
    const changesObj = typeof request.changes === "string" ? JSON.parse(request.changes) : request.changes;
    if (!changesObj || typeof changesObj !== "object") {
      return res.status(400).json({ error: "Invalid change request format" });
    }

    if (changesObj.data && changesObj.data.new && typeof changesObj.data.new === "object") {
      for (const [key, val] of Object.entries(changesObj.data.new)) {
        if (!changesObj[key]) {
          changesObj[key] = { new: val };
        }
      }
    }

    /* ---------- GET PROFILE ---------- */
    const [profile] = await sequelize.query(
      `SELECT id FROM therapist_profiles WHERE user_id = :userId`,
      {
        replacements: { userId: request.user_id },
        type: sequelize.QueryTypes.SELECT,
        transaction: t
      }
    );
    const profileId = profile?.id || null;

    /* ---------- FIELD MAPPINGS ---------- */
    const fieldMap = {
      fullName: "name",
      mobile: "phone",
      line1: "address_line1",
      line2: "address_line2",
      fullAddress: "full_address",
      lat: "latitude",
      lng: "longitude",
      panNumber: "pan_number",
      registrationNo: "registration_no",
      bankAccountNumber: "bank_account_number",
      bankIfscCode: "bank_ifsc_code",
      hourlyRate: "hourly_rate",
      membershipPlan: "membership_plan",
      serviceRadiusKm: "service_radius_km",
      experienceYears: "experience_years",
      experience: "experience_years",
      specialty: "specialty",
      bio: "bio",
      qualification: "qualification",
      dob: "date_of_birth",
      gender: "gender",
      country: "country",
      emergencyContact: "emergency_contact",
      email_opt_in: "email_notifications",
      push_opt_in: "push_notifications"
    };

    const fieldToTableMap = {
      // users table
      name: "users",
      email: "users",
      phone: "users",
      address_line1: "users",
      address_line2: "users",
      city: "users",
      state: "users",
      pin: "users",
      latitude: "users",
      longitude: "users",
      date_of_birth: "users",
      gender: "users",
      country: "users",
      emergency_contact: "users",
      email_notifications: "users",
      push_notifications: "users",
      default_role_id: "users",

      // therapist_profiles table
      bio: "therapist_profiles",
      qualification: "therapist_profiles",
      registration_no: "therapist_profiles",
      experience_years: "therapist_profiles",
      hourly_rate: "therapist_profiles",
      membership_plan: "therapist_profiles",
      pan_number: "therapist_profiles",
      bank_account_number: "therapist_profiles",
      bank_ifsc_code: "therapist_profiles",
      service_radius_km: "therapist_profiles",
      specialty: "therapist_profiles",
      full_address: "therapist_profiles"
    };

    /* ---------- APPLY FIELD UPDATES ---------- */
    for (const field in changesObj) {
      let value = changesObj[field]?.new;

      // skip non-db fields
      if (["availability", "userId", "section"].includes(field)) continue;

      const dbField = fieldMap[field] || field;
      const table = fieldToTableMap[dbField];
      if (!table) continue;

      // determine correct WHERE
      let whereField, refId;
      if (table === "users") {
        whereField = "id";
        refId = request.user_id;
      } else {
        if (!profileId) continue;
        whereField = "id";
        refId = profileId;
      }

      // convert array to Postgres array if needed
      if (dbField === "specialty" && Array.isArray(value)) {
        value = `{${value.join(",")}}`;
      }

      // skip nested objects
      if (typeof value === "object" && value !== null) continue;

      await sequelize.query(
        `UPDATE ${table}
         SET ${dbField} = :value
         WHERE ${whereField} = :refId`,
        { replacements: { value, refId }, transaction: t }
      );
    }

    /* ---------- HANDLE AVAILABILITY ---------- */
    if (profileId && changesObj.availability?.new) {
      const availability = changesObj.availability.new;

      // delete old availability
      await sequelize.query(
        `DELETE FROM therapist_availability WHERE therapist_id = :id`,
        { replacements: { id: profileId }, transaction: t }
      );

      // insert new availability
      for (const day in availability) {
        const slot = availability[day];
        await sequelize.query(
          `INSERT INTO therapist_availability
           (therapist_id, day_of_week, is_enabled, morning_start, morning_end, evening_start, evening_end)
           VALUES (:therapist_id, :day, :enabled, :m_start, :m_end, :e_start, :e_end)`,
          {
            replacements: {
              therapist_id: profileId,
              day,
              enabled: slot?.enabled ?? false,
              m_start: slot?.morning?.start || null,
              m_end: slot?.morning?.end || null,
              e_start: slot?.evening?.start || null,
              e_end: slot?.evening?.end || null
            },
            transaction: t
          }
        );
      }
    }

    /* ---------- MARK REQUEST AS APPROVED ---------- */
    await sequelize.query(
      `UPDATE change_requests
       SET status='approved', reviewer_id=:admin, reviewed_at=NOW()
       WHERE id=:id`,
      { replacements: { id: requestId, admin: req.user.id }, transaction: t }
    );

    await t.commit();

    return res.status(200).json({ success: true, message: "Change request approved successfully" });
  } catch (error) {
    await t.rollback();
    console.error("ApproveChangeRequest error:", error);
    return res.status(500).json({ error: "Approval failed" });
  }
};

exports.rejectChangeRequest = async (req, res) => {

  const requestId = req.params.id;

  await sequelize.query(
    `UPDATE change_requests
     SET status='rejected',
         reviewer_id=:admin,
         reviewed_at=NOW()
     WHERE id=:id`,
    {
      replacements: {
        id: requestId,
        admin: req.user.id
      }
    }
  );

  return res.success({}, "Request rejected");
};

exports.rejectChangeRequest = async (req, res) => {
  try {
    const requestId = req.params.id;
    const reason = req.body.reason || ""; // get reason from request body

    if (!reason) {
      return res.error("Rejection reason is required");
    }

    await sequelize.query(
      `UPDATE change_requests
       SET status='rejected',
           reviewer_id=:admin,
           reviewed_at=NOW(),
           reason=:reason
       WHERE id=:id`,
      {
        replacements: {
          id: requestId,
          admin: req.user.id,
          reason
        }
      }
    );

    return res.success({}, "Request rejected successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to reject request");
  }
};
exports.getChangeRequestById = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const roles = req.user?.roles || [];
    const requestId = Number(req.params.id);

    if (!userId || isNaN(userId)) return res.error("Invalid user ID");
    if (!requestId || isNaN(requestId)) return res.error("Invalid request ID");

    let whereClause = "WHERE cr.id = :requestId";
    let replacements = { requestId };

    if (roles.includes("admin.super")) {
      whereClause += " AND cr.role = :role";
      replacements.role = "admin";
    } else if (roles.includes("admin.therapy")) {
      const [admin] = await sequelize.query(
        `SELECT state_admin_name FROM users WHERE id = :id`,
        { replacements: { id: userId }, type: QueryTypes.SELECT }
      );

      if (!admin) return res.error("Admin state not found");

      whereClause += " AND cr.role = :role AND u.state = :state";
      replacements.role = "therapist";
      replacements.state = admin.state_admin_name;
    } else {
      return res.error("Unauthorized access");
    }

    const [request] = await sequelize.query(
      `
      SELECT
        cr.id,
        cr.user_id,
        cr.role,
        cr.entity_id,
        cr.section,
        cr.changes,
        cr.reason,       -- added reason field
        cr.status,
        cr.reviewer_id,
        cr.created_at,
        cr.reviewed_at,
        u.name,
        u.email,
        u.state_admin_name AS state
      FROM change_requests cr
      JOIN users u ON u.id = cr.user_id
      ${whereClause}
      LIMIT 1
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    if (!request) return res.error("Change request not found");

    return res.success(request, "Change request fetched successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch change request");
  }
};

// ✅ PUBLIC STATS
exports.publicStats = async (req, res) => {
  try {
    const [usersResult] = await sequelize.query(`SELECT COUNT(*) as cnt FROM users`, { type: QueryTypes.SELECT });
    const [therapistsResult] = await sequelize.query(`SELECT COUNT(*) as cnt FROM users WHERE role = 'therapist'`, { type: QueryTypes.SELECT });

    let productsCnt = 0;
    try {
      const [productsResult] = await sequelize.query(`SELECT COUNT(*) as cnt FROM products`, { type: QueryTypes.SELECT });
      productsCnt = Array.isArray(productsResult) ? (productsResult[0]?.cnt || 0) : (productsResult?.cnt || 0);
    } catch (e) { }

    let patientsCnt = 0;
    try {
      // Assuming appointments table has a status or we just count all of them for now
      const [appointmentsResult] = await sequelize.query(`SELECT COUNT(*) as cnt FROM appointments`, { type: QueryTypes.SELECT });
      patientsCnt = Array.isArray(appointmentsResult) ? (appointmentsResult[0]?.cnt || 0) : (appointmentsResult?.cnt || 0);
    } catch (e) { }

    let ordersCnt = 0;
    try {
      const [ordersResult] = await sequelize.query(`SELECT COUNT(*) as cnt FROM orders WHERE status = 'delivered' OR status = 'Delivered'`, { type: QueryTypes.SELECT });
      ordersCnt = Array.isArray(ordersResult) ? (ordersResult[0]?.cnt || 0) : (ordersResult?.cnt || 0);
    } catch (e) { }


    return res.json({
      usersTotal: parseInt(usersResult?.cnt || 0),
      therapistsTotal: parseInt(therapistsResult?.cnt || 0),
      productsTotal: parseInt(productsCnt),
      patientsServedTotal: parseInt(patientsCnt),
      productsDeliveredTotal: parseInt(ordersCnt)
    });
  } catch (error) {
    console.error("Public Stats Error:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
};

exports.listChangeRequests = async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const roles = req.user?.roles || [];

    if (!userId || isNaN(userId)) return res.error("Invalid user ID");

    let whereClause = "";
    let replacements = {};

    if (roles.includes("admin.super")) {
      whereClause = "WHERE cr.role = :role";
      replacements.role = "admin";
    } else if (roles.includes("admin.therapy")) {
      const [admin] = await sequelize.query(
        `SELECT state_admin_name FROM users WHERE id = :id`,
        { replacements: { id: userId }, type: QueryTypes.SELECT }
      );

      if (!admin) return res.error("Admin state not found");

      whereClause = "WHERE cr.role = :role AND u.state = :state";
      replacements.role = "therapist";
      replacements.state = admin.state_admin_name;
    } else {
      return res.error("Unauthorized access");
    }

    const requests = await sequelize.query(
      `
      SELECT
        cr.id,
        cr.user_id,
        cr.role,
        cr.entity_id,
        cr.section,
        cr.changes,
        cr.status,
        cr.reviewer_id,
        cr.created_at,
        cr.reviewed_at,
        u.name,
        u.email,
        u.state_admin_name AS state
      FROM change_requests cr
      JOIN users u ON u.id = cr.user_id
      ${whereClause}
      ORDER BY cr.created_at DESC
      `,
      { replacements, type: QueryTypes.SELECT }
    );

    return res.success(requests, "Change requests fetched");

  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch change requests");
  }
};