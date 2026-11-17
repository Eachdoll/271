-- 15.161 매입 세금계산서 품목 줄을 고쳐 저장(받은 계산서 그대로 맞추기). 비어 있으면 담긴 매입전표의 품목 줄로 채워 보인다. 칸 1개만 추가.
ALTER TABLE purchase_tax_invoices ADD COLUMN items TEXT NOT NULL DEFAULT '';
