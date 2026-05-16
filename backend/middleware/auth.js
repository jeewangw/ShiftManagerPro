// backend/middleware/auth.js
const jwt = require('jsonwebtoken');

/**
 * Verifies the Bearer access token in Authorization header.
 * Attaches decoded payload to req.user.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired.' : 'Invalid token.';
    return res.status(401).json({ error: msg });
  }
}

/**
 * Role guard — pass one or more allowed roles.
 * Usage: authorize('super_admin', 'branch_admin')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' });
    }
    next();
  };
}

/**
 * Branch scope guard — branch_admin can only access their own branch.
 * Super admin bypasses this check.
 * Expects :branchId param or req.body.branch_id / req.query.branch_id.
 */
function branchScope(req, res, next) {
  if (req.user.role === 'super_admin') return next();

  const requested = parseInt(
    req.params.branchId || req.body.branch_id || req.query.branch_id
  );

  if (!requested || req.user.branch_id !== requested) {
    return res.status(403).json({ error: 'Access restricted to your branch.' });
  }
  next();
}

module.exports = { authenticate, authorize, branchScope };