// backend/routes/users.js
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/userController');

router.use(authenticate);

router.get('/me',     ctrl.me);
router.put('/me',     ctrl.updateMe);

router.get('/',       authorize('super_admin', 'branch_admin'), ctrl.list);
router.get('/:id',    authorize('super_admin', 'branch_admin'), ctrl.get);
router.post('/',      authorize('super_admin', 'branch_admin'), ctrl.create);
router.put('/:id',    authorize('super_admin', 'branch_admin'), ctrl.update);
router.delete('/:id', authorize('super_admin', 'branch_admin'), ctrl.remove);

module.exports = router;