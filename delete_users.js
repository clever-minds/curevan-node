const { sequelize } = require('./src/config/db.js');

async function deleteUsers() {
  try {
    const emails = ['anikmalik_1605@yahoo.com', 'anik_malik@yahoo.com'];
    
    // Find users
    const [users] = await sequelize.query(
      `SELECT id FROM users WHERE email IN (:emails)`,
      { replacements: { emails } }
    );
    
    if (users.length === 0) {
      console.log('Users not found in the database.');
      process.exit(0);
    }
    
    const userIds = users.map(u => u.id);
    console.log('Found user IDs:', userIds);
    
    // Delete from related tables
    await sequelize.query(`DELETE FROM user_roles WHERE user_id IN (:userIds)`, { replacements: { userIds } });
    await sequelize.query(`DELETE FROM therapist_profiles WHERE user_id IN (:userIds)`, { replacements: { userIds } });
    await sequelize.query(`DELETE FROM change_requests WHERE user_id IN (:userIds)`, { replacements: { userIds } });
    await sequelize.query(`DELETE FROM pcr WHERE therapist_id IN (:userIds)`, { replacements: { userIds } });
    
    // Delete users
    await sequelize.query(`DELETE FROM users WHERE id IN (:userIds)`, { replacements: { userIds } });
    
    console.log('Successfully deleted the users!');
    process.exit(0);
  } catch (error) {
    console.error('Error deleting users:', error);
    process.exit(1);
  }
}

deleteUsers();
