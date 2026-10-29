
const express = require('express');
const router = express.Router();
const { googleSignIn, appleSignIn, refreshAccessToken, logout } = require('../controllers/auth.controller');
const { adminLogin } = require('../controllers/adminAuth.controller');
const authenticateStudent = require('../middleware/authenticateStudent'); // adjust path

router.post('/google', googleSignIn);
router.post('/apple', appleSignIn);
// Android's Apple sign-in runs in a browser. Apple form-posts the result
// here, and this hands it straight back to the app; the token in it is then
// checked by POST /apple like any other.
router.post('/apple/callback', express.urlencoded({ extended: false }), (req, res) => {
  const params = new URLSearchParams(req.body).toString();
  res.redirect(307, `intent://callback?${params}#Intent;package=com.keerthana.dr_app;scheme=signinwithapple;end`);
});
router.post('/admin/login', adminLogin);
router.post('/refresh', refreshAccessToken); // NEW — no auth middleware, the refresh token itself is the credential
router.post('/logout', authenticateStudent, logout);

module.exports = router;