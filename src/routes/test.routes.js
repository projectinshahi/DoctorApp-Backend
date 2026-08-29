const express = require('express');
const router = express.Router();
const multer = require('multer');

const {
  createTest, listTests, uploadTestQuestions,
  clearTestQuestions, publishTest, previewTest,
  uploadTestImages, listTestImages, deleteTestImage,
} = require('../controllers/test.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// A 200-question paper is a few hundred KB. The cap stops a wrong file (a
// video, a database dump) from being parsed as text.
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'];
    if (!ok.includes(file.mimetype)) return cb(new Error('Upload a .csv file'));
    cb(null, true);
  },
});

router.get('/tests', authenticateAdmin, listTests);
router.post('/courses/:courseId/tests', authenticateAdmin, createTest);
router.get('/tests/:testId/preview', authenticateAdmin, previewTest);
router.post('/tests/:testId/questions/upload', authenticateAdmin, csvUpload.single('file'), uploadTestQuestions);
router.delete('/tests/:testId/questions', authenticateAdmin, clearTestQuestions);
router.post('/tests/:testId/publish', authenticateAdmin, publishTest);

// Images go up before the CSV — a CSV can carry a URL but not binary data.
// Per-file size is checked in the controller so one oversized image reports as
// a row error instead of failing the whole batch at the middleware.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 200 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ok.includes(file.mimetype)) {
      return cb(new Error(`Unsupported file type ${file.mimetype} — use JPEG, PNG, or WebP`));
    }
    cb(null, true);
  },
});

router.post('/tests/:testId/images', authenticateAdmin, imageUpload.array('images', 200), uploadTestImages);
router.get('/tests/:testId/images', authenticateAdmin, listTestImages);
router.delete('/tests/:testId/images/:imageId', authenticateAdmin, deleteTestImage);

// Multer rejections (wrong type, too large) are user errors, not 500s.
router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: { message: err.message || 'Upload failed' } });
  next();
});

module.exports = router;
