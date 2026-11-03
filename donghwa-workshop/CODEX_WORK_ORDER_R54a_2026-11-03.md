# Codex 지시서 r54a · 설정 화면 단순화 (R53 지시서에 이어서) · 2026-11-03

## 배경

부모님이 프로 모드의 '글 품질' 탭을 보고 "너무 복잡해, 쓸데없는 건 버리고"라고 했습니다. 작가실(R50~R53)이 정하는 일을 화면에서 뺐습니다.

**Claude가 구현해 커밋했습니다.** R53 지시서와 함께 반입합니다(범위가 이어집니다). 서버와 DB는 바뀌지 않았고, 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`9afba2b`** (캐시 `donghwa-shell-v104`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v59 / v99 (지금) | **`3ace695..9afba2b`** (R50~R53 + R54a, 한 번에) | v60 |

R53 지시서(`CODEX_WORK_ORDER_R53_2026-11-03.md`)의 파일 목록에 더해:

| 구분 | 파일 |
| --- | --- |
| 바뀐 코드 | `dist/story-generation/quality-settings.js`, `dist/story-generation/writers-room.js`, `dist/text-generation/models.js`, `dist/sw.js`(v104) |
| 스크립트 | `scripts/ux-census.mjs`(표: `02-settings-text` 9/10/5) |
| 테스트 | `story-quality-settings`, `stage-categories-r33`, `story-world-ui` |

## 1. 무엇이 달라졌나

- 프로 설정 '글 품질' 탭은 **'글 모델' 한 패널**입니다: **작가 · 상위**(작가실의 전제·초고·고쳐쓰기·영어판·다듬기와 줄거리), **독자단·읽기 · 보급형**(독자 여섯, 그림 읽기). 저장 버튼 하나.
- 사라진 것: 구성 재료·패턴 스위치, 증류 예시, 비트 탐색, 풍부화 2패스, 아이 시뮬레이터, 주간 코치, 전문·코치 엔진 행, 이야기 모양 기본값, 기본 모험 무대·세계 카드·계절·시간, 소품·생물 변형 확률, 패턴 카드 편집, 반복 소재 확인, 코치 제안·규칙.
- 저장된 옛 값은 그대로입니다. 옛 초안과 이미 만든 책은 바뀌지 않습니다.
- **주간 코치는 더 이상 스스로 돌지 않습니다**(유료 자동 실행 없음).
- 세계 카드·무대·계절·시간은 프로 ②(이야기 만들기)에 그대로 있습니다.

## 2. 검증

R53 지시서 1절과 같습니다. 기대값: `npm test` **1141/1141**, 품질 85/85, 미러 출력 없음, DOM `0e5035cf…`, 센서스 `PRO SAME AS TABLE true` · `ERRORS []` · `PAID 0`, 스모크 PASS.

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r50-r54a 반입 · 작가실 · 설정 단순화 · 캐시 v104"
git push origin <운영 브랜치>
```

캐시는 `donghwa-shell-v104`입니다. R53 지시서의 3절·4절 확인에 더해, 프로 설정의 글 탭에서 '글 모델' 패널에 행이 둘뿐인지 봅니다.

## 4. 완료 보고

`CODEX_R53_COMPLETION_2026-11-03.md` 하나에 R54a까지 적습니다.

## 5. 하지 말 것

R53 지시서 5절과 같습니다.
