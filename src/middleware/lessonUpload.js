const multer = require('multer');

const storage = multer.memoryStorage();

const videoUpload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB - class videos are large
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only MP4, MOV, MKV, or WEBM video files are allowed'));
    }
    cb(null, true);
  },
});

const pdfUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

module.exports = { videoUpload, pdfUpload };