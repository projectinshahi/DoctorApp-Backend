const express = require('express');
const router = express.Router();

const { getUploadSignature } = require('../controllers/upload.controller');
const { uploadLessonVideo, uploadLessonNote } = require('../controllers/lessonUpload.controller');
const { videoUpload, pdfUpload } = require('../middleware/lessonUpload');

const authenticateStudent = require('../middleware/authenticateStudent');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// ── Student profile-photo signed upload (existing) ──
router.post('/signature', authenticateStudent, getUploadSignature);

// ── Admin lesson video/note uploads (NEW) ──
router.post('/lesson-video', authenticateAdmin, videoUpload.single('video'), uploadLessonVideo);
router.post('/lesson-note', authenticateAdmin, pdfUpload.single('note'), uploadLessonNote);

// Handle multer errors (wrong file type, too large) with a clean JSON response
router.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: { message: err.message || 'Upload failed' } });
  }
  next();
});

module.exports = router;