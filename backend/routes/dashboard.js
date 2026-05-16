// backend/routes/dashboard.js
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/dashboardController');

router.get('/', authenticate, ctrl.summary);

module.exports = router;