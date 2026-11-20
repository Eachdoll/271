-- 15.265 재고 조정을 LOT·창고·위치 단위로도: 재고 현황 LOT별·창고·위치별 줄에서 수량 조정(실사·증감). 비어 있으면 예전처럼 품목 단위.
ALTER TABLE stock_adjustments ADD COLUMN lot TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE stock_adjustments ADD COLUMN warehouse TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE stock_adjustments ADD COLUMN location TEXT NOT NULL DEFAULT '';
