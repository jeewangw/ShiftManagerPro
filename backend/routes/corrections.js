// backend/routes/corrections.js
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/correctionController');

router.use(authenticate);

router.get('/',                ctrl.list);
router.get('/:id',             ctrl.get);
router.post('/',               authorize('employee', 'branch_admin', 'super_admin'), ctrl.create);
router.put('/:id/approve',     authorize('super_admin', 'branch_admin'), ctrl.approve);
router.put('/:id/reject',      authorize('super_admin', 'branch_admin'), ctrl.reject);

module.exports = router;