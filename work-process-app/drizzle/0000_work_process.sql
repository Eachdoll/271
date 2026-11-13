


CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  pw_salt TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  roles TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  req_no TEXT NOT NULL, vendor TEXT NOT NULL, item TEXT NOT NULL,
  qty REAL NOT NULL, due_date TEXT, note TEXT DEFAULT '',
  recv_status TEXT NOT NULL DEFAULT '', recv_qty REAL, recv_note TEXT DEFAULT '',
  recv_by TEXT, recv_at TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE IF NOT EXISTS laundry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  in_date TEXT NOT NULL, in_qty REAL, discard_qty REAL NOT NULL,
  note TEXT DEFAULT '', photos TEXT NOT NULL DEFAULT '[]',
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,              -- analysis | development | sample
  status TEXT NOT NULL DEFAULT 'pending', -- pending | rejected | waiting | progress | done
  req_no TEXT,
  title TEXT NOT NULL,
  customer TEXT DEFAULT '',
  due_date TEXT,
  category TEXT DEFAULT '',        -- 분석: 수입검사/의뢰검사/출하검사/공정검사
  target_price TEXT DEFAULT '',    -- 개발: 타겟단가
  data TEXT NOT NULL DEFAULT '{}',
  requester_id INTEGER, requester_name TEXT,
  approver_name TEXT, approved_at TEXT, reject_reason TEXT DEFAULT '',
  result_note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,              -- finished(완제품) | semi(반제품)
  period TEXT NOT NULL,            -- day | week | month
  start_date TEXT NOT NULL,        -- day: 그날, week: 그 주 월요일, month: 그 달 1일
  product TEXT NOT NULL, qty REAL NOT NULL, note TEXT DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_date TEXT NOT NULL, item TEXT NOT NULL, qty REAL NOT NULL,
  customer TEXT NOT NULL, note TEXT DEFAULT '',
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);

CREATE UNIQUE INDEX requests_req_no_unique ON requests(req_no);
CREATE TABLE login_attempts (name TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, until_at INTEGER NOT NULL DEFAULT 0);
