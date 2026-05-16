// backend/config/db.js
const mysql = require('mysql2/promise');
require('dotenv').config(); // Ensure env variables are completely loaded

const pool = mysql.createPool({
  // Dynamically pull variables from Vercel's dashboard settings, falling back to Railway's public string
  host:             process.env.DB_HOST     || 'tramway.proxy.rlwy.net',
  port:             parseInt(process.env.DB_PORT || '47017'),
  user:             process.env.DB_USER     || 'root',
  password:         process.env.DB_PASSWORD || 'SpdgawFyGUIJlAShCPZpiEytQnrMPRSY',
  database:         process.env.DB_NAME     || 'railway',
  
  waitForConnections: true,
  // CRITICAL FOR VERCEL: Keep connectionLimit low (2-3) 
  // Each parallel Vercel function creates its own pool; a high number will exhaust Railway immediately.
  connectionLimit:    parseInt(process.env.DB_POOL_MAX || '3'),
  queueLimit:         0,
  timezone:           '+00:00',
  charset:            'utf8mb4',
  
  // Cloud Handshake Timing Protections
  connectTimeout:     15000, // 15 seconds to establish connection over the open internet
  acquireTimeout:     15000  // 15 seconds to safely fetch a connection from the pool
});

// REMOVED: pool.getConnection().catch(process.exit(1)) 
// This keeps the Vercel build container alive during initialization!

module.exports = pool;