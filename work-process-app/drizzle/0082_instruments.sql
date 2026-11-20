-- 15.304 품질 › 검교정 관리(계측기 대장): 관리번호·장비명·모델명·제조사·S/N·측정 범위·위치·사용 부서·담당자·구입일·교정 주기(개월)·교정 방식·교정기관·
-- 직전 교정일·다음 교정일·성적서 번호·결과·상태(사용 중·교정 중·사용중지·예비·폐기)·메모·교정 이력(JSON).
CREATE TABLE instruments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mgmt_no TEXT NOT NULL,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  maker TEXT NOT NULL DEFAULT '',
  serial_no TEXT NOT NULL DEFAULT '',
  spec TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  location_detail TEXT NOT NULL DEFAULT '',
  dept TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  purchase_date TEXT,
  cycle_months INTEGER NOT NULL DEFAULT 12,
  cal_type TEXT NOT NULL DEFAULT 'external',
  cal_agency TEXT NOT NULL DEFAULT '',
  last_cal TEXT,
  next_due TEXT,
  cert_no TEXT NOT NULL DEFAULT '',
  last_result TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_use',
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
CREATE UNIQUE INDEX instruments_mgmt_no ON instruments(mgmt_no);
--> statement-breakpoint
CREATE INDEX instruments_next_due ON instruments(next_due);
--> statement-breakpoint
CREATE UNIQUE INDEX instruments_request ON instruments(request_id) WHERE request_id IS NOT NULL;
