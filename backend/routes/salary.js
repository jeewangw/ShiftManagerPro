const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/salaryController');

// 1. Everyone must be logged in to touch any salary data
router.use(authenticate);

// 2. Personal route - NO 'authorize' middleware here
// This allows any logged-in user to see their own history
router.get('/my-salary', ctrl.mySalary);

// 3. Admin routes - 'authorize' middleware added ONLY here
// This blocks employees from these specific endpoints
router.get('/', authorize('super_admin', 'branch_admin'), ctrl.list);
router.get('/:id', authorize('super_admin', 'branch_admin'), ctrl.get);
router.post('/compute', authorize('super_admin', 'branch_admin'), ctrl.compute);
router.put('/:id/rate',   authorize('super_admin', 'branch_admin'), ctrl.updateRate);
router.put('/:id/status', authorize('super_admin', 'branch_admin'), ctrl.updateStatus);

module.exports = router;