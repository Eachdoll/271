-- 15.251 업체 LOT 하나에 실물 여러 절: 절마다 코드 LOT-1, LOT-2 …(입고 순서로 이어 매김). 커팅·융착에서 고른 절 번호를 남긴다("3,4,7").
ALTER TABLE semi_lot_inputs ADD COLUMN piece_nos TEXT NOT NULL DEFAULT '';
