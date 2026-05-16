// database/seed.js
// Run: node database/seed.js
// Creates the Super Admin with a proper bcrypt hash

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql  = require('mysql2/promise');

async function seed() {
  const db = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 3306,
    user:     process.env.DB_USER     || 'root',
    database: process.env.DB_NAME     || 'shift_monitor_pro',
  });

  console.log('Connected to MySQL.');

  const password   = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
  const hash       = await bcrypt.hash(password, 12);

  // Upsert super admin
  await db.execute(`
    INSERT INTO users (full_name, email, role, password_hash, employee_code)
    VALUES (?, ?, 'super_admin', ?, 'SA-001')
    ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)
  `, ['Super Admin', 'admin@shiftmonitorpro.com', hash]);

  console.log(`Super Admin seeded.`);
  console.log(`  Email   : admin@shiftmonitorpro.com`);
  console.log(`  Password: ${password}`);
  console.log('Change the password immediately after first login.');

  await db.end();
}

seed().catch(err => { console.error(err); process.exit(1); });