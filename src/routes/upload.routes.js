
const express = require('express');
const router = express.Router();

const { getUploadSignature } = require('../controllers/upload.controller');
const {
  uploadLessonVideo, uploadLessonNote, uploadLessonThumbnail,
  uploadQuestionImage, deleteQuestionImage,
} = require('../controllers/lessonUpload.controller');
const multer = require('multer');
const { videoUpload, noteUpload, thumbnailUpload } = require('../middleware/lessonUpload');

const authenticateStudent = require('../middleware/authenticateStudent');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// ── Student profile-photo signed upload ──
router.post('/signature', authenticateStudent, getUploadSignature);

// ── Admin lesson video/note uploads ──
router.post('/lesson-video', authenticateAdmin, videoUpload.single('video'), uploadLessonVideo);
router.post('/lesson-note', authenticateAdmin, noteUpload.single('note'), uploadLessonNote);
router.post('/lesson-thumbnail', authenticateAdmin, thumbnailUpload.single('thumbnail'), uploadLessonThumbnail);

// ── Question bank images ──
// 2MB: a question illustration that needs more than that is a scan nobody can
// read on a phone anyway. The type check is in the controller so the message
// names the type that was refused.
const questionImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.post('/question-image', authenticateAdmin, questionImageUpload.single('image'), uploadQuestionImage);
router.delete('/question-image', authenticateAdmin, deleteQuestionImage);

// Handle multer errors (wrong file type, too large) with a clean JSON response
router.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: { message: err.message || 'Upload failed' } });
  }
  next();
});

module.exports = router;
