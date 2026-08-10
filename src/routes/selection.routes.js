const express = require('express');
const router = express.Router();
const { selectCourse, getSelectedCourse } = require('../controllers/selection.controller');
const authenticateStudent = require('../middleware/authenticateStudent');

router.put('/', authenticateStudent, selectCourse);
router.get('/', authenticateStudent, getSelectedCourse);

module.exports = router;