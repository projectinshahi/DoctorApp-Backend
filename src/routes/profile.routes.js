const express = require('express');
const router = express.Router();
const { getProfile, updateProfile } = require('../controllers/profile.controller');
const { getStudentLesson, getStudentQuizQuestions, submitStudentQuiz } = require('../controllers/selected-course.controller');
const {
  startAttempt, saveAnswer, finishAttempt, getAttempt, listAttempts,
} = require('../controllers/quizAttempt.controller');
const authenticateStudent = require('../middleware/authenticateStudent');

router.get('/', authenticateStudent, getProfile);
router.put('/', authenticateStudent, updateProfile);

// Mounted under /api/users/me -> GET /api/users/me/lessons/:id
router.get('/lessons/:id', authenticateStudent, getStudentLesson);
// Quiz content for a quiz-type lesson, behind the same published/unlock gates.
router.get('/lessons/:id/quiz-questions', authenticateStudent, getStudentQuizQuestions);
// Scoring happens here, not in the app — this is the only student route that
// returns correct answers and explanations, and only for answers submitted.
router.post('/lessons/:id/quiz-submit', authenticateStudent, submitStudentQuiz);

// Marrow-style attempt flow: start, answer one at a time, review at the end.
router.post('/lessons/:id/quiz-attempts', authenticateStudent, startAttempt);
router.get('/lessons/:id/quiz-attempts', authenticateStudent, listAttempts);
router.post('/quiz-attempts/:attemptId/answers', authenticateStudent, saveAnswer);
router.post('/quiz-attempts/:attemptId/finish', authenticateStudent, finishAttempt);
router.get('/quiz-attempts/:attemptId', authenticateStudent, getAttempt);

module.exports = router;