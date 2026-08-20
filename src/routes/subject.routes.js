const express = require('express');
const router = express.Router();
const {
  listSubjects,
  createSubject,
  updateSubject,
  listTopicsForSubject,
  createTopic,
} = require('../controllers/subject.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

router.get('/', authenticateAdmin, listSubjects);
router.post('/', authenticateAdmin, createSubject);
router.patch('/:id', authenticateAdmin, updateSubject);

router.get('/:subjectId/topics', authenticateAdmin, listTopicsForSubject);
router.post('/:subjectId/topics', authenticateAdmin, createTopic);

module.exports = router;
