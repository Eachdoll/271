// 의뢰 양식 정의 (의뢰요청서 엑셀 양식 기준).
// 항목을 추가/수정하려면 이 파일만 고치면 됩니다.
//  - core: true  → 서버 컬럼(title, customer, due_date, category, target_price)에 저장
//  - 그 외       → requests.data(JSON)에 저장
//  - t: text | number | date | textarea | radio | checks
//  - other: true → '기타' 직접입력칸(<키>_etc) 추가
window.REQ = {
  analysis: {
    label: '분석', dept: '품질', role: 'quality', mgr: '품질책임자',
    intake: '#/quality/request', list: '#/quality/list',
    titleLabel: '샘플명',
    fields: [
      { k: 'customer', label: '고객사', t: 'text', core: true },
      { k: 'due_date', label: '완료 희망일', t: 'date', core: true },
      { k: 'purpose', label: '의뢰목적', t: 'text', full: true },
      { k: 'title', label: '샘플명', t: 'text', core: true, req: true },
      { k: 'sample_qty', label: '샘플수량', t: 'text' },
      { k: 'category', label: '검사 구분', t: 'radio', core: true, req: true, opts: ['수입검사', '의뢰검사', '출하검사', '공정검사'] },
      { k: 'sample_kind', label: '샘플구분', t: 'radio', opts: ['글러브', '와이퍼', '마스크', '원단'], other: true },
      { k: 'lot', label: 'LOT#', t: 'radio', opts: ['없음', '있음'], otherOn: '있음', otherPh: 'LOT 번호' },
      { k: 'items', label: '의뢰 항목', t: 'checks', opts: ['외관', '규격', '파티클', '흡수성능', '인장,인열', '세정효율', '포집효율', 'Lint', 'COF', '박리강도', '흡기저항', '멸균진행'], other: true, full: true },
      { k: 'compare', label: '비교샘플', t: 'radio', opts: ['유', '무'], hint: '데이터 비교 대상샘플 있을 시 함께 전달요망' },
      { k: 'handling', label: '샘플처리', t: 'radio', opts: ['분석후 폐기', '시료훼손금지 (제한적 분석항목만 수행가능)'] },
      { k: 'result_type', label: '분석결과', t: 'radio', opts: ['기본(데이터공유)', 'summary', 'COA발행'] },
      { k: 'extra', label: '추가 요청사항', t: 'textarea', full: true },
    ],
  },
  development: {
    label: '개발', dept: '개발', role: 'dev', mgr: '개발책임자',
    intake: '#/dev/request', list: '#/dev/list',
    titleLabel: '타겟제품',
    fields: [
      { k: 'customer', label: '고객사', t: 'text', core: true },
      { k: 'due_date', label: '완료 희망일', t: 'date', core: true },
      { k: 'purpose', label: '의뢰목적', t: 'text', full: true },
      { k: 'title', label: '타겟제품', t: 'text', core: true, req: true, ph: '예) 니트릴 글러브 (블루컬러) 12" (박스형)' },
      { k: 'target_price', label: '타겟단가', t: 'text', core: true, req: true, ph: '예) 8~9만원 대/BOX', hint: '목표 원가 및 판매단가' },
      { k: 'usage', label: '사용용도', t: 'text', ph: '예) 클린룸 CLASS 1,000~10,000' },
      { k: 'volume', label: '사용량', t: 'text', hint: '연간예상수량', ph: '예) 360박스' },
      { k: 'condition', label: '생산조건', t: 'radio', opts: ['기존과 동일', '추가요청사항'], otherOn: '추가요청사항', otherPh: '추가요청 내용' },
      { k: 'packing', label: '포장사양', t: 'radio', opts: ['무관', '클린룸패킹 (단일)', '클린룸패킹 (이중)', '클린룸패킹 (삼중)'] },
      { k: 'pack_qty', label: '패킹수량/bag', t: 'text' },
      { k: 'extra', label: '기타 요청사항', t: 'textarea', full: true },
    ],
  },
  sample: {
    label: '샘플', dept: '생산', role: 'production', mgr: '생산담당자',
    intake: '#/prod/request', list: '#/prod/list',
    titleLabel: '샘플명',
    fields: [
      { k: 'customer', label: '고객사', t: 'text', core: true },
      { k: 'due_date', label: '완료 희망일', t: 'date', core: true },
      { k: 'purpose', label: '의뢰목적', t: 'text', full: true },
      { k: 'title', label: '샘플명', t: 'text', core: true, req: true },
      { k: 'req_qty', label: '요청수량', t: 'text', hint: '샘플제작 요청 수량' },
      { k: 'usage', label: '사용용도', t: 'text' },
      { k: 'volume', label: '사용량', t: 'text', hint: '연간예상수량' },
      { k: 'price', label: '희망가격', t: 'text', hint: '목표 원가 및 판매단가' },
      { k: 'condition', label: '생산조건', t: 'radio', opts: ['기존과 동일', '추가요청사항'], otherOn: '추가요청사항', otherPh: '추가요청 내용' },
      { k: 'packing', label: '포장사양', t: 'radio', opts: ['무관', '클린룸패킹 (단일)', '클린룸패킹 (이중)', '클린룸패킹 (삼중)'] },
      { k: 'pack_qty', label: '패킹수량/bag', t: 'text' },
      { k: 'extra', label: '기타 요청사항', t: 'textarea', full: true },
    ],
  },
};
