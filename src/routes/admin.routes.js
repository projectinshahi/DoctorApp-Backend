const express = require('express');
const router = express.Router();

const { getStudentList, getStudentById, updateStudentStatus, revokeStudentSessions } = require('../controllers/adminStudent.controller');
const { getAdminProfile, updateAdminProfile, changeAdminPassword } = require('../controllers/adminAuth.controller');
const {
  listComments: listAllComments, setCommentStatus, dismissReports,
  deleteComment: deleteCommentAsAdmin, setLessonComments,
  getCommentThread, replyToComment, editOwnReply,
} = require('../controllers/adminComment.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Settings: the signed-in admin's own account. Login itself lives in
// auth.routes.js — this is everything after it.
router.get('/me', authenticateAdmin, getAdminProfile);
router.patch('/me', authenticateAdmin, updateAdminProfile);
router.post('/me/password', authenticateAdmin, changeAdminPassword);

router.get('/students', authenticateAdmin, getStudentList);
router.get('/students/:id', authenticateAdmin, getStudentById);
router.patch('/students/:id/status', authenticateAdmin, updateStudentStatus);
// Releases the single-device lock when a student cannot reach their own account.
router.post('/students/:id/sessions/revoke', authenticateAdmin, revokeStudentSessions);

// Comment moderation.
router.get('/comments', authenticateAdmin, listAllComments);
router.get('/comments/:commentId', authenticateAdmin, getCommentThread);
router.patch('/comments/:commentId', authenticateAdmin, setCommentStatus);
router.post('/comments/:commentId/reply', authenticateAdmin, replyToComment);
router.patch('/comments/:commentId/body', authenticateAdmin, editOwnReply);
router.post('/comments/:commentId/dismiss-reports', authenticateAdmin, dismissReports);
router.delete('/comments/:commentId', authenticateAdmin, deleteCommentAsAdmin);
router.patch('/lessons/:lessonId/comments', authenticateAdmin, setLessonComments);

module.exports = router;