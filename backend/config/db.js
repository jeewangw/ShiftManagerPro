// backend/config/db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'tramway.proxy.rlwy.net',
  port:               parseInt(process.env.DB_PORT || '47017'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || 'SpdgawFyGUIJlAShCPZpiEytQnrMPRSY',
  database:           process.env.DB_NAME     || 'railway',
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_POOL_MAX || '10'),
  queueLimit:         0,
  timezone:           '+00:00',
  charset:            'utf8mb4',
});

// Test connection on startup
pool.getConnection()
  .then(conn => { console.log('MySQL pool connected.'); conn.release(); })
  .catch(err => { console.error('MySQL connection failed:', err.message); process.exit(1); });

module.exports = pool;