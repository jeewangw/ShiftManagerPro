// backend/controllers/userController.js
const bcrypt = require('bcryptjs');
const db     = require('../config/db');

// GET /api/users  (super_admin: all; branch_admin: own branch)
async function list(req, res) {
  const { role: callerRole, branch_id: callerBranch } = req.user;
  const filterBranch = callerRole === 'super_admin'
    ? (req.query.branch_id || null)
    : callerBranch;

  const [rows] = await db.execute(`
    SELECT u.id, u.full_name, u.email, u.phone, u.role,
           u.branch_id, u.employee_code, u.hourly_rate, u.is_active, u.created_at,
           b.name AS branch_name,
           s.name AS shift_name, s.start_time, s.end_time
      FROM users u
      LEFT JOIN branches       b  ON b.id  = u.branch_id
      LEFT JOIN employee_shifts es ON es.user_id = u.id AND es.effective_to IS NULL
      LEFT JOIN shifts          s  ON s.id  = es.shift_id
     WHERE u.role = 'employee'
       AND u.is_active = 1
       ${filterBranch ? 'AND u.branch_id = ?' : ''}
     ORDER BY u.full_name
  `, filterBranch ? [filterBranch] : []);

  res.json(rows);
}

// GET /api/users/:id
async function get(req, res) {
  const [[user]] = await db.execute(`
    SELECT u.id, u.full_name, u.email, u.phone, u.role,
           u.branch_id, u.employee_code, u.hourly_rate, u.is_active, u.created_at,
           b.name AS branch_name
      FROM users u
      LEFT JOIN branches b ON b.id = u.branch_id
     WHERE u.id = ?
  `, [req.params.id]);

  if (!user) return res.status(404).json({ error: 'User not found.' });

  // branch_admin can only view their own branch
  if (req.user.role === 'branch_admin' && user.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  res.json(user);
}

// POST /api/users  — create employee or branch_admin
async function create(req, res) {
  const { full_name, email, phone, password, role, branch_id, employee_code, shift_id, hourly_rate } = req.body;

  if (!full_name || !email || !password || !role) {
    return res.status(400).json({ error: 'full_name, email, password, role are required.' });
  }
  if (!['employee','branch_admin'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  // branch_admin can only create employees in their branch
  const targetBranch = req.user.role === 'super_admin' ? branch_id : req.user.branch_id;
  if (!targetBranch) return res.status(400).json({ error: 'branch_id is required.' });

  const hash = await bcrypt.hash(password, 12);

  const [result] = await db.execute(
    `INSERT INTO users (full_name, email, phone, password_hash, role, branch_id, employee_code, hourly_rate)
     VALUES (?,?,?,?,?,?,?,?)`,
    [full_name, email.toLowerCase().trim(), phone || null, hash, role, targetBranch, employee_code || null, parseFloat(hourly_rate) || 0]
  );

  // Assign shift if provided
  if (shift_id) {
    await db.execute(
      `INSERT INTO employee_shifts (user_id, shift_id, effective_from) VALUES (?,?,CURDATE())`,
      [result.insertId, shift_id]
    );
  }

  const [[user]] = await db.execute(
    `SELECT id, full_name, email, role, branch_id, employee_code, hourly_rate FROM users WHERE id = ?`,
    [result.insertId]
  );
  res.status(201).json(user);
}

// PUT /api/users/:id
async function update(req, res) {
  const { full_name, email, phone, is_active, shift_id, hourly_rate } = req.body;
  const uid = req.params.id;

  // Scope check
  const [[target]] = await db.execute(`SELECT branch_id FROM users WHERE id = ?`, [uid]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (req.user.role === 'branch_admin' && target.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Access denied.' });
  }

  await db.execute(
    `UPDATE users SET
       full_name   = COALESCE(?, full_name),
       email       = COALESCE(?, email),
       phone       = COALESCE(?, phone),
       is_active   = COALESCE(?, is_active),
       hourly_rate = COALESCE(?, hourly_rate)
     WHERE id = ?`,
    [full_name || null, email ? email.toLowerCase().trim() : null, phone || null,
     is_active !== undefined ? is_active : null,
     hourly_rate !== undefined ? parseFloat(hourly_rate) : null, uid]
  );

  // Update shift assignment if requested
  if (shift_id) {
    await db.execute(
      `UPDATE employee_shifts SET effective_to = CURDATE() WHERE user_id = ? AND effective_to IS NULL`,
      [uid]
    );
    await db.execute(
      `INSERT INTO employee_shifts (user_id, shift_id, effective_from) VALUES (?,?,CURDATE())`,
      [uid, shift_id]
    );
  }

  const [[user]] = await db.execute(
    `SELECT id, full_name, email, phone, role, branch_id, is_active, hourly_rate FROM users WHERE id = ?`, [uid]
  );
  res.json(user);
}

// DELETE /api/users/:id (soft)
async function remove(req, res) {
  const uid = req.params.id;
  const [[target]] = await db.execute(`SELECT branch_id, role FROM users WHERE id = ?`, [uid]);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.role === 'super_admin') return res.status(400).json({ error: 'Cannot delete super admin.' });
  if (req.user.role === 'branch_admin' && target.branch_id !== req.user.branch_id) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  await db.execute(`UPDATE users SET is_active = 0 WHERE id = ?`, [uid]);
  res.json({ message: 'Employee deactivated.' });
}

// GET /api/users/me
async function me(req, res) {
  const [[user]] = await db.execute(
    `SELECT id, full_name, email, phone, role, branch_id, employee_code FROM users WHERE id = ?`,
    [req.user.id]
  );
  res.json(user);
}

// PUT /api/users/me
async function updateMe(req, res) {
  const { full_name, phone } = req.body;
  await db.execute(
    `UPDATE users SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone) WHERE id = ?`,
    [full_name || null, phone || null, req.user.id]
  );
  const [[user]] = await db.execute(
    `SELECT id, full_name, email, phone, role, branch_id FROM users WHERE id = ?`, [req.user.id]
  );
  res.json(user);
}

module.exports = { list, get, create, update, remove, me, updateMe };