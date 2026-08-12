const express = require('express');
const router = express.Router();
const { subscribeToplan } = require('../controllers/subscribe.controller');
const authenticateStudent = require('../middleware/authenticateStudent');

router.post('/', authenticateStudent, subscribeToplan);

module.exports = router;