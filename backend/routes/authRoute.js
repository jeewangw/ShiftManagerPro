const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// Public routes
router.post('/login', authCtrl.login);
router.post('/refresh', authCtrl.refresh);

// Protected routes (User must be logged in)
router.post('/logout', authenticate, authCtrl.logout);
router.put('/change-password', authenticate, authCtrl.changePassword);

module.exports = router;