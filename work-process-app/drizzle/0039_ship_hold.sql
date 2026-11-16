-- 15.104 출하지시 보류: status CHECK(pending/shipped/cancelled)는 그대로 두고 보류 표시 칸을 더한다(기존 표를 다시 만들지 않음).
-- held=1이면 출하 처리 목록에서 빠지고 배지에서도 빠진다. 대기(pending)인 지시만 보류·해제한다.
ALTER TABLE ship_instructions ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ship_instructions ADD COLUMN hold_note TEXT NOT NULL DEFAULT '';
ALTER TABLE ship_instructions ADD COLUMN held_by TEXT;
ALTER TABLE ship_instructions ADD COLUMN held_at TEXT;
