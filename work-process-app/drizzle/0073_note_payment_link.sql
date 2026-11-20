-- 15.268 거래처 장부에서 어음으로 입금·지급하면 어음 관리에 자동 등록: 어음 ↔ 입금(sales_payments)/지급(purchase_payments) 연결, 어음종류·배서인·보관장소.
ALTER TABLE bill_notes ADD COLUMN payment_side TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bill_notes ADD COLUMN payment_id INTEGER;
--> statement-breakpoint
ALTER TABLE bill_notes ADD COLUMN note_type TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bill_notes ADD COLUMN endorser TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE bill_notes ADD COLUMN storage TEXT NOT NULL DEFAULT '';
