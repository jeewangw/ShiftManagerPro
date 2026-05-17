// backend/controllers/attendanceController.js
'use strict';
const db = require('../config/db');

// ── Nepal time helpers ────────────────────────────────────────────────────────
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

function nowNepal() {
  return new Date(Date.now() + NEPAL_OFFSET_MS);
}

function nepalDateStr(d) {
  const nd = d || nowNepal();
  return nd.toISOString().slice(0, 10);
}

function nepalDatetimeStr(d) {
  const nd = d || nowNepal();
  return nd.toISOString().replace('T', ' ').slice(0, 19);
}

async function recomputeTotal(attendanceId) {
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
  `, [attendanceId]);
}

// ── GET /api/attendance  ──────────────────────────────────────────────────────
async function list(req, res) {
  const { role, id: callerId, branch_id: callerBranch } = req.user;
  const { branch_id, user_id, from, to, status, page = 1, limit = 50 } = req.query;

  const safeLimit  = parseInt(limit)  || 50;
  const safeOffset = ((parseInt(page) || 1) - 1) * safeLimit;
  const params = [];
  const where  = [];

  if (role === 'employee') {
    where.push('a.user_id = ?'); params.push(parseInt(callerId));
  } else if (role === 'branch_admin') {
    where.push('a.branch_id = ?'); params.push(parseInt(callerBranch));
    if (user_id) { where.push('a.user_id = ?'); params.push(parseInt(user_id)); }
  } else {
    if (branch_id) { where.push('a.branch_id = ?'); params.push(parseInt(branch_id)); }
    if (user_id)   { where.push('a.user_id = ?');   params.push(parseInt(user_id)); }
  }

  if (from)   { where.push('a.work_date >= ?'); params.push(from); }
  if (to)     { where.push('a.work_date <= ?'); params.push(to); }
  if (status) { where.push('a.status = ?');     params.push(status); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [rows] = await db.execute(`
    SELECT a.*,
           u.full_name, u.employee_code,
           b.name  AS branch_name,
           s.name  AS shift_name, s.start_time, s.end_time
      FROM attendance a
      JOIN users    u ON u.id = a.user_id
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN shifts s ON s.id = a.shift_id
     ${whereClause}
     ORDER BY a.work_date DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}
  `, params);

  for (const row of rows) {
    const [sessions] = await db.execute(
      `SELECT id, clock_in, clock_out, duration_min FROM clock_sessions
        WHERE attendance_id = ? ORDER BY clock_in ASC`,
      [row.id]
    );
    row.sessions = sessions;
  }

  const [[{ total }]] = await db.execute(
    `SELECT COUNT(*) AS total FROM attendance a ${whereClause}`, params
  );

  res.json({ data: rows, total, page: parseInt(page) || 1, limit: safeLimit });
}

// ── GET /api/attendance/today  ────────────────────────────────────────────────
async function today(req, res) {
  const { role, id: callerId, branch_id: callerBranch } = req.user;
  const { branch_id } = req.query;

  const todayStr = nepalDateStr();
  const params   = [todayStr];
  const where    = ['a.work_date = ?'];

  if (role === 'employee') {
    where.push('a.user_id = ?'); params.push(parseInt(callerId));
  } else if (role === 'branch_admin') {
    where.push('a.branch_id = ?'); params.push(parseInt(callerBranch));
  } else if (branch_id) {
    where.push('a.branch_id = ?'); params.push(parseInt(branch_id));
  }

  const [rows] = await db.execute(`
    SELECT a.*,
           u.full_name, u.employee_code,
           b.name AS branch_name,
           s.name AS shift_name, s.start_time, s.end_time
      FROM attendance a
      JOIN users    u ON u.id = a.user_id
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN shifts s ON s.id = a.shift_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.total_minutes DESC
  `, params);

  for (const row of rows) {
    const [sessions] = await db.execute(
      `SELECT id, clock_in, clock_out, duration_min FROM clock_sessions
        WHERE attendance_id = ? ORDER BY clock_in ASC`,
      [row.id]
    );
    row.sessions = sessions;
  }

  res.json(rows);
}

// ── POST /api/attendance/clock-in  ───────────────────────────────────────────
async function clockIn(req, res) {
  const userId  = req.user.id;
  const todayNP = nepalDateStr();
  const nowNP   = nepalDatetimeStr();

  // Check for ANY open session across all dates — not just today.
  // This prevents the bug where an employee who didn't clock out yesterday
  // gets auto-clocked-out when a new Nepal day starts.
  const [[openSession]] = await db.execute(`
    SELECT cs.id, a.work_date FROM clock_sessions cs
      JOIN attendance a ON a.id = cs.attendance_id
     WHERE cs.user_id = ? AND cs.clock_out IS NULL
     ORDER BY cs.clock_in DESC
     LIMIT 1
  `, [userId]);

  if (openSession) {
    return res.status(400).json({
      error: `You are still clocked in from ${openSession.work_date}. Please clock out first.`
    });
  }

  const [[user]] = await db.execute(`
    SELECT u.branch_id, es.shift_id, s.start_time
      FROM users u
      LEFT JOIN employee_shifts es ON es.user_id = u.id AND es.effective_to IS NULL
      LEFT JOIN shifts s ON s.id = es.shift_id
     WHERE u.id = ?
  `, [userId]);

  if (!user?.branch_id) {
    return res.status(400).json({ error: 'No branch assigned to your account.' });
  }

  let status = 'present';
  if (user.start_time) {
    const [sh, sm] = user.start_time.split(':').map(Number);
    const shiftStartNP = nowNepal();
    shiftStartNP.setHours(sh, sm, 0, 0);
    if (nowNepal() - shiftStartNP > 10 * 60 * 1000) status = 'late';
  }

  await db.execute(`
    INSERT INTO attendance (user_id, branch_id, shift_id, work_date, status)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status     = IF(status = 'absent', VALUES(status), status),
      updated_at = NOW()
  `, [userId, user.branch_id, user.shift_id || null, todayNP, status]);

  const [[att]] = await db.execute(
    `SELECT id FROM attendance WHERE user_id = ? AND work_date = ?`, [userId, todayNP]
  );

  await db.execute(`
    INSERT INTO clock_sessions (attendance_id, user_id, clock_in)
    VALUES (?, ?, ?)
  `, [att.id, userId, nowNP]);

  const [[session]] = await db.execute(
    `SELECT * FROM clock_sessions WHERE attendance_id = ? ORDER BY clock_in DESC LIMIT 1`,
    [att.id]
  );

  const [allSessions] = await db.execute(
    `SELECT id, clock_in, clock_out, duration_min FROM clock_sessions
      WHERE attendance_id = ? ORDER BY clock_in ASC`, [att.id]
  );

  res.status(201).json({
    message:   `Clocked in at ${nowNP} (NST)`,
    session,
    sessions:  allSessions,
    work_date: todayNP,
  });
}

// ── POST /api/attendance/clock-out  ──────────────────────────────────────────
async function clockOut(req, res) {
  const userId = req.user.id;
  const nowNP  = nepalDatetimeStr();

  // Find the open session across ANY date — not just today.
  // This lets an employee clock out even if their session started yesterday
  // (e.g. overnight shift, or they forgot to clock out before midnight NST).
  const [[openSession]] = await db.execute(`
    SELECT cs.id, cs.attendance_id, cs.clock_in, a.work_date
      FROM clock_sessions cs
      JOIN attendance a ON a.id = cs.attendance_id
     WHERE cs.user_id = ? AND cs.clock_out IS NULL
     ORDER BY cs.clock_in DESC
     LIMIT 1
  `, [userId]);

  if (!openSession) {
    return res.status(400).json({ error: 'You are not currently clocked in.' });
  }

  await db.execute(
    `UPDATE clock_sessions SET clock_out = ?, updated_at = NOW() WHERE id = ?`,
    [nowNP, openSession.id]
  );

  await recomputeTotal(openSession.attendance_id);

  const [[session]] = await db.execute(
    `SELECT * FROM clock_sessions WHERE id = ?`, [openSession.id]
  );

  const [allSessions] = await db.execute(
    `SELECT id, clock_in, clock_out, duration_min FROM clock_sessions
      WHERE attendance_id = ? ORDER BY clock_in ASC`, [openSession.attendance_id]
  );

  const [[att]] = await db.execute(
    `SELECT total_minutes FROM attendance WHERE id = ?`, [openSession.attendance_id]
  );

  res.json({
    message:       `Clocked out at ${nowNP} (NST)`,
    session,
    sessions:      allSessions,
    total_minutes: att.total_minutes,
    work_date:     openSession.work_date,
  });
}

// ── GET /api/attendance/my-status  ───────────────────────────────────────────
async function myStatus(req, res) {
  const userId  = req.user.id;
  const todayNP = nepalDateStr();

  const [[att]] = await db.execute(
    `SELECT * FROM attendance WHERE user_id = ? AND work_date = ?`, [userId, todayNP]
  );

  let sessions    = [];
  let openSession = null;

  if (att) {
    const [rows] = await db.execute(
      `SELECT id, clock_in, clock_out, duration_min FROM clock_sessions
        WHERE attendance_id = ? ORDER BY clock_in ASC`, [att.id]
    );
    sessions    = rows;
    openSession = rows.find(s => !s.clock_out) || null;
  }

  // Also check if there's an open session from a previous day
  if (!openSession) {
    const [[prevOpen]] = await db.execute(`
      SELECT cs.id, cs.clock_in, cs.attendance_id, a.work_date
        FROM clock_sessions cs
        JOIN attendance a ON a.id = cs.attendance_id
       WHERE cs.user_id = ? AND cs.clock_out IS NULL
       ORDER BY cs.clock_in DESC
       LIMIT 1
    `, [userId]);
    if (prevOpen) openSession = prevOpen;
  }

  res.json({
    clocked_in:     !!openSession,
    open_session:   openSession,
    sessions,
    attendance:     att || null,
    nepal_time_now: nepalDatetimeStr(),
    nepal_date:     todayNP,
  });
}

// ── GET /api/attendance/stats  ────────────────────────────────────────────────
async function stats(req, res) {
  const { role, id: callerId, branch_id: callerBranch } = req.user;
  const { branch_id, user_id, month, year } = req.query;

  const nowNP       = nowNepal();
  const targetMonth = parseInt(month) || (nowNP.getMonth() + 1);
  const targetYear  = parseInt(year)  || nowNP.getFullYear();

  const params = [targetYear, targetMonth];
  const where  = ['YEAR(a.work_date) = ?', 'MONTH(a.work_date) = ?'];

  if (role === 'employee') {
    where.push('a.user_id = ?'); params.push(parseInt(callerId));
  } else if (role === 'branch_admin') {
    where.push('a.branch_id = ?'); params.push(parseInt(callerBranch));
    if (user_id) { where.push('a.user_id = ?'); params.push(parseInt(user_id)); }
  } else {
    if (branch_id) { where.push('a.branch_id = ?'); params.push(parseInt(branch_id)); }
    if (user_id)   { where.push('a.user_id = ?');   params.push(parseInt(user_id)); }
  }

  const whereClause = 'WHERE ' + where.join(' AND ');

  const [[s]] = await db.execute(`
    SELECT
      COUNT(*)                                                        AS total_days,
      SUM(status = 'present')                                         AS present,
      SUM(status = 'absent')                                          AS absent,
      SUM(status = 'late')                                            AS late,
      SUM(status = 'half_day')                                        AS half_day,
      ROUND(AVG(total_minutes), 0)                                    AS avg_minutes,
      ROUND(SUM(total_minutes) / 60.0, 2)                            AS total_hours,
      ROUND(SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0) * 100, 1)                          AS attendance_pct
    FROM attendance a
    ${whereClause}
  `, params);

  res.json(s);
}

// ── GET /api/attendance/:id  ──────────────────────────────────────────────────
async function get(req, res) {
  const [[row]] = await db.execute(`
    SELECT a.*, u.full_name, b.name AS branch_name
      FROM attendance a
      JOIN users    u ON u.id = a.user_id
      JOIN branches b ON b.id = a.branch_id
     WHERE a.id = ?
  `, [req.params.id]);

  if (!row) return res.status(404).json({ error: 'Record not found.' });

  const { role, id: callerId, branch_id } = req.user;
  if (role === 'employee' && row.user_id !== callerId)
    return res.status(403).json({ error: 'Access denied.' });
  if (role === 'branch_admin' && row.branch_id !== branch_id)
    return res.status(403).json({ error: 'Access denied.' });

  const [sessions] = await db.execute(
    `SELECT id, clock_in, clock_out, duration_min FROM clock_sessions
      WHERE attendance_id = ? ORDER BY clock_in ASC`, [row.id]
  );
  row.sessions = sessions;

  res.json(row);
}

// ── PUT /api/attendance/:id  ──────────────────────────────────────────────────
async function update(req, res) {
  const { status, notes } = req.body;
  await db.execute(
    `UPDATE attendance SET
       status = COALESCE(?, status),
       notes  = COALESCE(?, notes)
     WHERE id = ?`,
    [status || null, notes || null, req.params.id]
  );
  const [[updated]] = await db.execute(`SELECT * FROM attendance WHERE id = ?`, [req.params.id]);
  res.json(updated);
}

module.exports = { list, today, clockIn, clockOut, myStatus, stats, get, update };