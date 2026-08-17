const express = require('express');
const router = express.Router();
const { selectCourse, getSelectedCourse } = require('../controllers/selection.controller');
const { getSelectedCourseContent } = require('../controllers/selected-course.controller');
const authenticateStudent = require('../middleware/authenticateStudent');

router.put('/', authenticateStudent, selectCourse);
router.get('/', authenticateStudent, getSelectedCourse);
router.get('/content', authenticateStudent, getSelectedCourseContent);

module.exports = router;