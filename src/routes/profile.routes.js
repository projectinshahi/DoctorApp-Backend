const express = require('express');
const router = express.Router();
const { getProfile, updateProfile } = require('../controllers/profile.controller');
const { getStudentLesson, getStudentQuizQuestions, submitStudentQuiz } = require('../controllers/selected-course.controller');
const {
  startAttempt, saveAnswer, finishAttempt, getAttempt, listAttempts, listInProgress,
} = require('../controllers/quizAttempt.controller');
const {
  saveQuestion, unsaveQuestion, listSavedQuestions,
  saveLesson, unsaveLesson, listSavedLessons, listSaved,
} = require('../controllers/saved.controller');
const { getHome, saveProgress } = require('../controllers/home.controller');
const {
  listComments, createComment, updateComment, deleteComment, reportComment,
} = require('../controllers/comment.controller');
const {
  listTests: listStudentTests, startTestAttempt, answerTestQuestion,
  clearTestAnswer, submitTestAttempt, getTestResult, getTestLeaderboard,
} = require('../controllers/testAttempt.controller');
const authenticateStudent = require('../middleware/authenticateStudent');

router.get('/', authenticateStudent, getProfile);
router.put('/', authenticateStudent, updateProfile);

// Mounted under /api/users/me -> GET /api/users/me/lessons/:id
// One call for the whole home screen: module counts plus the two continue rows.
router.get('/home', authenticateStudent, getHome);

router.get('/lessons/:id', authenticateStudent, getStudentLesson);
router.put('/lessons/:id/progress', authenticateStudent, saveProgress);
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
// Registered before /:attemptId so "quiz-attempts" with a query string is not
// swallowed as an attempt id.
router.get('/quiz-attempts', authenticateStudent, listInProgress);
router.get('/quiz-attempts/:attemptId', authenticateStudent, getAttempt);

// Bookmarks, synced to the account instead of the device.
// One call for the whole screen: chip counts plus both lists.
router.get('/saved', authenticateStudent, listSaved);
router.post('/saved-questions', authenticateStudent, saveQuestion);
router.get('/saved-questions', authenticateStudent, listSavedQuestions);
router.delete('/saved-questions/:questionId', authenticateStudent, unsaveQuestion);

router.post('/saved-lessons', authenticateStudent, saveLesson);
router.get('/saved-lessons', authenticateStudent, listSavedLessons);
router.delete('/saved-lessons/:lessonId', authenticateStudent, unsaveLesson);

// Grand Test. Separate from the quiz flow on purpose: a Test is a fixed paper
// with a server-enforced timer, not a filter that samples the question bank.
router.get('/courses/:courseId/tests', authenticateStudent, listStudentTests);
router.post('/tests/:testId/attempts', authenticateStudent, startTestAttempt);
router.patch('/test-attempts/:attemptId/answers/:testQuestionId', authenticateStudent, answerTestQuestion);
router.delete('/test-attempts/:attemptId/answers/:testQuestionId', authenticateStudent, clearTestAnswer);
router.post('/test-attempts/:attemptId/submit', authenticateStudent, submitTestAttempt);
router.get('/test-attempts/:attemptId/result', authenticateStudent, getTestResult);
router.get('/tests/:testId/leaderboard', authenticateStudent, getTestLeaderboard);

// Lesson comments. Only signed-in students, which authenticateStudent is.
router.get('/lessons/:lessonId/comments', authenticateStudent, listComments);
router.post('/lessons/:lessonId/comments', authenticateStudent, createComment);
router.patch('/comments/:commentId', authenticateStudent, updateComment);
router.delete('/comments/:commentId', authenticateStudent, deleteComment);
router.post('/comments/:commentId/report', authenticateStudent, reportComment);

module.exports = router;