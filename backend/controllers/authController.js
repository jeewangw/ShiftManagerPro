// backend/controllers/authController.js
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../config/db');

// ── helpers ──────────────────────────────────────────────────────────────────

function issueAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, branch_id: user.branch_id },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
}

async function issueRefreshToken(userId) {
  const raw  = crypto.randomBytes(64).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const exp  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.execute(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)`,
    [userId, hash, exp]
  );
  return raw;
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const [[user]] = await db.execute(
    `SELECT id, full_name, email, password_hash, role, branch_id, is_active
       FROM users WHERE email = ? LIMIT 1`,
    [email.toLowerCase().trim()]
  );

  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

  const accessToken  = issueAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);

  // httpOnly cookie for refresh token
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });

  return res.json({
    accessToken,
    user: {
      id:        user.id,
      full_name: user.full_name,
      email:     user.email,
      role:      user.role,
      branch_id: user.branch_id,
    },
  });
}

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
async function refresh(req, res) {
  const raw = req.cookies?.refreshToken;
  if (!raw) return res.status(401).json({ error: 'No refresh token.' });

  const hash = crypto.createHash('sha256').update(raw).digest('hex');

  const [[row]] = await db.execute(
    `SELECT rt.user_id, rt.expires_at,
            u.id, u.email, u.role, u.branch_id, u.is_active
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = ? LIMIT 1`,
    [hash]
  );

  if (!row || !row.is_active || new Date(row.expires_at) < new Date()) {
    res.clearCookie('refreshToken');
    return res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }

  // Rotate: delete old, issue new
  await db.execute(`DELETE FROM refresh_tokens WHERE token_hash = ?`, [hash]);
  const newRefresh = await issueRefreshToken(row.user_id);
  const accessToken = issueAccessToken(row);

  res.cookie('refreshToken', newRefresh, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   7 * 24 * 60 * 60 * 1000,
  });

  return res.json({ accessToken });
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
async function logout(req, res) {
  const raw = req.cookies?.refreshToken;
  if (raw) {
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    await db.execute(`DELETE FROM refresh_tokens WHERE token_hash = ?`, [hash]);
  }
  res.clearCookie('refreshToken');
  return res.json({ message: 'Logged out.' });
}

// ── POST /api/auth/change-password ────────────────────────────────────────────
async function changePassword(req, res) {
  const { current_password, new_password } = req.body;
  const userId = req.user.id;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Both fields required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const [[user]] = await db.execute(
    `SELECT password_hash FROM users WHERE id = ?`, [userId]
  );
  const match = await bcrypt.compare(current_password, user.password_hash);
  if (!match) return res.status(400).json({ error: 'Current password is incorrect.' });

  const hash = await bcrypt.hash(new_password, 12);
  await db.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, userId]);

  return res.json({ message: 'Password changed successfully.' });
}

module.exports = { login, refresh, logout, changePassword };