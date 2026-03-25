const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");


/* =========================
   REGISTER THERAPIST
========================= */
// exports.registerTherapist = async (req, res) => {

//   const t = await sequelize.transaction();

//   try {

//     const {
//       email,
//       password,
//       fullName,
//       mobile,

//       bio,
//       qualification,
//       experienceYears,
//       registrationNo,

//       hourlyRate,
//       membershipPlan,

//       panNumber,
//       bankAccountNumber,
//       bankIfscCode,

//       specialty,

//       line1,
//       line2,
//       city,
//       state,
//       pin,
//       fullAddress,
//       lat,
//       lng,

//       serviceRadiusKm

//     } = req.body;


//     const hash = await bcrypt.hash(password, 10);
//     const uid = uuidv4();


//     /* ---------- USERS TABLE ---------- */

//     const userResult = await sequelize.query(
//       `
//       INSERT INTO users
//       (
//         uid,email,password,name,phone,role,
//         address_line1,address_line2,city,state,pin,
//         full_address,latitude,longitude
//       )
//       VALUES
//       (
//         :uid,:email,:password,:name,:phone,'therapist',
//         :line1,:line2,:city,:state,:pin,
//         :fullAddress,:lat,:lng
//       )
//       RETURNING *
//       `,
//       {
//         replacements: {
//           uid,
//           email,
//           password: hash,
//           name: fullName,
//           phone: mobile,
//           line1,
//           line2,
//           city,
//           state,
//           pin,
//           fullAddress,
//           lat,
//           lng
//         },
//         type: QueryTypes.INSERT,
//         transaction: t
//       }
//     );

//     const user = userResult[0][0];


//     /* ---------- SPECIALTY FORMAT ---------- */

//     const pgSpecialty = Array.isArray(specialty)
//       ? `{${specialty.join(",")}}`
//       : `{${(specialty || "").split("/").join(",")}}`;


//     /* ---------- THERAPIST PROFILE ---------- */

//     const profileResult = await sequelize.query(
//       `
//       INSERT INTO therapist_profiles
//       (
//         user_id,
//         bio,
//         qualification,
//         registration_no,
//         experience_years,
//         hourly_rate,
//         membership_plan,
//         pan_number,
//         bank_account_number,
//         bank_ifsc_code,
//         service_radius_km,
//         specialty
//       )
//       VALUES
//       (
//         :user_id,
//         :bio,
//         :qualification,
//         :registration_no,
//         :experience_years,
//         :hourly_rate,
//         :membership_plan,
//         :pan_number,
//         :bank_account_number,
//         :bank_ifsc_code,
//         :service_radius_km,
//         :specialty
//       )
//       RETURNING *
//       `,
//       {
//         replacements: {
//           user_id: user.id,
//           bio,
//           qualification,
//           registration_no: registrationNo,
//           experience_years: experienceYears,
//           hourly_rate: hourlyRate,
//           membership_plan: membershipPlan,
//           pan_number: panNumber,
//           bank_account_number: bankAccountNumber,
//           bank_ifsc_code: bankIfscCode,
//           service_radius_km: serviceRadiusKm || 10,
//           specialty: pgSpecialty
//         },
//         type: QueryTypes.INSERT,
//         transaction: t
//       }
//     );

//     const therapist = profileResult[0][0];

//     await t.commit();

//     res.status(201).json({
//       status: true,
//       message: "Therapist Registered",
//       data: therapist
//     });

//   } catch (error) {

//     await t.rollback();

//     console.error("registerTherapist error:", error);

//     res.status(500).json({
//       status: false,
//       message: "Server Error"
//     });

//   }
// };

exports.registerTherapist = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const {
      email,
      password,
      fullName,
      mobile,

      bio,
      qualification,
      experienceYears,
      registrationNo,

      hourlyRate,
      membershipPlan,

      panNumber,
      bankAccountNumber,
      bankIfscCode,

      specialty,

      line1,
      line2,
      city,
      state,
      pin,
      fullAddress,
      lat,
      lng,

      serviceRadiusKm,

      availability // ✅ NEW
    } = req.body;

    const hash = await bcrypt.hash(password, 10);
    const uid = uuidv4();

    /* ---------- USERS ---------- */
    const userResult = await sequelize.query(
      `INSERT INTO users
      (uid,email,password,name,phone,role,
       address_line1,address_line2,city,state,pin,
       full_address,latitude,longitude)
      VALUES
      (:uid,:email,:password,:name,:phone,'therapist',
       :line1,:line2,:city,:state,:pin,
       :fullAddress,:lat,:lng)
      RETURNING *`,
      {
        replacements: {
          uid,
          email,
          password: hash,
          name: fullName,
          phone: mobile,
          line1,
          line2,
          city,
          state,
          pin,
          fullAddress,
          lat,
          lng
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const user = userResult[0][0];

    /* ---------- SPECIALTY ---------- */
    const pgSpecialty = Array.isArray(specialty)
      ? `{${specialty.join(",")}}`
      : `{${(specialty || "").split("/").join(",")}}`;

    /* ---------- PROFILE ---------- */
    const profileResult = await sequelize.query(
      `INSERT INTO therapist_profiles
      (user_id,bio,qualification,registration_no,
       experience_years,hourly_rate,membership_plan,
       pan_number,bank_account_number,bank_ifsc_code,
       service_radius_km,specialty)
      VALUES
      (:user_id,:bio,:qualification,:registration_no,
       :experience_years,:hourly_rate,:membership_plan,
       :pan_number,:bank_account_number,:bank_ifsc_code,
       :service_radius_km,:specialty)
      RETURNING *`,
      {
        replacements: {
          user_id: user.id,
          bio,
          qualification,
          registration_no: registrationNo,
          experience_years: experienceYears,
          hourly_rate: hourlyRate,
          membership_plan: membershipPlan,
          pan_number: panNumber,
          bank_account_number: bankAccountNumber,
          bank_ifsc_code: bankIfscCode,
          service_radius_km: serviceRadiusKm || 10,
          specialty: pgSpecialty
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const therapist = profileResult[0][0];

    /* ---------- AVAILABILITY (NEW) ---------- */
    if (availability) {
      for (const day in availability) {
        const slot = availability[day];

        await sequelize.query(
          `INSERT INTO therapist_availability
          (therapist_id, day_of_week, is_enabled,
           morning_start, morning_end,
           evening_start, evening_end)
          VALUES
          (:therapist_id, :day, :enabled,
           :m_start, :m_end,
           :e_start, :e_end)`,
          {
            replacements: {
              therapist_id: user.id, // ⚠️ important (user.id)
              day,
              enabled: slot.enabled,
              m_start: slot.morning?.start || null,
              m_end: slot.morning?.end || null,
              e_start: slot.evening?.start || null,
              e_end: slot.evening?.end || null
            },
            type: QueryTypes.INSERT,
            transaction: t
          }
        );
      }
    }

    await t.commit();

    res.status(201).json({
      status: true,
      message: "Therapist Registered with Availability",
      data: therapist
    });

  } catch (error) {
    await t.rollback();

    console.error("registerTherapist error:", error);

    res.status(500).json({
      status: false,
      message: "Server Error"
    });
  }
};

/* =========================
   UPDATE PROFILE
========================= */

// exports.updateProfile = async (req, res) => {

//   const t = await sequelize.transaction();

//   try {

//     const { userId } = req.params;

//     const {
//       email,
//       fullName,
//       mobile,

//       line1,
//       line2,
//       city,
//       state,
//       pin,
//       fullAddress,
//       lat,
//       lng,

//       bio,
//       qualification,
//       experienceYears,
//       hourlyRate,
//       membershipPlan,
//       panNumber,
//       registrationNo,
//       bankAccountNumber,
//       bankIfscCode,
//       serviceRadiusKm,
//       specialty

//     } = req.body;



//     /* ---------- USERS UPDATE ---------- */

//     await sequelize.query(
//       `
//       UPDATE users
//       SET
//       email=:email,
//       name=:name,
//       phone=:phone,
//       address_line1=:line1,
//       address_line2=:line2,
//       city=:city,
//       state=:state,
//       pin=:pin,
//       full_address=:fullAddress,
//       latitude=:lat,
//       longitude=:lng
//       WHERE id=:id
//       `,
//       {
//         replacements: {
//           id: userId,
//           email,
//           name: fullName,
//           phone: mobile,
//           line1,
//           line2,
//           city,
//           state,
//           pin,
//           fullAddress,
//           lat,
//           lng
//         },
//         type: QueryTypes.UPDATE,
//         transaction: t
//       }
//     );


//     /* ---------- SPECIALTY ---------- */

//     const pgSpecialty = `{${specialty.join(",")}}`;


//     /* ---------- PROFILE UPDATE ---------- */

//     await sequelize.query(
//       `
//       UPDATE therapist_profiles
//       SET
//       bio=:bio,
//       qualification=:qualification,
//       registration_no=:registrationNo,
//       experience_years=:experienceYears,
//       hourly_rate=:hourlyRate,
//       membership_plan=:membershipPlan,
//       pan_number=:panNumber,
//       bank_account_number=:bankAccountNumber,
//       bank_ifsc_code=:bankIfscCode,
//       service_radius_km=:serviceRadiusKm,
//       specialty=:specialty
//       WHERE user_id=:userId
//       `,
//       {
//         replacements: {
//           userId,
//           bio,
//           qualification,
//           registrationNo,
//           experienceYears,
//           hourlyRate,
//           membershipPlan,
//           panNumber,
//           bankAccountNumber,
//           bankIfscCode,
//           serviceRadiusKm,
//           specialty: pgSpecialty
//         },
//         type: QueryTypes.UPDATE,
//         transaction: t
//       }
//     );

//     await t.commit();

//     res.json({
//       status: true,
//       message: "Profile Updated"
//     });

//   } catch (error) {

//     await t.rollback();

//     console.error("updateProfile error:", error);

//     res.status(500).json({
//       status: false,
//       message: "Server Error"
//     });

//   }
// };

exports.updateProfile = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { userId } = req.params;

    const {
      email,
      fullName,
      mobile,

      line1,
      line2,
      city,
      state,
      pin,
      fullAddress,
      lat,
      lng,

      bio,
      qualification,
      experienceYears,
      hourlyRate,
      membershipPlan,
      panNumber,
      registrationNo,
      bankAccountNumber,
      bankIfscCode,
      serviceRadiusKm,
      specialty,

      availability // ✅ NEW
    } = req.body;

    /* ---------- USERS UPDATE ---------- */
    await sequelize.query(
      `UPDATE users SET
        email=:email,
        name=:name,
        phone=:phone,
        address_line1=:line1,
        address_line2=:line2,
        city=:city,
        state=:state,
        pin=:pin,
        full_address=:fullAddress,
        latitude=:lat,
        longitude=:lng
      WHERE id=:id`,
      {
        replacements: {
          id: userId,
          email,
          name: fullName,
          phone: mobile,
          line1,
          line2,
          city,
          state,
          pin,
          fullAddress,
          lat,
          lng
        },
        type: QueryTypes.UPDATE,
        transaction: t
      }
    );

    /* ---------- SPECIALTY SAFE ---------- */
    const pgSpecialty = Array.isArray(specialty)
      ? `{${specialty.join(",")}}`
      : `{${(specialty || "").split("/").join(",")}}`;

    /* ---------- PROFILE UPDATE ---------- */
    await sequelize.query(
      `UPDATE therapist_profiles SET
        bio=:bio,
        qualification=:qualification,
        registration_no=:registrationNo,
        experience_years=:experienceYears,
        hourly_rate=:hourlyRate,
        membership_plan=:membershipPlan,
        pan_number=:panNumber,
        bank_account_number=:bankAccountNumber,
        bank_ifsc_code=:bankIfscCode,
        service_radius_km=:serviceRadiusKm,
        specialty=:specialty
      WHERE user_id=:userId`,
      {
        replacements: {
          userId,
          bio,
          qualification,
          registrationNo,
          experienceYears,
          hourlyRate,
          membershipPlan,
          panNumber,
          bankAccountNumber,
          bankIfscCode,
          serviceRadiusKm,
          specialty: pgSpecialty
        },
        type: QueryTypes.UPDATE,
        transaction: t
      }
    );

    /* ---------- AVAILABILITY UPDATE (NEW) ---------- */
    if (availability) {

      // 🧹 Delete old
      await sequelize.query(
        `DELETE FROM therapist_availability WHERE therapist_id = :id`,
        {
          replacements: { id: userId },
          type: QueryTypes.DELETE,
          transaction: t
        }
      );

      // ➕ Insert new
      for (const day in availability) {
        const slot = availability[day];

        await sequelize.query(
          `INSERT INTO therapist_availability
          (therapist_id, day_of_week, is_enabled,
           morning_start, morning_end,
           evening_start, evening_end)
          VALUES
          (:therapist_id, :day, :enabled,
           :m_start, :m_end,
           :e_start, :e_end)`,
          {
            replacements: {
              therapist_id: userId,
              day,
              enabled: slot.enabled,
              m_start: slot.morning?.start || null,
              m_end: slot.morning?.end || null,
              e_start: slot.evening?.start || null,
              e_end: slot.evening?.end || null
            },
            type: QueryTypes.INSERT,
            transaction: t
          }
        );
      }
    }

    await t.commit();

    res.json({
      status: true,
      message: "Profile + Availability Updated"
    });

  } catch (error) {
    await t.rollback();

    console.error("updateProfile error:", error);

    res.status(500).json({
      status: false,
      message: "Server Error"
    });
  }
};

/* =========================
   GET PROFILE
========================= */

// exports.getProfile = async (req, res) => {

//   try {

//     const { userId } = req.params;

//     const result = await sequelize.query(
//       `
//       SELECT
//       tp.*,

//       u.name,
//       u.email,
//       u.phone,

//       u.address_line1,
//       u.address_line2,
//       u.city,
//       u.state,
//       u.pin,

//       u.full_address as "fullAddress",
//       u.latitude as lat,
//       u.longitude as lng

//       FROM therapist_profiles tp
//       JOIN users u ON u.id = tp.user_id

//       WHERE tp.user_id=:userId
//       `,
//       {
//         replacements: { userId },
//         type: QueryTypes.SELECT
//       }
//     );

//     if (!result.length)
//       return res.status(404).json({
//         status: false,
//         message: "Profile not found"
//       });

//     const profile = result[0];

//     // FIX specialty conversion
//     profile.specialty = Array.isArray(profile.specialty)
//       ? profile.specialty
//       : (profile.specialty
//           ? profile.specialty.replace(/[{}]/g, "").split(",")
//           : []);

//     res.json({
//       status: true,
//       data: profile
//     });

//   } catch (error) {

//     console.error("getProfile error:", error);

//     res.status(500).json({
//       status: false,
//       message: "Server error"
//     });

//   }
// };



exports.getProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    // 1️⃣ Fetch therapist profile
    const result = await sequelize.query(
      `
      SELECT
        tp.*,
        u.name,
        u.email,
        u.phone,
        u.address_line1,
        u.address_line2,
        u.city,
        u.state,
        u.pin,
        u.full_address AS "fullAddress",
        u.latitude AS lat,
        u.longitude AS lng
      FROM therapist_profiles tp
      JOIN users u ON u.id = tp.user_id
      WHERE tp.user_id = :userId
      `,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    if (!result.length) {
      return res.status(404).json({
        status: false,
        message: "Profile not found",
      });
    }

    const profile = result[0];

    // 2️⃣ Convert specialty to array
    profile.specialty = Array.isArray(profile.specialty)
      ? profile.specialty
      : profile.specialty
      ? profile.specialty.replace(/[{}]/g, "").split(",")
      : [];

    // 3️⃣ Fetch therapist availability
    const availabilities = await sequelize.query(
      `
      SELECT
        day_of_week AS "dayOfWeek",
        is_enabled,
        json_build_object('start', morning_start, 'end', morning_end, 'enabled', is_enabled) AS morning,
        json_build_object('start', evening_start, 'end', evening_end, 'enabled', is_enabled) AS evening
      FROM public.therapist_availability
      WHERE therapist_id = :userId
      ORDER BY day_of_week
      `,
      {
         replacements: { userId: profile.id },
        type: QueryTypes.SELECT,
      }
    );

    // 4️⃣ Merge availability into structured object {0: {...}, 1: {...}, ...}
    const availabilityObj = availabilities.reduce((acc, cur) => {
      acc[cur.dayOfWeek] = {
        morning: cur.morning,
        evening: cur.evening,
      };
      return acc;
    }, {});

    profile.availability = availabilityObj;

    // 5️⃣ Send response
    res.json({
      status: true,
      data: profile,
    });
  } catch (error) {
    console.error("getProfile error:", error);
    res.status(500).json({
      status: false,
      message: "Server error",
    });
  }
};
exports.listUsersWithProfiles = async (req, res) => {
  try {

    const users = await sequelize.query(
      `
      SELECT 
        u.id,
        REPLACE(u.name, '.', '') AS name,
        u.email,
        u.phone,
        u.status AS "isActive",
        u.created_at AS "createdAt",
        u.updated_at AS "updatedAt",

        -- address fields from USERS
        u.address_line1,
        u.address_line2,
        u.city,
        u.state,
        u.pin,
        u.full_address,
        u.latitude,
        u.longitude,

        tp.user_id,
        tp.bio,
        tp.service_radius_km,
        tp.qualification,
        tp.id as therapist_id,
        tp.registration_no,
        tp.experience_years as experience,
        tp.hourly_rate as "hourlyRate",
        tp.membership_plan,
        tp.pan_number,
        tp.bank_account_number,
        tp.bank_ifsc_code,
        tp.profile_status,
        tp.specialty,
        tp.is_public_profile as "isProfilePublic",

        tp.created_at AS "profileCreatedAt",
        tp.updated_at AS "profileUpdatedAt",

        media.file_path as image,

        ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name), NULL) AS roles

      FROM users u

      LEFT JOIN therapist_profiles tp 
        ON tp.user_id = u.id

      LEFT JOIN user_roles ur 
        ON ur.user_id = u.id

      LEFT JOIN roles r 
        ON r.id = ur.role_id

      LEFT JOIN media  
        ON tp.profile_image = media.id

      WHERE u.role = 'therapist'

      GROUP BY 
        u.id,
        u.name,
        u.email,
        u.phone,
        u.status,
        u.created_at,
        u.updated_at,

        u.address_line1,
        u.address_line2,
        u.city,
        u.state,
        u.pin,
        u.full_address,
        u.latitude,
        u.longitude,

        tp.id,
        tp.user_id,
        tp.bio,
        tp.service_radius_km,
        tp.qualification,
        tp.registration_no,
        tp.experience_years,
        tp.hourly_rate,
        tp.membership_plan,
        tp.pan_number,
        tp.bank_account_number,
        tp.bank_ifsc_code,
        tp.profile_status,
        tp.specialty,
        tp.is_public_profile,
        tp.created_at,
        tp.updated_at,

        media.file_path

      ORDER BY u.id DESC
      `,
      { type: QueryTypes.SELECT }
    );



    /* =========================
       AVAILABILITY MERGE
    ========================= */

    const therapistIds = users
      .map(u => u.therapist_id)
      .filter(Boolean)
      .map(Number);

    if (therapistIds.length > 0) {

      const availabilities = await sequelize.query(
        `
        SELECT 
          therapist_id,
          day_of_week as "dayOfWeek",

          json_build_object(
            'start', morning_start,
            'end', morning_end,
            'enabled', true
          ) AS morning,

          json_build_object(
            'start', evening_start,
            'end', evening_end,
            'enabled', true
          ) AS evening

        FROM therapist_availability

        WHERE therapist_id = ANY(ARRAY[:ids]::int[])

        ORDER BY therapist_id, day_of_week
        `,
        {
          type: QueryTypes.SELECT,
          replacements: { ids: therapistIds }
        }
      );


      const usersWithAvailability = users.map(user => {

        const userAvail = availabilities
          .filter(a => a.therapist_id === user.therapist_id)
          .reduce((acc, cur) => {

            acc.windows = acc.windows || {};

            acc.windows[cur.dayOfWeek] = {
              morning: cur.morning,
              evening: cur.evening
            };

            return acc;

          }, {});

        return {
          ...user,
          availability: userAvail
        };

      });

      return res.json({
        status: true,
        data: usersWithAvailability
      });
    }

    res.json({
      status: true,
      data: users.map(u => ({ ...u, availability: [] }))
    });

  } catch (error) {

    console.error("listUsersWithProfiles error:", error);

    res.status(500).json({
      status: false,
      message: "Server error"
    });

  }
};


/* =========================
   FIND THERAPIST BY RADIUS
========================= */

// exports.listUsersWithProfilesInRadius = async (req, res) => {
//   try {

//     const { lat, lng } = req.query;

//     if (!lat || !lng) {
//       return res.status(400).json({
//         status: false,
//         message: "Latitude and Longitude required"
//       });
//     }

//     const users = await sequelize.query(
//       `
//       SELECT

//       u.id,
//       REPLACE(u.name,'.','') AS name,
//       u.email,
//       u.phone,

//       -- address from users
//       u.address_line1,
//       u.address_line2,
//       u.city,
//       u.state,
//       u.pin,
//       u.full_address,

//       -- location from users
//       u.latitude,
//       u.longitude,

//       -- therapist profile
//       tp.bio,
//       tp.specialty,
//       tp.hourly_rate,
//       tp.service_radius_km,

//       -- distance calculation
//       ROUND(
//         (
//           6371 * acos(
//             cos(radians(:lat)) *
//             cos(radians(u.latitude)) *
//             cos(radians(u.longitude) - radians(:lng)) +
//             sin(radians(:lat)) *
//             sin(radians(u.latitude))
//           )
//         )::numeric
//       ,2) AS distance_km

//       FROM users u

//       JOIN therapist_profiles tp
//         ON tp.user_id = u.id

//       WHERE 
//         u.role = 'therapist'
//         AND u.latitude IS NOT NULL
//         AND u.longitude IS NOT NULL

//       HAVING
//       (
//         6371 * acos(
//           cos(radians(:lat)) *
//           cos(radians(u.latitude)) *
//           cos(radians(u.longitude) - radians(:lng)) +
//           sin(radians(:lat)) *
//           sin(radians(u.latitude))
//         )
//       ) <= tp.service_radius_km

//       ORDER BY distance_km ASC
//       `,
//       {
//         replacements: { lat, lng },
//         type: QueryTypes.SELECT
//       }
//     );

//     res.json({
//       status: true,
//       data: users
//     });

//   } catch (error) {

//     console.error("listUsersWithProfilesInRadius error:", error);

//     res.status(500).json({
//       status: false,
//       message: "Server Error"
//     });

//   }
// };


exports.listUsersWithProfilesInRadius = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        status: false,
        message: "Latitude and Longitude required"
      });
    }

    const users = await sequelize.query(
      `
      SELECT
        u.id,
        REPLACE(u.name,'.','') AS name,
        u.email,
        u.phone,
        u.address_line1,
        u.address_line2,
        u.city,
        u.state,
        u.pin,
        u.full_address,
        u.latitude,
        u.longitude,
        tp.bio,
        tp.specialty,
        tp.hourly_rate,
        tp.service_radius_km,
        ROUND(
          (
            6371 * acos(
              cos(radians(:lat)) *
              cos(radians(u.latitude)) *
              cos(radians(u.longitude) - radians(:lng)) +
              sin(radians(:lat)) *
              sin(radians(u.latitude))
            )
          )::numeric
        ,2) AS distance_km
      FROM users u
      JOIN therapist_profiles tp
        ON tp.user_id = u.id
      WHERE 
        u.role = 'therapist'
        AND u.latitude IS NOT NULL
        AND u.longitude IS NOT NULL
        AND (
          6371 * acos(
            cos(radians(:lat)) *
            cos(radians(u.latitude)) *
            cos(radians(u.longitude) - radians(:lng)) +
            sin(radians(:lat)) *
            sin(radians(u.latitude))
          )
        ) <= tp.service_radius_km
      ORDER BY distance_km ASC
      `,
      {
        replacements: { lat, lng },
        type: QueryTypes.SELECT
      }
    );

    res.json({
      status: true,
      data: users
    });

  } catch (error) {
    console.error("listUsersWithProfilesInRadius error:", error);
    res.status(500).json({
      status: false,
      message: "Server Error"
    });
  }
};

/* =========================
   SAVE AVAILABILITY
========================= */
exports.saveAvailability = async (req, res) => {
  try {
    const { therapist_id, availability } = req.body;
    await sequelize.query(
      `DELETE FROM therapist_availability WHERE therapist_id = :id`,
      { replacements: { id: therapist_id }, type: QueryTypes.DELETE }
    );

    for (const day in availability) {
      const slot = availability[day];
      await sequelize.query(
        `INSERT INTO therapist_availability (
          therapist_id, day_of_week, is_enabled,
          morning_start, morning_end,
          evening_start, evening_end
        )
        VALUES (:therapist_id, :day, :enabled, :m_start, :m_end, :e_start, :e_end)`,
        {
          replacements: {
            therapist_id,
            day,
            enabled: slot.enabled,
            m_start: slot.morning?.start || null,
            m_end: slot.morning?.end || null,
            e_start: slot.evening?.start || null,
            e_end: slot.evening?.end || null,
          },
          type: QueryTypes.INSERT
        }
      );
    }

    res.json({ status: true, message: "Availability saved" });

  } catch (error) {
    console.error("saveAvailability error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

/* =========================
   UPLOAD DOCUMENT
========================= */
exports.uploadDocument = async (req, res) => {
  try {
    const { therapist_id, document_type, file_url } = req.body;
    const result = await sequelize.query(
      `INSERT INTO therapist_documents (therapist_id, document_type, file_url)
       VALUES (:therapist_id, :document_type, :file_url)
       RETURNING *`,
      { replacements: { therapist_id, document_type, file_url }, type: QueryTypes.INSERT }
    );
    res.status(201).json({ status: true, data: result[0][0] });

  } catch (error) {
    console.error("uploadDocument error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.getAvailability = async (req, res) => {
  try {
    const { therapistId } = req.params;

    const result = await sequelize.query(
      `SELECT * FROM therapist_availability WHERE therapist_id = :id`,
      {
        replacements: { id: therapistId },
        type: QueryTypes.SELECT
      }
    );

    res.json({ status: true, data: result });

  } catch (error) {
    console.error("getAvailability error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};
