-- 15.138 세금계산서 상태(기존 ERP 기준): 발행구분(정발행·역발행), 상대방 수신 확인, 역발행 거래처 표시. 열 추가만.
-- issue_type: normal(정발행: 우리가 발행) / reverse(역발행: 거래처가 요청·발행, 예: 삼성전자·삼성디스플레이)
ALTER TABLE tax_invoices ADD COLUMN issue_type TEXT NOT NULL DEFAULT 'normal';
-- recv_status: '' 수신자 미확인 / confirmed 수신 확인 / rejected 수신 거부
ALTER TABLE tax_invoices ADD COLUMN recv_status TEXT NOT NULL DEFAULT '';
ALTER TABLE tax_invoices ADD COLUMN recv_at TEXT;
ALTER TABLE tax_invoices ADD COLUMN recv_by TEXT;
ALTER TABLE vendors ADD COLUMN tax_reverse INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_tax_invoices ADD COLUMN issue_type TEXT NOT NULL DEFAULT 'normal';
