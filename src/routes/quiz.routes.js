const express = require('express');
const router = express.Router();
const {
  createQuiz,
  listQuizzes,
  getQuiz,
  updateQuiz,
  deleteQuiz,
  serveLessonQuizQuestions,
  previewQuizQuestions,
  listQuizQuestions,
  setQuizQuestions,
  addQuizQuestions,
  removeQuizQuestion,
} = require('../controllers/quiz.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

router.post('/quizzes', authenticateAdmin, createQuiz);
router.get('/quizzes', authenticateAdmin, listQuizzes);
router.get('/quizzes/:id', authenticateAdmin, getQuiz);
// Answer-key preview for the admin, before publishing the lesson that serves it.
router.get('/quizzes/:id/preview', authenticateAdmin, previewQuizQuestions);

// Pinned questions. A quiz with none of these keeps using its filter.
router.get('/quizzes/:id/questions', authenticateAdmin, listQuizQuestions);
router.put('/quizzes/:id/questions', authenticateAdmin, setQuizQuestions);
router.post('/quizzes/:id/questions', authenticateAdmin, addQuizQuestions);
router.delete('/quizzes/:id/questions/:questionId', authenticateAdmin, removeQuizQuestion);
router.patch('/quizzes/:id', authenticateAdmin, updateQuiz);
router.delete('/quizzes/:id', authenticateAdmin, deleteQuiz);

// Lesson-scoped, but it is quiz logic, so it lives here rather than splitting
// quiz.controller across two route files.
// ponytail: admin-only for now — there is no reusable student lesson-access
// gate (plan/subscription check) yet. Swap in authenticateStudent + that gate
// once it exists; the handler itself needs no change.
router.get('/lessons/:id/quiz-questions', authenticateAdmin, serveLessonQuizQuestions);

module.exports = router;
