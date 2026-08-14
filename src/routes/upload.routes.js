
const express = require('express');
const router = express.Router();

const { getUploadSignature } = require('../controllers/upload.controller');
const { uploadLessonVideo, uploadLessonNote, uploadLessonThumbnail } = require('../controllers/lessonUpload.controller');
const { videoUpload, noteUpload, thumbnailUpload } = require('../middleware/lessonUpload');

const authenticateStudent = require('../middleware/authenticateStudent');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// ── Student profile-photo signed upload ──
router.post('/signature', authenticateStudent, getUploadSignature);

// ── Admin lesson video/note uploads ──
router.post('/lesson-video', authenticateAdmin, videoUpload.single('video'), uploadLessonVideo);
router.post('/lesson-note', authenticateAdmin, noteUpload.single('note'), uploadLessonNote);
router.post('/lesson-thumbnail', authenticateAdmin, thumbnailUpload.single('thumbnail'), uploadLessonThumbnail);

// Handle multer errors (wrong file type, too large) with a clean JSON response
router.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: { message: err.message || 'Upload failed' } });
  }
  next();
});

module.exports = router;
