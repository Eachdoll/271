-- 15.333 품질 문서관리 폴더: 문서마다 분류 폴더 경로(예: '생산/세탁'). 폴더 목록은 settings('qdoc_folders')에. 칸 추가만(기존 문서는 미분류 '').
ALTER TABLE quality_docs ADD COLUMN folder TEXT NOT NULL DEFAULT '';
