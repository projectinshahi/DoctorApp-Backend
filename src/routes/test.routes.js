const express = require('express');
const router = express.Router();
const multer = require('multer');

const {
  createTest, listTests, uploadTestQuestions,
  clearTestQuestions, publishTest, previewTest,
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

// Multer rejections (wrong type, too large) are user errors, not 500s.
router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: { message: err.message || 'Upload failed' } });
  next();
});

module.exports = router;
