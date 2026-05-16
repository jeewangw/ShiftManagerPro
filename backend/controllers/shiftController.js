// backend/controllers/shiftController.js
'use strict';
const db = require('../config/db');

async function list(req, res) {
  const { role, branch_id: callerBranch } = req.user;
  const branchId = role === 'super_admin'
    ? (req.query.branch_id || null)
    : callerBranch;

  const [rows] = await db.execute(
    `SELECT s.*, b.name AS branch_name
       FROM shifts s
       JOIN branches b ON b.id = s.branch_id
      WHERE s.is_active = 1
        ${branchId ? 'AND s.branch_id = ?' : ''}
      ORDER BY s.branch_id, s.start_time`,
    branchId ? [branchId] : []
  );
  res.json(rows);
}

async function create(req, res) {
  const { branch_id, name, start_time, end_time, break_minutes } = req.body;
  if (!branch_id || !name || !start_time || !end_time) {
    return res.status(400).json({ error: 'branch_id, name, start_time, end_time required.' });
  }
  const targetBranch = req.user.role === 'super_admin' ? branch_id : req.user.branch_id;
  const [result] = await db.execute(
    `INSERT INTO shifts (branch_id, name, start_time, end_time, break_minutes)
     VALUES (?,?,?,?,?)`,
    [targetBranch, name, start_time, end_time, break_minutes || 30]
  );
  const [[shift]] = await db.execute(`SELECT * FROM shifts WHERE id = ?`, [result.insertId]);
  res.status(201).json(shift);
}

async function update(req, res) {
  const { name, start_time, end_time, break_minutes, is_active } = req.body;
  await db.execute(
    `UPDATE shifts SET
       name          = COALESCE(?, name),
       start_time    = COALESCE(?, start_time),
       end_time      = COALESCE(?, end_time),
       break_minutes = COALESCE(?, break_minutes),
       is_active     = COALESCE(?, is_active)
     WHERE id = ?`,
    [name||null, start_time||null, end_time||null,
     break_minutes||null, is_active!==undefined?is_active:null, req.params.id]
  );
  const [[shift]] = await db.execute(`SELECT * FROM shifts WHERE id = ?`, [req.params.id]);
  res.json(shift);
}

async function remove(req, res) {
  await db.execute(`UPDATE shifts SET is_active = 0 WHERE id = ?`, [req.params.id]);
  res.json({ message: 'Shift deactivated.' });
}

module.exports = { list, create, update, remove };