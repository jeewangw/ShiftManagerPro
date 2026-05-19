// backend/controllers/salaryController.js
'use strict';
const db = require('../config/db');

// Nepal time helpers (mirrors attendanceController)
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
function nowNepal() { return new Date(Date.now() + NEPAL_OFFSET_MS); }

// ── GET /api/salary  ─────────────────────────────────────────────────────────
// Super admin: all; branch_admin: own branch; employee: own records
async function list(req, res) {
  const { role, id: callerId, branch_id: callerBranch } = req.user;
  const { branch_id, user_id, month, year } = req.query;

  const where  = [];
  const params = [];

  if (role === 'employee') {
    where.push('sr.user_id = ?'); params.push(callerId);
  } else if (role === 'branch_admin') {
    where.push('sr.branch_id = ?'); params.push(callerBranch);
    if (user_id) { where.push('sr.user_id = ?'); params.push(user_id); }
  } else {
    if (branch_id) { where.push('sr.branch_id = ?'); params.push(branch_id); }
    if (user_id)   { where.push('sr.user_id = ?');   params.push(user_id); }
  }

  if (month) { where.push('sr.month = ?'); params.push(parseInt(month)); }
  if (year)  { where.push('sr.year = ?');  params.push(parseInt(year)); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [rows] = await db.execute(`
    SELECT sr.*,
           u.full_name, u.employee_code,
           b.name AS branch_name
      FROM salary_records sr
      JOIN users    u ON u.id = sr.user_id
      JOIN branches b ON b.id = sr.branch_id
     ${whereClause}
     ORDER BY sr.year DESC, sr.month DESC, u.full_name
  `, params);

  res.json(rows);
}

// ── POST /api/salary/compute  ─────────────────────────────────────────────────
// Compute (or recompute) salary for a given month/year.
// Super admin: any branch; branch_admin: own branch only.
// ── POST /api/salary/compute ─────────────────────────────────────────────────
async function compute(req, res) {
  try {
    const { role, branch_id: callerBranch } = req.user;
    const nowNP = nowNepal();

    const month = parseInt(req.body.month) || (nowNP.getMonth() + 1);
    const year = parseInt(req.body.year) || nowNP.getFullYear();
    const branchId = role === 'super_admin' ? req.body.branch_id : callerBranch;

    if (!branchId) return res.status(400).json({ error: 'branch_id is required.' });

    const [employees] = await db.execute(
      `SELECT id, full_name, branch_id, hourly_rate FROM users 
       WHERE branch_id = ? AND role = 'employee' AND is_active = 1`, 
      [branchId]
    );

    const computed = [];

    for (const emp of employees) {
      // Sum all session minutes per work_date directly from clock_sessions.
      // This avoids relying on the cached attendance.total_minutes, which is
      // only updated on each individual clock-out and would cause the 6-hour
      // OT threshold to reset after a mid-day clock-out/clock-in cycle.
      // We also include any still-open sessions (clock_out IS NULL) via
      // TIMESTAMPDIFF so a compute triggered mid-day is still accurate.
      const [days] = await db.execute(
        `SELECT a.work_date,
                SUM(
                  TIMESTAMPDIFF(
                    MINUTE,
                    cs.clock_in,
                    COALESCE(cs.clock_out, NOW())
                  )
                ) AS day_minutes
           FROM attendance a
           JOIN clock_sessions cs ON cs.attendance_id = a.id
          WHERE a.user_id = ?
            AND MONTH(a.work_date) = ?
            AND YEAR(a.work_date)  = ?
          GROUP BY a.work_date`,
        [emp.id, month, year]
      );

      let regHoursTotal   = 0;
      let extraHoursTotal = 0;
      let totalPay        = 0;

      days.forEach(day => {
        // Use the full-day session sum — never reset by an intermediate clock-out
        const mins  = day.day_minutes || 0;
        const hours = mins / 60;

        if (mins > 360) {
          // Rule: first 6 hours at standard rate, remainder at 2×
          const dailyReg   = 6;
          const dailyExtra = hours - 6;
          regHoursTotal   += dailyReg;
          extraHoursTotal += dailyExtra;
          totalPay += (dailyReg * emp.hourly_rate) + (dailyExtra * emp.hourly_rate * 2);
        } else {
          // Rule: standard rate for days ≤ 6 hours
          regHoursTotal += hours;
          totalPay      += hours * emp.hourly_rate;
        }
      });

      const totalHours = regHoursTotal + extraHoursTotal;
      // extraPay = the OT premium above the flat hourly rate for all hours
      const extraPay = totalPay - (totalHours * emp.hourly_rate);

      // computed_up_to = last day of the month, or today if current month
      const lastDay = new Date(year, month, 0).getDate();
      const nowNPDate = nowNepal().toISOString().slice(0,10);
      const isCurrentMonth = (nowNepal().getFullYear() === year && (nowNepal().getMonth()+1) === month);
      const computedUpTo = isCurrentMonth ? nowNPDate : `${year}-${String(month).padStart(2,'0')}-${lastDay}`;

      await db.execute(`
        INSERT INTO salary_records 
          (user_id, branch_id, month, year, hourly_rate, total_hours, regular_hours, extra_hours, base_salary, extra_pay, computed_up_to, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_processed')
        ON DUPLICATE KEY UPDATE
          hourly_rate    = VALUES(hourly_rate),
          total_hours    = VALUES(total_hours),
          regular_hours  = VALUES(regular_hours),
          extra_hours    = VALUES(extra_hours),
          base_salary    = VALUES(base_salary),
          extra_pay      = VALUES(extra_pay),
          computed_up_to = VALUES(computed_up_to),
          computed_at    = NOW()
      `, [
        emp.id, emp.branch_id, month, year, emp.hourly_rate,
        totalHours, regHoursTotal, extraHoursTotal, totalPay, extraPay, computedUpTo
      ]);

      computed.push({ name: emp.full_name, totalHours, totalPay });
    }

    res.json({ message: `Salary recomputed with 2x OT rule.`, records: computed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/salary/my-salary  ────────────────────────────────────────────────
async function mySalary(req, res) {
  const userId = req.user.id;

  const [rows] = await db.execute(`
    SELECT sr.*, b.name AS branch_name
      FROM salary_records sr
      JOIN branches b ON b.id = sr.branch_id
     WHERE sr.user_id = ?
     ORDER BY sr.year DESC, sr.month DESC
     LIMIT 12
  `, [userId]);

  res.json(rows);
}

// ── GET /api/salary/:id  ──────────────────────────────────────────────────────
async function get(req, res) {
  const [[row]] = await db.execute(`
    SELECT sr.*, u.full_name, b.name AS branch_name
      FROM salary_records sr
      JOIN users    u ON u.id = sr.user_id
      JOIN branches b ON b.id = sr.branch_id
     WHERE sr.id = ?
  `, [req.params.id]);

  if (!row) return res.status(404).json({ error: 'Salary record not found.' });

  const { role, id: callerId, branch_id } = req.user;
  if (role === 'employee' && row.user_id !== callerId)
    return res.status(403).json({ error: 'Access denied.' });
  if (role === 'branch_admin' && row.branch_id !== branch_id)
    return res.status(403).json({ error: 'Access denied.' });

  res.json(row);
}

// ── PUT /api/salary/:id/rate  — update hourly rate for an employee ────────────
async function updateRate(req, res) {
  const { hourly_rate } = req.body;
  const { id: empId }   = req.params;

  if (hourly_rate === undefined || isNaN(hourly_rate)) {
    return res.status(400).json({ error: 'hourly_rate (NPR) is required.' });
  }
  if (parseFloat(hourly_rate) < 0) {
    return res.status(400).json({ error: 'hourly_rate cannot be negative.' });
  }

  // Scope: branch_admin can only update employees in their branch
  if (req.user.role === 'branch_admin') {
    const [[emp]] = await db.execute(`SELECT branch_id FROM users WHERE id = ?`, [empId]);
    if (!emp || emp.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
  }

  await db.execute(
    `UPDATE users SET hourly_rate = ? WHERE id = ? AND role = 'employee'`,
    [parseFloat(hourly_rate), empId]
  );

  const [[user]] = await db.execute(
    `SELECT id, full_name, hourly_rate FROM users WHERE id = ?`, [empId]
  );

  res.json({ message: 'Hourly rate updated.', user });
}

// ── PUT /api/salary/:id/status  — update payment status ─────────────────────
async function updateStatus(req, res) {
  const { status } = req.body;
  const validStatuses = ['not_processed', 'processing', 'paid_out'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be: not_processed, processing, or paid_out.' });
  }

  // Scope check for branch_admin
  if (req.user.role === 'branch_admin') {
    const [[rec]] = await db.execute(`SELECT branch_id FROM salary_records WHERE id = ?`, [req.params.id]);
    if (!rec || rec.branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
  }

  await db.execute(`UPDATE salary_records SET status = ? WHERE id = ?`, [status, req.params.id]);
  const [[updated]] = await db.execute(`SELECT * FROM salary_records WHERE id = ?`, [req.params.id]);
  res.json({ message: 'Salary status updated.', record: updated });
}

module.exports = { list, compute, mySalary, get, updateRate, updateStatus };