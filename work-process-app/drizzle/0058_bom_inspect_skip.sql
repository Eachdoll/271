-- 15.207 품목별 검사 제외: 수입검사 제외·출하검사 제외(체크하면 그 품목의 수입·출하검사 의뢰는 리스트에 올라가되 「검사 제외」로 바로 완료). 열 2개만 추가.
ALTER TABLE boms ADD COLUMN skip_incoming INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE boms ADD COLUMN skip_outgoing INTEGER NOT NULL DEFAULT 0;
