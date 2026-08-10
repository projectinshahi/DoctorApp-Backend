const express = require('express');
// mergeParams is required so this router can read :courseTypeId from the
// parent path it gets mounted under (see app.js wiring below).
const router = express.Router({ mergeParams: true });

const {
  createChapter,
  getChapters,
  getChapterById,
  updateChapter,
  deleteChapter,
} = require('../controllers/chapter.controller');

// TODO: adjust this import to match your project's actual admin-auth middleware.
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Mounted at /api/course-types/:courseTypeId/chapters
router.post('/', authenticateAdmin, createChapter);
router.get('/', authenticateAdmin, getChapters);
router.get('/:chapterId', authenticateAdmin, getChapterById);
router.put('/:chapterId', authenticateAdmin, updateChapter);
router.delete('/:chapterId', authenticateAdmin, deleteChapter);

module.exports = router;