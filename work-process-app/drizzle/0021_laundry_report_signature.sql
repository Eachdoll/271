-- 성적서를 발행할 때 등록된 확인자 서명 이미지를 기록에 남긴다.
ALTER TABLE laundry_reports ADD COLUMN signature TEXT NOT NULL DEFAULT '';
