const express = require('express');
// mergeParams is required so this router can read :chapterId from the
// parent path it gets mounted under (see app.js wiring below).
const router = express.Router({ mergeParams: true });

const {
  createLesson,
  getLessons,
  getLessonById,
  updateLesson,
  deleteLesson,
} = require('../controllers/lesson.controller');

// TODO: adjust this import to match your project's actual admin-auth middleware.
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Mounted at /api/chapters/:chapterId/lessons
router.post('/', authenticateAdmin, createLesson);
router.get('/', authenticateAdmin, getLessons);
router.get('/:lessonId', authenticateAdmin, getLessonById);
router.put('/:lessonId', authenticateAdmin, updateLesson);
router.delete('/:lessonId', authenticateAdmin, deleteLesson);

module.exports = router;