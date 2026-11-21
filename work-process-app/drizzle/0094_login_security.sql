-- 15.329 접속 보안: 로그인 기록(IP·국가·도시·결과)과 사용자별 최근 접속. 새 표와 새 칸만(기존 자료는 그대로).
CREATE TABLE login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'ok',
  ip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX login_logs_user ON login_logs(user_id, id);
--> statement-breakpoint
CREATE INDEX login_logs_created ON login_logs(created_at);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_ip TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_country TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_city TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN last_login_at TEXT;
