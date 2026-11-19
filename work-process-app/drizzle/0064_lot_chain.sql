-- 15.249 LOT 체계 개편: 원자재 LOT → 봉투(반제품) LOT → 세탁(같은 봉투 LOT) → 완제품 LOT 연결.
-- semi_lot_inputs: 커팅·융착 기록(봉투 1개 = semi_records 1줄)에 투입한 원자재 LOT과 수량(원자재 LOT 재고에서 빠짐).
CREATE TABLE semi_lot_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES semi_records(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL,
  qty REAL NOT NULL CHECK(qty>0),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX semi_lot_inputs_record ON semi_lot_inputs(record_id);
--> statement-breakpoint
CREATE INDEX semi_lot_inputs_lot ON semi_lot_inputs(lot);
--> statement-breakpoint
-- pack_bag_links: 완제품 포장 실적(production_actuals 1건)에 들어간 세탁 완료 봉투 LOT. 봉투 하나가 여러 완제품 LOT에 들어갈 수 있다(남은 봉투).
CREATE TABLE pack_bag_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actual_id INTEGER NOT NULL REFERENCES production_actuals(id) ON DELETE CASCADE,
  bag_lot TEXT NOT NULL,
  item TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX pack_bag_links_actual ON pack_bag_links(actual_id);
--> statement-breakpoint
CREATE INDEX pack_bag_links_bag ON pack_bag_links(bag_lot);
--> statement-breakpoint
CREATE INDEX semi_records_lot ON semi_records(process, lot);
