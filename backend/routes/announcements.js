// backend/routes/announcements.js
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/announcementController');

router.use(authenticate);

router.get('/',         ctrl.list);
router.get('/manage',   authorize('super_admin','branch_admin'), ctrl.manage);
router.post('/',        authorize('super_admin','branch_admin'), ctrl.create);
router.put('/:id',      authorize('super_admin','branch_admin'), ctrl.update);
router.delete('/:id',   authorize('super_admin','branch_admin'), ctrl.remove);

module.exports = router;