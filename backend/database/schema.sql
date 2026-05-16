-- ==========================================================
-- Shift Monitor Pro — MySQL Schema v2
-- Timezone: Asia/Kathmandu  (UTC+5:45)
-- Changes vs v1:
--   • All times stored in Nepal time (UTC+05:45)
--   • attendance table is now a daily summary row
--   • clock_sessions table allows multiple in/out per day
--   • users.hourly_rate (NPR) added
--   • salary_records table added
-- ==========================================================

CREATE DATABASE IF NOT EXISTS if0_41925321_shift_monitor_pro
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
  
USE if0_41925321_shift_monitor_pro;

-- Set session timezone so CURRENT_TIMESTAMP / NOW() = Nepal time
SET time_zone = '+05:45';

-- ----------------------------------------------------------
-- BRANCHES
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  city        VARCHAR(100) NOT NULL,
  address     VARCHAR(255),
  phone       VARCHAR(30),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- USERS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  branch_id       INT NULL,
  full_name       VARCHAR(120) NOT NULL,
  email           VARCHAR(150) NOT NULL UNIQUE,
  phone           VARCHAR(30),
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('super_admin','branch_admin','employee') NOT NULL DEFAULT 'employee',
  employee_code   VARCHAR(30) UNIQUE,
  hourly_rate     DECIMAL(10,2) NOT NULL DEFAULT 0.00,  -- NPR per hour
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_branch (branch_id),
  INDEX idx_role   (role),
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------
-- SHIFTS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  branch_id     INT NOT NULL,
  name          VARCHAR(80) NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  break_minutes SMALLINT NOT NULL DEFAULT 30,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_branch (branch_id),
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- EMPLOYEE → SHIFT assignment
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_shifts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  shift_id       INT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to   DATE NULL,
  UNIQUE KEY uq_current (user_id, effective_from),
  FOREIGN KEY (user_id)   REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (shift_id)  REFERENCES shifts(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- ATTENDANCE  (one summary row per employee per work_date)
-- total_minutes is recomputed each time a session closes
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  branch_id       INT NOT NULL,
  shift_id        INT NULL,
  work_date       DATE NOT NULL,          -- Nepal calendar date
  total_minutes   INT NOT NULL DEFAULT 0, -- sum of all closed sessions
  status          ENUM('present','absent','late','half_day','holiday') NOT NULL DEFAULT 'present',
  notes           TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_date (user_id, work_date),
  INDEX idx_branch_date (branch_id, work_date),
  INDEX idx_user_date   (user_id, work_date),
  FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id)  REFERENCES shifts(id)   ON DELETE SET NULL
);

-- ----------------------------------------------------------
-- CLOCK SESSIONS  (multiple in/out pairs per day allowed)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS clock_sessions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  attendance_id INT NOT NULL,
  user_id       INT NOT NULL,
  clock_in      DATETIME NOT NULL,    -- Nepal time
  clock_out     DATETIME NULL,        -- NULL = employee currently active
  duration_min  INT GENERATED ALWAYS AS (
                  CASE WHEN clock_out IS NOT NULL
                  THEN TIMESTAMPDIFF(MINUTE, clock_in, clock_out)
                  ELSE NULL END
                ) STORED,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_attendance (attendance_id),
  INDEX idx_user       (user_id),
  INDEX idx_user_in    (user_id, clock_in),
  FOREIGN KEY (attendance_id) REFERENCES attendance(id)    ON DELETE CASCADE,
  FOREIGN KEY (user_id)       REFERENCES users(id)         ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- SALARY RECORDS  (monthly computed, per employee)
-- Base salary = total logged hours × hourly_rate (NPR)
-- Does NOT include bonus of any kind.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS salary_records (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  branch_id       INT NOT NULL,
  month           TINYINT  NOT NULL,    -- 1–12
  year            SMALLINT NOT NULL,
  hourly_rate     DECIMAL(10,2) NOT NULL,   -- snapshot at time of calculation
  total_hours     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  base_salary     DECIMAL(12,2) NOT NULL DEFAULT 0.00,  -- NPR
  currency        VARCHAR(5)   NOT NULL DEFAULT 'NPR',
  computed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes           TEXT NULL,
  UNIQUE KEY uq_user_month_year (user_id, month, year),
  INDEX idx_branch_period (branch_id, year, month),
  FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

ALTER TABLE salary_records 
ADD COLUMN regular_hours DECIMAL(10,2) DEFAULT 0.00 AFTER total_hours,
ADD COLUMN extra_hours DECIMAL(10,2) DEFAULT 0.00 AFTER regular_hours,
ADD COLUMN extra_pay DECIMAL(12,2) DEFAULT 0.00 AFTER base_salary;

-- ----------------------------------------------------------
-- CORRECTION REQUESTS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS correction_requests (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  attendance_id INT NULL,
  session_id    INT NULL,
  user_id       INT NOT NULL,
  branch_id     INT NOT NULL,
  work_date     DATE NOT NULL,
  issue_type    ENUM('missed_clock_in','missed_clock_out','wrong_time','technical_error','other') NOT NULL,
  description   TEXT NOT NULL,
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  resolved_by   INT NULL,
  resolved_at   DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_branch_status (branch_id, status),
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- NOTIFICATIONS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  title      VARCHAR(150) NOT NULL,
  body       TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_read (user_id, is_read),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- REFRESH TOKENS
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- SEED: Super Admin  (run node database/seed.js to set real hash)
-- ----------------------------------------------------------
INSERT IGNORE INTO users (full_name, email, role, password_hash, employee_code, hourly_rate)
VALUES (
  'Super Admin',
  'admin@shiftmonitorpro.com',
  'super_admin',
  '$2a$12$placeholder_replace_with_real_bcrypt_hash',
  'SA-001',
  0.00
);