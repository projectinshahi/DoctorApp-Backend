const express = require('express');
const router = express.Router();

const { getStudentList } = require('../controllers/adminStudent.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

router.get('/students', authenticateAdmin, getStudentList);

module.exports = router;