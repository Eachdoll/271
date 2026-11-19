-- 15.254 임시 SST LOT에 나중에 알게 된 업체 LOT을 연결(LOT 이름은 그대로 두고 별칭으로). 조회·라벨·LOT 연결 조회에서 함께 보이고 업체 LOT으로도 찾는다.
ALTER TABLE po_receipt_lots ADD COLUMN vendor_lot TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE other_receipts ADD COLUMN vendor_lot TEXT NOT NULL DEFAULT '';
