-- 15.114 창고 이동: LOT를 한 창고·위치에서 다른 창고·위치로 옮긴 기록. 품목 전체 재고는 바뀌지 않고 LOT의 위치별 잔량만 바뀐다.
-- 취소는 status='cancelled'(지우지 않음).
CREATE TABLE stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_date TEXT NOT NULL,
  item TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL,
  qty REAL NOT NULL CHECK(qty > 0),
  from_place TEXT NOT NULL DEFAULT '',
  to_warehouse TEXT NOT NULL,
  to_location TEXT NOT NULL DEFAULT '',
  to_place TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  cancelled_at TEXT,
  cancelled_by TEXT
);
CREATE INDEX stock_transfers_lot ON stock_transfers(item, unit, lot, status);
CREATE INDEX stock_transfers_date ON stock_transfers(transfer_date, id);
