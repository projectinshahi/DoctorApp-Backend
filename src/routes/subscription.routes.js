const express = require('express');
const router = express.Router();
const { getMySubscriptionStatus } = require('../controllers/subscription.controller');
const authenticateStudent = require('../middleware/authenticateStudent');

router.get('/', authenticateStudent, getMySubscriptionStatus);

module.exports = router;