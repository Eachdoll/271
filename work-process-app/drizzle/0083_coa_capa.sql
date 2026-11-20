-- 15.305 품질 1단계: LOT별 COA(성적서) 발행과 부적합·CAPA. 기존 표·데이터는 그대로.
-- coas: LOT 1개 = COA 1장(발행번호 COA-YYMMDD-NN). 출하검사·분석 측정값을 항목 스냅숏(items_json)으로 복사, 작성 → 승인(품질책임자) → 재발행 시 Rev 증가, 무효.
CREATE TABLE coas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coa_no TEXT NOT NULL,
  lot TEXT NOT NULL,
  item TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  spec TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  qty REAL,
  unit TEXT NOT NULL DEFAULT '',
  mfg_date TEXT,
  exp_date TEXT,
  ship_date TEXT,
  source_request_id INTEGER,
  source_no TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL DEFAULT '[]',
  judge TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT 'ko',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  rev INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT NOT NULL DEFAULT '',
  approved_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX coas_no ON coas(coa_no);
--> statement-breakpoint
CREATE INDEX coas_lot ON coas(lot);
--> statement-breakpoint
CREATE UNIQUE INDEX coas_request ON coas(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- nonconformities: 부적합·일탈(OOS·OOT·공정 이상·고객 불만·심사 지적) → 원인분석 → 시정·예방조치 → 유효성검증 → 종결(CAPA). 번호 NC-YYMMDD-NN.
CREATE TABLE nonconformities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nc_no TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'other',
  source_id INTEGER,
  source_no TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'OOS',
  grade TEXT NOT NULL DEFAULT 'minor',
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL DEFAULT '',
  qty REAL,
  found_date TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  containment TEXT NOT NULL DEFAULT '',
  cause_json TEXT NOT NULL DEFAULT '{}',
  correction TEXT NOT NULL DEFAULT '',
  corrective TEXT NOT NULL DEFAULT '',
  preventive TEXT NOT NULL DEFAULT '',
  action_date TEXT,
  verify_date TEXT,
  verify_result TEXT NOT NULL DEFAULT '',
  verify_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
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
CREATE UNIQUE INDEX nonconformities_no ON nonconformities(nc_no);
--> statement-breakpoint
CREATE INDEX nonconformities_source ON nonconformities(source_type, source_id);
--> statement-breakpoint
CREATE INDEX nonconformities_status ON nonconformities(status, due_date);
--> statement-breakpoint
CREATE UNIQUE INDEX nonconformities_request ON nonconformities(request_id) WHERE request_id IS NOT NULL;
