const express = require('express');
const router = express.Router();

const { getPushStatus } = require('../controllers/pushStatus.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Admin-only: it reports what the server can do, not what any student can see.
router.get('/push/status', authenticateAdmin, getPushStatus);

module.exports = router;
