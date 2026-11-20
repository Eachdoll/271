-- 15.274 거래처 담당자 목록: 한 거래처에 사업장·부서·용도(세금계산서·발주·납품 등)별로 담당자 여러 명.
CREATE TABLE vendor_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
--> statement-breakpoint
CREATE INDEX vendor_contacts_vendor ON vendor_contacts(vendor_id, sort);
