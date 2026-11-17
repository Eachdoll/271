-- 15.133~15.136 LOT 추적: 서브 LOT(한 LOT를 여러 포장으로 받을 때 001~), 완제품 생산 LOT, 생산 투입 자재 LOT. 열 3개·새 표 1개만 추가.
ALTER TABLE po_receipt_lots ADD COLUMN sub_lot TEXT NOT NULL DEFAULT '';
ALTER TABLE other_receipts ADD COLUMN sub_lot TEXT NOT NULL DEFAULT '';
ALTER TABLE production_actuals ADD COLUMN lot TEXT NOT NULL DEFAULT '';
CREATE INDEX production_actuals_lot ON production_actuals(lot);
-- production_lot_inputs: 생산실적 한 건에 투입한 자재 LOT과 수량(LOT별 재고에서 빠짐). 실적이 취소되면(voided_at) 재고 계산에서 빠져 되돌아간다.
CREATE TABLE production_lot_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actual_id INTEGER NOT NULL,
  item TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL,
  qty REAL NOT NULL CHECK(qty>0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
CREATE INDEX production_lot_inputs_actual ON production_lot_inputs(actual_id);
CREATE INDEX production_lot_inputs_lot ON production_lot_inputs(lot);
