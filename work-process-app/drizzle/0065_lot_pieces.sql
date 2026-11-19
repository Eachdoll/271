-- 15.250 원자재 실물 수량(절): 입고는 거래 단위(예: yd)로 받고 실물 개수(절)를 따로 적는다. 마감은 거래 단위 그대로.
-- 커팅·융착 투입은 LOT별 절로 적고, 거래 단위 사용량은 BOM으로 자동 계산(semi_lot_inputs.qty), 적은 절은 pieces.
ALTER TABLE po_receipt_lots ADD COLUMN pieces REAL;
--> statement-breakpoint
ALTER TABLE other_receipts ADD COLUMN pieces REAL;
--> statement-breakpoint
ALTER TABLE semi_lot_inputs ADD COLUMN pieces REAL;
