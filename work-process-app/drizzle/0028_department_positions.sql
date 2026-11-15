-- 부서별 직급 체계. NULL이면 기존 공통 직급 목록을 사용한다.
-- 기존 사용자·직급·결재 스냅샷은 변경하지 않는다.
ALTER TABLE org_departments ADD COLUMN positions_json TEXT;
