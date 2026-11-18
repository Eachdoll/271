-- 15.190 제품등록 업체 정보(공급·고객 업체, 담당자·연락처 등 자유 입력). 열 1개만 추가.
ALTER TABLE boms ADD COLUMN vendor_info TEXT NOT NULL DEFAULT '';
