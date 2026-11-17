-- 15.143 문서 구분: tax(세금계산서) / free(계산서 — 면세, 세액 칸 없음). 열 추가만(예전 계산서는 세금계산서로 남고 창에서 바꿀 수 있음).
ALTER TABLE tax_invoices ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'tax';
ALTER TABLE purchase_tax_invoices ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'tax';
