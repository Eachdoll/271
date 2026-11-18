-- 15.209 같은 등록 요청을 두 번 보내도 한 건만(기타입고·직접 출하·생산계획)
ALTER TABLE other_receipts ADD COLUMN request_id TEXT;
--> statement-breakpoint
ALTER TABLE shipments ADD COLUMN request_id TEXT;
--> statement-breakpoint
ALTER TABLE schedules ADD COLUMN request_id TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX other_receipts_request_id_unique ON other_receipts(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX shipments_request_id_unique ON shipments(request_id) WHERE request_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX schedules_request_id_unique ON schedules(request_id) WHERE request_id IS NOT NULL;
