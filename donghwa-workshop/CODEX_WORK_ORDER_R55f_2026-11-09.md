# Codex 지시서 r55f · 그림 포함 1권 실측(R55e) 후속 — 영어 합치기 캡 · 동물 카드 · 쪽별 그림 계획·카메라 · 없는 인물 명시 · 쪽별 장소 · 2026-11-09

`CODEX_R55E_PAID_2026-11-09.md`(커밋 `8b2ff98`)의 남은 문제 넷을 코드로 고쳤습니다. 유료 호출은 늘지 않습니다. 이미 산 그림·원고는 다시 만들지 않습니다.

| 항목 | 값 |
| --- | --- |
| 코드 커밋 | 이 지시서와 같은 커밋 (캐시 `donghwa-shell-v121`) |
| 반입 범위 | r55e 지시서 커밋 `ee16fc6` 이후: `ee16fc6..HEAD` |
| 바뀐 파일 | `dist/story-generation/writers-room.js`, `dist/image-generation/scene-prompt.js`, `dist/image-generation/world.js`, `dist/text-pocket.js`, `dist/story-generation/story-drama.js`, `dist/book-layout.js`, `dist/sw.js`, `tests/writers-room-r55f.test.mjs`(새), r54f 테스트, `QA/r55e-paid/replay-binding.mjs`(두 캡 전달), `CLAUDE.md` |

## 바뀐 것 (실측 항목 → 고침)
1. **영어 6문장 합치기**(e): `fitSpreadMarks(pages, openings, {cap, capEn})` — 합친 쪽의 영어도 E2 낱쪽 캡(4문장, `pageSentenceCap(specs.en)`)을 넘기면 합치지 않고 표시를 풉니다. 보고의 원고(`QA/r55e-paid/source-draft.json`)를 다시 돌리면 15항목(마지막 한글 5·영어 6) 대신 16항목·표시 0, 영어 최대 4문장. `node QA/r55e-paid/replay-binding.mjs`도 두 캡을 넘기도록 고쳤습니다(출력 entries 16, lastEn 2).
2. **사슴의 사람 얼굴**(d-2): 작가실 새 인물 카드(`roomCastRecord`)가 사람(child/adult)이 아니면 `hairColor`·`skinColor`를 비우고 설명에 "a real deer: animal head, face and body (no human face, hair or skin)"를 붙입니다. 시트 요청의 identity 줄이 이 설명을 그대로 받습니다. 이미 만든 콩이 카드는 그대로입니다(새 카드부터).
3. **명단 밖 인물**(d-1): `pictureRefs` 책의 쪽 그림 요청에 그 쪽에 없는 서랍 인물을 이름으로 적습니다 — "Not in this picture: Mom — the earlier-page and style reference images may show them; draw none of them here." (전송 영수증은 이미 맞았으므로 참조 그림에서 끌려오는 인물을 글로 막는 것입니다. 효과는 다음 책에서 실측.)
4. **카메라 두 기준·쪽별 계획**(d-3): 그림 읽기의 쪽별 값(shot·space·carrier·focus·pocket·backdrop)이 **쪽마다** `page.picturePlan`으로 실리고, 그림 요청·글 자리(`pocketOf`)·단색 바탕(`plainBackdropFor`·`settleBackdrops`)이 비트 계획보다 쪽 계획을 먼저 읽습니다(한 펼침의 두 낱쪽이 같은 계획을 공유하던 것, 마지막 쪽이 앞 비트의 closeup을 받던 것이 사라짐). 또 `pictureRefs` 책에서 계획이 'middle'이면 스테이징 회전의 카메라(high_angle·from_behind·over_shoulder·low_angle·medium)를 그대로 써서 카메라가 셋으로 줄지 않습니다. 쪽 다시 쓰기·수정에서도 `picturePlan`을 유지(`KEPT_FIELDS`).
5. **쪽별 장소**(d-4): 그림 읽기의 `where`가 공급 장소를 이름으로 대면(예: "forest and home") **먼저 나온 장소의 ID**가 쪽의 `scene.where`가 되어 스테이징·장소 참조·앞 쪽 참조가 쪽 단위로 그 장소를 씁니다(보고의 2쪽은 숲인데 비트 장소가 집이라 집 참조를 받았음). 완성 줄거리의 비트 장소도 같은 규칙.

## 바뀌지 않은 것
옛 길·데모·표식 없는 책은 바이트 단위로 그대로(R12 핀 12그룹 그대로). 글 자리 '4/11 활용'(d-5)은 R48의 실측 배치(그림이 비워 두지 않으면 아래로)가 의도대로 작동한 것이라 손대지 않았고, 모델이 빈 자리를 더 잘 비우는지는 다음 책에서 봅니다.

## 검증 (이 커밋 기준)
`npm test` 1147/1147 · 품질 85/85 · 미러 동일 · R12 핀 12그룹 그대로 · 읽기 DOM `0e5035cf…` · 센서스 7표 동일·ERRORS []·PAID 0 · 스모크 PASS×2. `tests/writers-room-r55f.test.mjs`(4: 보고 원고 재생으로 영어 캡, 동물 카드, 쪽별 장소·계획, 그림 요청의 없는 인물·카메라).

## Codex가 할 일
1. `ee16fc6..HEAD` 반입·배포. 캐시 `donghwa-shell-v121` 확인. `node QA/r55e-paid/replay-binding.mjs`가 entries 16·lastEn ≤ 4인지(무료).
2. 다음 그림 포함 실측은 **부모님이 다시 승인하신 뒤에만**(그림 약 $3.6 + 글 약 $0.6). 그때 확인: (a) 콩이 같은 동물 시트가 동물 얼굴인지, (b) 그 쪽에 없는 인물이 그림에 나오는 쪽 수(이번 5/15), (c) `imageMeta.prompt`의 COMPOSITION FIRST 카메라 종류 수(이번 3종), (d) 숲 쪽이 숲 참조를 받는지(`imageMeta.referenceImages`의 background 라벨), (e) 마지막 쪽 영어 문장 수.
3. 키·초대 코드는 어디에도 적지 않습니다.
