# Codex 지시서 r55a · 한 화면 (쉬운/프로 모드 통합) · 2026-11-03

## 배경

부모님이 "구버전 기능 중 삭제할 게 더 있나 찾아봐, 쉬운 모드·프로 모드도 없애도 될 것 같아"라고 했고, 검토서(`APP_SIMPLIFICATION_REVIEW_2026-11-03.md`)를 보고 "지워"라고 결정했습니다.

**Claude가 구현해 커밋했습니다.** R53·R54a 지시서와 함께 반입합니다(범위가 이어집니다). 서버와 DB는 바뀌지 않았고, 유료 실행은 없습니다.

## 0. 가져올 소스

| 항목 | 값 |
| --- | --- |
| 저장소·브랜치 | https://github.com/Eachdoll/271 · `claude/cross-owner-repo-constraint-j20lhz` |
| 코드 커밋 | **`af1577c`** (캐시 `donghwa-shell-v105`) |

| 운영 상태 | 반입 범위 | 운영 버전 |
| --- | --- | --- |
| v59 / v99 (지금) | **`3ace695..af1577c`** (R50~R53 + R54a + R55a, 한 번에) | v60 |

R53·R54a 지시서의 파일 목록에 더해:

| 구분 | 파일 |
| --- | --- |
| 바뀐 코드 | `dist/app.js`, `dist/simple-create.js`, `dist/image-generation/settings-ui.js`, `dist/sw.js`(v105) |
| 스크립트 | `scripts/ux-census.mjs`(프로 패스 없음, 쉬운 화면 표), `scripts/r9-simple-smoke.mjs`(모드 왕복 없음) |
| 테스트 | `simple-create`, `review-model-r26`, `council-review-r22`, R12 legacy(`review` 핀 재고정) |
| 문서 | `CLAUDE.md`(R55a), `APP_SIMPLIFICATION_REVIEW_2026-11-03.md` |

## 1. 무엇이 달라졌나

- **화면은 하나입니다.** 모드 전환 버튼·모드 표시 줄이 없고, 기기에 'pro'가 저장돼 있어도 쉬운 화면입니다. 프로 화면(만들기 1~4단계, 줄거리 카드, 전문, 쪽 나누기, 이야기 다듬기, 설정 세 탭)은 닿을 수 없습니다. 코드는 다음 라운드에서 지웁니다.
- **설정에 '더 보기'**: 엔진과 키 아래에 접힌 '더 보기 · 글 모델 · 그림 World·화풍'이 있습니다. 글 모델 둘(작가·독자단), 이미지 엔진·World·화풍·캐릭터 시트가 들어 있습니다.
- **사라진 것**: 재료 서랍의 '조연 자동생성하여 추가하기', 그림 설정의 '같은 프롬프트로 엔진 3개 비교', ③의 스위치 넷(회의 후 부모 확인·검사는 최고 모델로·정성 모드·승인 예시 더 참고), ③의 '에코 모드 · 복사·붙여넣기' 버튼.
- 설정값과 핸들러는 남아 있어 **이미 만든 책·에코 책·옛 초안은 그대로** 열립니다.

## 2. 검증

| 명령 | 기대값 |
| --- | --- |
| `npm test` | **1141/1141** |
| `npm run test:quality` | **85/85** |
| `diff -rq story-quality/dist dist/story-quality/dist` | 출력 없음 |
| `scripts/r12-legacy-dom.mjs --check` (포트 4960) | `0e5035cf…` 그대로 |
| `scripts/ux-census.mjs` | `PRO SAME AS TABLE true`(쉬운 화면 7개 표), `ERRORS []`, `PAID 0` |
| `scripts/r9-simple-smoke.mjs` | PASS (1280·390) |

## 3. 커밋·푸시·배포

```bash
git add donghwa-workshop
git commit -m "donghwa-workshop: r50-r55a 반입 · 작가실 · 한 화면 · 캐시 v105"
git push origin <운영 브랜치>
```

캐시는 `donghwa-shell-v105`입니다.

## 4. 배포 후 확인 (무료)

1. 새로 고침 뒤 상단에 모드 전환 버튼이 **없는지** 봅니다. 예전에 프로 모드였던 기기도 쉬운 화면이어야 합니다.
2. 부모 설정에서 '더 보기'를 펼쳐 글 모델 둘과 그림 World 설정이 보이는지 봅니다.
3. ③에서 '글 만들기 · 데모로 체험'과 '엔진·예상 요금' 안의 **작가실 스위치만** 있는지 봅니다.
4. 재료 서랍에 '조연 자동생성' 버튼이 없는지 봅니다.
5. 기존 책 하나의 읽기·인쇄가 전과 같은지 봅니다.

## 5. 완료 보고

`CODEX_R53_COMPLETION_2026-11-03.md` 하나에 R54a·R55a까지 적습니다.

## 6. 하지 말 것

R53 지시서 5절과 같습니다.
