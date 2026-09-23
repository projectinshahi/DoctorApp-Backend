const express = require('express');
const router = express.Router();

const { listWebUsers, getWebUser, listWebReviews } = require('../controllers/webUser.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Read-only, admin-only: these rows carry people's email addresses and phone
// numbers, and the website owns the tables behind them.
router.get('/web-users', authenticateAdmin, listWebUsers);
router.get('/web-users/:id', authenticateAdmin, getWebUser);
router.get('/web-reviews', authenticateAdmin, listWebReviews);

module.exports = router;
