# store-watch-core

네이버 스마트스토어 최신상품 조회 핵심 로직입니다. **프레임워크·UI 의존성이 없습니다** — React도 Next.js도 필요 없고, 순수 TypeScript로만 돼 있습니다.

새 프로젝트(`Eachdoll/271`)의 시작점으로 쓰세요. 화면과 저장 방식은 이 위에 자유롭게 얹으면 됩니다.

## 검증 상태

```
테스트 47건 통과 (jest)
타입체크 통과 (tsc --noEmit)
```

이 저장소만 떼어내 독립 실행한 결과입니다.

**단, 네이버 실제 응답으로는 검증하지 못했습니다.** 개발 환경 IP가 네이버에 차단(429)돼 있어 모의 응답으로만 테스트했습니다. 아래 "알려진 제약" 참고.

## 시작하기

```bash
npm install
npm test        # 47건
npm run typecheck
```

## 사용법

```ts
import { parseStoreInput, fetchLatestProducts, mergeStoreFeed } from "./src";

// 1) 사용자 입력에서 스토어 식별자 추출 (URL / 아이디 모두 허용)
const parsed = parseStoreInput("https://smartstore.naver.com/mystore");
if (!parsed.ok) throw new Error("스마트스토어 주소가 아닙니다");

// 2) 최신 상품 조회
const result = await fetchLatestProducts(parsed.ref, 12);
if (!result.success) {
  console.error(result.code); // BLOCKED | STORE_NOT_FOUND | EMPTY_RESULT | ...
  return;
}

// 3) 여러 스토어를 하나의 최신순 목록으로 병합
const feed = mergeStoreFeed([result.data]);
```

### 응답 캐시 주입 (권장)

기본값은 매 호출마다 네이버로 나갑니다. 프레임워크에 맞는 캐시를 주입하세요.

```ts
import { setUpstreamFetchInit, UPSTREAM_REVALIDATE_SEC } from "./src";

// Next.js
setUpstreamFetchInit({ next: { revalidate: UPSTREAM_REVALIDATE_SEC } } as RequestInit);
```

## 구성

| 파일 | 역할 |
| --- | --- |
| `parseStoreInput.ts` | 입력 → 스토어 식별자. **외부 요청의 신뢰 경계** |
| `naverClient.ts` | 네이버 조회 (3단계 폴백 체인) |
| `extractProducts.ts` | 응답 → 상품 정규화 |
| `extractPreloadedState.ts` | HTML 인라인 상태 JSON 추출 (폴백용) |
| `compareByRecency.ts` | 최신순 정렬 기준 |
| `mergeStoreFeed.ts` | 여러 스토어 → 통합 최신순 목록 |
| `const.ts` / `types.ts` | 설정값 / 타입 |

## 설계에서 지켜야 할 것

이 코드에는 이유가 있어서 그렇게 짠 부분이 있습니다. 새로 얹을 때 무너뜨리지 마세요.

**1. SSRF 차단 — `parseStoreInput`이 유일한 관문**

외부 요청 URL은 항상 `허용 도메인 상수 + 검증된 storeId`로만 조립합니다. 사용자 입력 문자열을 그대로 `fetch`에 넘기지 않습니다. 허용 도메인은 `smartstore.naver.com`, `m.smartstore.naver.com`, `brand.naver.com`, `m.brand.naver.com` 넷뿐입니다.

`smartstore.naver.com.attacker.io` 같은 도메인 사칭과 `https://smartstore.naver.com@attacker.io/` 같은 자격증명 URL을 거부하는 테스트가 있습니다. 지우지 마세요.

**2. 호출 빈도 제한을 반드시 두세요**

이 패키지에는 없습니다. 공개 화면에 붙인다면 IP 단위 제한을 꼭 추가하세요 (원본에서는 60초당 20회). 없으면 누구나 여러분의 서버를 경유해 네이버로 요청을 흘릴 수 있습니다.

**3. 응답 경로에 의존하지 않는 파싱**

네이버는 공개 API 스펙을 보장하지 않습니다. 그래서 고정 경로(`widgetContents.…`)를 따라가지 않고, 페이로드 전체를 순회하며 "상품번호 + 이름 + 가격"을 가진 객체를 찾습니다. 응답 구조가 바뀌어도 필드명만 유지되면 계속 동작합니다.

조회도 3단계로 폴백합니다: 스토어 메타 JSON → 채널 상품목록 JSON → 스토어 페이지 HTML 인라인 JSON.

**4. 상품번호는 스토어를 가로질러 유일하지 않습니다**

통합 피드에서 중복 제거는 반드시 `호스트/스토어ID/상품번호`로 판단하세요. 상품번호만 쓰면 서로 다른 스토어의 다른 상품이 하나로 합쳐집니다.

## 알려진 제약

- **네이버 IP 차단**: 데이터센터 IP는 차단(429)되기 쉽습니다. 서버에서 호출하면 `BLOCKED`가 날 수 있습니다. 폰/PC에서 직접 호출하는 네이티브 앱이라면 통신사 IP로 나가 훨씬 안전합니다. 웹(브라우저)에서는 CORS 때문에 직접 호출이 불가능해 서버 경유가 강제됩니다.
- **정렬만 있고 기간 필터는 없습니다**: "신상품"을 최신순 정렬로만 정의했습니다. `최근 N일` 필터가 필요하면 `mergeStoreFeed`에 조건을 추가하세요.
- **등록일이 없는 응답**: 등록일이 빠지면 상품번호가 클수록 최신이라는 성질로 정렬합니다. 근사치입니다.

## 함께 가져올 수 있는 것

원본에는 이 위에 얹혀 있던 Next.js 레이어(서버 액션, React Query 훅, UI 컴포넌트, PWA 설정)가 더 있습니다. 프레임워크에 묶여 있어 여기서는 뺐습니다. 필요하면 `smartstore-personal.patch`에서 꺼내 쓰세요.
