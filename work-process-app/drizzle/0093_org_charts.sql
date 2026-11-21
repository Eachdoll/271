-- 15.323 조직도 여러 개 저장(공식 조직도 외 SBL 조직도 등). 공식 조직도는 지금처럼 부서·구성원에서 그리고,
-- 여기에는 따로 저장해 쓰는 조직도(상자 트리·부서장·구성원(회원 또는 이름만)·역할·업무)를 JSON으로 둔다. 새 표만.
CREATE TABLE org_charts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX org_charts_request ON org_charts(request_id) WHERE request_id IS NOT NULL;
