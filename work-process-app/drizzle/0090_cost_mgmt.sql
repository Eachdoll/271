-- 15.318 구매 › 원가 산출 관리. 기존 표·데이터는 그대로(새 표만).
-- cost_rates: 공통 기준(시점별 버전) — 시간당 인건비(1 WH 실지출), 제조경비율·판관비율·불량률(%), 환율(JSON {USD,EUR,JPY,CNY}).
CREATE TABLE cost_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_date TEXT NOT NULL,
  labor_rate REAL NOT NULL DEFAULT 0,
  mfg_rate REAL NOT NULL DEFAULT 0,
  sga_rate REAL NOT NULL DEFAULT 0,
  defect_rate REAL NOT NULL DEFAULT 0,
  fx TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX cost_rates_date ON cost_rates(effective_date);
--> statement-breakpoint
CREATE UNIQUE INDEX cost_rates_request ON cost_rates(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- cost_materials: 원가 백데이터(원부자재·상품 매입 단가 마스터). 단가는 시점별로 cost_material_prices에 쌓는다.
CREATE TABLE cost_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
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
CREATE UNIQUE INDEX cost_materials_code ON cost_materials(code);
--> statement-breakpoint
CREATE UNIQUE INDEX cost_materials_request ON cost_materials(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- cost_material_prices: 시점별 단가 이력. 원화 단가 = (단가 + 할증) × 환율 + 부대비(원/단위: 슬리팅·물류·통관).
CREATE TABLE cost_material_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KRW',
  price REAL NOT NULL DEFAULT 0,
  surcharge REAL NOT NULL DEFAULT 0,
  fx REAL NOT NULL DEFAULT 1,
  extra_krw REAL NOT NULL DEFAULT 0,
  krw_price REAL NOT NULL DEFAULT 0,
  incoterms TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX cost_material_prices_mat ON cost_material_prices(material_id, effective_date);
--> statement-breakpoint
CREATE UNIQUE INDEX cost_material_prices_request ON cost_material_prices(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- cost_items: 품목별 원가표(지금 원가). 원가 줄(lines JSON: 원부자재·인건비 공정·기타 직접비, 수식 칸), 기준 덮어쓰기(overrides JSON),
-- 판관비 기준(sga_base: direct=직접비 / mfg=직접비+제조경비). 원가가 바뀔 때마다 cost_item_revs에 시점·사유와 함께 스냅샷을 남긴다.
CREATE TABLE cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT NOT NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'product',
  category TEXT NOT NULL DEFAULT '',
  bom_id INTEGER,
  unit TEXT NOT NULL DEFAULT '',
  pieces REAL,
  pack_spec TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '',
  sale_price REAL,
  sga_base TEXT NOT NULL DEFAULT 'direct',
  overrides TEXT NOT NULL DEFAULT '{}',
  lines TEXT NOT NULL DEFAULT '[]',
  rev INTEGER NOT NULL DEFAULT 0,
  rev_date TEXT,
  totals TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
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
CREATE UNIQUE INDEX cost_items_code ON cost_items(item_code);
--> statement-breakpoint
CREATE UNIQUE INDEX cost_items_request ON cost_items(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
-- cost_item_revs: 원가 리비전(바꾸지 않는 기록). 변동 시점·사유·원인(manual 직접 수정 / material 단가 변경 / rates 공통 기준 변경)과
-- 그때의 머리 정보·원가 줄(단가 풀어 넣은 값)·적용 기준·합계를 그대로 담는다.
CREATE TABLE cost_item_revs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  cause TEXT NOT NULL DEFAULT 'manual',
  header TEXT NOT NULL DEFAULT '{}',
  lines TEXT NOT NULL DEFAULT '[]',
  rates TEXT NOT NULL DEFAULT '{}',
  totals TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX cost_item_revs_rev ON cost_item_revs(item_id, rev);
