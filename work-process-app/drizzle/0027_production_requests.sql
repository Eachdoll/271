-- 영업 → 생산 생산의뢰(수주). 기존 표와 데이터는 바꾸지 않고 새 표 2개와 생산일정의 연결 칸만 추가한다.
-- 의뢰 머리: 업체·주문번호·발주일·출고 희망·사양. 출고 여부와 출고일은 생산 후 체크한다.
CREATE TABLE production_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  req_no TEXT NOT NULL UNIQUE,
  order_date TEXT NOT NULL,
  customer TEXT NOT NULL,
  order_no TEXT NOT NULL DEFAULT '',
  ship_text TEXT NOT NULL DEFAULT '',
  ship_date TEXT,
  spec TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_department TEXT NOT NULL DEFAULT '',
  shipped INTEGER NOT NULL DEFAULT 0 CHECK(shipped IN (0,1)),
  shipped_date TEXT,
  shipped_by TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX production_requests_date ON production_requests(order_date, id);
-- 의뢰 품목 줄. 사이즈별 수량은 사이즈마다 한 줄(spec에 사이즈)로 둔다. 생산 진행은 연결된 생산일정의 실적으로 계산한다.
CREATE TABLE production_request_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  bom_id INTEGER,
  product_code TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL CHECK(qty > 0)
);
CREATE INDEX production_request_lines_request ON production_request_lines(request_id, line_no);
-- 생산계획(생산일정)과 의뢰 줄의 연결. 생산의뢰에서 「생산계획 반영」으로 만든 일정에만 값이 있다.
ALTER TABLE schedules ADD COLUMN production_line_id INTEGER;
CREATE INDEX schedules_production_line ON schedules(production_line_id);
