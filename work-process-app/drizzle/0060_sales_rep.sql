-- 15.224 영업담당자: 매출전표마다 담당자, 거래처에는 기본 담당자(전표에 비어 있으면 거래처 담당자로 집계). 기존 값은 빈칸으로 둔다.
ALTER TABLE sales_bills ADD COLUMN sales_rep TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE vendors ADD COLUMN sales_rep TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX sales_bills_rep ON sales_bills(sales_rep, bill_date);
