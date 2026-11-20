-- 15.314 조직도 · 지정 담당자. 기존 표·데이터는 그대로(부서 표에 칸 두 개만 더함, 기본값 비어 있음).
-- org_departments.head_user_id: 부서장(조직도 상자 맨 위). duties: 부서 업무 분장(조직도에 표시).
ALTER TABLE org_departments ADD COLUMN head_user_id INTEGER;
--> statement-breakpoint
ALTER TABLE org_departments ADD COLUMN duties TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
-- org_duty_assignments: 법정·사내 지정 담당자(정보보호담당자·개인정보 보호책임자·소방안전관리자·안전보건관리책임자 등).
-- 정(user_id/person_name)·부(deputy) 담당자, 범위(전사·부서), 선임일·신고일·종료일, 법적 근거·자격, 법정교육 주기·최근·다음 교육일, 별도 담당 업무(tasks).
CREATE TABLE org_duty_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duty_key TEXT NOT NULL DEFAULT 'custom',
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'etc',
  user_id INTEGER,
  person_name TEXT NOT NULL DEFAULT '',
  deputy_user_id INTEGER,
  deputy_name TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  appointed_date TEXT,
  report_date TEXT,
  end_date TEXT,
  legal_basis TEXT NOT NULL DEFAULT '',
  qualification TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  training_cycle INTEGER NOT NULL DEFAULT 0,
  last_training TEXT,
  next_training TEXT,
  tasks TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE INDEX org_duty_user ON org_duty_assignments(user_id, active);
--> statement-breakpoint
CREATE UNIQUE INDEX org_duty_request ON org_duty_assignments(request_id) WHERE request_id IS NOT NULL;
