const express = require('express');
const router = express.Router();

const { getPushStatus } = require('../controllers/pushStatus.controller');
const { sendNotification } = require('../controllers/notification.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Admin-only: it reports what the server can do, not what any student can see.
router.get('/push/status', authenticateAdmin, getPushStatus);

// An announcement typed by an admin, to one course's students or to everyone.
router.post('/notifications', authenticateAdmin, sendNotification);

module.exports = router;
