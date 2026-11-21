-- 15.343 생산 › 환경점검: 구역(창고·라인) · 일별 점검일지(온습도 오전/오후 · 라인 청소 체크시트) · 점검자 → 확인자 → 승인자 결재. 새 표 추가만.
CREATE TABLE env_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area TEXT NOT NULL,
  name TEXT NOT NULL,
  temp_min REAL,
  temp_max REAL,
  hum_min REAL,
  hum_max REAL,
  clean_items TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE INDEX env_zones_area ON env_zones(area, active, sort);
--> statement-breakpoint
CREATE TABLE env_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  area TEXT NOT NULL,
  check_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  comment TEXT NOT NULL DEFAULT '',
  nc_id INTEGER,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX env_sheets_day ON env_sheets(kind, area, check_date);
--> statement-breakpoint
CREATE INDEX env_sheets_status ON env_sheets(status, check_date);
--> statement-breakpoint
CREATE TABLE env_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id INTEGER NOT NULL REFERENCES env_sheets(id),
  zone_id INTEGER NOT NULL REFERENCES env_zones(id),
  slot TEXT NOT NULL,
  zone_name TEXT NOT NULL DEFAULT '',
  temp REAL,
  hum REAL,
  results TEXT NOT NULL DEFAULT '[]',
  ok INTEGER NOT NULL DEFAULT 1,
  skipped INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT '',
  checked_by TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX env_records_slot ON env_records(sheet_id, zone_id, slot);
--> statement-breakpoint
CREATE INDEX env_records_zone ON env_records(zone_id);
