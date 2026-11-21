-- 15.335 협력업체 연간 평가계획: 업체·평가 종류·계획 월 → 실시(실시일·결과). 유효성평가를 저장하면 같은 해 정기·재평가 계획이 실시로 바뀜. 새 표만.
CREATE TABLE supplier_eval_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  vendor TEXT NOT NULL,
  vendor_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'regular',
  plan_month INTEGER NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  done_date TEXT,
  result TEXT NOT NULL DEFAULT '',
  eval_id INTEGER,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE INDEX supplier_eval_plans_year ON supplier_eval_plans(year, plan_month);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_eval_plans_request ON supplier_eval_plans(request_id) WHERE request_id IS NOT NULL;
