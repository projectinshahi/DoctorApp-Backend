const express = require('express');
const router = express.Router();

const {
  createRapidRecall, listRapidRecalls, getRapidRecall,
  updateRapidRecall, setRapidRecallCards, deleteRapidRecall,
} = require('../controllers/rapidRecall.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Images and the note document reuse the existing upload endpoints —
// POST /api/uploads/question-image and POST /api/uploads/lesson-note — so
// there is one place that decides which file types are allowed.
router.post('/rapid-recalls', authenticateAdmin, createRapidRecall);
router.get('/rapid-recalls', authenticateAdmin, listRapidRecalls);
router.get('/rapid-recalls/:id', authenticateAdmin, getRapidRecall);
router.patch('/rapid-recalls/:id', authenticateAdmin, updateRapidRecall);
router.put('/rapid-recalls/:id/cards', authenticateAdmin, setRapidRecallCards);
router.delete('/rapid-recalls/:id', authenticateAdmin, deleteRapidRecall);

module.exports = router;
