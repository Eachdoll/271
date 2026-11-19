-- 15.230 제품등록: SST제품명(품목명 옆)과 포장정보. 기존 값은 빈칸.
ALTER TABLE boms ADD COLUMN sst_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE boms ADD COLUMN pack_info TEXT NOT NULL DEFAULT '';
