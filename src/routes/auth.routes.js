
const express = require('express');
const router = express.Router();
const { googleSignIn, refreshAccessToken, logout } = require('../controllers/auth.controller');
const { adminLogin } = require('../controllers/adminAuth.controller');
const authenticateStudent = require('../middleware/authenticateStudent'); // adjust path

router.post('/google', googleSignIn);
router.post('/admin/login', adminLogin);
router.post('/refresh', refreshAccessToken); // NEW — no auth middleware, the refresh token itself is the credential
router.post('/logout', authenticateStudent, logout);

module.exports = router;