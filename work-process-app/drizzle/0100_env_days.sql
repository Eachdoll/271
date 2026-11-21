-- 15.344 환경점검 날짜 예외: 회사 휴일(holiday) · 특근(workday, 휴무일에 점검) · 라인 비가동(off, 구역 또는 라인 전체=zone_id 0). 새 표 추가만.
CREATE TABLE env_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  zone_id INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX env_days_key ON env_days(kind, area, zone_id, day);
--> statement-breakpoint
CREATE INDEX env_days_day ON env_days(day);
