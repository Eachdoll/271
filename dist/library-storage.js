/** Startup checks structure only. Byte/signature checks belong to external imports. */
export function validateStoredLibrary(text) {
  if (typeof text !== "string" || text.length > 250 * 1024 * 1024)
    throw new Error("기기 보관 데이터 크기를 확인해 주세요.");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("라이브러리 구조를 읽지 못했어요.");
  if (
    parsed.format &&
    (parsed.format !== "donghwa-workshop-library" || parsed.version !== 1)
  )
    throw new Error("지원하지 않는 보관 버전이에요.");
  const state = parsed.format ? parsed.state : parsed;
  if (
    !state ||
    !Array.isArray(state.books) ||
    !Array.isArray(state.characters) ||
    (state.backgrounds !== undefined && !Array.isArray(state.backgrounds)) ||
    !state.settings ||
    typeof state.settings !== "object" ||
    Array.isArray(state.settings) ||
    (state.version !== undefined && ![1, 2].includes(state.version))
  )
    throw new Error("책·재료·설정 구조를 확인해 주세요.");
  const invalidRecords = [];
  const checkImages = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new Error("허용하지 않는 데이터 키예요.");
      if (
        key === "imageUrl" &&
        item != null &&
        (typeof item !== "string" ||
          !/^(asset:|data:image\/|\/assets\/)/i.test(item))
      )
        throw new Error("그림 주소를 확인해 주세요.");
      if (item && typeof item === "object") checkImages(item);
    }
  };
  for (const collection of ["books", "characters", "backgrounds"]) {
    const ids = new Set();
    state[collection] = (state[collection] || []).filter((record, index) => {
      try {
        if (
          !record ||
          typeof record.id !== "string" ||
          !record.id ||
          ids.has(record.id)
        )
          throw new Error("식별자를 확인해 주세요.");
        if (
          collection === "books" &&
          (typeof record.title !== "string" ||
            !Array.isArray(record.pages) ||
            !record.pages.length ||
            record.pages.length > 100 ||
            record.pages.some(
              (p) =>
                !p ||
                typeof (p.ko ?? p.textKo) !== "string" ||
                typeof (p.en ?? p.textEn) !== "string",
            ))
        )
          throw new Error("책 본문 형식을 확인해 주세요.");
        if (collection !== "books" && typeof record.name !== "string")
          throw new Error("재료 이름을 확인해 주세요.");
        checkImages(record);
        ids.add(record.id);
        return true;
      } catch (error) {
        invalidRecords.push({
          collection,
          index,
          record,
          error: error.message,
        });
        return false;
      }
    });
  }
  return { state, invalidRecords, version: 1 };
}

/* Never replace unreadable browser data with a sample library on the next save. */
export function readStoredLibrary(storage, key, { validate, seed }) {
  let raw = null;
  try {
    raw = storage.getItem(key);
    if (raw === null)
      return { state: seed(), kind: "fresh", raw: null, error: null };
    return {
      ...(() => {
        const result = validate(raw);
        return result?.invalidRecords
          ? { state: result.state, invalidRecords: result.invalidRecords }
          : { state: result, invalidRecords: [] };
      })(),
      kind: "ready",
      raw,
      error: null,
    };
  } catch (error) {
    return {
      state: seed(),
      kind: "blocked",
      raw,
      error: String(error?.message || error),
    };
  }
}
export function writeStoredLibrary(
  storage,
  key,
  state,
  { blocked = false, invalidRecords = [] } = {},
) {
  if (blocked)
    throw new Error(
      "기존 데이터를 읽지 못해 원본을 보호하고 있어요. 복구 파일을 가져온 뒤 저장해 주세요.",
    );
  const preserved = { ...state };
  for (const collection of new Set(
    invalidRecords.map((item) => item.collection),
  )) {
    preserved[collection] = [...(state[collection] || [])];
    for (const item of invalidRecords
      .filter((item) => item.collection === collection)
      .sort((a, b) => a.index - b.index))
      preserved[collection].splice(
        Math.min(item.index, preserved[collection].length),
        0,
        item.record,
      );
  }
  storage.setItem(key, JSON.stringify(preserved));
}
const DB = "donghwa-workshop-library-recovery",
  STORE = "snapshots";
let pending;
function database() {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error("이 브라우저에서 복구용 보관함을 사용할 수 없어요."),
    );
  if (!pending)
    pending = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      const timer = setTimeout(
        () => reject(new Error("복구용 보관함을 여는 시간이 초과됐어요.")),
        8000,
      );
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = request.onblocked = () => {
        clearTimeout(timer);
        reject(
          new Error(
            "복구용 보관함을 열지 못했어요. 기존 데이터를 바꾸지 않았어요.",
          ),
        );
      };
    }).catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}
const RECOVERY_KEEP = 3;
export async function keepRecoveryPoint(
  text,
  { reason = "before-import", mediaDeferred = false } = {},
) {
  if (typeof text !== "string" || !text)
    throw new Error("복구용 원본 데이터가 없어요.");
  const db = await database(),
    record = {
      id: "recovery-" + crypto.randomUUID(),
      text,
      reason,
      mediaDeferred,
      createdAt: new Date().toISOString(),
    };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"),
      store = tx.objectStore(STORE);
    store.put(record);
    const all = store.getAll();
    all.onsuccess = () => {
      const extra = (all.result || [])
        .filter((item) => item.id !== record.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(RECOVERY_KEEP - 1);
      for (const old of extra) store.delete(old.id);
    };
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () =>
      reject(
        new Error(
          "복구용 원본을 보관하지 못했어요. 공간을 확보한 뒤 다시 시도해 주세요.",
        ),
      );
  });
  return record;
}
export async function latestRecoveryPoint() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly"),
      r = tx.objectStore(STORE).getAll();
    r.onsuccess = () =>
      resolve(
        r.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ||
          null,
      );
    r.onerror = () => reject(new Error("복구용 보관본을 읽지 못했어요."));
  });
}
