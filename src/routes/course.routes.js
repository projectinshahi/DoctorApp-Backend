const express = require('express');
const router = express.Router();
const { createCourse } = require('../controllers/course.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

router.post('/', authenticateAdmin, createCourse);

module.exports = router;