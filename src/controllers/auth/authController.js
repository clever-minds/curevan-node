const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

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
exports.getUserProfile = async (req, res) => {
  const { uid } = req.params;

  const users = await sequelize.query(
    'SELECT id, uid, name, email, phone, role FROM users WHERE id = :uid',
    {
      replacements: { uid },
      type: QueryTypes.SELECT
    }
  );

  if (!users.length) {
    return res.status(404).json({ message: 'User not found' });
  }

  const roles = await sequelize.query(
    `SELECT r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = :id`,
    {
      replacements: { id: users[0].id },
      type: QueryTypes.SELECT
    }
  );

  res.json({
    ...users[0],
    roles: roles.map(r => r.name)
  });
};

exports.getUserProfile = async (req, res) => {
  try {
    const { id } = req.user; // ✅ TOKEN SE

    if (!id) {
      return res.status(400).json({ message: 'ID not found in token' });
    }

    // 1️⃣ User fetch
    const users = await sequelize.query(
      `
      SELECT id, uid, name, email, phone, role
      FROM users
      WHERE id = :id
      `,
      {
        replacements: { id },
        type: QueryTypes.SELECT
      }
    );

    if (!users.length) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    // 2️⃣ User roles fetch
    const roles = await sequelize.query(
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

    // 3️⃣ Response
    return res.json({
      id: user.id,
      uid: user.uid,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      roles: roles.map(r => r.name)
    });

  } catch (error) {
    console.error('❌ getUserProfile error:', error);
    return res.status(500).json({
      message: 'Internal server error'
    });
  }
};
exports.getMe = async (req, res) => {
  try {
    const token = req.cookies.token;
    console.log("token",token);
    if (!token) {
      return res.status(401).json({ message: "No token found" });
    }

    // 1️⃣ Verify Token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("decoded token:", decoded);
    if (!decoded.id) {
      return res.status(400).json({ message: "ID not found in token" });
    }

    // 2️⃣ Fetch User from DB
    const users = await sequelize.query(
      `
      SELECT id, uid, name, email, phone, role
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

    const user = users[0];

    // 3️⃣ Fetch Roles
    const roles = await sequelize.query(
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

    // 4️⃣ Final Response
    return res.json({
      user: {
        id: user.id,
        uid: user.uid,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        roles: roles.map(r => r.name)
      }
    });

  } catch (err) {
    console.error("❌ me error:", err);
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
