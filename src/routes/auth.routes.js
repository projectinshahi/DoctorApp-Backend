const express = require('express');
const router = express.Router();
const { googleSignIn } = require('../controllers/auth.controller');
const { adminLogin } = require('../controllers/adminAuth.controller');

router.post('/google', googleSignIn);
router.post('/admin/login', adminLogin);

module.exports = router;