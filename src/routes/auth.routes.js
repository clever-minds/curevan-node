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
router.post("/login-with-mobile",responseHandler, auth.loginWithMobile);

router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  (req, res) => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      {
        id: req.user.id,
        uid: req.user.uid,
        email: req.user.email,
        role: req.user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
   res.cookie("token", token, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",  // ✅ CHANGE THIS
        maxAge: 24 * 60 * 60 * 1000,
    });
    console.log("Google OAuth successful, token set in cookie",);

return res.redirect("http://localhost:3000/dashboard/account");

  }
);
module.exports = router;
