const express = require('express');
const router = express.Router();

const { getStudentList, getStudentById, updateStudentStatus } = require('../controllers/adminStudent.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

router.get('/students', authenticateAdmin, getStudentList);
router.get('/students/:id', authenticateAdmin, getStudentById);
router.patch('/students/:id/status', authenticateAdmin, updateStudentStatus);

module.exports = router;