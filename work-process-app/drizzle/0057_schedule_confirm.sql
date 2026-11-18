-- 15.199 생산 계획 확정(대기 → 확정): 계획생산 접수·관리 화면에서 확정한 계획만 실적 입력에 나온다. 열 2개 추가.
-- 이미 쓰던 계획(실적 입력 중)은 그대로 실적 입력에 보이도록 확정으로 둔다(삭제·변경 없음, 확정 표시만).
ALTER TABLE schedules ADD COLUMN confirmed_at TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE schedules ADD COLUMN confirmed_by TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE schedules SET confirmed_at = created_at, confirmed_by = '(기존 계획)' WHERE confirmed_at = '';
