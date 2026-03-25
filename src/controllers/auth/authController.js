const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const transporter = require("../../config/mailer");

// exports.register = async (req, res) => {
//   const { email, password, name, phone, role, roles = [] } = req.body;
//   const uid = uuidv4();

//   const transaction = await sequelize.transaction();

//   try {
//     // 1️⃣ Check existing user
//     const exists = await sequelize.query(
//       `SELECT id FROM users WHERE email = :email`,
//       {
//         replacements: { email },
//         type: QueryTypes.SELECT,
//         transaction
//       }
//     );

//     if (exists.length) {
//       await transaction.rollback();
//       return res.status(409).json({ message: 'User already exists' });
//     }

//     // 2️⃣ Hash password
//     const hash = await bcrypt.hash(password, 10);

//     // 3️⃣ Insert user
//     const [user] = await sequelize.query(
//       `INSERT INTO users (uid,email,password,name,phone,role)
//        VALUES (:uid,:email,:password,:name,:phone,:role)
//        RETURNING id`,
//       {
//         replacements: {
//           uid,
//           email,
//           password: hash,
//           name,
//           phone,
//           role
//         },
//         type: QueryTypes.INSERT,
//         transaction
//       }
//     );

//     const userId = user[0].id;

//     // 4️⃣ Insert roles + mapping
//     for (const roleName of roles) {
//       const [roleRes] = await sequelize.query(
//         `INSERT INTO roles(name)
//          VALUES(:name)
//          ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name
//          RETURNING id`,
//         {
//           replacements: { name: roleName },
//           type: QueryTypes.INSERT,
//           transaction
//         }
//       );

//       await sequelize.query(
//         `INSERT INTO user_roles(user_id, role_id)
//          VALUES(:user_id, :role_id)
//          ON CONFLICT DO NOTHING`,
//         {
//           replacements: {
//             user_id: userId,
//             role_id: roleRes[0].id
//           },
//           type: QueryTypes.INSERT,
//           transaction
//         }
//       );
//     }

//     await transaction.commit();

//     res.json({
//       success: true,
//       message: 'User registered & roles mapped'
//     });

//   } catch (err) {
//     await transaction.rollback();
//     console.error(err);
//     res.status(500).json({ error: err.message });
//   }
// };

exports.register = async (req, res) => {
  const { email, password, name, phone, role, roles = [] } = req.body;

  const transaction = await sequelize.transaction();

  try {
    // 🔑 custom readable UID
    const uid = await generateUid(role, transaction);

    const exists = await sequelize.query(
      `SELECT id FROM users WHERE email = :email`,
      {
        replacements: { email },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    if (exists.length) {
      await transaction.rollback();
      return res.status(409).json({ message: 'User already exists' });
    }

    const hash = await bcrypt.hash(password, 10);

    const [user] = await sequelize.query(
      `INSERT INTO users (uid,email,password,name,phone,role)
       VALUES (:uid,:email,:password,:name,:phone,:role)
       RETURNING id`,
      {
        replacements: { uid, email, password: hash, name, phone, role },
        type: QueryTypes.INSERT,
        transaction
      }
    );

    const userId = user[0].id;

    for (const roleName of roles) {
      const [roleRes] = await sequelize.query(
        `INSERT INTO roles(name)
         VALUES(:name)
         ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name
         RETURNING id`,
        {
          replacements: { name: roleName },
          type: QueryTypes.INSERT,
          transaction
        }
      );

      await sequelize.query(
        `INSERT INTO user_roles(user_id, role_id)
         VALUES(:user_id, :role_id)
         ON CONFLICT DO NOTHING`,
        {
          replacements: { user_id: userId, role_id: roleRes[0].id },
          type: QueryTypes.INSERT,
          transaction
        }
      );
    }

    await transaction.commit();

    res.json({
      success: true,
      uid,
      message: 'User registered & roles mapped'
    });

  } catch (err) {
    await transaction.rollback();
    res.status(500).json({ error: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email & password required' });
    }
    // 1️⃣ User find
    const users = await sequelize.query(
      'SELECT * FROM users WHERE email = :email',
      {
        replacements: { email },
        type: QueryTypes.SELECT
      }
    );

    if (!users.length) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    

    const user = users[0];

    // 2️⃣ Password verify
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }


    // 3️⃣ Roles fetch
    const roleRows = await sequelize.query(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = :uid`,
      {
        replacements: { uid: user.id },
        type: QueryTypes.SELECT
      }
    );


    const roles = roleRows.map(r => r.name);
        console.log("hello",roles);

    // 4️⃣ JWT
 const token = jwt.sign(
  {
    id: user.id,
    uid: user.uid,
    email: user.email,
    role: user.role,
    roles
  },
  process.env.JWT_SECRET,
  {
    expiresIn: process.env.JWT_EXPIRE || "1d"
  }
);
 res.cookie("token", token, {
    httpOnly: true,
    secure: false, // localhost
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
  console.log("Login successful, token set in cookie", res);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        roles
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// exports.getUserProfile = async (req, res) => {
//   const { uid } = req.params;

//   const users = await sequelize.query(
//     'SELECT id, uid, name, email, phone, role FROM users WHERE id = :uid',
//     {
//       replacements: { uid },
//       type: QueryTypes.SELECT
//     }
//   );

//   if (!users.length) {
//     return res.status(404).json({ message: 'User not found' });
//   }

//   const roles = await sequelize.query(
//     `SELECT r.name
//      FROM user_roles ur
//      JOIN roles r ON r.id = ur.role_id
//      WHERE ur.user_id = :id`,
//     {
//       replacements: { id: users[0].id },
//       type: QueryTypes.SELECT
//     }
//   );

//   res.json({
//     ...users[0],
//     roles: roles.map(r => r.name)
//   });
// };

// exports.getUserProfile = async (req, res) => {
//   try {
//     const { id } = req.user; // ✅ TOKEN SE

//     if (!id) {
//       return res.status(400).json({ message: 'ID not found in token' });
//     }

//     // 1️⃣ User fetch
//     const users = await sequelize.query(
//       `
//       SELECT id, uid, name, email, phone, role
//       FROM users
//       WHERE id = :id
//       `,
//       {
//         replacements: { id },
//         type: QueryTypes.SELECT
//       }
//     );

//     if (!users.length) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     const user = users[0];

//     // 2️⃣ User roles fetch
//     const roles = await sequelize.query(
//       `
//       SELECT r.name
//       FROM user_roles ur
//       JOIN roles r ON r.id = ur.role_id
//       WHERE ur.user_id = :userId
//       `,
//       {
//         replacements: { userId: user.id },
//         type: QueryTypes.SELECT
//       }
//     );

//     // 3️⃣ Response
//     return res.json({
//       id: user.id,
//       uid: user.uid,
//       name: user.name,
//       email: user.email,
//       phone: user.phone,
//       role: user.role,
//       roles: roles.map(r => r.name)
//     });

//   } catch (error) {
//     console.error('❌ getUserProfile error:', error);
//     return res.status(500).json({
//       message: 'Internal server error'
//     });
//   }
// };

exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({
        message: "User ID not found in token"
      });
    }

    // 1️⃣ User fetch
    const users = await sequelize.query(
      `
      SELECT id, uid, name, email, phone, role
      FROM users
      WHERE id = :userId
      `,
      {
        replacements: { userId },
        type: QueryTypes.SELECT
      }
    );

    if (!users.length) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    let user = { ...users[0] };

    // 2️⃣ Roles fetch
    const rolesData = await sequelize.query(
      `
      SELECT r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = :userId
      `,
      {
        replacements: { userId },
        type: QueryTypes.SELECT
      }
    );

    const roles = rolesData.map(r => r.name);

    // 3️⃣ Agar patient/admin → direct return
    if (roles.includes("patient") || roles.includes("admin.super")) {
      return res.json({
        id: user.id,
        uid: user.uid,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        roles: roles
      });
    }

    // 4️⃣ Pending change request
    const changeRequest = await sequelize.query(
      `
      SELECT changes
      FROM change_requests
      WHERE user_id = :userId
      AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      {
        replacements: { userId },
        type: QueryTypes.SELECT
      }
    );

    if (changeRequest.length) {
      let changes = changeRequest[0].changes;

      if (typeof changes === "string") {
        try {
          changes = JSON.parse(changes);
        } catch {
          changes = {};
        }
      }

      // Apply changes directly in user object
      for (let key in changes) {
        if (changes[key]?.new !== undefined) {
          user[key] = changes[key].new;
        }
      }
    }

    // 5️⃣ Final flat response
    return res.json({
      id: user.id,
      uid: user.uid,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roles: roles
    });

  } catch (error) {
    console.error("❌ getUserProfile error:", error);
    return res.status(500).json({
      message: "Internal server error"
    });
  }
};


// exports.getMe = async (req, res) => {
//   try {
//    let token = req.cookies?.token;

//     if (!token && req.headers.authorization) {
//       token = req.headers.authorization.split(" ")[1];
//     }

//     console.log("token:", token);

//     if (!token) {
//       return res.status(401).json({ message: "No token found" });
//     }
//     // 1️⃣ Verify Token
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     console.log("decoded token:", decoded);
//     if (!decoded.id) {
//       return res.status(400).json({ message: "ID not found in token" });
//     }

//     // 2️⃣ Fetch User from DB
//     const users = await sequelize.query(
//       `
//       SELECT *
//       FROM users
//       WHERE id = :id
//       `,
//       {
//         replacements: { id: decoded.id },
//         type: QueryTypes.SELECT
//       }
//     );

//     if (!users.length) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const user = users[0];

//     // 3️⃣ Fetch Roles
//     const roles = await sequelize.query(
//       `
//       SELECT r.name
//       FROM user_roles ur
//       JOIN roles r ON r.id = ur.role_id
//       WHERE ur.user_id = :userId
//       `,
//       {
//         replacements: { userId: user.id },
//         type: QueryTypes.SELECT
//       }
//     );

//     // 4️⃣ Final Response
//     return res.json({
//       user: {
//         id: user.id,
//         uid: user.uid,
//         name: user.name,
//         gender: user.gender,
//         email: user.email,
//         phone: user.phone,
//         role: user.role,
//         city: user.city,
//         state: user.state,
//         line1: user.address_line1,
//         line2: user.address_line2,
//         pin: user.pin,
//         dob: user.date_of_birth,
//         country: user.country,
//         emergencyContact: user.emergency_contact,
//         push_opt_in: user.push_notifications ?? false,
//         email_opt_in: user.email_notifications ?? false,
//         roles: roles.map(r => r.name)
//       }
//     });

//   } catch (err) {
//     console.error("❌ me error:", err);
//     return res.status(401).json({ message: "Invalid or expired token" });
//   }
// };

exports.getMe = async (req, res) => {
  try {
    let token = req.cookies?.token;

    if (!token && req.headers.authorization) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ message: "No token found" });
    }

    // 1️⃣ Verify Token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.id) {
      return res.status(400).json({ message: "ID not found in token" });
    }

    // 2️⃣ Fetch User
    const users = await sequelize.query(
      `
      SELECT *
      FROM users
      WHERE id = :id
      `,
      {
        replacements: { id: decoded.id },
        type: QueryTypes.SELECT
      }
    );

    if (!users.length) {
      return res.status(404).json({ message: "User not found" });
    }

    let user = { ...users[0] };

    // 3️⃣ Fetch Roles
    const rolesData = await sequelize.query(
      `
      SELECT r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = :userId
      `,
      {
        replacements: { userId: user.id },
        type: QueryTypes.SELECT
      }
    );

    const roles = rolesData.map(r => r.name);

    // 4️⃣ Apply pending changes
    const changeRequest = await sequelize.query(
      `
      SELECT changes
      FROM change_requests
      WHERE user_id = :userId
      AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      {
        replacements: { userId: user.id },
        type: QueryTypes.SELECT
      }
    );

    if (changeRequest.length) {
      let changes = changeRequest[0].changes;

      if (typeof changes === "string") {
        try {
          changes = JSON.parse(changes);
        } catch {
          changes = {};
        }
      }

      for (let key in changes) {
        if (changes[key]?.new !== undefined) {
          user[key] = changes[key].new;
        }
      }
    }

    // 5️⃣ Final FLAT response (same format you want)
    return res.json({
      id: user.id,
      uid: user.uid,
      name: user.name,
      gender: user.gender,
      email: user.email,
      phone: user.phone,
      role: user.role,
      city: user.city,
      state: user.state,
      line1: user.address_line1,
      line2: user.address_line2,
      pin: user.pin,
      dob: user.date_of_birth,
      country: user.country,
      emergencyContact: user.emergency_contact,
      push_opt_in: user.push_notifications ?? false,
      email_opt_in: user.email_notifications ?? false,
      roles: roles
    });

  } catch (err) {
    console.error("❌ getMe error:", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

async function generateUid(role, transaction) {
  const result = await sequelize.query(
    `
    SELECT uid FROM users
    WHERE uid LIKE :pattern
    ORDER BY id DESC
    LIMIT 1
    `,
    {
      replacements: { pattern: `${role}-%` },
      type: QueryTypes.SELECT,
      transaction
    }
  );

  let nextNumber = 1;

  if (result.length) {
    const lastUid = result[0].uid; // e.g. patient-03
    const parts = lastUid.split('-');
    nextNumber = parseInt(parts[parts.length - 1], 10) + 1;
  }

  return `${role}-${String(nextNumber).padStart(2, '0')}`;
}

exports.googleLogin = async (req, res) => {
  const { token, role = "patient", roles = [] } = req.body;

  const transaction = await sequelize.transaction();

  try {
    if (!token) {
      return res.status(400).json({ message: "Google token required" });
    }

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    const exists = await sequelize.query(
      `SELECT * FROM users WHERE email = :email`,
      {
        replacements: { email },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    let user;
    let userId;

    if (!exists.length) {

      const uid = await generateUid(role, transaction);

      // 3️⃣ Insert user (no password for Google)
      const [newUser] = await sequelize.query(
        `INSERT INTO users (uid,email,name,role,picture)
         VALUES (:uid,:email,:name,:role,:picture)
         RETURNING *`,
        {
          replacements: { uid, email, name, role, picture },
          type: QueryTypes.INSERT,
          transaction
        }
      );

      user = newUser[0];
      userId = user.id;

      for (const roleName of roles) {
        const [roleRes] = await sequelize.query(
          `INSERT INTO roles(name)
           VALUES(:name)
           ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name
           RETURNING id`,
          {
            replacements: { name: roleName },
            type: QueryTypes.INSERT,
            transaction
          }
        );

        await sequelize.query(
          `INSERT INTO user_roles(user_id, role_id)
           VALUES(:user_id, :role_id)
           ON CONFLICT DO NOTHING`,
          {
            replacements: {
              user_id: userId,
              role_id: roleRes[0].id
            },
            type: QueryTypes.INSERT,
            transaction
          }
        );
      }

    } else {
      user = exists[0];
      userId = user.id;
    }

    await transaction.commit();

    const roleRows = await sequelize.query(
      `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = :uid`,
      {
        replacements: { uid: userId },
        type: QueryTypes.SELECT
      }
    );

    const userRoles = roleRows.map(r => r.name);

    const jwtToken = jwt.sign(
      {
        id: user.id,
        uid: user.uid,
        email: user.email,
        role: user.role,
        roles: userRoles
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRE || "1d"
      }
    );

    return res.json({
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        name: user.name,
        role: user.role,
        roles: userRoles
      }
    });

  } catch (err) {
    await transaction.rollback();
    console.error("Google Login Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
// controllers/auth.controller.js

exports.logout = async (req, res) => {
  try {
    res.clearCookie("token", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
  });
console.log("Logout successful", res);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Logout failed"
    });
  }
};



exports.loginWithMobile = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { phoneNumber, verifyOtp } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: "Phone number is required" });
  }

  const phone = phoneNumber.replace(/^\+91/, '');

  try {
    // 1️⃣ Check if the phone number exists
    const users = await sequelize.query(
      "SELECT * FROM users WHERE phone = :phoneNumber",
      {
        replacements: { phoneNumber: phone },
        type: QueryTypes.SELECT,
      }
    );

    if (users.length === 0) {
      return res.status(400).json({ success: false, error: "Phone number not registered" });
    }

    const user = users[0];

    // 2️⃣ Fetch all roles of this user
    const rolesResult = await sequelize.query(
      "SELECT r.name FROM roles r INNER JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = :userId",
      {
        replacements: { userId: user.id },
        type: QueryTypes.SELECT,
      }
    );

    // Extract role names into an array
    const roles = rolesResult.map(r => r.name);

    // 3️⃣ If OTP is verified, generate JWT including roles
    if (verifyOtp === true) {
      const token = jwt.sign(
        {
          id: user.id,
          uid: user.uid,
          email: user.email,
          role: user.role,
          roles, // add array of roles here
        },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.JWT_EXPIRE || "1d",
        }
      );

      res.cookie("token", token, {
        httpOnly: true,
        secure: false, // set true in production with HTTPS
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      });

      console.log("Login successful, token set in cookie");

      return res.status(200).json({
        success: true,
        message: "OTP verified, token generated",
        token,
        roles,
      });
    }

    // 4️⃣ OTP not verified yet
    res.status(200).json({ success: true, message: "Number exists, proceed with OTP" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.error("Email is required");
    }

    // Find user
    const [user] = await sequelize.query(
      `SELECT id, email FROM users WHERE email = :email`,
      {
        replacements: { email },
        type: QueryTypes.SELECT
      }
    );

    // Security: email exist ho ya na ho same response
    if (!user) {
      return res.success(null, "If the email exists, a reset link has been sent");
    }

    const resetToken = uuidv4();

    // Save token
    await sequelize.query(
      `UPDATE users
       SET reset_token = :token,
           reset_token_expiry = NOW() + interval '1 hour'
       WHERE id = :id`,
      {
        replacements: { token: resetToken, id: user.id },
        type: QueryTypes.UPDATE
      }
    );

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"Support" <${process.env.MAIL_USER}>`,
      to: user.email,
      subject: "Password Reset Request",
      html: `
        <p>You requested to reset your password.</p>
        <p>Click the link below to reset it:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>This link will expire in 1 hour.</p>
      `
    });

    return res.success(null, "Password reset link sent to your email");

  } catch (error) {
    console.error(error);
    return res.error("Failed to send password reset link");
  }
};



exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.error("Token and new password are required");
    }

    if (newPassword.length < 8) {
      return res.error("Password must be at least 8 characters");
    }

    // Find valid token (expiry check inside SQL)
    const [user] = await sequelize.query(
      `SELECT id
       FROM users
       WHERE reset_token = :token
       AND reset_token_expiry > NOW()`,
      {
        replacements: { token },
        type: QueryTypes.SELECT
      }
    );

    if (!user) {
      return res.error("Invalid or expired reset token");
    }

    const hash = await bcrypt.hash(newPassword, 10);

    // Update password
    await sequelize.query(
      `UPDATE users
       SET password = :password,
           reset_token = NULL,
           reset_token_expiry = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        replacements: { password: hash, id: user.id },
        type: QueryTypes.UPDATE
      }
    );

    // Audit log
    await sequelize.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
       VALUES (:actorId, 'password.reset', 'user', :userId)`,
      {
        replacements: {
          actorId: user.id,
          userId: user.id
        },
        type: QueryTypes.INSERT
      }
    );

    return res.success(null, "Password reset successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to reset password");
  }
};
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user?.id; // from authMiddleware
    const { currentPassword, newPassword } = req.body;

    if (!userId) return res.error("Unauthorized");
    if (!currentPassword || !newPassword) return res.error("Current and new password are required");

    // Fetch current password
    const [user] = await sequelize.query(
      `SELECT id, password FROM users WHERE id = :id`,
      { replacements: { id: userId }, type: QueryTypes.SELECT }
    );

    if (!user) return res.error("User not found");

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.error("Current password is incorrect");

    // Hash new password
    const hash = await bcrypt.hash(newPassword, 10);

    // Update password
    await sequelize.query(
      `UPDATE users SET password = :password, updated_at = CURRENT_TIMESTAMP WHERE id = :id`,
      { replacements: { password: hash, id: userId }, type: QueryTypes.UPDATE }
    );

    // Optional: log audit
    await sequelize.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
       VALUES (:actorId, 'password.changed', 'user', :userId)`,
      { replacements: { actorId: userId, userId }, type: QueryTypes.INSERT }
    );

    return res.success(null, "Password changed successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to change password");
  }
};

exports.updateUserProfile = async (req, res) => {
  try {
    const userId = req.user?.id; // from authMiddleware

    if (!userId) {
      return res.error("User ID not found in token");
    }

    const {
      fullName,
      dob,
      gender,
      email,
      mobile,
      emergencyContact,
      line1,
      line2,
      city,
      state,
      pin,
      country,
      email_opt_in,
      push_opt_in
    } = req.body;

    await sequelize.query(
      `
      UPDATE users
      SET
        name = :fullName,
        date_of_birth = :dob,
        gender = :gender,
        email = :email,
        phone = :mobile,
        emergency_contact = :emergencyContact,
        address_line1 = :line1,
        address_line2 = :line2,
        city = :city,
        state = :state,
        pin = :pin,
        country = :country,
        email_notifications = :email_opt_in,
        push_notifications = :push_opt_in,
        updated_at = NOW()
      WHERE id = :userId
      `,
      {
        replacements: {
          userId,
          fullName,
          dob,
          gender,
          email,
          mobile,
          emergencyContact,
          line1,
          line2,
          city,
          state,
          pin,
          country,
          email_opt_in,
          push_opt_in
        },
        type: QueryTypes.UPDATE
      }
    );

    return res.success(null, "Profile updated successfully");

  } catch (error) {
    console.error("❌ updateUserProfile error:", error);
    return res.error("Failed to update profile");
  }
};
exports.createChangeRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const clientData = req.body;

    if (!clientData || Object.keys(clientData).length === 0) {
      return res.error("No changes provided");
    }

    /* ---------- Flatten payload ---------- */
    const newValues = clientData.data?.new || clientData;
    const section = clientData.section?.new || clientData.section || "profile";
    const role = clientData.role?.new || clientData.role || req.user.role;

    // Merge top-level keys
    if (clientData.userId?.new) newValues.userId = clientData.userId.new;
    if (clientData.role?.new) newValues.role = clientData.role.new;
    if (clientData.section?.new) newValues.section = clientData.section.new;

    /* ---------- Field mapping for DB columns ---------- */
    const fieldMapping = {
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
      specialty: "specialty",
      bio: "bio",
      qualification: "qualification"
    };

    /* ---------- Fetch old data ---------- */
    const [oldUser] = await sequelize.query(
      `SELECT name, phone, address_line1, address_line2, city, state, pin, latitude, longitude, email
       FROM users WHERE id = :userId`,
      { replacements: { userId }, type: sequelize.QueryTypes.SELECT }
    );

    const [oldProfile] = await sequelize.query(
      `SELECT bio, qualification, registration_no, hourly_rate, membership_plan,
              service_radius_km, experience_years, pan_number, bank_account_number, bank_ifsc_code,
              full_address, specialty
       FROM therapist_profiles WHERE user_id = :userId`,
      { replacements: { userId }, type: sequelize.QueryTypes.SELECT }
    );

    const oldData = { ...oldUser, ...oldProfile };

    /* ---------- Extra fields ---------- */
    const extraFields = {
      dob: "1990-01-01",
      gender: "male",
      country: "India",
      push_opt_in: true,
      email_opt_in: true,
      default_role_id: role,
      emergencyContact: "9876543210"
    };

    /* ---------- Build final changes object ---------- */
    const changes = {};
    const allKeys = new Set([...Object.keys(newValues), ...Object.keys(extraFields)]);

    allKeys.forEach((key) => {
      // old value from DB
      let oldVal = oldData[fieldMapping[key] || key] ?? null;

      // new value from request or extra fields
      let newVal = newValues[key] ?? extraFields[key];

      const stringify = (v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : v);

      if (stringify(oldVal) !== stringify(newVal)) {
        changes[key] = {
          old: oldVal,
          new: newVal
        };
      }
    });

    /* ---------- Insert change request ---------- */
    if (Object.keys(changes).length === 0) {
      return res.success({}, "No changes detected");
    }

    await sequelize.query(
      `INSERT INTO change_requests
       (user_id, role, entity_id, section, changes)
       VALUES (:user_id, :role, :entity_id, :section, :changes)`,
      {
        replacements: {
          user_id: userId,
          role,
          entity_id: userId,
          section,
          changes: JSON.stringify(changes)
        }
      }
    );

    return res.success(changes, "Change request submitted successfully");

  } catch (error) {
    console.error(error);
    return res.error("Failed to submit change request");
  }
};