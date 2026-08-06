/**
 * 화면 로직.
 *
 * 조회·정규화·정렬은 전부 store-watch-core가 서버에서 합니다. 여기서는 그리기만 합니다.
 * 스토어 목록은 서버에 남기지 않고 이 브라우저의 localStorage에만 둡니다.
 */

/** 코어의 SMART_STORE_STORAGE_KEY와 같은 값 */
const STORAGE_KEY = "smartstore:stores";

const el = {
  form: document.getElementById("add-form"),
  search: document.querySelector(".search"),
  input: document.getElementById("store-input"),
  storebar: document.getElementById("storebar"),
  chips: document.getElementById("chips"),
  refresh: document.getElementById("refresh"),
  notices: document.getElementById("notices"),
  feed: document.getElementById("feed-section"),
  count: document.getElementById("feed-count"),
  fetchedAt: document.getElementById("fetched-at"),
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  skeleton: document.getElementById("skeleton"),
  example: document.getElementById("example"),
  demoFlag: document.getElementById("demo-flag"),
};

/** @type {{storeId:string, host:string, key:string, storeUrl:string, displayName?:string, addedAt:string}[]} */
let stores = readStores();
/** 선택된 스토어 키. null이면 전체 보기. */
let activeKey = null;
let loading = false;

const ERROR_TEXT = {
  INVALID_INPUT: {
    title: "스마트스토어 주소가 아닙니다",
    desc: "smartstore.naver.com 또는 brand.naver.com 주소를 넣거나, 스토어 아이디만 입력해 주세요.",
  },
  STORE_NOT_FOUND: {
    title: "스토어를 찾을 수 없습니다",
    desc: "주소가 바뀌었거나 문을 닫은 스토어일 수 있습니다.",
  },
  BLOCKED: {
    title: "네이버가 이 서버의 요청을 막았습니다",
    desc: "데이터센터 IP는 차단(429)되기 쉽습니다. 개인 회선의 PC에서 직접 띄우면 통과할 수 있습니다.",
  },
  UPSTREAM_ERROR: {
    title: "네이버 응답을 읽지 못했습니다",
    desc: "잠시 뒤 새로고침해 주세요. 계속 이러면 응답 구조가 바뀌었을 수 있습니다.",
  },
  EMPTY_RESULT: {
    title: "노출 중인 상품이 없습니다",
    desc: "스토어에 판매 중인 상품이 없거나 전부 숨김 상태입니다.",
  },
  RATE_LIMITED: {
    title: "잠시 뒤에 다시 시도해 주세요",
    desc: "네이버를 너무 자주 두드리지 않도록 호출 횟수를 제한하고 있습니다.",
  },
};

init();

async function init() {
  try {
    const config = await fetch("/api/config").then((r) => r.json());
    el.example.textContent = config.example;
    if (config.demo) {
      el.demoFlag.hidden = false;
      // 데모로 띄웠는데 아직 아무것도 없으면 시연용 스토어를 미리 채워둡니다.
      if (stores.length === 0 && config.demoStores.length > 0) {
        stores = config.demoStores.map((storeId) => ({
          storeId,
          host: "smartstore",
          key: `smartstore/${storeId}`,
          storeUrl: `https://smartstore.naver.com/${storeId}`,
          addedAt: new Date().toISOString(),
        }));
        writeStores();
      }
    }
  } catch {
    /* 설정은 부가 정보라 실패해도 화면은 뜹니다. */
  }

  el.form.addEventListener("submit", onAdd);
  el.input.addEventListener("input", () => el.search.classList.remove("is-invalid"));
  el.refresh.addEventListener("click", () => load({ refresh: true }));

  renderChips();
  if (stores.length > 0) load({ refresh: false });
}

function onAdd(event) {
  event.preventDefault();
  const value = el.input.value.trim();
  if (!value) return;

  // 진짜 검증은 서버의 parseStoreInput이 합니다. 여기서는 중복만 걸러냅니다.
  const guessKey = guessStoreKey(value);
  if (guessKey && stores.some((store) => store.key === guessKey)) {
    el.input.value = "";
    activeKey = guessKey;
    renderChips();
    return;
  }

  addPending(value);
}

/**
 * 입력값을 임시로 담아 조회한 뒤, 서버가 확인해 준 식별자로 확정합니다.
 * 서버가 거절하면 목록에 남기지 않습니다.
 */
async function addPending(input) {
  el.input.value = "";
  setLoading(true);

  const requested = [...stores.map((store) => store.storeUrl), input];
  const data = await requestFeed(requested, false);
  setLoading(false);
  if (!data) return;

  const outcome = data.stores.find((entry) => entry.input === input);
  if (!outcome || !outcome.key) {
    el.search.classList.add("is-invalid");
    el.input.value = input;
    renderNotices(outcome ? [outcome] : []);
    return;
  }

  if (!stores.some((store) => store.key === outcome.key)) {
    const [host, storeId] = outcome.key.split("/");
    stores.push({
      storeId,
      host,
      key: outcome.key,
      storeUrl: outcome.storeUrl ?? input,
      displayName: outcome.displayName,
      addedAt: new Date().toISOString(),
    });
    writeStores();
  }

  apply(data);
}

async function load({ refresh }) {
  if (stores.length === 0) {
    renderChips();
    render(null);
    return;
  }
  setLoading(true);
  const data = await requestFeed(stores.map((store) => store.storeUrl), refresh);
  setLoading(false);
  if (data) apply(data);
}

async function requestFeed(storeUrls, refresh) {
  const params = new URLSearchParams({ stores: storeUrls.join(",") });
  if (refresh) params.set("refresh", "1");

  try {
    const response = await fetch(`/api/feed?${params}`);
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } catch {
    renderNotices([{ input: "", ok: false, code: "UPSTREAM_ERROR" }]);
    return null;
  }
}

function apply(data) {
  // 서버가 확인해 준 표시명·상품 수를 칩에 반영합니다.
  for (const outcome of data.stores) {
    if (!outcome.key) continue;
    const store = stores.find((entry) => entry.key === outcome.key);
    if (!store) continue;
    if (outcome.displayName) store.displayName = outcome.displayName;
    store.count = outcome.count;
    store.failed = !outcome.ok;
  }
  writeStores();

  renderChips();
  renderNotices(data.stores.filter((outcome) => !outcome.ok));
  render(data);
}

function render(data) {
  el.grid.replaceChildren();

  const products = !data
    ? []
    : activeKey === null
      ? data.products
      : data.products.filter((item) => `${item.store.host}/${item.store.storeId}` === activeKey);

  if (products.length === 0) {
    el.feed.hidden = true;

    // 목록이 비어도 화면까지 비우지는 않습니다. 왜 비었는지는 위 안내가 설명합니다.
    const hasStores = stores.length > 0;
    el.empty.hidden = false;
    el.empty.querySelector(".empty__title").textContent = hasStores
      ? "보여줄 신상품이 없습니다"
      : "지켜볼 스토어를 추가해 주세요";
    el.empty.querySelector(".empty__desc").hidden = hasStores;
    return;
  }

  el.empty.hidden = true;
  el.feed.hidden = false;
  el.count.textContent = String(products.length);
  el.fetchedAt.textContent = `${formatClock(data.fetchedAt)} 기준`;
  el.grid.append(...products.map(card));
}

function card(product) {
  const item = document.createElement("li");
  item.className = "card";

  const link = document.createElement("a");
  link.className = "card__link";
  link.href = product.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  const thumb = document.createElement("div");
  thumb.className = "thumb";

  if (product.imageUrl) {
    const img = document.createElement("img");
    img.src = product.imageUrl;
    img.alt = "";
    img.loading = "lazy";
    // 네이버 CDN이 막히면 대체 표시로 넘어갑니다.
    img.addEventListener("error", () => img.replaceWith(fallbackThumb(product)));
    thumb.append(img);
  } else {
    thumb.append(fallbackThumb(product));
  }

  if (isNew(product.registeredAt)) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "NEW";
    thumb.append(badge);
  }

  if (product.soldOut) {
    const overlay = document.createElement("span");
    overlay.className = "soldout";
    overlay.textContent = "품절";
    thumb.append(overlay);
  }

  const body = document.createElement("div");
  body.className = "card__body";

  const store = document.createElement("span");
  store.className = "card__store";
  store.textContent = product.store.displayName;

  const name = document.createElement("p");
  name.className = "card__name";
  name.textContent = product.name;

  body.append(store, name, priceRow(product));

  const registered = formatRelative(product.registeredAt);
  if (registered) {
    const foot = document.createElement("p");
    foot.className = "card__foot";
    foot.textContent = registered;
    body.append(foot);
  }

  link.append(thumb, body);
  item.append(link);
  return item;
}

function priceRow(product) {
  const row = document.createElement("div");
  row.className = "price";

  const now = product.discountedPrice ?? product.salePrice;
  if (typeof now !== "number") {
    const unknown = document.createElement("span");
    unknown.className = "price__was";
    unknown.textContent = "가격 정보 없음";
    row.append(unknown);
    return row;
  }

  if (typeof product.salePrice === "number" && product.salePrice > now) {
    const rate = Math.round((1 - now / product.salePrice) * 100);
    if (rate > 0) {
      const discount = document.createElement("span");
      discount.className = "price__rate";
      discount.textContent = `${rate}%`;
      row.append(discount);
    }
  }

  const current = document.createElement("span");
  current.className = "price__now";
  current.textContent = now.toLocaleString("ko-KR");
  const won = document.createElement("small");
  won.textContent = "원";
  current.append(won);
  row.append(current);

  if (typeof product.salePrice === "number" && product.salePrice > now) {
    const was = document.createElement("span");
    was.className = "price__was";
    was.textContent = `${product.salePrice.toLocaleString("ko-KR")}원`;
    row.append(was);
  }

  return row;
}

/** 상품번호로 색을 정해, 이미지 없이도 카드마다 다른 면이 보이게 합니다. */
function fallbackThumb(product) {
  const box = document.createElement("div");
  box.className = "thumb__fallback";

  let hash = 0;
  for (const char of product.productNo) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  box.style.setProperty("--tint-a", `hsl(${hash} 46% 93%)`);
  box.style.setProperty("--tint-b", `hsl(${(hash + 38) % 360} 40% 86%)`);
  box.textContent = product.name.trim().charAt(0) || "?";
  return box;
}

function renderChips() {
  el.storebar.hidden = stores.length === 0;
  el.chips.replaceChildren();
  if (stores.length === 0) return;

  el.chips.append(chip({ label: "전체", key: null, count: undefined }));
  for (const store of stores) {
    el.chips.append(
      chip({
        label: store.displayName || store.storeId,
        key: store.key,
        count: store.count,
        failed: store.failed,
      }),
    );
  }
}

function chip({ label, key, count, failed }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = key === null ? "chip chip--all" : "chip";
  if (failed) button.classList.add("chip--failed");
  button.setAttribute("aria-pressed", String(activeKey === key));

  const text = document.createElement("span");
  text.textContent = label;
  button.append(text);

  if (typeof count === "number" && !failed) {
    const badge = document.createElement("span");
    badge.className = "chip__count";
    badge.textContent = String(count);
    button.append(badge);
  }

  button.addEventListener("click", () => {
    activeKey = activeKey === key ? null : key;
    renderChips();
    load({ refresh: false });
  });

  if (key !== null) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip__remove";
    remove.setAttribute("aria-label", `${label} 삭제`);
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      stores = stores.filter((store) => store.key !== key);
      if (activeKey === key) activeKey = null;
      writeStores();
      renderChips();
      load({ refresh: false });
    });
    button.append(remove);
  }

  return button;
}

function renderNotices(failures) {
  el.notices.replaceChildren();

  // 같은 사유가 여러 스토어에서 나면 한 줄로 묶습니다.
  const byCode = new Map();
  for (const failure of failures) {
    const code = failure.code ?? "UPSTREAM_ERROR";
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(failure.input);
  }

  for (const [code, inputs] of byCode) {
    const text = ERROR_TEXT[code] ?? ERROR_TEXT.UPSTREAM_ERROR;
    const box = document.createElement("div");
    box.className = "notice notice--error";

    const icon = document.createElement("span");
    icon.className = "notice__icon";
    icon.textContent = "!";

    const body = document.createElement("div");
    const title = document.createElement("b");
    title.textContent = text.title;
    const desc = document.createElement("span");
    desc.textContent = text.desc;
    body.append(title, desc);

    const named = inputs.filter(Boolean);
    if (named.length > 0) {
      const which = document.createElement("code");
      which.textContent = named.join(", ");
      body.append(document.createElement("br"), which);
    }

    box.append(icon, body);
    el.notices.append(box);
  }
}

function setLoading(next) {
  loading = next;
  el.refresh.disabled = next;
  el.skeleton.hidden = !next || el.grid.childElementCount > 0;
  if (next && el.skeleton.hidden === false) el.empty.hidden = true;
}

function isNew(registeredAt) {
  if (!registeredAt) return false;
  const at = Date.parse(registeredAt);
  if (Number.isNaN(at)) return false;
  return Date.now() - at < 7 * 24 * 60 * 60 * 1000;
}

function formatRelative(registeredAt) {
  if (!registeredAt) return "";
  const at = Date.parse(registeredAt);
  if (Number.isNaN(at)) return "";

  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "오늘 등록";
  if (days === 1) return "어제 등록";
  if (days < 30) return `${days}일 전 등록`;
  return `${new Date(at).toLocaleDateString("ko-KR")} 등록`;
}

function formatClock(iso) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  return new Date(at).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readStores() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((entry) => entry && entry.key && entry.storeUrl) : [];
  } catch {
    return [];
  }
}

function writeStores() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stores));
  } catch {
    /* 저장 실패는 조회를 막지 않습니다. */
  }
}

/** 입력값만으로 키를 추정합니다. 중복 판단에만 쓰고, 실제 확정은 서버 응답으로 합니다. */
function guessStoreKey(value) {
  const match = value.match(
    /^(?:https?:\/\/)?(?:m\.)?(smartstore|brand)\.naver\.com\/([a-zA-Z0-9][a-zA-Z0-9_-]{1,39})/i,
  );
  if (match) return `${match[1].toLowerCase()}/${match[2]}`;
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/.test(value)) return `smartstore/${value}`;
  return null;
}
