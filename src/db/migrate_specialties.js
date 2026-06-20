const { sequelize } = require('../config/db');

async function migrate() {
  try {
    const serviceTypes = await sequelize.query('SELECT id, name FROM service_types', { type: sequelize.QueryTypes.SELECT });
    const nameToId = {};
    serviceTypes.forEach(st => { nameToId[st.name] = st.id; });

    const profiles = await sequelize.query('SELECT user_id, specialty FROM therapist_profiles', { type: sequelize.QueryTypes.SELECT });

    for (const p of profiles) {
      if (!p.specialty) continue;
      
      let arr = [];
      if (Array.isArray(p.specialty)) {
        arr = p.specialty;
      } else {
        arr = p.specialty.replace(/[{}]/g, '').split(',');
      }

      const newArr = arr.map(s => nameToId[s] || s);
      
      const pgArr = `{${newArr.join(',')}}`;
      await sequelize.query('UPDATE therapist_profiles SET specialty = :pgArr WHERE user_id = :user_id', {
        replacements: { pgArr, user_id: p.user_id },
        type: sequelize.QueryTypes.UPDATE
      });
    }
    console.log("Migration done");
  } catch(e) {
    console.error(e);
  } finally {
    process.exit();
  }
}
migrate();
