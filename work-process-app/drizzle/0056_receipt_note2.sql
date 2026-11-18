-- 15.199 입고 상세 「업체 정보(비고2)」: 발주입고 LOT 줄·기타입고 줄에 열 1개씩만 추가.
ALTER TABLE po_receipt_lots ADD COLUMN note2 TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE other_receipts ADD COLUMN note2 TEXT NOT NULL DEFAULT '';
