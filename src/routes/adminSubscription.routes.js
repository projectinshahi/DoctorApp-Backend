const express = require('express');
const router = express.Router();

const {
  listSubscriptions, subscriptionSummary, getSubscription,
} = require('../controllers/adminSubscription.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Before /:id, or "summary" is read as an id.
router.get('/subscriptions/summary', authenticateAdmin, subscriptionSummary);
router.get('/subscriptions', authenticateAdmin, listSubscriptions);
router.get('/subscriptions/:id', authenticateAdmin, getSubscription);

module.exports = router;
