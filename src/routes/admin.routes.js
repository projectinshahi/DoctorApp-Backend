const express = require('express');
const router = express.Router();

const { getStudentList, getStudentById, updateStudentStatus } = require('../controllers/adminStudent.controller');
const { getAdminProfile, updateAdminProfile, changeAdminPassword } = require('../controllers/adminAuth.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

// Settings: the signed-in admin's own account. Login itself lives in
// auth.routes.js — this is everything after it.
router.get('/me', authenticateAdmin, getAdminProfile);
router.patch('/me', authenticateAdmin, updateAdminProfile);
router.post('/me/password', authenticateAdmin, changeAdminPassword);

router.get('/students', authenticateAdmin, getStudentList);
router.get('/students/:id', authenticateAdmin, getStudentById);
router.patch('/students/:id/status', authenticateAdmin, updateStudentStatus);

module.exports = router;