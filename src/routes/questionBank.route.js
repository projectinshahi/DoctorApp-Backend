const express = require('express');
const router = express.Router();
const {
  createQuestion,
  listQuestions,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  activateOrDeactivateQuestion,
  bulkActivateOrDeactivate,
  bulkCreateQuestions,
  duplicateQuestion,
} = require('../controllers/questionBank.controller');
const { updateTopic } = require('../controllers/subject.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Literal paths before parameterised ones, so /questions/bulk-status is never
// swallowed by /questions/:id.
router.patch('/questions/bulk-status', authenticateAdmin, bulkActivateOrDeactivate);
router.post('/questions/bulk', authenticateAdmin, bulkCreateQuestions);

router.post('/questions', authenticateAdmin, createQuestion);
router.get('/questions', authenticateAdmin, listQuestions);
router.get('/questions/:id', authenticateAdmin, getQuestion);
router.put('/questions/:id', authenticateAdmin, updateQuestion);
router.delete('/questions/:id', authenticateAdmin, deleteQuestion);
router.patch('/questions/:id/status', authenticateAdmin, activateOrDeactivateQuestion);
router.post('/questions/:id/duplicate', authenticateAdmin, duplicateQuestion);

// Topics are created under their subject (see subject.routes.js) but edited by
// their own id.
router.patch('/topics/:id', authenticateAdmin, updateTopic);

module.exports = router;
