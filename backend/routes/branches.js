// backend/routes/branches.js
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/branchesController');

router.use(authenticate);

router.get('/',     authorize('super_admin', 'branch_admin'), ctrl.list);
router.get('/:id',  authorize('super_admin', 'branch_admin'), ctrl.get);
router.post('/',    authorize('super_admin'),                  ctrl.create);
router.put('/:id',  authorize('super_admin'),                  ctrl.update);
router.delete('/:id', authorize('super_admin'),                ctrl.remove);

module.exports = router;