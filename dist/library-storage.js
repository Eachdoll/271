/*
 * 2026-10-20 저장 한도: the library lives in localStorage, whose quota is a
 * few MB of UTF-16 (Safari: about 5MB). A library that no longer fits as
 * plain JSON is stored LZW-compressed (UTF-8 bytes → 9..16-bit codes packed
 * fifteen bits per code unit in U+0100..U+80FF, so the value never holds a
 * surrogate). The value starts with COMPRESSED_MARK; plain JSON is still
 * read and written as before, and a reader always goes through
 * decodeStoredLibrary. A quota refusal after both tries becomes a Korean
 * StorageQuotaError naming the sizes, never the browser's English text.
 */
export const COMPRESSED_MARK = "\u0001dwz1:";
const CLEAR = 256,
  EOD = 257,
  FIRST = 258,
  MAX_CODES = 1 << 16,
  CHUNK_BITS = 15,
  CHUNK_BASE = 0x100;
export function isCompressedLibrary(raw) {
  return typeof raw === "string" && raw.startsWith(COMPRESSED_MARK);
}
/** JSON text → compact storage string (deterministic, no surrogates). */
export function encodeStoredLibrary(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  let out = "",
    bitBuf = 0,
    bitCount = 0;
  const parts = [];
  const emit = (code, width) => {
    bitBuf = (bitBuf << width) | code;
    bitCount += width;
    while (bitCount >= CHUNK_BITS) {
      bitCount -= CHUNK_BITS;
      out += String.fromCharCode(CHUNK_BASE + ((bitBuf >>> bitCount) & 0x7fff));
      bitBuf &= (1 << bitCount) - 1;
      if (out.length >= 8192) {
        parts.push(out);
        out = "";
      }
    }
  };
  let dict = new Map(),
    next = FIRST,
    width = 9,
    prefix = -1;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (prefix < 0) {
      prefix = byte;
      continue;
    }
    const key = prefix * 256 + byte,
      found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix, width);
    dict.set(key, next++);
    if (next === 1 << width && width < 16) width++;
    else if (next === MAX_CODES) {
      emit(CLEAR, width);
      dict = new Map();
      next = FIRST;
      width = 9;
    }
    prefix = byte;
  }
  if (prefix >= 0) emit(prefix, width);
  emit(EOD, width);
  if (bitCount > 0) emit(0, CHUNK_BITS - bitCount);
  parts.push(out);
  return COMPRESSED_MARK + parts.join("");
}
/** Storage string → JSON text. Plain JSON (no mark) is returned as is. */
export function decodeStoredLibrary(raw) {
  if (isSpilledLibrary(raw))
    throw new Error(
      "책장이 큰 보관함(IndexedDB)에 있어요. 큰 보관함을 먼저 읽어야 해요.",
    );
  if (!isCompressedLibrary(raw)) return raw;
  const data = raw.slice(COMPRESSED_MARK.length);
  let pos = 0,
    bitBuf = 0,
    bitCount = 0;
  const read = (width) => {
    while (bitCount < width) {
      if (pos >= data.length) return EOD;
      const unit = data.charCodeAt(pos++) - CHUNK_BASE;
      if (unit < 0 || unit > 0x7fff)
        throw new Error("기기 보관 데이터가 손상됐어요.");
      bitBuf = (bitBuf << CHUNK_BITS) | unit;
      bitCount += CHUNK_BITS;
    }
    bitCount -= width;
    const code = (bitBuf >>> bitCount) & ((1 << width) - 1);
    bitBuf &= (1 << bitCount) - 1;
    return code;
  };
  let out = new Uint8Array(Math.max(64, data.length * 4)),
    length = 0;
  const append = (entry) => {
    if (length + entry.length > out.length) {
      const bigger = new Uint8Array(Math.max(out.length * 2, length + entry.length));
      bigger.set(out);
      out = bigger;
    }
    out.set(entry, length);
    length += entry.length;
  };
  let table = [],
    next = FIRST,
    width = 9,
    previous = null;
  const entryOf = (code) => {
    if (code < 256) return Uint8Array.of(code);
    const entry = table[code - FIRST];
    if (!entry) throw new Error("기기 보관 데이터가 손상됐어요.");
    return entry;
  };
  for (;;) {
    const code = read(width);
    if (code === EOD) break;
    if (code === CLEAR) {
      table = [];
      next = FIRST;
      width = 9;
      previous = null;
      continue;
    }
    let entry;
    if (code === next && previous) {
      entry = new Uint8Array(previous.length + 1);
      entry.set(previous);
      entry[previous.length] = previous[0];
    } else entry = entryOf(code);
    append(entry);
    if (previous && next < MAX_CODES) {
      const added = new Uint8Array(previous.length + 1);
      added.set(previous);
      added[previous.length] = entry[0];
      table[next++ - FIRST] = added;
      if (next + 1 === 1 << width && width < 16) width++;
    }
    previous = entry;
  }
  return new TextDecoder().decode(out.subarray(0, length));
}
/** The browser refused a write for lack of space (any vendor's name or text). */
export function isQuotaError(error) {
  return (
    !!error &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014 ||
      /quota/iu.test(String(error.message || "")))
  );
}
const mb = (chars) => (Math.round((chars * 2) / 1024 / 1024 * 10) / 10).toFixed(1);
export class StorageQuotaError extends Error {
  constructor(plainChars, compressedChars) {
    super(
      `이 기기 브라우저의 저장 한도를 넘어 책장을 저장하지 못했어요 (책장 약 ${mb(plainChars)}MB, 압축해도 약 ${mb(compressedChars)}MB). 끝난 이야기를 책장에 저장하고 '제작 중인 이야기'에서 필요 없는 작업을 지우면 줄어들어요. 이 기기의 자료는 그대로예요.`,
    );
    this.name = "StorageQuotaError";
    this.code = "QUOTA";
    this.plainChars = plainChars;
    this.compressedChars = compressedChars;
  }
}

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
          !/^(asset:|data:image\/|https?:\/\/|\/assets\/)/i.test(item))
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
        const result = validate(decodeStoredLibrary(raw));
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
/** The saved JSON: the state plus the records this device could not read, in place. */
export function storedLibraryText(state, invalidRecords = []) {
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
  return JSON.stringify(preserved);
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
  const text = storedLibraryText(state, invalidRecords);
  // Plain JSON first (readable, cheap); compressed when the plain value does
  // not fit, and from then on (a compressed value is never tried plain again).
  // R27: a library kept in IndexedDB tries only the compressed value here.
  let current = null;
  try {
    current = storage.getItem(key);
  } catch {}
  const compressedFirst = isCompressedLibrary(current) || isSpilledLibrary(current);
  let encoded = null,
    quota = null;
  for (const mode of compressedFirst ? ["compressed"] : ["plain", "compressed"]) {
    try {
      if (mode === "plain") storage.setItem(key, text);
      else {
        encoded ??= encodeStoredLibrary(text);
        storage.setItem(key, encoded);
      }
      return;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      quota = error;
    }
  }
  encoded ??= encodeStoredLibrary(text);
  const failure = new StorageQuotaError(text.length, encoded.length);
  failure.cause = quota;
  throw failure;
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

/*
 * R27 큰 보관함: when even the compressed library does not fit localStorage,
 * the compressed value goes to IndexedDB and localStorage keeps a small
 * pointer (SPILL_MARK + {savedAt, length}). Order matters: the full value is
 * written to IndexedDB first, and only then does the pointer replace the old
 * localStorage value, so a crash in between leaves the previous library
 * readable. Boot resolves the pointer with readSpilledLibrary before
 * readStoredLibrary; a pointer whose record cannot be read blocks saving
 * (storageBlocked) instead of starting a sample library over it.
 */
export const SPILL_MARK = "\u0001dwidb1:";
export function isSpilledLibrary(raw) {
  return typeof raw === "string" && raw.startsWith(SPILL_MARK);
}
const SPILL_DB = "donghwa-workshop-library-spill",
  SPILL_STORE = "library",
  SPILL_ID = "current";
let spillPending;
function spillDatabase() {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error("이 브라우저에서 큰 보관함(IndexedDB)을 쓸 수 없어요."),
    );
  if (!spillPending)
    spillPending = new Promise((resolve, reject) => {
      const request = indexedDB.open(SPILL_DB, 1);
      const timer = setTimeout(
        () => reject(new Error("큰 보관함을 여는 시간이 초과됐어요.")),
        8000,
      );
      request.onupgradeneeded = () =>
        request.result.createObjectStore(SPILL_STORE, { keyPath: "id" });
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = request.onblocked = () => {
        clearTimeout(timer);
        reject(new Error("큰 보관함을 열지 못했어요."));
      };
    }).catch((error) => {
      spillPending = null;
      throw error;
    });
  return spillPending;
}
/** The IndexedDB record behind the pointer ({get, put}; tests pass a memory one). */
export function indexedDbSpillStore() {
  return {
    async get() {
      const db = await spillDatabase();
      return new Promise((resolve, reject) => {
        const r = db.transaction(SPILL_STORE, "readonly").objectStore(SPILL_STORE).get(SPILL_ID);
        r.onsuccess = () => resolve(r.result?.text ?? null);
        r.onerror = () => reject(new Error("큰 보관함을 읽지 못했어요."));
      });
    },
    async put(text) {
      const db = await spillDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(SPILL_STORE, "readwrite");
        tx.objectStore(SPILL_STORE).put({ id: SPILL_ID, text, savedAt: new Date().toISOString() });
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () =>
          reject(new Error("큰 보관함에 저장하지 못했어요. 기기 저장 공간을 확인해 주세요."));
      });
    },
  };
}
/**
 * Write the library to the big store and point localStorage at it. Throws
 * (leaving localStorage as it was) when IndexedDB refuses the value.
 */
export async function spillStoredLibrary(
  storage,
  key,
  state,
  { invalidRecords = [], store = indexedDbSpillStore(), now = () => new Date().toISOString() } = {},
) {
  const text = storedLibraryText(state, invalidRecords),
    encoded = encodeStoredLibrary(text);
  await store.put(encoded);
  storage.setItem(key, SPILL_MARK + JSON.stringify({ savedAt: now(), length: encoded.length }));
  return { length: encoded.length };
}
/**
 * Boot: a localStorage stand-in whose getItem(key) is the library text — the
 * big store's record when localStorage holds the pointer, else the plain
 * value. `spilled` says which; `error` is set when the pointer's record could
 * not be read (getItem then returns the pointer, which decodes to an error,
 * so the app blocks saving rather than replacing the library).
 */
export async function readSpilledLibrary(storage, key, { store = indexedDbSpillStore() } = {}) {
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { storage, spilled: false };
  }
  if (!isSpilledLibrary(raw)) return { storage, spilled: false };
  try {
    const text = await store.get();
    if (typeof text !== "string" || !text) throw new Error("큰 보관함에 책장이 없어요.");
    return {
      spilled: true,
      storage: { getItem: (k) => (k === key ? text : storage.getItem(k)) },
    };
  } catch (error) {
    return { storage, spilled: true, error: String(error?.message || error) };
  }
}
/** Recovery copies and comparisons need the library text, never the pointer. */
export async function libraryTextOf(raw, { store = indexedDbSpillStore() } = {}) {
  if (!isSpilledLibrary(raw)) return raw;
  const text = await store.get();
  if (typeof text !== "string" || !text) throw new Error("큰 보관함에 책장이 없어요.");
  return text;
}
