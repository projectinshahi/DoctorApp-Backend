const express = require('express');
const router = express.Router();
const {
  createLesson,
  getLesson,
  getLessonsByChapter,
  updateLesson,
  deleteLesson,
  reorderLessons,
  getLessonPlans,
} = require('../controllers/lesson.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

router.patch('/chapters/:chapterId/lessons/reorder', authenticateAdmin, reorderLessons);
router.get('/lessons/:id/plans', authenticateAdmin, getLessonPlans);
router.post('/chapters/:chapterId/lessons', authenticateAdmin, createLesson);
router.get('/chapters/:chapterId/lessons', authenticateAdmin, getLessonsByChapter);
router.get('/lessons/:id', authenticateAdmin, getLesson);
router.put('/lessons/:id', authenticateAdmin, updateLesson);
router.delete('/lessons/:id', authenticateAdmin, deleteLesson);

module.exports = router;