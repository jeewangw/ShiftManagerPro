// backend/server.js
'use strict';
require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const compression  = require('compression');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');

const app = express();

// ── Trust Railway/Render reverse proxy ───────────────────────────────────────
// Required so express-rate-limit can read the real client IP from the
// X-Forwarded-For header without throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
// '1' means trust the first proxy hop (Railway's load balancer).
app.set('trust proxy', 1);

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());

// CORS_ORIGIN=* is fine for demos.
// Note: credentials (cookies) cannot be sent with a wildcard origin, so we
// disable credentials when using * — the frontend uses Bearer tokens anyway.
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5500';
app.use(cors({
  origin:      corsOrigin === '*' ? '*' : corsOrigin,
  credentials: corsOrigin !== '*',
}));

app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Global rate limiter ───────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max:      200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
}));

// Stricter limiter for auth routes
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  message: { error: 'Too many login attempts, please try again in 15 minutes.' },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/authRoute'));
app.use('/api/branches',    require('./routes/branches'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/attendance',  require('./routes/attendance'));
app.use('/api/corrections', require('./routes/corrections'));
app.use('/api/shifts',      require('./routes/shifts'));
app.use('/api/dashboard',   require('./routes/dashboard'));
app.use('/api/salary',      require('./routes/salary'));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route ${req.path} not found.` }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const msg    = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error.'
    : err.message || 'Internal server error.';
  res.status(status).json({ error: msg });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '5000');
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

module.exports = app;