-- Contractor sign-in / sign-out timesheets.
-- All timestamps are ISO-8601 UTC strings; work_date is the Australia/Brisbane
-- calendar date (YYYY-MM-DD) the shift started on.

CREATE TABLE workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  surname TEXT NOT NULL,
  mobile TEXT NOT NULL,            -- normalised 04XXXXXXXX
  company TEXT NOT NULL,           -- contract / labour-hire company
  inducted_at TEXT NOT NULL,       -- when they ticked "I have been inducted…"
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX workers_mobile ON workers(mobile);

CREATE TABLE shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  work_date TEXT NOT NULL,
  arrived_at TEXT NOT NULL,          -- the time that counts (override or click)
  arrived_clicked_at TEXT NOT NULL,  -- when the button was actually pressed
  finished_at TEXT,
  finished_clicked_at TEXT,
  break_taken INTEGER,               -- NULL = not asked yet, 0 = no, 1 = yes
  break_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (worker_id, work_date)
);
CREATE INDEX shifts_date ON shifts(work_date);

-- Every manager override (kiosk) or manager edit (admin), for audit.
-- No FK on shift_id so a deleted shift keeps its history.
CREATE TABLE adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  field TEXT NOT NULL,         -- arrived_at | finished_at | break_minutes | created | deleted
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,        -- kiosk_override | admin_edit
  created_at TEXT NOT NULL
);
CREATE INDEX adjustments_date ON adjustments(work_date);

-- Manager-code attempts, for a simple lockout after repeated wrong codes.
CREATE TABLE code_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  ok INTEGER NOT NULL
);

-- One row per weekly summary email, so a cron retry never double-sends.
CREATE TABLE summary_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT,
  trigger TEXT NOT NULL        -- cron | manual
);
