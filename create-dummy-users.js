const { sequelize } = require('./src/config/db');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('Connected to PostgreSQL database');

    const dummyPassword = await bcrypt.hash('password123', 10);

    console.log('Creating Therapist...');
    const therapistUid = uuidv4();
    const [therapistResult] = await sequelize.query(
      `INSERT INTO users (uid, name, email, password, role, status, created_at, updated_at) 
       VALUES (:uid, 'Dummy Therapist', 'therapist@curevan.com', :password, 'therapist', 'active', NOW(), NOW())
       RETURNING id`,
      { replacements: { uid: therapistUid, password: dummyPassword }, type: sequelize.QueryTypes.INSERT }
    );
    const therapistId = therapistResult[0].id;
    
    await sequelize.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES (:id, 7)`,
      { replacements: { id: therapistId }, type: sequelize.QueryTypes.INSERT }
    );

    await sequelize.query(
      `INSERT INTO therapist_profiles 
       (user_id, name, specialty, address_line1, city, state, pin, country, latitude, longitude, experience_years, bio) 
       VALUES (:id, 'Dummy Therapist', '{1,2,4}', 'Ashwamegh Nagar, Tandalja, Near Fire Brigade', 'Vadodara', 'Gujarat', '390012', 'India', 22.2882, 73.1585, 5, 'Dummy therapist profile')`,
      { replacements: { id: therapistId }, type: sequelize.QueryTypes.INSERT }
    );
    console.log(`Created therapist user with id ${therapistId}`);


    console.log('Creating Patient...');
    const patientUid = uuidv4();
    const [patientResult] = await sequelize.query(
      `INSERT INTO users (uid, name, email, password, role, status, created_at, updated_at) 
       VALUES (:uid, 'Dummy Patient', 'user@curevan.com', :password, 'patient', 'active', NOW(), NOW())
       RETURNING id`,
      { replacements: { uid: patientUid, password: dummyPassword }, type: sequelize.QueryTypes.INSERT }
    );
    const patientId = patientResult[0].id;

    await sequelize.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES (:id, 2)`,
      { replacements: { id: patientId }, type: sequelize.QueryTypes.INSERT }
    );
    console.log(`Created patient user with id ${patientId}`);


    console.log('Finished dummy user creation in PostgreSQL!');
    process.exit(0);

  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      console.log('Users already exist in the database.');
    } else {
      console.error('Error inserting dummy users:', error);
    }
    process.exit(1);
  }
}

run();
