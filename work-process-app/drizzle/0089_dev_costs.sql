-- 15.316 연구소 › 개발원가 관리. 기존 표·데이터는 그대로.
-- dev_costs: 개발 건(개발리스트 requests.type='development', dev_request_id)별 원가표. 원가 줄(lines JSON: 발생일·구분·품목·규격·거래처·수량·단위·단가·통화·환율·비고)과
-- 원가 기준 수량(base_qty)·판관비율(sga_rate %)·목표 이익률(profit_rate %)·목표 판매단가(target_price)로 직접비·판관비·총원가·단위원가·이익률을 계산한다.
-- 작성 → 확정(개발책임자) → 확정 취소(사유)로 다시 작성.
CREATE TABLE dev_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cost_no TEXT NOT NULL,
  dev_request_id INTEGER,
  title TEXT NOT NULL,
  customer TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  base_qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '',
  sga_rate REAL NOT NULL DEFAULT 0,
  profit_rate REAL NOT NULL DEFAULT 0,
  target_price REAL,
  lines TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  history TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX dev_costs_no ON dev_costs(cost_no);
--> statement-breakpoint
CREATE UNIQUE INDEX dev_costs_request ON dev_costs(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX dev_costs_dev ON dev_costs(dev_request_id);
