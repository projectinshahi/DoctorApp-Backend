const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/test-error', (req, res, next) => {
  next({ status: 400, message: 'Test error' });
});

module.exports = router;