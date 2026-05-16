// backend/config/db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'shift_monitor_pro',
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