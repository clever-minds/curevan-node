const express = require('express');
const router = express.Router();
const auth = require('../controllers/auth/authController');
const authMiddleware = require('../middlewares/authMiddleware');
const passport = require('../config/passport');
const responseHandler = require("../middlewares/responseHandler");

console.log("authMiddleware =>", authMiddleware);

router.post('/register', auth.register);
router.post('/login', auth.login);
router.get('/profile', authMiddleware, auth.getUserProfile);
router.get('/me', authMiddleware, auth.getMe);
router.post("/logout", auth.logout);
router.post("/login-with-mobile", responseHandler, auth.loginWithMobile);
router.post("/verify-email", responseHandler, auth.verifyEmail);
router.post("/resend-verification", responseHandler, auth.resendVerificationEmail);
router.post("/change-password", authMiddleware, responseHandler, auth.changePassword);

router.post("/forgot-password", responseHandler, auth.forgotPassword);

router.post("/reset-password", responseHandler, auth.resetPassword);

router.put("/update-profile", authMiddleware, responseHandler, auth.updateUserProfile);

router.put("/update-fcm-token", authMiddleware, auth.updateFcmToken);

router.post("/change-profile-request", authMiddleware, responseHandler, auth.createChangeRequest);

router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  async (req, res) => {
    const jwt = require('jsonwebtoken');
    const { sequelize } = require('../config/db');
    // same token shape as every other login: id, uid, email, role AND the roles array
    const roleRows = await sequelize.query(
      'SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = :id',
      { replacements: { id: req.user.id }, type: sequelize.QueryTypes.SELECT }
    );
    const token = jwt.sign(
      {
        id: req.user.id,
        uid: req.user.uid,
        email: req.user.email,
        role: req.user.role,
        roles: roleRows.map((r) => r.name)
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      domain: ".curevan.com",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });
    console.log("Google OAuth successful, token set in cookie",);

    return res.redirect(`${process.env.FRONTEND_URL}/dashboard/account`);
  }
);
module.exports = router;
