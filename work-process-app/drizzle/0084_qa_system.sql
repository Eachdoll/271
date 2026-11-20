-- 15.306 품질 2단계(QA 체계): 문서관리 · 변경관리 · 교육·자격 · 협력업체 품질. 기존 표·데이터는 그대로.
-- quality_docs: 내부문서(매뉴얼·절차서·지침서·양식)와 외부문서(규격·법규·고객 요구서) 대장.
-- 내부문서는 초안 → 검토 → 승인·배포(품질책임자) → 폐지. 개정하면 판(rev)이 오르고, 승인된 판은 versions(JSON)에 파일과 함께 쌓인다.
CREATE TABLE quality_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT NOT NULL,
  title TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'internal',
  kind TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  edition TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  dept TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  file_json TEXT NOT NULL DEFAULT '{}',
  versions TEXT NOT NULL DEFAULT '[]',
  effective_date TEXT,
  review_months INTEGER NOT NULL DEFAULT 12,
  next_review TEXT,
  retention_years INTEGER NOT NULL DEFAULT 3,
  obsolete_date TEXT,
  dispose_date TEXT,
  access_depts TEXT NOT NULL DEFAULT '[]',
  training_needed INTEGER NOT NULL DEFAULT 0,
  change_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
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
CREATE UNIQUE INDEX quality_docs_no ON quality_docs(doc_no);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_docs_request ON quality_docs(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- quality_changes: 변경관리(4M + 설계·규격). 요청 → 영향평가 → 승인(품질책임자) → 적용(적용일·초물 LOT) → 검증완료. 번호 CHG-YYMMDD-NN.
-- 출처: 직접 요청, CAPA 조치(capa), 협력업체 변경점(supplier).
CREATE TABLE quality_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_no TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  item TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  before_text TEXT NOT NULL DEFAULT '',
  after_text TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'internal',
  source_id INTEGER,
  source_no TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  impact_json TEXT NOT NULL DEFAULT '{}',
  plan_date TEXT,
  apply_date TEXT,
  first_lot TEXT NOT NULL DEFAULT '',
  verify_date TEXT,
  verify_result TEXT NOT NULL DEFAULT '',
  verify_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',
  requester_name TEXT NOT NULL DEFAULT '',
  requester_id INTEGER,
  owner_name TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_changes_no ON quality_changes(change_no);
--> statement-breakpoint
CREATE UNIQUE INDEX quality_changes_request ON quality_changes(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- trainings: 교육 계획·실적(OJT·정기·직무·외부·문서 개정 교육). 계획 → 실시 → 평가완료.
CREATE TABLE trainings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  done_date TEXT,
  hours REAL,
  instructor TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  eval_method TEXT NOT NULL DEFAULT '',
  doc_id INTEGER,
  doc_label TEXT NOT NULL DEFAULT '',
  change_id INTEGER,
  status TEXT NOT NULL DEFAULT 'planned',
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
CREATE UNIQUE INDEX trainings_request ON trainings(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- training_attendees: 교육 대상자(회원). 본인이 참석 확인, 담당이 평가(점수·결과).
CREATE TABLE training_attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  training_id INTEGER NOT NULL,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  dept TEXT NOT NULL DEFAULT '',
  attended INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  score REAL,
  result TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE UNIQUE INDEX training_attendees_one ON training_attendees(training_id, user_name);
--> statement-breakpoint
-- qualifications: 자격(검사원·내부심사원·외부 자격증 등) 취득·만료 관리.
CREATE TABLE qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  cert_no TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  acquired_date TEXT,
  expire_date TEXT,
  status TEXT NOT NULL DEFAULT 'valid',
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
CREATE UNIQUE INDEX qualifications_request ON qualifications(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- supplier_evals: 매입처 연 1회 유효성평가(품질·납기·대응 점수 → 등급 A~D). 수입검사 건수·불합격은 평가 때의 값을 함께 남긴다.
CREATE TABLE supplier_evals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor TEXT NOT NULL,
  vendor_key TEXT NOT NULL,
  year INTEGER NOT NULL,
  quality_score REAL NOT NULL,
  delivery_score REAL NOT NULL,
  response_score REAL NOT NULL,
  total REAL NOT NULL,
  grade TEXT NOT NULL,
  iqc_total INTEGER NOT NULL DEFAULT 0,
  iqc_fail INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  evaluated_by TEXT NOT NULL DEFAULT '',
  evaluated_at TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_evals_one ON supplier_evals(vendor_key, year);
--> statement-breakpoint
-- supplier_coas: 공급사 COA 수령(수입검사 의뢰 1건 = 입고 LOT 1개). 파일(PDF·사진)은 회사 저장소, 이름만 기록.
CREATE TABLE supplier_coas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '[]',
  received_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_coas_one ON supplier_coas(inspection_id);
