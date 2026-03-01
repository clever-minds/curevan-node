const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { sequelize } = require('./db');
const { QueryTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: 'http://localhost:5000/api/auth/google/callback',
    },
   async (accessToken, refreshToken, profile, done) => {
        const transaction = await sequelize.transaction();

        try {
            let users = await sequelize.query(
            `SELECT id FROM users WHERE email = :email`,
            { 
                replacements: { email: profile.emails[0].value }, 
                type: QueryTypes.SELECT,
                transaction
            }
            );

            let user;
            if (!users.length) {
            // 🔑 custom readable UID

            const uid = uuidv4();

            const [newUser] = await sequelize.query(
                `INSERT INTO users (uid, name, email, role)
                VALUES (:uid, :name, :email, :role)
                RETURNING id, uid, name, email, role`,
                {
                replacements: {
                    uid,
                    name: profile.displayName,
                    email: profile.emails[0].value,
                    role: 'patient',
                },
                type: QueryTypes.INSERT,
                transaction
                }
            );
            user = newUser[0];

            // Optional: Assign default roles if needed
            const defaultRoles = ['patient']; // or whatever default roles

            for (const roleName of defaultRoles) {
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
                    replacements: { user_id: user.id, role_id: roleRes[0].id },
                    type: QueryTypes.INSERT,
                    transaction
                }
                );
            }
            } else {
            user = users[0];
            }

            await transaction.commit();
            return done(null, user);

        } catch (err) {
            await transaction.rollback();
            return done(err, null);
        }
    }
  )
);

module.exports = passport;
