// backend/controllers/correctionController.js
'use strict';
const db = require('../config/db');

// GET /api/corrections
async function list(req, res) {
  const { role, id: callerId, branch_id: callerBranch } = req.user;
  const { status, branch_id } = req.query;

  const where  = [];
  const params = [];

  if (role === 'employee') {
    where.push('cr.user_id = ?'); params.push(callerId);
  } else if (role === 'branch_admin') {
    where.push('cr.branch_id = ?'); params.push(callerBranch);
  } else if (branch_id) {
    where.push('cr.branch_id = ?'); params.push(branch_id);
  }

  if (status) { where.push('cr.status = ?'); params.push(status); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [rows] = await db.execute(`
    SELECT cr.*,
           u.full_name, u.employee_code,
           b.name AS branch_name,
           r.full_name AS resolved_by_name
      FROM correction_requests cr
      JOIN users    u ON u.id = cr.user_id
      JOIN branches b ON b.id = cr.branch_id
      LEFT JOIN users r ON r.id = cr.resolved_by
     ${whereClause}
     ORDER BY cr.created_at DESC
  `, params);

  res.json(rows);
}

// GET /api/corrections/:id
async function get(req, res) {
  const [[row]] = await db.execute(`
    SELECT cr.*, u.full_name, b.name AS branch_name
      FROM correction_requests cr
      JOIN users    u ON u.id = cr.user_id
      JOIN branches b ON b.id = cr.branch_id
     WHERE cr.id = ?
  `, [req.params.id]);

  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.json(row);
}

// POST /api/corrections  (employee submits)
async function create(req, res) {
  const { work_date, issue_type, description, attendance_id } = req.body;
  const { id: userId, branch_id } = req.user;

  if (!work_date || !issue_type || !description) {
    return res.status(400).json({ error: 'work_date, issue_type, description are required.' });
  }
  if (!branch_id) return res.status(400).json({ error: 'No branch assigned.' });

  const [result] = await db.execute(
    `INSERT INTO correction_requests
       (user_id, branch_id, attendance_id, work_date, issue_type, description)
     VALUES (?,?,?,?,?,?)`,
    [userId, branch_id, attendance_id || null, work_date, issue_type, description]
  );

  const [[created]] = await db.execute(
    `SELECT * FROM correction_requests WHERE id = ?`, [result.insertId]
  );
  res.status(201).json(created);
}

// PUT /api/corrections/:id/approve
async function approve(req, res) {
  const { id: resolverId } = req.user;
  const { id } = req.params;
  const { clock_in, clock_out } = req.body; // optional manual time fix

  await db.execute(
    `UPDATE correction_requests
        SET status = 'approved', resolved_by = ?, resolved_at = NOW()
      WHERE id = ? AND status = 'pending'`,
    [resolverId, id]
  );

  // If admin also provided corrected times, update the attendance record
  const [[cr]] = await db.execute(
    `SELECT * FROM correction_requests WHERE id = ?`, [id]
  );

  if (cr && (clock_in || clock_out)) {
    if (cr.attendance_id) {
      await db.execute(
        `UPDATE attendance SET
           clock_in  = COALESCE(?, clock_in),
           clock_out = COALESCE(?, clock_out)
         WHERE id = ?`,
        [clock_in || null, clock_out || null, cr.attendance_id]
      );
    } else {
      // Create new attendance record
      const [[user]] = await db.execute(
        `SELECT branch_id FROM users WHERE id = ?`, [cr.user_id]
      );
      await db.execute(
        `INSERT INTO attendance (user_id, branch_id, work_date, clock_in, clock_out, status, notes)
         VALUES (?,?,?,?,?,'present','Correction approved')
         ON DUPLICATE KEY UPDATE
           clock_in  = COALESCE(VALUES(clock_in),  clock_in),
           clock_out = COALESCE(VALUES(clock_out), clock_out)`,
        [cr.user_id, user.branch_id, cr.work_date, clock_in || null, clock_out || null]
      );
    }
  }

  const [[updated]] = await db.execute(
    `SELECT * FROM correction_requests WHERE id = ?`, [id]
  );
  res.json({ message: 'Correction approved.', correction: updated });
}

// PUT /api/corrections/:id/reject
async function reject(req, res) {
  const { id: resolverId } = req.user;
  await db.execute(
    `UPDATE correction_requests
        SET status = 'rejected', resolved_by = ?, resolved_at = NOW()
      WHERE id = ? AND status = 'pending'`,
    [resolverId, req.params.id]
  );
  const [[updated]] = await db.execute(
    `SELECT * FROM correction_requests WHERE id = ?`, [req.params.id]
  );
  res.json({ message: 'Correction rejected.', correction: updated });
}

module.exports = { list, get, create, approve, reject };