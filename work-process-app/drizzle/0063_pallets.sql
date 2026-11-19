-- 15.231 파렛트 묶음 QR: 여러 LOT·수량을 한 파렛트(PLT_YYYYMMDD_NNN)로 묶고, 출고 때 파렛트 QR 하나로 LOT별 출하를 한 번에 만든다.
CREATE TABLE pallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pallet_no TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','shipped','cancelled')),
  created_by TEXT NOT NULL,
  created_by_id INTEGER,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  shipped_at TEXT,
  shipped_by TEXT,
  ship_token TEXT,
  customer TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT,
  cancelled_by TEXT
);
--> statement-breakpoint
CREATE TABLE pallet_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pallet_id INTEGER NOT NULL REFERENCES pallets(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  lot TEXT NOT NULL,
  qty REAL NOT NULL CHECK(qty>=0),
  orig_qty REAL NOT NULL
);
--> statement-breakpoint
CREATE INDEX pallet_lines_pallet ON pallet_lines(pallet_id);
--> statement-breakpoint
CREATE INDEX pallet_lines_lot ON pallet_lines(item, lot);
--> statement-breakpoint
CREATE INDEX pallets_status ON pallets(status, created_at);
--> statement-breakpoint
ALTER TABLE shipments ADD COLUMN pallet_id INTEGER;
