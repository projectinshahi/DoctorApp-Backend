const express = require('express');
const router = express.Router();
const { getProfile, updateProfile } = require('../controllers/profile.controller');
const authenticateStudent = require('../middleware/authenticateStudent');

router.get('/', authenticateStudent, getProfile);
router.put('/', authenticateStudent, updateProfile);

module.exports = router;