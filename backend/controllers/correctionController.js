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
           r.full_name AS resolved_by_name,
           cs.clock_in  AS existing_clock_in,
           cs.clock_out AS existing_clock_out,
           cs.duration_min AS existing_duration_min
      FROM correction_requests cr
      JOIN users    u  ON u.id  = cr.user_id
      JOIN branches b  ON b.id  = cr.branch_id
      LEFT JOIN users r  ON r.id  = cr.resolved_by
      LEFT JOIN clock_sessions cs ON cs.id = cr.session_id
     ${whereClause}
     ORDER BY cr.created_at DESC
  `, params);

  res.json(rows);
}

// GET /api/corrections/:id
async function get(req, res) {
  const [[row]] = await db.execute(`
    SELECT cr.*, u.full_name, b.name AS branch_name,
           cs.clock_in AS existing_clock_in, cs.clock_out AS existing_clock_out
      FROM correction_requests cr
      JOIN users    u ON u.id = cr.user_id
      JOIN branches b ON b.id = cr.branch_id
      LEFT JOIN clock_sessions cs ON cs.id = cr.session_id
     WHERE cr.id = ?
  `, [req.params.id]);

  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.json(row);
}

// POST /api/corrections  (employee submits)
async function create(req, res) {
  const { work_date, issue_type, description, attendance_id, session_id } = req.body;
  const { id: userId, branch_id } = req.user;

  if (!work_date || !issue_type || !description) {
    return res.status(400).json({ error: 'work_date, issue_type, description are required.' });
  }
  if (!branch_id) return res.status(400).json({ error: 'No branch assigned.' });

  const [result] = await db.execute(
    `INSERT INTO correction_requests
       (user_id, branch_id, attendance_id, session_id, work_date, issue_type, description)
     VALUES (?,?,?,?,?,?,?)`,
    [userId, branch_id, attendance_id || null, session_id || null, work_date, issue_type, description]
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
  const {
    clock_in,
    clock_out,
    total_minutes,
    erase_sessions,
    replace_session  // if true, delete the original wrong session before inserting corrected one
  } = req.body;

  await db.execute(
    `UPDATE correction_requests
        SET status = 'approved', resolved_by = ?, resolved_at = NOW()
      WHERE id = ? AND status = 'pending'`,
    [resolverId, id]
  );

  const [[cr]] = await db.execute(
    `SELECT * FROM correction_requests WHERE id = ?`, [id]
  );

  if (!cr) {
    const [[updated]] = await db.execute(`SELECT * FROM correction_requests WHERE id = ?`, [id]);
    return res.json({ message: 'Correction approved.', correction: updated });
  }

  // Ensure attendance row exists for the work_date
  const [[user]] = await db.execute(`SELECT branch_id FROM users WHERE id = ?`, [cr.user_id]);
  await db.execute(
    `INSERT INTO attendance (user_id, branch_id, work_date, status, notes)
     VALUES (?, ?, ?, 'present', 'Correction approved')
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [cr.user_id, user.branch_id, cr.work_date]
  );
  const [[att]] = await db.execute(
    `SELECT id FROM attendance WHERE user_id = ? AND work_date = ?`,
    [cr.user_id, cr.work_date]
  );

  if (clock_in && clock_out) {
    // If replacing: delete the specific wrong session the employee flagged
    if (replace_session && cr.session_id) {
      await db.execute(
        `DELETE FROM clock_sessions WHERE id = ?`, [cr.session_id]
      );
    }

    // Insert the corrected session
    await db.execute(
      `INSERT INTO clock_sessions (attendance_id, user_id, clock_in, clock_out)
       VALUES (?, ?, ?, ?)`,
      [att.id, cr.user_id, clock_in, clock_out]
    );

    // Recompute total_minutes from all remaining sessions
    await db.execute(`
      UPDATE attendance a
         SET total_minutes = (
               SELECT COALESCE(SUM(duration_min), 0)
                 FROM clock_sessions cs
                WHERE cs.attendance_id = a.id
                  AND cs.duration_min IS NOT NULL
             ),
             updated_at = NOW()
       WHERE a.id = ?
    `, [att.id]);

  } else if (total_minutes !== undefined && total_minutes !== null && total_minutes !== '') {
    // Erase all sessions if requested before setting total override
    if (erase_sessions) {
      await db.execute(
        `DELETE FROM clock_sessions WHERE attendance_id = ?`, [att.id]
      );
    }
    // Directly override total_minutes for the day
    await db.execute(
      `UPDATE attendance SET total_minutes = ?, notes = 'Total manually corrected', updated_at = NOW() WHERE id = ?`,
      [parseInt(total_minutes), att.id]
    );
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