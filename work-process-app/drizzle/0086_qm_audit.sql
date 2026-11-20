-- 15.308 품질 4단계: 심사(Audit) 관리 · 밸리데이션 · 품질목표·KPI · 리스크 관리. 기존 표·데이터는 그대로.
-- quality_audits: 심사 계획·실시(고객사 수검·내부심사·협력사 심사·인증심사). 계획 → 실시 → 시정 중 → 종결. 체크리스트·보고서 파일은 JSON.
CREATE TABLE quality_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_no TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  cert_id INTEGER,
  plan_date TEXT NOT NULL,
  done_date TEXT,
  auditors TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  checklist TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planned',
  closed_by TEXT NOT NULL DEFAULT '',
  closed_at TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_audits_no ON quality_audits(audit_no);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_audits_request ON quality_audits(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- audit_findings: 지적사항(중·경·권고). 중·경 지적은 부적합·CAPA(출처 심사 지적)를 자동으로 만들어 nc_id로 잇는다.
CREATE TABLE audit_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL,
  grade TEXT NOT NULL,
  clause TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  dept TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  nc_id INTEGER,
  obs_done INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX audit_findings_audit ON audit_findings(audit_id);
--> statement-breakpoint
CREATE UNIQUE INDEX audit_findings_request ON audit_findings(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- validations: 밸리데이션(설비 IQ/OQ/PQ · 공정 · 시험법 · 세척 · 시스템). 단계(JSON)별 수행·결과, 프로토콜·보고서 파일, 재밸리데이션 주기.
-- 계획 → 수행 → 적합/부적합(품질책임자 판정).
CREATE TABLE validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  val_no TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'process',
  target_id INTEGER,
  target_label TEXT NOT NULL DEFAULT '',
  stages TEXT NOT NULL DEFAULT '[]',
  files TEXT NOT NULL DEFAULT '[]',
  criteria TEXT NOT NULL DEFAULT '',
  cycle_months INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  change_id INTEGER,
  owner_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  judge_note TEXT NOT NULL DEFAULT '',
  judged_by TEXT NOT NULL DEFAULT '',
  judged_at TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX validations_no ON validations(val_no);
--> statement-breakpoint
CREATE UNIQUE INDEX validations_request ON validations(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- quality_goals: 연도별 품질목표(지표·단위·방향·연간 목표값)·전략·예산·개선계획·담당. metric이 있으면 실적을 자동 집계.
CREATE TABLE quality_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  title TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'down',
  target REAL,
  strategy TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  budget REAL,
  owner_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'plan',
  note TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE INDEX quality_goals_year ON quality_goals(year);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_goals_request ON quality_goals(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- quality_kpi_values: 목표별 월 목표·실적(자동 지표는 실적을 저장하지 않고 화면에서 집계, 월 목표만 저장).
CREATE TABLE quality_kpi_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  target REAL,
  actual REAL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_kpi_values_one ON quality_kpi_values(goal_id, month);
--> statement-breakpoint
-- quality_risks: 리스크·기회 등록부. 발생가능성×영향도(1~5) = 점수·등급, 대응계획·담당·기한, 재평가(대응 후 점수). 식별 → 대응 중 → 종결.
CREATE TABLE quality_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  risk_no TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'risk',
  area TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  cause TEXT NOT NULL DEFAULT '',
  likelihood INTEGER NOT NULL,
  impact INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  re_likelihood INTEGER,
  re_impact INTEGER,
  review_date TEXT,
  next_review TEXT,
  status TEXT NOT NULL DEFAULT 'identified',
  note TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_risks_no ON quality_risks(risk_no);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_risks_request ON quality_risks(request_id) WHERE request_id IS NOT NULL;
