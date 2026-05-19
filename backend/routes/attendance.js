// backend/routes/attendance.js
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const ctrl = require('../controllers/attendanceController');

router.use(authenticate);

router.get('/today',      ctrl.today);
router.get('/my-status',  ctrl.myStatus);
router.get('/stats',      ctrl.stats);
router.get('/',           ctrl.list);
router.get('/:id',        ctrl.get);

router.post('/clock-in',  ctrl.clockIn);
router.post('/clock-out', ctrl.clockOut);

router.put('/:id',           authorize('super_admin', 'branch_admin'), ctrl.update);
router.put('/session/:id',    authorize('super_admin', 'branch_admin'), ctrl.updateSession);
router.delete('/session/:id', authorize('super_admin', 'branch_admin'), ctrl.deleteSession);

module.exports = router;