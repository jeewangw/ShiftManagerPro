// backend/controllers/branchesController.js
const db = require('../config/db');

// GET /api/branches
async function list(req, res) {
  const [rows] = await db.execute(`
    SELECT b.*,
           COUNT(DISTINCT u.id)                                      AS total_employees,
           SUM(CASE WHEN a.clock_in IS NOT NULL
                     AND a.clock_out IS NULL
                     AND DATE(a.clock_in) = CURDATE() THEN 1 ELSE 0 END) AS active_now
      FROM branches b
      LEFT JOIN users     u ON u.branch_id = b.id AND u.role = 'employee' AND u.is_active = 1
      LEFT JOIN attendance a ON a.user_id  = u.id
     WHERE b.is_active = 1
     GROUP BY b.id
     ORDER BY b.name
  `);
  res.json(rows);
}

// GET /api/branches/:id
async function get(req, res) {
  const [[row]] = await db.execute(
    `SELECT * FROM branches WHERE id = ? AND is_active = 1`, [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Branch not found.' });
  res.json(row);
}

// POST /api/branches
async function create(req, res) {
  const { name, city, address, phone } = req.body;
  if (!name || !city) return res.status(400).json({ error: 'name and city are required.' });

  const [result] = await db.execute(
    `INSERT INTO branches (name, city, address, phone) VALUES (?,?,?,?)`,
    [name, city, address || null, phone || null]
  );
  const [[branch]] = await db.execute(`SELECT * FROM branches WHERE id = ?`, [result.insertId]);
  res.status(201).json(branch);
}

// PUT /api/branches/:id
async function update(req, res) {
  const { name, city, address, phone, is_active } = req.body;
  await db.execute(
    `UPDATE branches SET
       name      = COALESCE(?, name),
       city      = COALESCE(?, city),
       address   = COALESCE(?, address),
       phone     = COALESCE(?, phone),
       is_active = COALESCE(?, is_active)
     WHERE id = ?`,
    [name, city, address, phone, is_active !== undefined ? is_active : null, req.params.id]
  );
  const [[branch]] = await db.execute(`SELECT * FROM branches WHERE id = ?`, [req.params.id]);
  res.json(branch);
}

// DELETE /api/branches/:id  (soft delete)
async function remove(req, res) {
  await db.execute(`UPDATE branches SET is_active = 0 WHERE id = ?`, [req.params.id]);
  res.json({ message: 'Branch deactivated.' });
}

module.exports = { list, get, create, update, remove };