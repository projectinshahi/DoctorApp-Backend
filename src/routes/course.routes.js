
const express = require('express');
const router = express.Router();

const {
  createCourse,
  getCourses,
  getCourseDetails,
  getPublicCourseTypes,
  addCourseType,
  updateCourse,
  deleteCourse,
  updateCourseType,
  deleteCourseType,
} = require('../controllers/course.controller');

const authenticateAdmin = require('../middleware/authenticateAdmin');

router.post('/', authenticateAdmin, createCourse);
router.get('/', getCourses);
router.get('/:id', authenticateAdmin, getCourseDetails);

router.get('/:id/course-types', getPublicCourseTypes);

router.post('/:id/course-types', authenticateAdmin, addCourseType);
router.put('/:courseId/course-types/:courseTypeId', authenticateAdmin, updateCourseType);
router.delete('/:courseId/course-types/:courseTypeId', authenticateAdmin, deleteCourseType);

router.put('/:id', authenticateAdmin, updateCourse);
router.delete('/:id', authenticateAdmin, deleteCourse);

module.exports = router;