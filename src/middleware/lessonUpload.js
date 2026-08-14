// const multer = require('multer');
// const storage = multer.memoryStorage();

// const videoUpload = multer({
//   storage,
//   limits: { fileSize: 200 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     const allowed = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'];
//     if (!allowed.includes(file.mimetype)) {
//       return cb(new Error('Only MP4, MOV, MKV, or WEBM video files are allowed'));
//     }
//     cb(null, true);
//   },
// });

// // UPDATED: now accepts PDF, DOC, and DOCX
// const noteUpload = multer({
//   storage,
//   limits: { fileSize: 25 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     const allowed = [
//       'application/pdf',
//       'application/msword', // .doc
//       'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
//     ];
//     if (!allowed.includes(file.mimetype)) {
//       return cb(new Error('Only PDF, DOC, or DOCX files are allowed'));
//     }
//     cb(null, true);
//   },
// });

// module.exports = { videoUpload, noteUpload };


const multer = require('multer');
const storage = multer.memoryStorage();

const videoUpload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only MP4, MOV, MKV, or WEBM video files are allowed'));
    }
    cb(null, true);
  },
});

// UPDATED: now accepts PDF, DOC, and DOCX
const noteUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only PDF, DOC, or DOCX files are allowed'));
    }
    cb(null, true);
  },
});

// NEW: thumbnail image upload — this was missing, which is why the
// Add Lesson thumbnail field failed with "Unexpected response from server".
const thumbnailUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max for images
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, or WEBP image files are allowed'));
    }
    cb(null, true);
  },
});

module.exports = { videoUpload, noteUpload, thumbnailUpload };