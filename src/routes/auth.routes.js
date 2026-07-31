const express = require('express');
const router = express.Router();
const { googleSignIn } = require('../controllers/auth.controller');

router.post('/google', googleSignIn);

module.exports = router;