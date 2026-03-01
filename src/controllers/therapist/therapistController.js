const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

/* =========================
   REGISTER THERAPIST
========================= */
exports.registerTherapist = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      email, password, fullName, mobile, bio, qualification,
      experienceYears, panNumber, hourlyRate, membershipPlan,
      availability, line1, line2, city, state, pin, fullAddress,
      lat, lng, serviceRadiusKm, registrationNo,
      bankAccountNumber, bankIfscCode, specialty
    } = req.body;

    if (!email || !password || !fullName || !mobile) {
      return res.status(400).json({ status: false, message: "Missing required fields" });
    }

    const hash = await bcrypt.hash(password, 10);
    const uid = uuidv4();

    // Insert into users
    const userResult = await sequelize.query(
      `INSERT INTO users (uid, email, password, name, phone, role)
       VALUES (:uid, :email, :hash, :name, :phone, 'therapist')
       RETURNING *`,
      {
        replacements: { uid, email, hash, name: fullName, phone: mobile },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );
    const user = userResult[0][0];

    // Format specialty for Postgres text[]
    const pgSpecialty = Array.isArray(specialty)
      ? `{${specialty.join(',')}}`
      : `{${(specialty || '').split('/').join(',')}}`;

    // Insert into therapist_profiles
    const profileResult = await sequelize.query(
      `INSERT INTO therapist_profiles (
         user_id, bio, service_radius_km,
         address_line1, address_line2, city, state, pin,
         qualification, registration_no, experience_years,
         hourly_rate, membership_plan, pan_number,
         bank_account_number, bank_ifsc_code, specialty,
         full_address, latitude, longitude
       )
       VALUES (
         :user_id, :bio, :service_radius_km,
         :address_line1, :address_line2, :city, :state, :pin,
         :qualification, :registration_no, :experience_years,
         :hourly_rate, :membership_plan, :pan_number,
         :bank_account_number, :bank_ifsc_code, :specialty,
         :fullAddress, :lat, :lng
       )
       RETURNING *`,
      {
        replacements: {
          user_id: user.id,
          bio: bio || '',
          service_radius_km: serviceRadiusKm || 10,
          address_line1: line1 || '',
          address_line2: line2 || '',
          city: city || '',
          state: state || '',
          pin: pin || '',
          qualification: qualification || '',
          registration_no: registrationNo || '',
          experience_years: experienceYears || 0,
          hourly_rate: hourlyRate || 0,
          membership_plan: membershipPlan || '',
          pan_number: panNumber || '',
          bank_account_number: bankAccountNumber || '',
          bank_ifsc_code: bankIfscCode || '',
          specialty: pgSpecialty,
          fullAddress: fullAddress || '',
          lat: lat || 0,
          lng: lng || 0
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const therapist = profileResult[0][0];

    // Insert availability
    if (availability) {
      for (const day in availability) {
        const slot = availability[day];
        await sequelize.query(
          `INSERT INTO therapist_availability (
             therapist_id, day_of_week, is_enabled,
             morning_start, morning_end,
             evening_start, evening_end
           )
           VALUES (
             :therapist_id, :day, :enabled,
             :m_start, :m_end,
             :e_start, :e_end
           )`,
          {
            replacements: {
              therapist_id: therapist.id,
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
    res.status(201).json({ status: true, message: "Therapist registered successfully", data: therapist });

  } catch (error) {
    await t.rollback();
    console.error("registerTherapist error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};


/* =========================
   UPDATE PROFILE
========================= */
exports.updateProfile = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { userId } = req.params;
    const {
      email, password, fullName, mobile, bio, qualification,
      experienceYears, panNumber, hourlyRate, membershipPlan,
      availability, line1, line2, city, state, pin, fullAddress,
      lat, lng, profileImageId, kycIdProof, kycLicense, kycBankProof,
      serviceRadiusKm, registrationNo, bankAccountNumber, bankIfscCode,
      specialty
    } = req.body;

    // Check user exists
    const existingUser = await sequelize.query(
      `SELECT * FROM users WHERE id = :id`,
      { replacements: { id: userId }, type: QueryTypes.SELECT, transaction: t }
    );
    if (!existingUser.length) {
      await t.rollback();
      return res.status(404).json({ status: false, message: "User not found" });
    }

    // Update users table
    let updateUserFields = `email = :email, name = :name, phone = :phone`;
    const userReplacements = { id: userId, email, name: fullName, phone: mobile };
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updateUserFields += `, password = :password`;
      userReplacements.password = hash;
    }
    await sequelize.query(
      `UPDATE users SET ${updateUserFields} WHERE id = :id`,
      { replacements: userReplacements, type: QueryTypes.UPDATE, transaction: t }
    );

    // Format specialty for Postgres text[]
    const pgSpecialty = Array.isArray(specialty)
      ? `{${specialty.join(',')}}`
      : `{${(specialty || '').split('/').join(',')}}`;

    // Update therapist_profiles
    let updateFields = `
      bio = :bio,
      full_address = :fullAddress,
      latitude = :lat,
      longitude = :lng,
      address_line1 = :line1,
      address_line2 = :line2,
      city = :city,
      state = :state,
      pin = :pin,
      qualification = :qualification,
      experience_years = :experienceYears,
      hourly_rate = :hourlyRate,
      membership_plan = :membershipPlan,
      pan_number = :panNumber,
      service_radius_km = :serviceRadiusKm,
      registration_no = :registrationNo,
      bank_account_number = :bankAccountNumber,
      bank_ifsc_code = :bankIfscCode,
      specialty = :specialty
    `;
    const replacements = {
      user_id: userId,
      bio: bio || '',
      fullAddress: fullAddress || '',
      lat: lat || 0,
      lng: lng || 0,
      line1: line1 || '',
      line2: line2 || '',
      city: city || '',
      state: state || '',
      pin: pin || '',
      qualification: qualification || '',
      experienceYears: experienceYears || 0,
      hourlyRate: hourlyRate || 0,
      membershipPlan: membershipPlan || '',
      panNumber: panNumber || '',
      serviceRadiusKm: serviceRadiusKm || 10,
      registrationNo: registrationNo || '',
      bankAccountNumber: bankAccountNumber || '',
      bankIfscCode: bankIfscCode || '',
      specialty: pgSpecialty
    };
    if (profileImageId) { updateFields += `, profile_image = :profileImageId`; replacements.profileImageId = profileImageId; }
    if (kycIdProof) { updateFields += `, kyc_id_proof = :kycIdProof`; replacements.kycIdProof = kycIdProof; }
    if (kycLicense) { updateFields += `, kyc_license = :kycLicense`; replacements.kycLicense = kycLicense; }
    if (kycBankProof) { updateFields += `, kyc_bank_proof = :kycBankProof`; replacements.kycBankProof = kycBankProof; }

    await sequelize.query(
      `UPDATE therapist_profiles SET ${updateFields} WHERE user_id = :user_id`,
      { replacements, type: QueryTypes.UPDATE, transaction: t }
    );

    // Update availability
    if (availability) {
      await sequelize.query(
        `DELETE FROM therapist_availability WHERE therapist_id = 
         (SELECT id FROM therapist_profiles WHERE user_id = :user_id)`,
        { replacements: { user_id: userId }, type: QueryTypes.DELETE, transaction: t }
      );
      const therapistProfile = await sequelize.query(
        `SELECT id FROM therapist_profiles WHERE user_id = :user_id`,
        { replacements: { user_id: userId }, type: QueryTypes.SELECT, transaction: t }
      );
      const therapistId = therapistProfile[0].id;

      for (const day in availability) {
        const slot = availability[day];
        await sequelize.query(
          `INSERT INTO therapist_availability (
             therapist_id, day_of_week, is_enabled,
             morning_start, morning_end,
             evening_start, evening_end
           )
           VALUES (
             :therapist_id, :day, :enabled,
             :m_start, :m_end,
             :e_start, :e_end
           )`,
          {
            replacements: {
              therapist_id: therapistId,
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
    res.json({ status: true, message: "Therapist updated successfully" });

  } catch (error) {
    await t.rollback();
    console.error("updateProfile error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

/* =========================
   GET PROFILE
========================= */
exports.getProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await sequelize.query(
      `SELECT tp.*, u.email, u.name, u.phone, tp.experience_years as experience,
              tp.full_address as "fullAddress", latitude as lat, longitude as lng
       FROM therapist_profiles tp
       JOIN users u ON u.id = tp.user_id
       WHERE tp.user_id = :userId`,
      { replacements: { userId }, type: QueryTypes.SELECT }
    );

    if (!result.length) return res.status(404).json({ status: false, message: "Profile not found" });

    const profile = result[0];

    // Convert specialty back to array
    profile.specialty = profile.specialty ? profile.specialty.replace(/[{}]/g, '').split(',') : [];

    // Get availability
    const availabilityResult = await sequelize.query(
      `SELECT * FROM therapist_availability WHERE therapist_id = :profileId`,
      { replacements: { profileId: profile.id }, type: QueryTypes.SELECT }
    );

    const availability = {};
    availabilityResult.forEach(row => {
      availability[row.day_of_week] = {
        enabled: !!row.is_enabled,
        morning: { start: row.morning_start?.slice(0,5), end: row.morning_end?.slice(0,5) },
        evening: { start: row.evening_start?.slice(0,5), end: row.evening_end?.slice(0,5) },
      };
    });

    res.json({ status: true, data: { ...profile, availability } });

  } catch (error) {
    console.error("getProfile error:", error);
    res.status(500).json({ status: false, message: "Server error" });
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

// exports.listUsersWithProfiles = async (req, res) => {
//   try {
//     const users = await sequelize.query(
//       `
//       SELECT 
//     u.id,
//     REPLACE(u.name, '.', '') AS name,
//     u.email,
//     u.phone,
//     u.status AS "isActive",
//     u.created_at AS "createdAt",
//     u.updated_at AS "updatedAt",
//     tp.user_id,
//     tp.bio,
//     tp.image,
//     tp.service_radius_km,
//     tp.address_line1,
//     tp.address_line2,
//     tp.city,
//     tp.state,
//     tp.pin,
//     tp.qualification,
//     tp.registration_no,
//     tp.experience_years as experience,
//     tp.hourly_rate,
//     tp.membership_plan,
//     tp.pan_number,
//     tp.bank_account_number,
//     tp.bank_ifsc_code,
//     tp.profile_status,
//     tp.created_at AS "profileCreatedAt",
//     tp.updated_at AS "profileUpdatedAt",
//     tp.latitude,
//     tp.longitude,
//     tp.specialty,
//       tp.is_public_profile as "isProfilePublic",
//     ARRAY_REMOVE(ARRAY_AGG(r.name), NULL) AS roles
// FROM users u
// LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
// LEFT JOIN user_roles ur ON ur.user_id = u.id
// LEFT JOIN roles r ON r.id = ur.role_id  where u.role = 'therapist'
// GROUP BY 
//     u.id, u.name, u.email, u.phone, u.status, u.created_at, u.updated_at, tp.is_public_profile,
//     tp.user_id, tp.bio, tp.image, tp.service_radius_km, tp.address_line1, tp.address_line2,
//     tp.city, tp.state, tp.pin, tp.qualification, tp.registration_no, tp.experience_years ,
//     tp.hourly_rate, tp.membership_plan, tp.pan_number, tp.bank_account_number, tp.bank_ifsc_code,
//     tp.profile_status, tp.created_at, tp.updated_at,tp.specialty, tp.latitude, tp.longitude
// ORDER BY u.id DESC
//       `,
//       {
//         type: QueryTypes.SELECT,
//       }
//     );

//     res.json({ status: true, data: users });
//   } catch (error) {
//     console.error("listUsersWithProfiles error:", error);
//     res.status(500).json({ status: false, message: "Server error" });
//   }
// };



// 1️⃣ Users + Profiles fetch
exports.listUsersWithProfiles = async (req, res) => {
  try {
    // 1️⃣ Users + profiles + roles fetch
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
        tp.user_id,
        tp.bio,
        tp.image,
        tp.service_radius_km,
        tp.address_line1,
        tp.address_line2,
        tp.city,
        tp.state,
        tp.pin,
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
        tp.created_at AS "profileCreatedAt",
        tp.updated_at AS "profileUpdatedAt",
        tp.latitude,
        tp.longitude,
        tp.specialty,
        tp.is_public_profile as "isProfilePublic",
        media.file_path as image,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.name), NULL) AS roles
      FROM users u
      LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
    LEFT JOIN media  ON tp.profile_image = media.id
      WHERE u.role = 'therapist'
      GROUP BY 
        u.id,tp.id, u.name, u.email, u.phone, u.status, u.created_at, u.updated_at,
        tp.user_id, tp.bio, tp.image, tp.service_radius_km, tp.address_line1, tp.address_line2,
        tp.city, tp.state, tp.pin, tp.qualification, tp.registration_no, tp.experience_years,
        tp.hourly_rate, tp.membership_plan, tp.pan_number, tp.bank_account_number, tp.bank_ifsc_code,
        tp.profile_status, tp.created_at, tp.updated_at, tp.specialty, tp.latitude, tp.longitude, media.file_path,
        tp.is_public_profile
      ORDER BY u.id DESC
      `,
      { type: QueryTypes.SELECT }
    );

    // 2️⃣ Therapist IDs array
    const therapistIds = users.map(u => u.therapist_id).filter(Boolean).map(Number);

    if (therapistIds.length > 0) {
      // 3️⃣ Fetch all availabilities
     const availabilities = await sequelize.query(
          `
          SELECT therapist_id,
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
            replacements: { ids: therapistIds },
          }
        );
      // 4️⃣ Merge availability into users
     const usersWithAvailability = users.map(user => {
        const userAvail = availabilities
          .filter(a => a.therapist_id === user.therapist_id)
          .reduce((acc, cur) => {
            acc.windows = acc.windows || {};
            acc.windows[cur.dayOfWeek] = {
              morning: cur.morning,
              evening: cur.evening,
            };
            return acc;
          }, {}); // acc starts as empty object
        return { ...user, availability: userAvail };
      });

      return res.json({ status: true, data: usersWithAvailability });
    }

    // Agar koi therapist ID nahi mili
    res.json({ status: true, data: users.map(u => ({ ...u, availability: [] })) });

  } catch (error) {
    console.error("listUsersWithProfiles error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};
/* =========================
   GET PROFILE
========================= */
exports.getProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    // 1️⃣ Get main profile
    const result = await sequelize.query(
      `
      SELECT tp.*, u.email, u.name, u.phone, tp.experience_years as experience,tp.full_address as "fullAddress" ,latitude as lat, longitude as lng
      FROM therapist_profiles tp
      JOIN users u ON u.id = tp.user_id
      WHERE tp.user_id = :userId
      `,
      {
        replacements: { userId },
        type: QueryTypes.SELECT
      }
    );

    if (!result.length)
      return res.status(404).json({ status: false, message: "Profile not found" });

    const profile = result[0];

    // 2️⃣ Get availability
    const availabilityResult = await sequelize.query(
      `
      SELECT *
      FROM therapist_availability
      WHERE therapist_id = :profileId
      `,
      {
        replacements: { profileId: profile.id }, // use profile.id
        type: QueryTypes.SELECT
      }
    );

    // 3️⃣ Map availability to object
   const availability = {};
   availabilityResult.forEach(row => {
      availability[row.day_of_week] = {
        enabled: !!row.is_enabled,
        morning: { start: row.morning_start?.slice(0,5), end: row.morning_end?.slice(0,5) },
        evening: { start: row.evening_start?.slice(0,5), end: row.evening_end?.slice(0,5) },
      };
    });

    // 4️⃣ Return combined object
    res.json({ 
      status: true, 
      data: {
        ...profile,
        availability,
      }
    });

  } catch (error) {
    console.error("getProfile error:", error);
    res.status(500).json({ status: false, message: "Server error" });
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
        `
        INSERT INTO therapist_availability (
          therapist_id, day_of_week, is_enabled,
          morning_start, morning_end,
          evening_start, evening_end
        )
        VALUES (
          :therapist_id, :day, :enabled,
          :m_start, :m_end,
          :e_start, :e_end
        )
        `,
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
   GET AVAILABILITY
========================= */
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


/* =========================
   UPLOAD DOCUMENT
========================= */
exports.uploadDocument = async (req, res) => {
  try {
    const { therapist_id, document_type, file_url } = req.body;

    const result = await sequelize.query(
      `
      INSERT INTO therapist_documents (
        therapist_id, document_type, file_url
      )
      VALUES (:therapist_id, :document_type, :file_url)
      RETURNING *
      `,
      {
        replacements: { therapist_id, document_type, file_url },
        type: QueryTypes.INSERT
      }
    );

    res.status(201).json({
      status: true,
      data: result[0][0]
    });

  } catch (error) {
    console.error("uploadDocument error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

exports.listUsersWithProfilesInRadius = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        status: false,
        message: "Latitude and Longitude required",
      });
    }

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
        tp.user_id,
        tp.bio,
        tp.image,
        tp.service_radius_km,
        tp.address_line1,
        tp.address_line2,
        tp.city,
        tp.state,
        tp.pin,
        tp.qualification,
        tp.registration_no,
        tp.experience_years as experience,
        tp.hourly_rate as "hourlyRate",
        tp.membership_plan,
        tp.pan_number,
        tp.bank_account_number,
        tp.bank_ifsc_code,
        tp.profile_status,
        tp.created_at AS "profileCreatedAt",
        tp.updated_at AS "profileUpdatedAt",
        tp.latitude,
        tp.longitude,
        tp.specialty,
        tp.is_public_profile as "isProfilePublic",
        media.file_path as image,
        -- Distance calculation (Haversine formula)
     ROUND((
          6371 * acos(
            cos(radians(:lat)) *
            cos(radians(tp.latitude)) *
            cos(radians(tp.longitude) - radians(:lng)) +
            sin(radians(:lat)) *
            sin(radians(tp.latitude))
          )
        )::numeric,2) AS distance_km,

        ARRAY_REMOVE(ARRAY_AGG(r.name), NULL) AS roles

      FROM users u
      LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
      LEFT JOIN media  ON tp.profile_image = media.id

      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id

      WHERE u.role = 'therapist'
      AND tp.latitude IS NOT NULL
      AND tp.longitude IS NOT NULL

      GROUP BY 
        u.id, u.name, u.email, u.phone, u.status, u.created_at, u.updated_at, tp.is_public_profile,
        tp.user_id, tp.bio, tp.image, tp.service_radius_km, tp.address_line1, tp.address_line2,
        tp.city, tp.state, tp.pin, tp.qualification, tp.registration_no, tp.experience_years,
        tp.hourly_rate, tp.membership_plan, tp.pan_number, tp.bank_account_number, tp.bank_ifsc_code,
        tp.profile_status, tp.created_at, tp.updated_at,tp.specialty, tp.latitude, tp.longitude,media.file_path

      HAVING (
          6371 * acos(
            cos(radians(:lat)) *
            cos(radians(tp.latitude)) *
            cos(radians(tp.longitude) - radians(:lng)) +
            sin(radians(:lat)) *
            sin(radians(tp.latitude))
          )
      ) <= tp.service_radius_km

      ORDER BY distance_km ASC
      `,
      {
        replacements: { lat, lng },
        type: QueryTypes.SELECT,
      }
    );

    res.json({ status: true, data: users });

  } catch (error) {
    console.error("listUsersWithProfilesInRadius error:", error);
    res.status(500).json({ status: false, message: "Server error" });
  }
};