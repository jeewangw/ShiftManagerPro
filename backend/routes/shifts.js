// backend/routes/shifts.js
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/shiftController');

router.use(authenticate);
router.get('/',       authorize('super_admin','branch_admin'), ctrl.list);
router.post('/',      authorize('super_admin','branch_admin'), ctrl.create);
router.put('/:id',    authorize('super_admin','branch_admin'), ctrl.update);
router.delete('/:id', authorize('super_admin','branch_admin'), ctrl.remove);

module.exports = router;