const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const dashboardController = require('../controllers/dashboardController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');

// ─────────────────────────────────────────────
// PUBLIC — no auth needed
// ─────────────────────────────────────────────
router.post('/login', adminController.adminLogin);

// ─────────────────────────────────────────────
// PROTECTED — require valid JWT + isAdmin
// ─────────────────────────────────────────────
router.get('/users',           protect, requireAdmin, adminController.getAllUsers);
router.get('/users/exam-range', protect, requireAdmin, adminController.getUsersByExamDateRange);
router.get('/stats',           protect, requireAdmin, adminController.getDashboardStats);
router.get('/comprehensive-data', protect, requireAdmin, adminController.getComprehensiveAdminData);

// Dashboard / MCQ routes
router.get('/mcq-users',            protect, requireAdmin, dashboardController.getAdminMcqUsers);
router.get('/mcq-stats',            protect, requireAdmin, dashboardController.getMcqGenerationStats);
router.get('/user-questions/:userId', protect, requireAdmin, dashboardController.getMcqQuestions);

module.exports = router;