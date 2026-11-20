-- 15.307 품질 3단계: 생산 › 공무(설비·예방보전) · 품질 › 공정품질(PQC·SPC) · 시험법·신뢰성. 기존 표·데이터는 그대로.
-- equipment: 설비 대장(설비번호·호기·위치·제조사). pm_items(JSON)에 예방보전 항목·주기·점검표·직전 수행일·다음 예정일.
CREATE TABLE equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equip_no TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  unit_name TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  maker TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial_no TEXT NOT NULL DEFAULT '',
  install_date TEXT,
  owner_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  pm_items TEXT NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX equipment_no ON equipment(equip_no);
--> statement-breakpoint
CREATE UNIQUE INDEX equipment_request ON equipment(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- equipment_logs: 설비 이력(예방보전 수행·고장·수리·개조). PM 수행은 점검표 결과(JSON), 고장은 비가동 시간·조치·부품·비용.
CREATE TABLE equipment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  log_date TEXT NOT NULL,
  pm_key TEXT NOT NULL DEFAULT '',
  pm_name TEXT NOT NULL DEFAULT '',
  checks TEXT NOT NULL DEFAULT '[]',
  result TEXT NOT NULL DEFAULT '',
  downtime_hours REAL,
  description TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  parts TEXT NOT NULL DEFAULT '',
  cost REAL,
  worker_name TEXT NOT NULL DEFAULT '',
  nc_id INTEGER,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX equipment_logs_equipment ON equipment_logs(equipment_id, log_date);
--> statement-breakpoint
CREATE UNIQUE INDEX equipment_logs_request ON equipment_logs(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- process_points: 공정 관리항목(공정 조건·측정)과 환경측정 지점(클린룸 파티클·온습도·차압). 기준(하한~상한)·단위·측정주기.
CREATE TABLE process_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'process',
  place TEXT NOT NULL,
  item TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  lsl REAL,
  usl REAL,
  target REAL,
  cycle TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX process_points_one ON process_points(kind, place, item);
--> statement-breakpoint
-- process_measures: 측정값 한 줄 = 한 값. 측정 때의 기준(lsl·usl)을 함께 남겨 기준이 바뀌어도 판정이 그대로.
CREATE TABLE process_measures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  point_id INTEGER NOT NULL,
  measured_on TEXT NOT NULL,
  measured_time TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  lsl REAL,
  usl REAL,
  out_of_spec INTEGER NOT NULL DEFAULT 0,
  lot TEXT NOT NULL DEFAULT '',
  machine TEXT NOT NULL DEFAULT '',
  measurer TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX process_measures_point ON process_measures(point_id, measured_on);
--> statement-breakpoint
CREATE UNIQUE INDEX process_measures_request ON process_measures(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- test_methods: 시험법 대장(번호·이름·관련 규격·측정 항목·조건·사용 계측기(검교정 instruments.id)·SOP 파일·판).
CREATE TABLE test_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method_no TEXT NOT NULL,
  name TEXT NOT NULL,
  standard TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '',
  conditions TEXT NOT NULL DEFAULT '',
  instrument_ids TEXT NOT NULL DEFAULT '[]',
  file_json TEXT NOT NULL DEFAULT '{}',
  rev INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
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
CREATE UNIQUE INDEX test_methods_no ON test_methods(method_no);
--> statement-breakpoint
CREATE UNIQUE INDEX test_methods_request ON test_methods(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- reliability_tests: 신뢰성평가(내열·수명·보관 등). 계획 → 시험 중 → 완료(적합/부적합). 항목·기준(spec_json)과 측정 시점별 값(points_json).
CREATE TABLE reliability_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_no TEXT NOT NULL,
  title TEXT NOT NULL,
  item TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  method_id INTEGER,
  conditions TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  spec_json TEXT NOT NULL DEFAULT '[]',
  points_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planned',
  judge TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
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
CREATE UNIQUE INDEX reliability_tests_no ON reliability_tests(test_no);
--> statement-breakpoint
CREATE UNIQUE INDEX reliability_tests_request ON reliability_tests(request_id) WHERE request_id IS NOT NULL;
