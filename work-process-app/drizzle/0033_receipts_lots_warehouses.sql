-- 입고 묶음·LOT·창고(15.72). 새 표 3개와 기타입고의 칸 3개만 추가한다. 기존 데이터는 바꾸지 않는다.
-- receipts: 한 번에 받은 입고(입고번호 RC-YYMMDD-NN, 입고일, 거래처, 비고). 입고증 출력의 단위.
CREATE TABLE receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  receipt_date TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX receipts_date ON receipts(receipt_date, id);
-- po_receipt_lots: 발주입고의 LOT별 입고 줄. 한 발주를 여러 LOT·여러 번(부분 입고)으로 받는다.
-- 이 표에 줄이 있는 발주는 purchase_orders.recv_qty = 취소 안 된 줄의 합이며, 재고는 줄마다 입고일로 잡는다.
CREATE TABLE po_receipt_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  receipt_id INTEGER,
  lot TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL,
  received_date TEXT NOT NULL,
  warehouse TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  voided_at TEXT,
  voided_by TEXT
);
CREATE INDEX po_receipt_lots_po ON po_receipt_lots(po_id);
CREATE INDEX po_receipt_lots_receipt ON po_receipt_lots(receipt_id);
CREATE INDEX po_receipt_lots_lot ON po_receipt_lots(lot);
-- 기타입고도 입고 묶음·창고·위치를 가진다(비어 있으면 예전 방식 기록).
ALTER TABLE other_receipts ADD COLUMN receipt_id INTEGER;
ALTER TABLE other_receipts ADD COLUMN warehouse TEXT NOT NULL DEFAULT '';
ALTER TABLE other_receipts ADD COLUMN location TEXT NOT NULL DEFAULT '';
-- warehouses: 입고창고와 그 안의 위치(Location, 쉼표 구분). 비어 있으면 창고 칸을 쓰지 않는다.
CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  locations TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
