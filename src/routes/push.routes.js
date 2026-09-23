const express = require('express');
const router = express.Router();

const { getPushStatus } = require('../controllers/pushStatus.controller');
const { sendNotification } = require('../controllers/notification.controller');
const { sendExpiryReminders } = require('../controllers/expiryReminder.controller');
const authenticateCron = require('../middleware/authenticateCron');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Admin-only: it reports what the server can do, not what any student can see.
router.get('/push/status', authenticateAdmin, getPushStatus);

// An announcement typed by an admin, to one course's students or to everyone.
router.post('/notifications', authenticateAdmin, sendNotification);

// Called on a schedule from outside (GitHub Actions), or by an admin who wants
// the reminders out now. Render's free tier has no cron and sleeps when idle,
// so the clock cannot live in this process.
router.post('/notifications/expiry-reminders', authenticateCron, sendExpiryReminders);

module.exports = router;
