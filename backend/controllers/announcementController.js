// backend/controllers/announcementController.js
'use strict';
const db = require('../config/db');
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
function nowNepal() { return new Date(Date.now() + NEPAL_OFFSET_MS); }

// GET /api/announcements — active announcements visible to current user
async function list(req, res) {
  const { role, branch_id: callerBranch } = req.user;
  const nowNP = nowNepal().toISOString().replace('T', ' ').slice(0, 19);

  let where = `WHERE a.is_active = 1 AND (a.expires_at IS NULL OR a.expires_at > ?)`;
  const params = [nowNP];

  if (role !== 'super_admin') {
    where += ` AND (a.branch_id IS NULL OR a.branch_id = ?)`;
    params.push(callerBranch);
  }

  const [rows] = await db.execute(`
    SELECT a.*, u.full_name AS created_by_name, b.name AS branch_name
      FROM announcements a
      JOIN users u ON u.id = a.created_by
      LEFT JOIN branches b ON b.id = a.branch_id
     ${where}
     ORDER BY FIELD(a.priority,'urgent','important','normal'), a.created_at DESC
  `, params);

  res.json(rows);
}

// GET /api/announcements/manage — all (incl. inactive) for admin management
async function manage(req, res) {
  const { role, branch_id: callerBranch } = req.user;
  const where  = role === 'super_admin' ? '' : 'WHERE (a.branch_id IS NULL OR a.branch_id = ?)';
  const params = role === 'super_admin' ? [] : [callerBranch];

  const [rows] = await db.execute(`
    SELECT a.*, u.full_name AS created_by_name, b.name AS branch_name
      FROM announcements a
      JOIN users u ON u.id = a.created_by
      LEFT JOIN branches b ON b.id = a.branch_id
     ${where}
     ORDER BY a.created_at DESC
  `, params);

  res.json(rows);
}

// POST /api/announcements
async function create(req, res) {
  const { title, body, priority, branch_id, expires_at } = req.body;
  const { id: createdBy, role, branch_id: callerBranch } = req.user;

  if (!title?.trim() || !body?.trim())
    return res.status(400).json({ error: 'title and body are required.' });

  const targetBranch = role === 'super_admin' ? (branch_id || null) : callerBranch;

  const [result] = await db.execute(
    `INSERT INTO announcements (title, body, priority, branch_id, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title.trim(), body.trim(), priority || 'normal', targetBranch, createdBy, expires_at || null]
  );

  const [[created]] = await db.execute(
    `SELECT a.*, u.full_name AS created_by_name FROM announcements a
      JOIN users u ON u.id = a.created_by WHERE a.id = ?`, [result.insertId]
  );
  res.status(201).json(created);
}

// PUT /api/announcements/:id
async function update(req, res) {
  const { title, body, priority, is_active, expires_at } = req.body;
  const { role, branch_id: callerBranch } = req.user;

  const [[ann]] = await db.execute(`SELECT * FROM announcements WHERE id = ?`, [req.params.id]);
  if (!ann) return res.status(404).json({ error: 'Not found.' });
  if (role === 'branch_admin' && ann.branch_id !== callerBranch)
    return res.status(403).json({ error: 'Access denied.' });

  await db.execute(
    `UPDATE announcements SET
       title     = COALESCE(?, title),
       body      = COALESCE(?, body),
       priority  = COALESCE(?, priority),
       is_active = COALESCE(?, is_active),
       expires_at = ?
     WHERE id = ?`,
    [title||null, body||null, priority||null,
     is_active !== undefined ? is_active : null,
     expires_at !== undefined ? (expires_at||null) : ann.expires_at,
     req.params.id]
  );

  const [[updated]] = await db.execute(`SELECT * FROM announcements WHERE id = ?`, [req.params.id]);
  res.json(updated);
}

// DELETE /api/announcements/:id
async function remove(req, res) {
  const { role, branch_id: callerBranch } = req.user;
  const [[ann]] = await db.execute(`SELECT * FROM announcements WHERE id = ?`, [req.params.id]);
  if (!ann) return res.status(404).json({ error: 'Not found.' });
  if (role === 'branch_admin' && ann.branch_id !== callerBranch)
    return res.status(403).json({ error: 'Access denied.' });
  await db.execute(`DELETE FROM announcements WHERE id = ?`, [req.params.id]);
  res.json({ message: 'Announcement deleted.' });
}

module.exports = { list, manage, create, update, remove };