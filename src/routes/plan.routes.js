const express = require('express');
const router = express.Router();

const {
  createPlan,
  getPlansForCourse,
  updatePlan,
  deletePlan,
} = require('../controllers/plan.controller');

const authenticateAdmin = require('../middleware/authenticateAdmin');

router.post('/courses/:courseId/plans', authenticateAdmin, createPlan);
router.get('/courses/:courseId/plans', getPlansForCourse); // public, students need to see pricing
router.put('/plans/:id', authenticateAdmin, updatePlan);
router.delete('/plans/:id', authenticateAdmin, deletePlan);

module.exports = router;