---
name: 토스스타일
description: 토스 느낌으로 화면을 새로 만들거나 바꾼다. "토스스타일로 만들어줘 / 토스처럼 바꿔줘" 요청에 사용
---

# 토스스타일

공개된 토스 디자인 시스템(TDS) 가이드를 바탕으로, 화면을 토스처럼 **쉽고 선명하고 친근하게** 만든다.
색·간격·둥글기·버튼·입력창 같은 *스타일*만 가져온다. 토스의 로고·이름·서체·이미지는 쓰지 않는다.

## 언제 쓰나
- "토스스타일로 만들어줘", "토스처럼 바꿔줘", "토스 느낌으로" 같은 요청.
- 새 화면을 만들 때: `assets/base.css`를 그대로 붙여 넣고 `.toss-btn`, `.toss-field`, `.toss-card`, `.toss-badge` 클래스를 쓴다.
- 이미 있는 화면을 바꿀 때: 기존 클래스 이름은 그대로 두고, CSS 변수(색·둥글기)와 버튼·입력·카드·표 규칙만 아래 표처럼 덮어쓴다. HTML·JS는 건드리지 않는다.

## 바로 쓰는 요약
| 항목 | 값 |
|---|---|
| 바탕 | 페이지 `#F2F4F6`(회색) 위에 흰 면 `#FFFFFF`. 면은 테두리·그림자 없이 바탕색 차이로 구분 |
| 글자 | 제목·본문 `#191F28`, 보조 `#4E5968`, 흐린 글자 `#6B7684`, 비활성 `#B0B8C1` |
| 경계선 | `#E5E8EB` (꼭 필요할 때만) |
| 주요 파랑(UI) | `#3182F6`, hover `#2272EB`, 누름 `#1B64DA`, 옅은 파랑 면 `#E8F3FF`, 작은 링크 `#1B64DA` |
| 브랜드 파랑 | `#0064FF`는 로고 전용. 버튼·링크에 쓰지 않는다 |
| 상태 | 성공 `#029359`/`#F0FAF6`, 경고 `#DD7D02`/`#FFF9E7`, 오류 `#D22030`/`#FFEEEE`, 위험 버튼 `#F04452` |
| 다크 | 바탕 `#17171C`, 면 `#202027`, 경계 `#3C3C47`, 글자 `#FFFFFF`, 흐린 글자 `#9E9EA4`, 파랑 `#3485FA` |
| 둥글기 | 배지 8, 버튼·입력 12, 카드 16~24, 큰 그림 40, 원형은 실제 원형 아이콘만 |
| 그림자 | 기본 없음. 떠 있는 창(모달)에만 `0 8px 24px rgba(0,23,51,.08)` 정도 |
| 글자 크기 | 제목 26~30px/700/자간 -.03em, 본문 15~17px, 캡션 13px. 전체 자간 약 -.02em |
| 버튼 | 주요=파랑 채움, 보조=옅은 회색 면(weak), 위험=빨강 글자+옅은 빨강 면. 한 화면의 파란 채움 버튼은 하나가 원칙 |
| 입력 | 높이 44~52px, 둥글기 12, 초점 시 파랑 2px 테두리. label은 항상 위에, 오류 문장은 바로 아래 |

## 적용 순서
1. CSS 변수부터 바꾼다(`assets/base.css`의 `:root`와 다크 블록). 기존 변수 이름이 다르면 같은 역할끼리 연결한다.
2. 카드·표·KPI의 그림자와 테두리를 빼고, 회색 바탕 위 흰 면으로 구분한다.
3. 버튼: 기본 버튼을 weak 회색으로, 주요 버튼만 파랑 채움으로.
4. 입력: 높이·둥글기·초점 표시.
5. 데스크톱과 휴대폰(390px), 라이트와 다크를 모두 캡처해서 확인한다.

## 우리가 겪은 메모 (서울세미텍 업무 시스템에 적용하며)
- **서체**: Toss Product Sans는 토스 전용이라 쓰지 않는다. 앱은 외부 패키지·외부 폰트를 내려받지 않으므로 시스템 한글 고딕 스택(`-apple-system, 'Apple SD Gothic Neo', Pretendard, 'Malgun Gothic', 'Noto Sans KR', system-ui`)으로 둔다.
- **브랜드**: 화면의 로고와 이름은 우리 회사(서울세미텍) 것을 유지한다. 토스 로고·문구·이미지를 넣지 않는다.
- **업무 화면 밀도**: 토스 홈페이지는 여유롭지만 업무 앱은 표가 많다. 버튼 높이 40px, 입력 44px, 표 줄 간격은 기존 수준으로 두고 색·둥글기·평면성만 가져오는 편이 잘 맞았다.
- **덮어쓰기 방식**: style.css 끝에 "토스 스타일" 블록을 붙여 변수와 핵심 규칙만 덮어쓴다. 클래스 이름을 바꾸면 JS 선택자가 깨진다.
- **이름 충돌**: 예전에 `.cards`라는 클래스가 기존 그리드 규칙과 겹쳐 데스크톱 표가 모두 깨진 적이 있다. 새 클래스는 `toss-` 접두어를 붙인다.
- **다크 모드**: 기존 `@media (prefers-color-scheme: dark)` 블록이 있으면 같은 미디어 쿼리 안에 다크 토큰을 다시 선언해야 라이트 값이 새지 않는다.
- **확인**: CSS만 바꿔도 휴대폰 카드형 표·모달·인쇄(성적서)가 달라질 수 있다. 바꾼 뒤 주요 화면을 데스크톱·390px·인쇄 미리보기로 다시 본다.

---

# 받은 가이드 (원문 ①~⑪)

원문 맨 앞의 메타데이터(hero_html 등)와 ⑫ 시그니처 예시 HTML은 분량이 커서 뺐다. 값은 아래 본문과 `assets/base.css`에 모두 들어 있다.

### ① 브랜드 DNA

- **브랜드명**: Toss(토스). 송금으로 시작해 자산 관리, 투자, 결제, 쇼핑을 한 앱 안에서 이어 주는 서비스다.
- **한 줄 정체성**: 복잡한 금융 절차를 누구나 이해할 수 있는 짧은 행동으로 바꾼다.
- **공식 메시지**: 현재 홈페이지의 첫 문장은 “금융부터 일상까지”다. 금융 기능을 목록으로만 보여주지 않고, 휴대폰을 쓰는 일상 장면으로 소개한다.
- **시그니처 요소 1개**: 크게 둥근 장면 속에서 파란 완료 표시와 굵은 한국어 한 문장이 만나는 구성. 송금 결과를 숫자와 짧은 말로 보여 주면 제품의 쉬움이 먼저 읽힌다.
- **문서 범위**: 홈페이지 구성과 공개 TDS Mobile 문서를 함께 기록했다. 디자인 시스템은 2018년부터 만들어졌고 2025년에 색 체계 개편을 소개했다. 2015년 서비스 출시와 디자인 시스템의 시작은 서로 다른 시점이다. 첫 공개 연도는 제작 시작 시점인 2018년으로 추정했으며, 별도 외부 공개일은 확인하지 못했다.
- **확인 범위**: 브랜드 색은 브랜드 자료실, UI 값은 공개 색표와 배포 CSS에서 확인했다. 2025년 개편 글은 OKLCH와 의미별 토큰 체계를 설명하지만 전체 새 팔레트를 공개하지 않는다. 아래 값은 열람 가능한 공개 토큰이며, 2025년 신규 내부 토큰 전체를 옮긴 문서는 아니다.

### ② 톤 & 무드

- **핵심 키워드 3개**: 쉬움, 선명함, 친근함.
- **무드 설명**: 페이지 바탕은 흰색으로 비워 두고 큰 생활 장면을 둥근 모서리로 감싼다. 진한 회색 제목과 부드러운 회색 설명 사이에 파란 행동 하나를 둔다. 영상에서는 흰 제목을 어두운 하단 위에 놓는다.
- **비주얼 스타일**: 모던 미니멀과 휴머니즘. 복잡한 도표보다 손에 든 기기와 큰 결과 표시를 먼저 보여 준다.
- **밀도**: Spacious. 홈페이지는 한 구획에 메시지 하나와 큰 장면 하나를 둔다. 앱의 계좌 목록처럼 줄 간격을 촘촘하게 옮기지 않는다.
- **모서리 성향**: Round. 일반 버튼은 약 12~16px, 홈페이지의 큰 영상은 약 40px다(화면 관찰, 추정). 모든 요소를 알약 모양으로 만들지 않는다.
- **평면성**: Subtle. 본문과 일반 카드는 평평하다. 기기·사진·일러스트 안에서만 빛과 깊이를 드러낸다.
- **라이트와 다크**: TDS의 공식 배포 CSS에는 두 테마용 배경·글자·경계·파랑 값이 있다. 홈페이지에 어두운 영상이 있다는 이유로 다크 모드를 판정하지 않았다. 다크 예시는 이 토큰을 같은 홈페이지 구성에 적용한 화면이다.

### ③ 컬러 시스템

브랜드 블루와 UI 블루의 역할을 나눈다. 브랜드 자료실의 **Toss Blue는 #0064FF**, **Toss Gray는 #202632**다. UI의 기본 파랑은 공개 TDS 색표의 **blue500 #3182F6**다. 모든 파란색을 브랜드 블루 하나로 치환하지 않는다.

```css
:root {
  --color-brand: #0064ff; /* 브랜드 식별용 */
  --color-brand-gray: #202632;
  --color-primary-50: #e8f3ff;
  --color-primary-100: #c9e2ff;
  --color-primary-200: #90c2ff;
  --color-primary-300: #64a8ff;
  --color-primary-400: #4593fc;
  --color-primary-500: #3182f6; /* 공개 TDS UI 기본 파랑 */
  --color-primary-600: #2272eb;
  --color-primary-700: #1b64da;
  --color-primary-800: #1957c2;
  --color-primary-900: #194aa6;
  --color-neutral-0: #ffffff;
  --color-neutral-50: #f9fafb;
  --color-neutral-100: #f2f4f6;
  --color-neutral-200: #e5e8eb;
  --color-neutral-300: #d1d6db;
  --color-neutral-400: #b0b8c1;
  --color-neutral-500: #8b95a1;
  --color-neutral-600: #6b7684;
  --color-neutral-700: #4e5968;
  --color-neutral-800: #333d4b;
  --color-neutral-900: #191f28;
  --color-neutral-1000: #000000;
  --color-success-bg: #f0faf6;
  --color-success-fg: #029359;
  --color-warning-bg: #fff9e7;
  --color-warning-fg: #dd7d02;
  --color-error-bg: #ffeeee;
  --color-error-fg: #d22030;
  --color-info-bg: #e8f3ff;
  --color-info-fg: #1b64da;
  --color-danger: #f04452;
  --bg-base: #ffffff; /* adaptiveBackground */
  --bg-subtle: #f2f4f6; /* adaptiveGreyBackground */
  --bg-elevated: #ffffff; /* adaptiveLayeredBackground */
  --bg-overlay: #ffffff; /* adaptiveFloatBackground */
  --text-primary: #191f28;
  --text-secondary: #4e5968;
  --text-tertiary: #6b7684;
  --text-on-primary: #ffffff;
  --text-disabled: #b0b8c1;
  --border-default: #e5e8eb;
  --border-subtle: #f2f4f6;
  --border-strong: #b0b8c1;
  --border-focus: #3182f6;
  --button-primary: #3182f6;
  --button-primary-hover: #2272eb;
  --button-primary-active: #1b64da;
  --color-link: #1b64da;
  --focus-ring: #1b64da;
  --font-brand: 'Toss Product Sans', -apple-system, BlinkMacSystemFont,
    'Noto Sans CJK KR', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif;
}
```

- **출처가 있는 값**: 파랑·회색 단계와 상태색의 원색 값은 TDS Colors, 배경 위계는 공식 `tds/style.css`, 브랜드 두 색은 브랜드 자료실이다.
- **예시에 정한 역할**: 상태 배경과 앞글자 조합, 링크 색, hover·active 단계 선택은 공개 팔레트로 구성한 적용값이다(추정). 공식 컴포넌트의 현재 내부 구현을 그대로 복제한 값으로 보지 않는다.
- **색의 양**: 넓은 UI 바탕은 흰색과 회색, 파랑은 결과·주요 행동에 집중한다. 영상의 피부색·기기 재질·청회색 배경은 UI 의미색과 분리한다.
- **읽기**: 작은 파란 링크는 기본 파랑보다 짙은 700단계를 쓴다. 완료 여부는 색과 함께 체크 모양 및 문장으로 전달한다.

### ④ 타이포그래피

- **한글·영문**: Toss Product Sans. 산돌은 한글을 산돌고딕Neo1에 기초해 다듬고 영문과 숫자 등을 새로 설계했다고 설명한다. 토스 홈페이지도 이 서체를 먼저 선언한다. Pretendard를 토스 전용 서체로 설명하지 않는다.
- **대체 서체**: Toss Product Sans가 설치되지 않은 곳에서는 시스템 한글 고딕으로 표시한다. 아래 예시는 외부 폰트를 내려받지 않는다. 따라서 획의 끝과 숫자 폭이 실제 토스 화면과 조금 다를 수 있다.
- **공개 기본 위계**: TDS Typography 문서의 크기와 행간을 따른다. 굵기와 자간은 내용에 맞춰 정한 예시값이다(추정).
  - Display: 56px / 700 / 1.18 / -.04em — 홈페이지 큰 장면용(전체 값 추정).
  - H1, T1: 30px / 700 / 40px / -.03em.
  - H2, T2: 26px / 700 / 35px / -.03em.
  - H3, T3: 22px / 700 / 31px / -.025em.
  - Body Large, T4: 20px / 500 / 29px / -.02em.
  - Body, T5: 17px / 400 / 25.5px / -.02em.
  - Body Small, T6: 15px / 400 / 22.5px / -.02em.
  - Caption, T7: 13px / 400 / 19.5px / -.01em.
- **문장 모양**: 제목은 한국어 의미 단위로 끊고 굵기 하나로 강조한다. 같은 문장에 파란 단어·밑줄·배지를 한꺼번에 넣지 않는다. 금액은 `10,000원`처럼 쉼표와 단위를 함께 쓴다.
- **큰 글자 설정**: TDS 문서는 기기의 텍스트 확대 설정에 맞춰 토큰을 바꾸도록 안내한다. 서비스 UI를 구현할 때는 이 표의 px만 고정하지 않는다. 예시는 rem과 유동 제목 크기를 섞는다.

### ⑤ 스페이싱

헤더·장면·설명 사이의 간격이 화면을 나눈다. PC 홈페이지의 헤더는 약 64px, 모바일은 약 56px이며 작은 화면에는 약 20px의 좌우 여백이 보인다. 아래 토큰의 묶음과 상세 데모용 수치는 이 관찰을 압축한 값이다(추정).

```css
:root {
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;
  --space-3xl: 64px;
  --space-section: 88px;
  --container-max: 1184px;
  --container-gutter: 24px;
}
.toss-container {
  width: min(calc(100% - var(--container-gutter) * 2), var(--container-max));
  margin-inline: auto;
}
@media (max-width: 640px) {
  :root { --container-gutter: 20px; --space-section: 64px; }
}
```

- **기본 단위**: 4px를 조합한 예시 체계(추정). TDS 전체가 이 간격만 쓴다고 단정하지 않는다.
- **화면 폭**: 큰 장면은 본문보다 넓게, 문장은 읽기 좋은 폭으로 제한한다. 좌우를 카드 격자로 모두 채우지 않는다.
- **반응형**: 712px에서는 제목과 기기가 함께 보이도록 가로 구성을 유지한다. 640px 이하에서 문장과 그림을 세로로 배치한다.

### ⑥ Border Radius

작은 조작 요소와 큰 영상의 둥글기를 나눈다. 큰 이미지의 모서리를 버튼 크기에 그대로 적용하지 않는다. 아래 수치는 공식 페이지 관찰로 정한 예시값이다(추정).

```css
:root {
  --radius-none: 0;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-scene: 40px;
  --radius-full: 9999px;
}
```

- 8~12px: 짧은 상태 표식과 헤더 버튼.
- 16px: 입력과 주요 버튼, 눌러서 이동하는 작은 카드.
- 24px: 자산 묶음 등 중간 크기 면.
- 40px: 홈페이지의 큰 생활 장면. 축소 카드에서는 약 22px로 압축한다.
- 완전한 원: 완료 체크 등 실제 원형 상태 아이콘에만 쓴다.

### ⑦ Shadow / Elevation

표면은 간격과 바탕색으로 구별한다. 모든 카드에 그림자를 붙이지 않는다. 그림자 값은 제품·장면의 깊이를 보여 주기 위한 예시값이다(추정).

```css
:root {
  --shadow-none: none;
  --shadow-sm: 0 2px 6px rgba(0, 23, 51, .04);
  --shadow-md: 0 8px 24px rgba(0, 23, 51, .08);
  --shadow-lg: 0 16px 40px rgba(0, 23, 51, .12);
  --shadow-xl: 0 28px 72px rgba(0, 23, 51, .16);
}
```

- None: 일반 본문, 계좌 행, 기본 카드.
- Small: 배경과 구별이 어려운 작은 부유 버튼.
- Medium: 안내 창이나 떠 있는 결과 요약.
- Large: 예시 속 입체 기기 주변. 금융 정보 칸 전체에 쓰지 않는다.
- XLarge: 큰 제품 그림의 접지감. 긴 페이지의 모든 구획에 반복하지 않는다.

### ⑧ Iconography

- **스타일**: UI의 체크·화살표는 단순한 선과 채운 원을 조합한다. 브랜드 심볼과 일반 상태 아이콘을 구별한다.
- **선 굵기**: 예시는 24px 격자에 2px, 둥근 끝을 쓴다(추정). 실제 홈페이지의 메뉴는 단순한 가로선이다.
- **부피감**: 큰 기기 그림에는 금속 외곽, 화면 반사, 손의 음영, 둥근 완료 표시를 남긴다. 작은 목록 아이콘까지 모두 3D로 만들지 않는다.
- **로고**: 공식 CDN의 검정·흰 모노 SVG를 각각 사용한다. 심볼을 임의의 파란 타원으로 그리거나 일반 폰트로 `toss`를 입력해 대신하지 않는다.
- **추천 소스**: 로고는 토스 공식 파일, 일반 기호는 화면에 필요한 선을 직접 작성한다. 외부 아이콘 묶음은 사용하지 않았다.
- **접근성**: 의미를 전달하는 그림에는 이름을 붙인다. 문장과 뜻이 같은 체크나 화살표는 장식으로 숨긴다.

### ⑨ 컴포넌트 가이드

TDS Button 문서는 fill·weak 스타일, primary·dark·danger·light 색, small·medium·large·xlarge 크기를 제공한다. 아래는 이를 웹 예시에 맞게 줄인 클래스다. 높이·모서리·상태별 색 조합은 예시 적용값이다(추정). 버튼이 실제 서비스로 이동하는 기능은 포함하지 않는다.

```css
.toss-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 48px; padding: 12px 20px; border: 1px solid transparent;
  border-radius: var(--radius-lg); font: 600 1rem/1.4 var(--font-brand);
  letter-spacing: -.02em; cursor: pointer; text-decoration: none;
  transition: background-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}
.toss-btn--primary { background: var(--button-primary); color: var(--text-on-primary); }
.toss-btn--primary:hover { background: var(--button-primary-hover); }
.toss-btn--primary:active { background: var(--button-primary-active); transform: scale(.98); }
.toss-btn--secondary { background: var(--color-primary-50); color: var(--color-link); }
.toss-btn--secondary:hover { background: var(--color-primary-100); }
.toss-btn--secondary:active { background: var(--color-primary-200); transform: scale(.98); }
.toss-btn--ghost { background: transparent; color: var(--text-secondary); }
.toss-btn--ghost:hover { background: var(--bg-subtle); }
.toss-btn--ghost:active { background: var(--border-default); transform: scale(.98); }
.toss-btn--danger { background: var(--color-danger); color: #fff; }
.toss-btn--danger:hover { background: var(--color-error-fg); }
.toss-btn--danger:active { opacity: .85; transform: scale(.98); }
.toss-btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
.toss-btn[aria-busy="true"] { position: relative; cursor: progress; pointer-events: none; }
.toss-btn[aria-busy="true"] .toss-btn-label { opacity: 0; }
.toss-btn .toss-loading { display: none; }
.toss-btn[aria-busy="true"] .toss-loading {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  position: absolute; inset: 0;
}
.toss-loading i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: toss-dot .9s infinite; }
.toss-loading i:nth-child(2) { animation-delay: .12s; }
.toss-loading i:nth-child(3) { animation-delay: .24s; }
.toss-btn:focus-visible, .toss-nav button:focus-visible {
  outline: 3px solid var(--focus-ring); outline-offset: 3px;
}
.toss-field { display: grid; gap: 8px; color: var(--text-secondary); font: 500 15px/1.5 var(--font-brand); }
.toss-field input {
  box-sizing: border-box; width: 100%; min-width: 0; min-height: 52px;
  border: 1px solid var(--border-default); border-radius: var(--radius-md);
  padding: 12px 16px; background: var(--bg-elevated); color: var(--text-primary);
  font: 400 17px/1.5 var(--font-brand);
}
.toss-field input::placeholder { color: var(--text-tertiary); }
.toss-field input:focus { outline: 2px solid var(--border-focus); outline-offset: 1px; }
.toss-field input[aria-invalid="true"] { border-color: var(--color-error-fg); }
.toss-field input[aria-invalid="true"]:focus { outline-color: var(--color-error-fg); }
.toss-field input:disabled { background: var(--bg-subtle); color: var(--text-disabled); cursor: not-allowed; }
.toss-field-error { color: var(--color-error-fg); font-size: 13px; }
.toss-card { padding: 24px; border-radius: var(--radius-xl); background: var(--bg-subtle); color: var(--text-primary); }
.toss-card--emphasis { background: var(--color-primary-50); }
.toss-card--outline { background: var(--bg-elevated); border: 1px solid var(--border-default); }
.toss-badge { display: inline-flex; padding: 4px 8px; border-radius: var(--radius-sm); font: 600 13px/1.5 var(--font-brand); }
.toss-badge--solid { background: var(--button-primary); color: var(--text-on-primary); }
.toss-badge--subtle { background: var(--color-primary-50); color: var(--color-link); }
.toss-badge--outline { border: 1px solid var(--border-default); color: var(--text-secondary); }
.toss-nav { display: flex; align-items: center; gap: 24px; min-height: 64px; }
.toss-nav button { border: 0; background: transparent; color: var(--text-secondary); font: 500 14px/1.5 var(--font-brand); padding: 8px 0; cursor: pointer; }
.toss-nav button:hover { color: var(--text-primary); }
.toss-nav button[aria-current="page"] { color: var(--text-primary); font-weight: 700; }
```

- **버튼**: 한 작업의 주요 버튼은 fill, 보조 행동은 weak로 구별한다. 로딩 상태는 문구의 자리와 폭을 유지하고 세 점만 바꾼다. 로딩 사실은 별도 상태 텍스트로도 알린다.
- **입력**: label을 유지하고 오류 문장은 필드 바로 아래 연결한다. 빨간 선만으로 실패 이유를 전달하지 않는다.
- **카드**: 일반형은 회색 면, 강조형은 옅은 파랑, 테두리형은 흰 면과 가는 경계다. 모든 형식을 한 화면에 견본처럼 나열하지 않는다.
- **배지**: 진행 상태나 범주가 정말 필요할 때만 쓴다. 제목 위에 근거 없는 'NEW'나 'BEST'를 붙이지 않는다.
- **내비게이션**: 홈페이지의 서비스·비즈니스·회사소개·뉴스룸·채용 흐름을 따른다. 좁은 화면에서 항목을 작은 글자로 압축하지 않는다.

### ⑩ Motion

홈페이지는 영상과 스크롤로 장면이 이어진다. 정적인 예시에서는 움직임을 멈춘 한 장면으로 보여 주며, 자동으로 숫자를 돌리거나 송금 성공을 반복 재생하지 않는다. 아래 시간·곡선은 적용 예시다(추정).

```css
:root {
  --duration-fast: 150ms;
  --duration-base: 220ms;
  --duration-slow: 400ms;
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-in-out: cubic-bezier(.4, 0, .2, 1);
}
@keyframes toss-dot { 0%, 65%, 100% { opacity: .35; } 30% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .toss-btn { transition: none; }
  .toss-btn:active { transform: none; }
  .toss-loading i { animation: none; opacity: 1; }
}
```

### ⑪ Anti-patterns

1. **브랜드 파랑과 UI 파랑을 섞기**: 로고용 #0064FF를 모든 버튼·링크·다크 강조색에 그대로 복사하지 않는다. 값보다 역할을 먼저 구별한다.
2. **가짜 토스 로고와 잘못된 서체 설명**: 임의의 타원과 굵은 영문을 붙이지 않는다. Toss Product Sans를 Pretendard의 다른 이름처럼 설명하지 않는다.
3. **작은 금융 정보를 빽빽하게 채우기**: 홈페이지 장면에 계좌·혜택·차트·종목 목록을 한꺼번에 넣으면 큰 메시지가 사라진다.
4. **모든 면을 입체로 만들기**: 사진과 기기의 반사는 필요하지만 일반 입력창과 목록까지 강한 그림자를 두르면 토스의 평평하고 명료한 UI가 흐려진다.
5. **어두운 사진을 다크 모드라 부르기**: 다크에서는 페이지·층·글자·경계 값을 함께 바꾼다. 영상 한 구획의 색만으로 제품의 테마 지원을 주장하지 않는다.

