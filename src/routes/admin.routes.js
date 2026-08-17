const express = require('express');
const router = express.Router();

const { getStudentList, updateStudentStatus } = require('../controllers/adminStudent.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

router.get('/students', authenticateAdmin, getStudentList);
router.patch('/students/:id/status', authenticateAdmin, updateStudentStatus);

module.exports = router;