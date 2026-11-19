-- 15.252 원자재 입고에 실물(절)을 안 적으면 임시 1절(LOT-1, pieces_temp=1)을 붙여 커팅·융착에서 절 코드로 고를 수 있게 한다(임시 절은 여러 번 고를 수 있음).
ALTER TABLE po_receipt_lots ADD COLUMN pieces_temp INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE other_receipts ADD COLUMN pieces_temp INTEGER NOT NULL DEFAULT 0;
