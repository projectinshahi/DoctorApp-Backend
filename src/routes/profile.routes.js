const express = require('express');
const router = express.Router();
const { getProfile, updateProfile } = require('../controllers/profile.controller');
const { getStudentLesson, getStudentQuizQuestions } = require('../controllers/selected-course.controller');
const authenticateStudent = require('../middleware/authenticateStudent');

router.get('/', authenticateStudent, getProfile);
router.put('/', authenticateStudent, updateProfile);

// Mounted under /api/users/me -> GET /api/users/me/lessons/:id
router.get('/lessons/:id', authenticateStudent, getStudentLesson);
// Quiz content for a quiz-type lesson, behind the same published/unlock gates.
router.get('/lessons/:id/quiz-questions', authenticateStudent, getStudentQuizQuestions);

module.exports = router;