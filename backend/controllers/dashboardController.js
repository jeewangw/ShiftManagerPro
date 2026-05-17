// backend/controllers/dashboardController.js
'use strict';
const db = require('../config/db');

const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
function nowNepal() { return new Date(Date.now() + NEPAL_OFFSET_MS); }
function nepalDateStr(d) { return (d || nowNepal()).toISOString().slice(0, 10); }

async function summary(req, res) {
  const { role, id: callerId, branch_id: callerBranch } = req.user;
  if (role === 'super_admin')  return superSummary(res);
  if (role === 'branch_admin') return branchSummary(res, callerBranch);
  return employeeSummary(res, callerId);
}

// ── Super Admin ───────────────────────────────────────────────────────────────
async function superSummary(res) {
  const todayNP = nepalDateStr();
  const nowNP   = nowNepal();
  const month   = nowNP.getMonth() + 1;
  const year    = nowNP.getFullYear();

  const [[branchStats]] = await db.execute(`
    SELECT COUNT(*) AS total_branches, SUM(is_active) AS active_branches FROM branches
  `);

  const [[empStats]] = await db.execute(`
    SELECT COUNT(*) AS total_employees
      FROM users WHERE role = 'employee' AND is_active = 1
  `);

  const [[todayStats]] = await db.execute(`
    SELECT
      (SELECT COUNT(*) FROM clock_sessions cs
        JOIN attendance a ON a.id = cs.attendance_id
       WHERE a.work_date = ? AND cs.clock_out IS NULL)     AS clocked_in_now,
      SUM(status = 'absent')  AS absent_today,
      SUM(status IN ('present','late')) AS present_today
    FROM attendance WHERE work_date = ?
  `, [todayNP, todayNP]);

  const [branchBreakdown] = await db.execute(`
    SELECT b.id, b.name, b.city,
           COUNT(DISTINCT u.id) AS total_employees,
           (SELECT COUNT(*) FROM clock_sessions cs2
              JOIN attendance a2 ON a2.id = cs2.attendance_id
             WHERE a2.branch_id = b.id AND a2.work_date = ? AND cs2.clock_out IS NULL
           ) AS active_now,
           ROUND(
             SUM(a.status IN ('present','late')) /
             NULLIF(COUNT(a.id), 0) * 100, 1
           ) AS attendance_pct
      FROM branches b
      LEFT JOIN users u      ON u.branch_id = b.id AND u.role = 'employee' AND u.is_active = 1
      LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = ?
     WHERE b.is_active = 1
     GROUP BY b.id
     ORDER BY b.name
  `, [todayNP, todayNP]);

  const [weeklyTrend] = await db.execute(`
    SELECT work_date AS date,
           COUNT(*)  AS total,
           SUM(status IN ('present','late')) AS present
      FROM attendance
     WHERE work_date >= DATE_SUB(?, INTERVAL 7 DAY)
     GROUP BY work_date
     ORDER BY work_date
  `, [todayNP]);

  const [recentActivity] = await db.execute(`
    SELECT cs.clock_in AS ts, u.full_name, b.name AS branch_name
      FROM clock_sessions cs
      JOIN attendance a  ON a.id  = cs.attendance_id
      JOIN users      u  ON u.id  = cs.user_id
      JOIN branches   b  ON b.id  = a.branch_id
     WHERE a.work_date = ?
     ORDER BY cs.clock_in DESC LIMIT 10
  `, [todayNP]);

  // Monthly salary totals across all branches
  const [[salaryTotals]] = await db.execute(`
    SELECT COUNT(DISTINCT user_id)          AS employees_with_salary,
           ROUND(SUM(base_salary), 2)       AS total_base_salary,
           ROUND(SUM(total_hours), 2)       AS total_hours
      FROM salary_records
     WHERE month = ? AND year = ?
  `, [month, year]);

  res.json({
    role: 'super_admin',
    nepal_date: todayNP,
    branches:  branchStats,
    employees: empStats,
    today:     todayStats,
    branch_breakdown: branchBreakdown,
    weekly_trend:     weeklyTrend,
    recent_activity:  recentActivity,
    salary_summary:   { ...salaryTotals, month, year },
  });
}

// ── Branch Admin ──────────────────────────────────────────────────────────────
async function branchSummary(res, branchId) {
  const todayNP = nepalDateStr();
  const nowNP   = nowNepal();
  const month   = nowNP.getMonth() + 1;
  const year    = nowNP.getFullYear();

  const [[empStats]] = await db.execute(`
    SELECT COUNT(*) AS total_employees
      FROM users WHERE branch_id = ? AND role = 'employee' AND is_active = 1
  `, [branchId]);

  const [[todayStats]] = await db.execute(`
    SELECT
      (SELECT COUNT(*) FROM clock_sessions cs
         JOIN attendance a2 ON a2.id = cs.attendance_id
        WHERE a2.branch_id = ? AND a2.work_date = ? AND cs.clock_out IS NULL) AS clocked_in_now,
      SUM(a.status = 'absent')               AS absent_today,
      SUM(a.status IN ('present','late'))    AS present_today
    FROM attendance a
    WHERE a.branch_id = ? AND a.work_date = ?
  `, [branchId, todayNP, branchId, todayNP]);

  const [teamToday] = await db.execute(`
    SELECT u.id, u.full_name, u.employee_code, u.hourly_rate,
           a.id AS attendance_id, a.total_minutes, a.status,
           s.name AS shift_name, s.start_time, s.end_time,
           (SELECT cs.clock_in FROM clock_sessions cs
              WHERE cs.attendance_id = a.id AND cs.clock_out IS NULL
              ORDER BY cs.clock_in DESC LIMIT 1) AS current_clock_in,
           (SELECT COUNT(*) FROM clock_sessions cs
              WHERE cs.attendance_id = a.id) AS session_count
      FROM users u
      LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = ?
      LEFT JOIN employee_shifts es ON es.user_id = u.id AND es.effective_to IS NULL
      LEFT JOIN shifts s ON s.id = es.shift_id
     WHERE u.branch_id = ? AND u.role = 'employee' AND u.is_active = 1
     ORDER BY u.full_name
  `, [todayNP, branchId]);

  const [[pendingCorrections]] = await db.execute(`
    SELECT COUNT(*) AS count FROM correction_requests
     WHERE branch_id = ? AND status = 'pending'
  `, [branchId]);

  // Branch monthly salary
  const [branchSalary] = await db.execute(`
    SELECT sr.user_id, u.full_name, u.employee_code,
           sr.hourly_rate, sr.total_hours, sr.base_salary, sr.computed_at
      FROM salary_records sr
      JOIN users u ON u.id = sr.user_id
     WHERE sr.branch_id = ? AND sr.month = ? AND sr.year = ?
     ORDER BY u.full_name
  `, [branchId, month, year]);

  const [[salarySummary]] = await db.execute(`
    SELECT ROUND(SUM(base_salary), 2) AS total_salary,
           ROUND(SUM(total_hours), 2) AS total_hours
      FROM salary_records
     WHERE branch_id = ? AND month = ? AND year = ?
  `, [branchId, month, year]);

  res.json({
    role: 'branch_admin',
    nepal_date: todayNP,
    employees:  empStats,
    today:      todayStats,
    team_today: teamToday,
    pending_corrections: pendingCorrections.count,
    salary: {
      month, year,
      records:  branchSalary,
      summary:  salarySummary,
    },
  });
}

// ── Employee ──────────────────────────────────────────────────────────────────
async function employeeSummary(res, userId) {
  const todayNP = nepalDateStr();
  const nowNP   = nowNepal();
  const month   = nowNP.getMonth() + 1;
  const year    = nowNP.getFullYear();

  const [[att]] = await db.execute(
    `SELECT * FROM attendance WHERE user_id = ? AND work_date = ?`, [userId, todayNP]
  );

  let todaySessions = [];
  let openSession   = null;

  if (att) {
    const [rows] = await db.execute(
      `SELECT id, clock_in, clock_out, duration_min FROM clock_sessions
        WHERE attendance_id = ? ORDER BY clock_in ASC`, [att.id]
    );
    todaySessions = rows;
    openSession   = rows.find(s => !s.clock_out) || null;
  }

  // Cross-day check: if no open session found in today's rows,
  // look for an open session from a previous day (e.g. employee
  // clocked in yesterday at 22:00 and hasn't clocked out yet).
  if (!openSession) {
    const [[prevOpen]] = await db.execute(`
      SELECT cs.id, cs.clock_in, cs.clock_out, cs.duration_min, a.work_date
        FROM clock_sessions cs
        JOIN attendance a ON a.id = cs.attendance_id
       WHERE cs.user_id = ? AND cs.clock_out IS NULL
       ORDER BY cs.clock_in DESC
       LIMIT 1
    `, [userId]);
    if (prevOpen) openSession = prevOpen;
  }

  const [[monthStats]] = await db.execute(`
    SELECT
      COUNT(*) AS total_days,
      SUM(status IN ('present','late')) AS present_days,
      ROUND(SUM(total_minutes) / 60.0, 2) AS total_hours,
      ROUND(SUM(status IN ('present','late')) / NULLIF(COUNT(*), 0) * 100, 1) AS attendance_pct
    FROM attendance
    WHERE user_id = ? AND MONTH(work_date) = ? AND YEAR(work_date) = ?
  `, [userId, month, year]);

  const [recentHistory] = await db.execute(`
    SELECT a.work_date, a.total_minutes, a.status
      FROM attendance a
     WHERE a.user_id = ?
     ORDER BY a.work_date DESC LIMIT 10
  `, [userId]);

  // Attach sessions to recent history
  for (const row of recentHistory) {
    const [[histAtt]] = await db.execute(
      `SELECT id FROM attendance WHERE user_id = ? AND work_date = ?`, [userId, row.work_date]
    );
    if (histAtt) {
      const [sessions] = await db.execute(
        `SELECT id, clock_in, clock_out, duration_min FROM clock_sessions
          WHERE attendance_id = ? ORDER BY clock_in ASC`, [histAtt.id]
      );
      row.sessions = sessions;
    } else {
      row.sessions = [];
    }
  }

  const [[shiftInfo]] = await db.execute(`
    SELECT s.name, s.start_time, s.end_time
      FROM employee_shifts es
      JOIN shifts s ON s.id = es.shift_id
     WHERE es.user_id = ? AND es.effective_to IS NULL
  `, [userId]);

  // Salary records (own, last 12 months)
  const [salaryHistory] = await db.execute(`
    SELECT month, year, hourly_rate, total_hours, base_salary, currency, computed_at
      FROM salary_records
     WHERE user_id = ?
     ORDER BY year DESC, month DESC LIMIT 12
  `, [userId]);

  // Current month salary (may not be computed yet)
  const [[currentSalary]] = await db.execute(`
    SELECT * FROM salary_records
     WHERE user_id = ? AND month = ? AND year = ?
  `, [userId, month, year]);

  const [[userInfo]] = await db.execute(
    `SELECT hourly_rate FROM users WHERE id = ?`, [userId]
  );

  res.json({
    role: 'employee',
    nepal_date:      todayNP,
    nepal_time_now:  nowNP.toISOString().replace('T',' ').slice(0,19),
    clocked_in:      !!openSession,
    open_session:    openSession,
    today_sessions:  todaySessions,
    today:           att || null,
    month_stats:     monthStats,
    recent_history:  recentHistory,
    shift:           shiftInfo || null,
    hourly_rate:     userInfo?.hourly_rate || 0,
    salary: {
      month, year,
      current:  currentSalary || null,
      history:  salaryHistory,
    },
  });
}

module.exports = { summary };