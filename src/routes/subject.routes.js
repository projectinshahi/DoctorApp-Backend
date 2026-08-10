const express = require('express');
const router = express.Router();
const { listSubjects, createSubject } = require('../controllers/subject.controller');
const authenticateAdmin = require('../middleware/authenticateAdmin');

router.get('/', authenticateAdmin, listSubjects);
router.post('/', authenticateAdmin, createSubject);

module.exports = router;