import { createLibraryBackup, validateImport } from "./output.js";
import {
  FAMILY_MESSAGES,
  FAMILY_SESSION_HEADER,
  FAMILY_SESSION_KEY,
  clearFamilySession,
  derivePasswordKey,
  familyAuthMessage,
  formatRecoveryCode,
  isFamilyOwnerId,
  isFullAutoRunActive,
  isRecoveryCode,
  isSessionToken,
  normalizeRecoveryCode,
  normalizeUsername,
  readFamilySession,
  validateDisplayName,
  validateExistingPassword,
  validatePassword,
  validateUsername,
  writeFamilySession,
} from "./family-auth.js";
const REQUEST_TIMEOUT_MS = 45000,
  REQUEST_TIMEOUT_UPLOAD = 120000,
  AUTH_TIMEOUT_MS = 30000;

/** Per-account library replication. Credentials and parent PINs never leave the device. */
export const CLOUD_SYNC_STORAGE_KEY = "donghwa-cloud-sync-v1";
export const MAX_CLOUD_MEDIA_BYTES = 40 * 1024 * 1024;
/** Shown when a family account is over its media quota (server code quota_exceeded). */
export const CLOUD_QUOTA_MESSAGE =
  "가족 클라우드 저장 공간(5GB)을 다 썼어요. 이 기기의 책과 그림은 그대로 보관돼요. 책장이 바뀌거나 ‘이 기기 자료 클라우드에 저장’을 누르면 다시 올려 봐요.";
const encoder = new TextEncoder();
const clone = (value) => JSON.parse(JSON.stringify(value));
const sensitive = new Set([
  "apikey",
  "key",
  "token",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "bearertoken",
  "secret",
  "secretkey",
  "privatekey",
  "clientsecret",
  "password",
  "authorization",
  "credentials",
  "credential",
  "vault",
  "encryptedcredentials",
  "pin",
  "pinhash",
  "pinsalt",
  "pinverifier",
  "parentpin",
  "parentpinhash",
  "parentpinsalt",
  "parentpinverifier",
]);
const normalizeKey = (key) => key.replace(/[-_\s]/g, "").toLowerCase();
const aborted = () =>
  new DOMException("클라우드 동기화를 취소했어요.", "AbortError");

export class CloudSyncError extends Error {
  constructor(message, code = "CLOUD_SYNC_ERROR", details = {}) {
    super(message);
    this.name = "CloudSyncError";
    this.code = code;
    Object.assign(this, details);
  }
}

function semanticValue(value) {
  if (Array.isArray(value)) return value.map(semanticValue);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (sensitive.has(normalizeKey(key)) || key.startsWith("_restore"))
      continue;
    result[key] =
      key === "imageUrl" && value.imageAssetId
        ? "asset:" + String(value.imageAssetId).replace(/^asset:/, "")
        : semanticValue(value[key]);
  }
  return result;
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle)
    throw new CloudSyncError(
      "이 브라우저에서는 안전한 클라우드 동기화를 사용할 수 없어요. HTTPS 주소로 열어 주세요.",
      "CRYPTO_UNAVAILABLE",
    );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Per-device reading statistics. A child-mode tablet writes them on every
 * opened book but cannot upload, so they never count as a change or a
 * conflict; they travel with the next real save and are merged on apply.
 */
const READING_COUNTS = ["reads", "paperReads"],
  READING_TIMES = ["lastReadAt", "paperReadAt"];
const HASH_VERSION = 2;
function withoutReadingStats(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return state;
  const { daily, ...rest } = state;
  if (Array.isArray(state.books))
    rest.books = state.books.map((book) => {
      if (!book || typeof book !== "object") return book;
      const copy = { ...book };
      for (const field of [...READING_COUNTS, ...READING_TIMES])
        delete copy[field];
      return copy;
    });
  return rest;
}
const stateBytes = (state) =>
  encoder.encode(JSON.stringify(semanticValue(state)));

/** Ignores local PINs, credentials, temporary object URLs and reading statistics when comparing revisions. */
export function hashCloudState(state) {
  return sha256(stateBytes(withoutReadingStats(state)));
}
/** The pre-R11 fingerprint, used only to upgrade baselines saved before reading statistics were left out. */
const legacyHash = (state) => sha256(stateBytes(state));

const countOf = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};
const isLater = (candidate, current) => {
  const next = typeof candidate === "string" ? Date.parse(candidate) : NaN,
    now = typeof current === "string" ? Date.parse(current) : NaN;
  return Number.isFinite(next) && (!Number.isFinite(now) || next > now);
};
/**
 * Keeps this device's reading statistics when a remote library replaces it:
 * for books on both sides the larger count and the later time win, and the
 * daily counter takes the larger value per day. Mutates and returns target.
 */
export function mergeReadingStats(target, local) {
  if (!target || typeof target !== "object" || !local) return target;
  const mine = new Map(
    (Array.isArray(local.books) ? local.books : [])
      .filter((book) => book && typeof book.id === "string")
      .map((book) => [book.id, book]),
  );
  for (const book of Array.isArray(target.books) ? target.books : []) {
    const own = book && mine.get(book.id);
    if (!own) continue;
    for (const field of READING_COUNTS)
      if (countOf(own[field]) > countOf(book[field]))
        book[field] = countOf(own[field]);
    for (const field of READING_TIMES)
      if (isLater(own[field], book[field])) book[field] = own[field];
  }
  if (
    local.daily &&
    typeof local.daily === "object" &&
    !Array.isArray(local.daily)
  ) {
    let daily =
      target.daily &&
      typeof target.daily === "object" &&
      !Array.isArray(target.daily)
        ? target.daily
        : null;
    for (const [day, count] of Object.entries(local.daily)) {
      if (["__proto__", "constructor", "prototype"].includes(day)) continue;
      if (countOf(count) <= countOf(daily?.[day])) continue;
      daily ||= target.daily = {};
      daily[day] = countOf(count);
    }
  }
  return target;
}

/* A brand-new device holds the built-in sample library; that is not data worth offering to upload. */
const SAMPLE_COLLECTIONS = ["books", "characters", "backgrounds"],
  SAMPLE_SETTINGS = new Set([
    "settings",
    "daily",
    "readingLog",
    "version",
    "activeWorldId",
    "worlds",
  ]),
  SAMPLE_BOOK_USAGE = [
    ...READING_COUNTS,
    ...READING_TIMES,
    "favorite",
    "printedAt",
    "worldId",
    "imageEngine",
    "stylePresetId",
    "generationSnapshot",
  ];
function sampleFingerprint(collection, record) {
  if (!record || typeof record !== "object") return null;
  const copy = { ...record };
  if (collection === "books")
    for (const field of SAMPLE_BOOK_USAGE) delete copy[field];
  if (collection === "characters") {
    delete copy.sheetSeed;
    if (
      Array.isArray(copy.characterSheets) &&
      copy.characterSheets.every(
        (sheet) =>
          sheet?.meta?.legacySample === true &&
          sheet.meta.source === "local-svg",
      )
    )
      delete copy.characterSheets;
  }
  return JSON.stringify(semanticValue(copy));
}
const emptyValue = (value) =>
  value == null ||
  value === false ||
  value === "" ||
  (typeof value === "object" && Object.keys(value).length === 0);
const sampleReferences = new WeakMap();
/**
 * True while the library content is still the built-in sample library `seed`
 * (as the app normalizes it on load): the same books, characters and
 * backgrounds and nothing the family made. Settings, the PIN, keys, reading
 * statistics, favourites and the sample World binding do not count. Any field
 * this function does not know about counts as family content.
 */
export function isSeedOnlyLibrary(state, seed) {
  if (!state || typeof state !== "object" || !seed || typeof seed !== "object")
    return false;
  if (Array.isArray(state.worlds) && state.worlds.length > 1) return false;
  for (const [key, value] of Object.entries(state))
    if (
      !SAMPLE_SETTINGS.has(key) &&
      !SAMPLE_COLLECTIONS.includes(key) &&
      !emptyValue(value)
    )
      return false;
  let reference = sampleReferences.get(seed);
  if (!reference) {
    reference = Object.fromEntries(
      SAMPLE_COLLECTIONS.map((collection) => [
        collection,
        new Map(
          (seed[collection] || []).map((record) => [
            record.id,
            sampleFingerprint(collection, record),
          ]),
        ),
      ]),
    );
    sampleReferences.set(seed, reference);
  }
  for (const collection of SAMPLE_COLLECTIONS) {
    const records = state[collection] ?? [],
      samples = reference[collection],
      seen = new Set();
    if (!Array.isArray(records) || records.length !== samples.size)
      return false;
    for (const record of records) {
      if (seen.has(record?.id) || !samples.has(record?.id)) return false;
      seen.add(record.id);
      if (samples.get(record.id) !== sampleFingerprint(collection, record))
        return false;
    }
  }
  return true;
}

/** Shown before a push replaces a cloud copy that has more books than this device. */
export function pushBookCountWarning(deviceBooks, cloudBooks) {
  const device = countOf(deviceBooks),
    cloud = countOf(cloudBooks);
  return cloud > device
    ? `클라우드에는 책이 ${cloud}권, 이 기기에는 ${device}권 있어요. 저장하면 클라우드의 책장이 이 기기 것으로 바뀌어요.`
    : "";
}

function dataBlob(dataUrl, kind) {
  const match =
    /^data:([^;,]+)((?:;[^;,]*)*);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      String(dataUrl || ""),
    );
  const mimeType = match?.[1].trim().toLowerCase();
  if (
    !match ||
    (kind === "image"
      ? !/^image\/[a-z0-9.+-]+$/.test(mimeType)
      : !/^(?:audio\/[a-z0-9.+-]+|video\/webm)$/.test(mimeType))
  )
    throw new CloudSyncError(
      "클라우드에 보관할 그림·음원 형식을 확인해 주세요.",
      "INVALID_MEDIA",
    );
  let binary;
  try {
    binary = atob(match[3]);
  } catch {
    throw new CloudSyncError(
      "그림·음원 데이터를 읽을 수 없어요.",
      "INVALID_MEDIA",
    );
  }
  if (!binary.length || binary.length > MAX_CLOUD_MEDIA_BYTES)
    throw new CloudSyncError(
      "클라우드 그림·음원은 한 파일에 40MB까지 보관할 수 있어요.",
      "MEDIA_TOO_LARGE",
    );
  // Mobile MediaRecorder includes codec parameters. The server and manifest use
  // the normalized container MIME, while the original bytes stay untouched.
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], {
    type: mimeType,
  });
}

async function blobData(blob, mimeType) {
  const bytes = new Uint8Array(await blob.arrayBuffer()),
    parts = [];
  for (let at = 0; at < bytes.length; at += 0x8000)
    parts.push(String.fromCharCode(...bytes.subarray(at, at + 0x8000)));
  return `data:${mimeType};base64,${btoa(parts.join(""))}`;
}

function summary(state) {
  return {
    bookCount: state?.books?.length || 0,
    characterCount: state?.characters?.length || 0,
    backgroundCount: state?.backgrounds?.length || 0,
    worldCount: state?.worlds?.length || 0,
  };
}
function manifestChecked(manifest) {
  if (!Array.isArray(manifest) || manifest.length > 10000)
    throw new CloudSyncError(
      "클라우드 미디어 목록이 올바르지 않아요.",
      "INVALID_LIBRARY",
    );
  const seen = new Set();
  return manifest.map((item) => {
    if (
      !item ||
      !["image", "audio"].includes(item.kind) ||
      typeof item.id !== "string" ||
      !(
        item.kind === "image"
          ? /^image-[a-zA-Z0-9-]{8,120}$/
          : /^audio-[a-zA-Z0-9-]{5,100}$/
      ).test(item.id) ||
      seen.has(item.id) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 1 ||
      item.size > MAX_CLOUD_MEDIA_BYTES ||
      typeof item.mimeType !== "string" ||
      (item.kind === "image"
        ? !/^image\/[a-z0-9.+-]+$/i.test(item.mimeType)
        : !/^(?:audio\/[a-z0-9.+-]+|video\/webm)$/i.test(item.mimeType)) ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new CloudSyncError(
        "클라우드 그림·음원 정보가 올바르지 않아요.",
        "INVALID_LIBRARY",
      );
    seen.add(item.id);
    return {
      id: item.id,
      kind: item.kind,
      mimeType: item.mimeType,
      size: item.size,
      sha256: item.sha256,
    };
  });
}

function recordChecked(record) {
  if (
    !record ||
    typeof record.exists !== "boolean" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    (record.exists &&
      (!record.state ||
        typeof record.state !== "object" ||
        record.revision < 1))
  )
    throw new CloudSyncError(
      "클라우드 책장 정보를 읽을 수 없어요.",
      "INVALID_LIBRARY",
    );
  return record.exists
    ? { ...record, manifest: manifestChecked(record.manifest) }
    : {
        exists: false,
        revision: 0,
        manifest: [],
        state: null,
        updatedAt: null,
      };
}

/** Two transfers at most; the caller aborts the remaining requests on any failure. */
async function twoAtATime(items, operation) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        await operation(items[index], index);
      }
    }),
  );
}

function referencedImageIds(state) {
  const ids = new Set();
  const visit = (value) => {
    if (
      typeof value === "string" &&
      /^(?:asset:)?image-[a-zA-Z0-9-]{8,120}$/.test(value)
    )
      ids.add(value.replace(/^asset:/, ""));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object")
      Object.values(value).forEach(visit);
  };
  visit(state);
  return ids;
}
function remapIds(value, mapping) {
  if (typeof value === "string")
    return (
      mapping.get(value) ||
      (value.startsWith("asset:") && mapping.has(value.slice(6))
        ? "asset:" + mapping.get(value.slice(6))
        : value)
    );
  if (Array.isArray(value)) return value.map((item) => remapIds(item, mapping));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        remapIds(item, mapping),
      ]),
    );
  return value;
}

/** Build through the existing complete backup path, then store binary media separately. */
const digestCache = new WeakMap();
export function hashMediaBlob(blob) {
  if (!digestCache.has(blob))
    digestCache.set(
      blob,
      blob
        .arrayBuffer()
        .then(sha256)
        .catch((error) => {
          digestCache.delete(blob);
          throw error;
        }),
    );
  return digestCache.get(blob);
}
async function cloudSnapshot(state, makeBackup) {
  const originalIds = referencedImageIds(state),
    backup = await makeBackup(state, { mode: "blobs" }),
    media = [],
    mapping = new Map();
  const assets =
    backup.assets instanceof Map
      ? backup.assets
      : new Map([
          ...(backup.imageAssets || []).map((item) => [
            item.id,
            dataBlob(item.dataUrl, "image"),
          ]),
          ...(backup.audioAssets || []).map((item) => [
            item.id,
            dataBlob(item.dataUrl, "audio"),
          ]),
        ]);
  for (const [assetId, blob] of assets) {
    const kind = assetId.startsWith("audio-") ? "audio" : "image";
    const hash = await hashMediaBlob(blob);
    const id =
      kind === "image" && !originalIds.has(assetId)
        ? "image-cloud-" + hash
        : assetId;
    if (id !== assetId) mapping.set(assetId, id);
    if (!media.some((asset) => asset.id === id))
      media.push({
        id,
        kind,
        mimeType: blob.type.split(";")[0].trim().toLowerCase(),
        size: blob.size,
        sha256: hash,
        blob,
      });
  }
  const compact = semanticValue(remapIds(backup.snapshot, mapping));
  if (encoder.encode(JSON.stringify(compact)).byteLength > 8 * 1024 * 1024)
    throw new CloudSyncError(
      "클라우드 책장 내용은 8MB까지 보관할 수 있어요. 그림·음원 원본은 별도로 보관됩니다.",
      "LIBRARY_TOO_LARGE",
    );
  return {
    state: compact,
    media,
    manifest: manifestChecked(media.map(({ blob, ...item }) => item)),
  };
}

/**
 * getState(), hasLocalData(), isParent(), canApplyRemote(), applyRemote(candidate,meta), onChange(status).
 * hasLocalData() is false for a library that still holds only the built-in samples (isSeedOnlyLibrary).
 * The candidate already carries this device's reading statistics (mergeReadingStats).
 * applyRemote MUST first retain raw local recovery data, then restoreLibraryImages(candidate),
 * preserve this device's PIN, assign and durably save. Return false to cancel; throw on failure.
 * No baseline is committed until that callback succeeds. API keys stay in the existing vault.
 */
export function createCloudSync(context) {
  if (
    typeof context?.getState !== "function" ||
    typeof context?.applyRemote !== "function"
  )
    throw new TypeError("Cloud sync needs getState and applyRemote.");
  const fetchImpl = context.fetchImpl || globalThis.fetch?.bind(globalThis),
    makeBackup = context.createLibraryBackup || createLibraryBackup,
    validate = context.validateImport || validateImport;
  const base = context.basePath || "/api/cloud";
  if (!/^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(base))
    throw new TypeError("Cloud endpoint must be same-origin.");
  let storage = context.storage;
  if (storage === undefined)
    try {
      storage = globalThis.localStorage;
    } catch {}
  const later = context.setTimeout || globalThis.setTimeout.bind(globalThis),
    clearLater =
      context.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const every = context.setInterval || globalThis.setInterval.bind(globalThis),
    clearEvery =
      context.clearInterval || globalThis.clearInterval.bind(globalThis);
  const target = context.eventTarget ?? globalThis.window,
    visibility = context.document ?? globalThis.document;
  const debounceMs = context.debounceMs ?? 1500,
    pollMs = context.pollInterval ?? 20000;
  const deriveKey =
    typeof context.derivePasswordKey === "function"
      ? context.derivePasswordKey
      : (username, password) => derivePasswordKey(username, password);
  const isAutoRunning =
    typeof context.isAutoRunning === "function"
      ? context.isAutoRunning
      : () => false;
  const locks =
    context.locks !== undefined ? context.locks : globalThis.navigator?.locks;
  function storedMetadata() {
    try {
      const candidate = JSON.parse(
        storage?.getItem(CLOUD_SYNC_STORAGE_KEY) || "null",
      );
      if (
        candidate &&
        typeof candidate.accountId === "string" &&
        /^[a-f0-9]{64}$/.test(candidate.stateHash) &&
        Number.isSafeInteger(candidate.revision) &&
        candidate.revision > 0
      )
        return candidate;
    } catch {}
    return null;
  }
  let metadata = storedMetadata();
  let status = {
    phase: "idle",
    authenticated: false,
    user: null,
    signInPath: "",
    connected: false,
    dirty: false,
    busy: false,
    remoteExists: false,
    revision: 0,
    updatedAt: null,
    reason: null,
    error: null,
    localAvailable: false,
    remoteSummary: summary(null),
    canPush: false,
    canPull: false,
  };
  let stopped = true,
    operation = null,
    operationKind = null,
    controller = null,
    epoch = 0,
    sequence = 0,
    debounce = null,
    poll = null,
    applying = false,
    blocked = null,
    // The library fingerprint the family quota refused; auto-upload waits for a change.
    quotaHash = null,
    previousUserId = metadata?.accountId || null,
    // While a family sign-in/out is deciding the identity, sync operations wait behind it.
    authGate = null;
  const localAvailable = () => Boolean(context.hasLocalData?.() ?? true);
  const parent = () => Boolean(context.isParent?.() ?? false);
  const getStatus = () => ({
    ...status,
    user: status.user ? { ...status.user } : null,
    remoteSummary: { ...status.remoteSummary },
  });
  function emit(patch = {}) {
    status = { ...status, ...patch, localAvailable: localAvailable() };
    status.canPush = Boolean(
      status.authenticated &&
        !status.busy &&
        parent() &&
        blocked !== "account-changed",
    );
    status.canPull = Boolean(
      status.authenticated && status.remoteExists && !status.busy,
    );
    context.onChange?.(getStatus());
  }
  function check(op) {
    if (stopped || op.epoch !== epoch || op.signal.aborted) throw aborted();
  }
  function persist(next) {
    if (!storage?.setItem)
      throw new CloudSyncError(
        "동기화 상태를 이 기기에 보관할 수 없어요. 브라우저 저장 권한을 확인해 주세요.",
        "LOCAL_STORAGE_UNAVAILABLE",
      );
    next = { ...next, hashVersion: HASH_VERSION };
    try {
      storage.setItem(CLOUD_SYNC_STORAGE_KEY, JSON.stringify(next));
    } catch {
      throw new CloudSyncError(
        "동기화 상태를 저장하지 못했어요. 기기의 저장 공간을 확인해 주세요.",
        "LOCAL_STORAGE_UNAVAILABLE",
      );
    }
    metadata = next;
    previousUserId = next.accountId;
  }
  async function request(path, op, options = {}, user = null) {
    check(op);
    let response;
    const deadline = new AbortController(),
      onAbort = () => deadline.abort(),
      timeoutMs = /^(PUT|POST)$/i.test(options.method || "GET")
        ? REQUEST_TIMEOUT_UPLOAD
        : REQUEST_TIMEOUT_MS;
    op.signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(onAbort, timeoutMs);
    timer.unref?.();
    // Read at call time so a sign-in in this or another tab applies to the next request.
    const family = readFamilySession(storage);
    try {
      response = await fetchImpl(base + path, {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        ...options,
        headers: {
          Accept: "application/json",
          ...(user ? { "X-Cloud-Account-ID": user.id } : {}),
          ...(family ? { [FAMILY_SESSION_HEADER]: family.token } : {}),
          ...options.headers,
        },
        signal: deadline.signal,
      });
    } catch (error) {
      if (op.signal.aborted || stopped) throw aborted();
      if (deadline.signal.aborted)
        throw new CloudSyncError(
          "클라우드 응답이 늦어 연결을 멈췄어요. 현재 기기의 자료는 보관되어 있어요.",
          "NETWORK_ERROR",
        );
      throw new CloudSyncError(
        "클라우드에 연결하지 못했어요. 현재 기기의 자료는 보관되어 있어요.",
        "NETWORK_ERROR",
      );
    } finally {
      clearTimeout(timer);
      op.signal.removeEventListener("abort", onAbort);
    }
    check(op);
    if (!response.ok) {
      let body = {};
      try {
        body = await response.json();
      } catch {}
      const code = String(body.error?.code || body.code || "").toLowerCase();
      if (["account_changed", "account_mismatch"].includes(code))
        throw new CloudSyncError(
          "로그인 계정이 바뀌었어요. 새 계정의 책장을 먼저 확인해 주세요.",
          "ACCOUNT_CHANGED",
        );
      if (code === "quota_exceeded")
        throw new CloudSyncError(CLOUD_QUOTA_MESSAGE, "QUOTA_EXCEEDED");
      if (response.status === 409)
        throw new CloudSyncError(
          "다른 기기에서 방금 저장했어요. 어느 내용을 사용할지 선택해 주세요.",
          "CONFLICT",
          { revision: Number(body.revision) || 0 },
        );
      if (response.status === 401 || response.status === 403)
        throw new CloudSyncError(
          "클라우드 로그인이 필요해요. 로그인 후 다시 연결해 주세요.",
          "SIGNED_OUT",
          // A family token revoked mid-refresh says so, like GET /session does.
          {
            reason:
              body.reason === "family-session-expired" ? body.reason : null,
          },
        );
      if (
        response.status === 404 ||
        response.status === 405 ||
        response.status === 501 ||
        code === "storage_unavailable"
      )
        throw new CloudSyncError(
          "이 사이트에서 클라우드 저장을 아직 사용할 수 없어요. 현재 기기의 자료는 보관되어 있어요.",
          "UNAVAILABLE",
        );
      throw new CloudSyncError(
        `클라우드 요청을 완료하지 못했어요. (HTTP ${response.status})`,
        "HTTP_ERROR",
      );
    }
    return response;
  }
  async function session(op) {
    const payload = await (await request("/session", op)).json();
    check(op);
    if (payload?.authenticated !== true) {
      blocked = "signed-out";
      emit({
        phase: "signed-out",
        authenticated: false,
        user: null,
        connected: false,
        signInPath:
          typeof payload?.signInPath === "string" &&
          /^\/(?!\/)/.test(payload.signInPath) &&
          !/[\\\x00-\x1f\x7f]/.test(payload.signInPath)
            ? payload.signInPath
            : "",
        // The stored family token was refused: say so instead of a plain sign-in prompt.
        reason:
          payload?.reason === "family-session-expired"
            ? "family-session-expired"
            : "sign-in",
        error: null,
      });
      return null;
    }
    const user = payload.user;
    if (
      !user ||
      typeof user.id !== "string" ||
      !user.id ||
      user.id.length > 256 ||
      /[\x00-\x1f\x7f]/.test(user.id)
    )
      throw new CloudSyncError(
        "로그인 계정 정보를 읽을 수 없어요.",
        "INVALID_SESSION",
      );
    const changed = previousUserId && previousUserId !== user.id;
    if (changed) {
      const wasBlocked = blocked === "account-changed";
      blocked = "account-changed";
      emit({
        phase: "account-changed",
        authenticated: true,
        user,
        connected: false,
        reason: "account-changed",
        error: null,
      });
      if (!wasBlocked)
        context.onAccountChange?.({
          previousAccountId: previousUserId,
          user: { ...user },
        });
    } else {
      previousUserId = user.id;
      if (blocked === "signed-out") blocked = null;
      emit({ authenticated: true, user, signInPath: "" });
    }
    return user;
  }
  async function libraryMeta(op, user) {
    const record = await (
      await request("/library?meta=1", op, {}, user)
    ).json();
    check(op);
    if (
      typeof record?.exists !== "boolean" ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 0
    )
      throw new CloudSyncError(
        "클라우드 버전 정보를 읽지 못했어요.",
        "INVALID_LIBRARY",
      );
    emit({
      remoteExists: record.exists,
      revision: record.revision,
      updatedAt: record.updatedAt || null,
      remoteSummary: record.summary || summary(null),
    });
    return record;
  }
  async function library(op, user) {
    const record = recordChecked(
      await (await request("/library", op, {}, user)).json(),
    );
    check(op);
    emit({
      remoteExists: record.exists,
      revision: record.revision,
      updatedAt: record.updatedAt || null,
      remoteSummary: summary(record.state),
    });
    return record;
  }
  function schedule() {
    if (debounce !== null) clearLater(debounce);
    debounce = null;
    // A quota block still lets a library change try again (reconcile compares).
    if (
      stopped ||
      !status.connected ||
      !status.dirty ||
      (blocked && blocked !== "quota") ||
      !parent()
    )
      return;
    debounce = later(() => {
      debounce = null;
      if (!operation) void refresh();
      else schedule();
    }, debounceMs);
    debounce?.unref?.();
  }
  function canApplyRemote() {
    return context.canApplyRemote?.() !== false;
  }
  function deferRemote(user, automatic) {
    if (canApplyRemote()) return false;
    if (!automatic)
      throw new CloudSyncError(
        "편집 중인 내용을 먼저 저장하거나 닫은 뒤 클라우드 책장을 불러와 주세요.",
        "EDITOR_OPEN",
      );
    emit({
      phase: "paused",
      connected: metadata?.accountId === user.id,
      reason: "editor-open",
      error: null,
    });
    return true;
  }
  async function apply(record, user, op, { automatic = false } = {}) {
    if (deferRemote(user, automatic)) return getStatus();
    const initialHash = await hashCloudState(context.getState());
    check(op);
    const images = [],
      audio = [];
    await twoAtATime(record.manifest, async (item) => {
      const response = await request(
          "/media/" + encodeURIComponent(item.id),
          op,
          {},
          user,
        ),
        blob = await response.blob();
      check(op);
      if (
        blob.size !== item.size ||
        (await sha256(await blob.arrayBuffer())) !== item.sha256
      )
        throw new CloudSyncError(
          "클라우드 그림·음원 내용이 일치하지 않아 복원을 중단했어요.",
          "MEDIA_INTEGRITY_ERROR",
        );
      const dataUrl = await blobData(blob, item.mimeType);
      check(op);
      (item.kind === "image" ? images : audio).push({
        id: item.id,
        dataUrl,
        ...(item.kind === "audio" ? { mimeType: item.mimeType } : {}),
      });
    });
    const candidate = validate(
      JSON.stringify({
        format: "donghwa-workshop-library",
        version: 1,
        exportedAt: record.updatedAt || new Date().toISOString(),
        state: record.state,
        imageAssets: images,
        audioAssets: audio,
      }),
    );
    check(op);
    // Opening a book during the download saves reading statistics only; those
    // are merged below. Re-hash until no save lands while the digest runs.
    let currentHash, seen;
    do {
      seen = sequence;
      currentHash = await hashCloudState(context.getState());
      check(op);
    } while (seen !== sequence);
    if (currentHash !== initialHash)
      throw new CloudSyncError(
        "불러오는 동안 이 기기의 내용이 바뀌었어요. 저장할 내용을 다시 선택해 주세요.",
        "CONFLICT",
        { revision: record.revision },
      );
    if (deferRemote(user, automatic)) return getStatus();
    if (blocked !== "account-changed")
      mergeReadingStats(candidate, context.getState());
    applying = true;
    let result;
    try {
      result = await context.applyRemote(candidate, {
        revision: record.revision,
        updatedAt: record.updatedAt,
        user: { ...user },
        signal: op.signal,
      });
    } finally {
      applying = false;
    }
    check(op);
    if (result === false)
      throw new CloudSyncError(
        "클라우드 불러오기를 취소했어요. 현재 기기의 자료는 보관되어 있어요.",
        "CANCELLED",
      );
    const stateHash = await hashCloudState(context.getState());
    check(op);
    persist({
      accountId: user.id,
      revision: record.revision,
      stateHash,
      updatedAt: record.updatedAt || null,
    });
    blocked = null;
    quotaHash = null;
    emit({
      phase: "ready",
      connected: true,
      dirty: false,
      reason: null,
      error: null,
    });
    return getStatus();
  }
  async function upload(record, user, op, force = false) {
    if (deferRemote(user, true)) return getStatus();
    if (!parent())
      throw new CloudSyncError(
        "부모 모드에서 클라우드에 저장할 수 있어요.",
        "PARENT_REQUIRED",
      );
    if (blocked === "account-changed")
      throw new CloudSyncError(
        "이 기기의 자료는 이전 계정에서 사용한 자료예요. 새 계정의 책장을 먼저 불러와 주세요.",
        "ACCOUNT_CHANGED",
      );
    const baseline = metadata?.accountId === user.id ? metadata : null;
    if (
      !force &&
      (record.exists
        ? !baseline || record.revision !== baseline.revision
        : Boolean(baseline))
    )
      throw new CloudSyncError(
        "다른 기기의 책장이 있어요. 어느 내용을 사용할지 선택해 주세요.",
        "CONFLICT",
        { revision: record.revision },
      );
    const snapshot = clone(context.getState()),
      stateHash = await hashCloudState(snapshot),
      prepared = await cloudSnapshot(snapshot, makeBackup);
    check(op);
    if (deferRemote(user, true)) return getStatus();
    const remoteMedia = new Map(record.manifest.map((item) => [item.id, item]));
    const putMedia = async (item) => {
      check(op);
      if (!canApplyRemote()) return;
      const existing = remoteMedia.get(item.id);
      if (
        existing?.sha256 === item.sha256 &&
        existing.size === item.size &&
        existing.kind === item.kind &&
        existing.mimeType === item.mimeType
      )
        return;
      await request(
        "/media/" + encodeURIComponent(item.id),
        op,
        {
          method: "PUT",
          headers: {
            "Content-Type": item.mimeType,
            "X-Content-SHA256": item.sha256,
          },
          body: item.blob,
        },
        user,
      );
    };
    try {
      await twoAtATime(prepared.media, putMedia);
    } catch (error) {
      // Over the family quota: this library is not sent again on its own.
      if (error?.code === "QUOTA_EXCEEDED") quotaHash = stateHash;
      throw error;
    }
    check(op);
    if (deferRemote(user, true)) return getStatus();
    const result = await (
      await request(
        "/library",
        op,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: record.revision,
            state: prepared.state,
            manifest: prepared.manifest,
          }),
        },
        user,
      )
    ).json();
    check(op);
    if (
      !Number.isSafeInteger(result?.revision) ||
      result.revision <= record.revision
    )
      throw new CloudSyncError(
        "클라우드 저장 확인을 받지 못했어요. 현재 기기의 자료는 보관되어 있어요.",
        "INVALID_LIBRARY",
      );
    persist({
      accountId: user.id,
      revision: result.revision,
      stateHash,
      updatedAt: result.updatedAt || null,
    });
    const dirty = (await hashCloudState(context.getState())) !== stateHash;
    check(op);
    blocked = null;
    quotaHash = null;
    emit({
      phase: "ready",
      connected: true,
      dirty,
      remoteExists: true,
      revision: result.revision,
      updatedAt: result.updatedAt || null,
      remoteSummary: summary(prepared.state),
      reason: dirty ? "local-changes" : null,
      error: null,
    });
    return getStatus();
  }
  /**
   * Whether this device changed since `baseline`. A baseline saved before
   * reading statistics were left out of the fingerprint is upgraded in place
   * when the device is otherwise untouched, so the update itself never makes
   * every device look changed (and upload or conflict) at once.
   */
  async function localDirty(baseline, op) {
    const state = context.getState(),
      legacy = baseline.hashVersion !== HASH_VERSION;
    // Both digests serialize the same state synchronously before awaiting.
    const [current, previous] = await Promise.all([
      hashCloudState(state),
      legacy ? legacyHash(state) : null,
    ]);
    check(op);
    if (current === baseline.stateHash) return false;
    if (!legacy || previous !== baseline.stateHash) return true;
    persist({ ...baseline, stateHash: current });
    return false;
  }
  /**
   * Whether the family quota refused exactly this library (same fingerprint):
   * then the automatic upload waits. A changed library clears the block.
   */
  async function quotaUnchanged(op) {
    if (blocked !== "quota") return false;
    const same =
      quotaHash !== null &&
      (await hashCloudState(context.getState())) === quotaHash;
    check(op);
    if (!same) {
      blocked = null;
      quotaHash = null;
    }
    return same;
  }
  function quotaWaiting() {
    emit({
      phase: "error",
      connected: true,
      dirty: true,
      reason: "quota",
      error: CLOUD_QUOTA_MESSAGE,
    });
    return getStatus();
  }
  async function reconcile(op) {
    const user = await session(op);
    if (!user) return getStatus();
    const meta = await libraryMeta(op, user);
    if (blocked === "account-changed") return getStatus();
    const currentBaseline = metadata?.accountId === user.id ? metadata : null;
    if (meta.exists && currentBaseline?.revision === meta.revision) {
      const dirty = await localDirty(currentBaseline, op);
      if (!dirty) {
        blocked = null;
        emit({
          phase: "ready",
          connected: true,
          dirty: false,
          reason: null,
          error: null,
        });
        return getStatus();
      }
      if (!canApplyRemote()) {
        deferRemote(user, true);
        return getStatus();
      }
      // Nothing new in the cloud and the refused library unchanged: no transfer.
      if (await quotaUnchanged(op)) return quotaWaiting();
    }
    const record = await library(op, user);
    if (blocked === "account-changed") return getStatus();
    const baseline = metadata?.accountId === user.id ? metadata : null;
    if (!baseline) {
      if (record.exists && !localAvailable())
        return apply(record, user, op, { automatic: true });
      blocked = "choice";
      emit({
        phase: "choice",
        connected: false,
        dirty: localAvailable(),
        reason: record.exists ? "choose-source" : "initial-upload",
        error: null,
      });
      return getStatus();
    }
    const dirty = await localDirty(baseline, op);
    // Same content on both sides (also an older baseline whose only local
    // difference was reading statistics): advance the baseline, no transfer.
    let sameHash = null;
    if (record.exists && (record.revision !== baseline.revision || dirty)) {
      const [localHash, remoteHash] = await Promise.all([
        hashCloudState(context.getState()),
        hashCloudState(record.state),
      ]);
      check(op);
      if (localHash === remoteHash) sameHash = localHash;
    }
    if (sameHash) {
      persist({
        accountId: user.id,
        revision: record.revision,
        stateHash: sameHash,
        updatedAt: record.updatedAt || null,
      });
      blocked = null;
      emit({
        phase: "ready",
        connected: true,
        dirty: false,
        reason: null,
        error: null,
      });
      return getStatus();
    }
    if (blocked === "conflict" || blocked === "choice") {
      emit({
        phase: blocked,
        connected: blocked === "conflict",
        dirty,
        reason: blocked === "conflict" ? "both-changed" : status.reason,
        error: null,
      });
      return getStatus();
    }
    if (record.revision !== baseline.revision || !record.exists) {
      if (dirty || !record.exists)
        throw new CloudSyncError(
          record.exists
            ? "다른 기기에서 방금 저장했어요. 어느 내용을 사용할지 선택해 주세요."
            : "다른 기기에서 책장이 바뀌었어요. 어느 내용을 사용할지 선택해 주세요.",
          "CONFLICT",
          { revision: record.revision },
        );
      return apply(record, user, op, { automatic: true });
    }
    // The family quota refused this very library: wait for a change or a push.
    if ((await quotaUnchanged(op)) && dirty) return quotaWaiting();
    emit({
      phase: "ready",
      connected: true,
      dirty,
      reason: dirty ? "local-changes" : null,
      error: null,
    });
    return dirty && parent() ? upload(record, user, op) : getStatus();
  }
  function execute(kind, action, { swallow = false } = {}) {
    if (stopped)
      return Promise.reject(
        new CloudSyncError("클라우드 연결을 먼저 시작해 주세요.", "STOPPED"),
      );
    if (authGate) {
      const run = () => execute(kind, action, { swallow });
      return authGate.then(run, run);
    }
    if (operation && kind !== "refresh" && operationKind === "refresh") {
      const run = () => execute(kind, action, { swallow });
      return operation.then(run, run);
    }
    if (operation)
      return kind === "refresh"
        ? operation
        : Promise.reject(
            new CloudSyncError(
              "클라우드 동기화가 진행 중이에요. 잠시 뒤 다시 시도해 주세요.",
              "BUSY",
            ),
          );
    operationKind = kind;
    controller = new AbortController();
    const op = { epoch: ++epoch, signal: controller.signal };
    emit({
      busy: true,
      phase:
        kind === "refresh" && status.connected
          ? status.phase
          : kind === "refresh"
            ? "checking"
            : "syncing",
      error: null,
    });
    const job = (async () => {
      try {
        return await action(op);
      } catch (error) {
        if (op.epoch === epoch && !stopped) {
          if (error.code === "CONFLICT") {
            blocked = "conflict";
            emit({
              phase: "conflict",
              dirty: true,
              reason: "both-changed",
              ...(error.revision ? { revision: error.revision } : {}),
              error: error.message,
            });
          } else if (error.code === "ACCOUNT_CHANGED") {
            blocked = "account-changed";
            emit({
              phase: "account-changed",
              connected: false,
              reason: "account-changed",
              error: error.message,
            });
          } else if (error.code === "SIGNED_OUT") {
            blocked = "signed-out";
            emit({
              phase: "signed-out",
              authenticated: false,
              connected: false,
              reason: error.reason || "sign-in",
              error: error.message,
            });
          } else if (error.code === "QUOTA_EXCEEDED") {
            blocked = "quota";
            emit({
              phase: "error",
              reason: "quota",
              error: error.message,
            });
          } else if (error.code === "UNAVAILABLE") {
            emit({
              phase: "unavailable",
              connected: false,
              error: error.message,
            });
          } else
            emit({
              phase: error.code === "CANCELLED" ? "choice" : "error",
              error: error.message || "클라우드 동기화를 완료하지 못했어요.",
            });
        }
        controller?.abort();
        if (swallow || error.name === "AbortError") return getStatus();
        throw error;
      } finally {
        if (op.epoch === epoch) {
          operation = null;
          operationKind = null;
          controller = null;
          emit({ busy: false });
          if (status.phase === "ready") schedule();
        }
      }
    })();
    operation = job;
    return job;
  }
  function refresh() {
    return execute("refresh", reconcile, { swallow: true });
  }
  const focus = () => {
    if (!stopped && (!visibility || visibility.visibilityState !== "hidden"))
      void refresh();
  };
  function start() {
    if (!stopped) return refresh();
    stopped = false;
    target?.addEventListener?.("focus", focus);
    target?.addEventListener?.("storage", onStorage);
    visibility?.addEventListener?.("visibilitychange", focus);
    if (pollMs > 0) {
      poll = every(focus, pollMs);
      poll?.unref?.();
    }
    return refresh();
  }
  function changed() {
    if (applying || stopped) return;
    const seen = ++sequence,
      baseline = metadata;
    emit({
      dirty: true,
      ...(status.connected && !blocked ? { reason: "local-changes" } : {}),
    });
    schedule();
    // A save that only recorded reading (a child opening a book) leaves the
    // fingerprint at the baseline: settle back to "saved" without a request.
    if (
      !status.connected ||
      blocked ||
      baseline?.accountId !== status.user?.id
    )
      return;
    hashCloudState(context.getState()).then(
      (hash) => {
        if (
          hash !== baseline.stateHash ||
          seen !== sequence ||
          stopped ||
          operation ||
          blocked ||
          metadata !== baseline ||
          !status.connected
        )
          return;
        if (debounce !== null) clearLater(debounce);
        debounce = null;
        emit({
          dirty: false,
          ...(status.reason === "local-changes" ? { reason: null } : {}),
        });
      },
      () => {},
    );
  }
  function push({ force = false } = {}) {
    return execute("push", async (op) => {
      // The parent asked to save: a quota refusal is tried again once.
      if (blocked === "quota") {
        blocked = null;
        quotaHash = null;
      }
      const user = await session(op);
      if (!user)
        throw new CloudSyncError("클라우드 로그인이 필요해요.", "SIGNED_OUT", {
          reason: status.reason,
        });
      const record = await library(op, user);
      return upload(record, user, op, force);
    });
  }
  function pull() {
    return execute("pull", async (op) => {
      const user = await session(op);
      if (!user)
        throw new CloudSyncError("클라우드 로그인이 필요해요.", "SIGNED_OUT", {
          reason: status.reason,
        });
      const record = await library(op, user);
      if (!record.exists)
        throw new CloudSyncError(
          "이 계정에 저장된 클라우드 책장이 아직 없어요.",
          "EMPTY_CLOUD",
        );
      return apply(record, user, op);
    });
  }
  function stop() {
    stopped = true;
    epoch++;
    controller?.abort();
    controller = null;
    operation = null;
    if (debounce !== null) clearLater(debounce);
    debounce = null;
    if (poll !== null) clearEvery(poll);
    poll = null;
    target?.removeEventListener?.("focus", focus);
    target?.removeEventListener?.("storage", onStorage);
    visibility?.removeEventListener?.("visibilitychange", focus);
    emit({ phase: "stopped", busy: false });
  }

  // ---- Family ID accounts --------------------------------------------------
  // Auth calls go straight to fetchImpl, never through request(): a refused
  // password, invite or recovery code never changes the phase, the block or
  // the privacy lock, and makes no library request.
  const failure = (code, message, extra = {}) => ({
    ok: false,
    code,
    message,
    ...extra,
  });
  const KNOWN_FAILURES = new Set(["crypto_unavailable", "storage"]);
  async function autoRunRefusal() {
    return (await isFullAutoRunActive({ isAutoRunning, locks }))
      ? failure("auto_running", FAMILY_MESSAGES.autoRunning)
      : null;
  }
  /** Waits until no sync operation is running, so no request straddles an identity change. */
  async function settle() {
    while (operation) {
      try {
        await operation;
      } catch {}
    }
  }
  /**
   * One family auth flow at a time. Sync work started meanwhile waits behind
   * the gate. `work` returns {result, refresh}; refresh re-checks the account
   * once the gate is open again.
   */
  async function exclusive(work) {
    if (authGate) return failure("busy", FAMILY_MESSAGES.busy);
    let release;
    authGate = new Promise((resolve) => {
      release = resolve;
    });
    let outcome;
    try {
      await settle();
      outcome = await work();
    } catch (error) {
      outcome = {
        result: KNOWN_FAILURES.has(error?.code)
          ? failure(error.code, error.message)
          : failure("failed", "요청을 완료하지 못했어요. 잠시 뒤 다시 해 주세요."),
      };
    } finally {
      authGate = null;
      release();
    }
    if (outcome.refresh && !stopped) await refresh();
    return outcome.result;
  }
  async function authPost(
    name,
    body,
    { token = null, accountId = null, keepalive = false } = {},
  ) {
    if (!fetchImpl) return failure("network", FAMILY_MESSAGES.network);
    const deadline = new AbortController(),
      timer = setTimeout(() => deadline.abort(), AUTH_TIMEOUT_MS);
    timer.unref?.();
    let response;
    try {
      response = await fetchImpl(base + "/auth/" + name, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        ...(keepalive ? { keepalive: true } : {}),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token ? { [FAMILY_SESSION_HEADER]: token } : {}),
          ...(accountId ? { "X-Cloud-Account-ID": accountId } : {}),
        },
        body: JSON.stringify(body),
        signal: deadline.signal,
      });
    } catch {
      return deadline.signal.aborted
        ? failure("timeout", FAMILY_MESSAGES.timeout)
        : failure("network", FAMILY_MESSAGES.network);
    } finally {
      clearTimeout(timer);
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {}
    if (!response.ok) {
      const code =
          String(payload?.error?.code || "")
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "")
            .slice(0, 64) || "http_" + response.status,
        retryAfter = Math.max(
          0,
          Math.floor(
            Number(
              payload?.retryAfter ??
                payload?.error?.retryAfter ??
                response.headers?.get?.("Retry-After"),
            ) || 0,
          ),
        );
      return failure(
        code,
        familyAuthMessage(code, { retryAfter, status: response.status }),
        { status: response.status, ...(retryAfter ? { retryAfter } : {}) },
      );
    }
    return { ok: true, status: response.status, body: payload };
  }
  function signedInFrom(body) {
    const user = body?.user,
      token = body?.session?.token,
      username = normalizeUsername(user?.username);
    if (
      !user ||
      !isFamilyOwnerId(user.id) ||
      !isSessionToken(token) ||
      !validateUsername(username).ok
    )
      return null;
    const displayName = validateDisplayName(user.displayName);
    return {
      user: {
        id: user.id,
        kind: "family",
        username,
        displayName: displayName.ok ? displayName.displayName : "",
        email: "",
      },
      token,
    };
  }
  /**
   * The account-switch carry rule. Signing in to another account on a device
   * that was unlocked and showing a connected, saved (not dirty) library of the
   * previous account, or that had no cloud baseline, forgets that baseline so
   * the explicit source choice runs and nothing uploads before the parent
   * confirms. Any other device keeps its baseline and gets the account-changed
   * lock (pull only).
   */
  function carriesOver(nextOwnerId) {
    if (metadata?.accountId === nextOwnerId) return false;
    const locked =
      blocked === "account-changed" ||
      status.phase === "account-changed" ||
      (Boolean(metadata) && !status.authenticated);
    if (locked) return false;
    if (!metadata) return true;
    return (
      status.authenticated &&
      status.phase === "ready" &&
      status.connected &&
      !status.dirty &&
      metadata.accountId === status.user?.id
    );
  }
  function forgetBaseline() {
    try {
      if (typeof storage?.removeItem === "function")
        storage.removeItem(CLOUD_SYNC_STORAGE_KEY);
      else storage?.setItem?.(CLOUD_SYNC_STORAGE_KEY, "null");
    } catch {}
    metadata = null;
    previousUserId = null;
    blocked = null;
    quotaHash = null;
  }
  /** The signed-in account is about to change: show 'checking' until the next refresh says who it is. */
  function identityChanged() {
    emit({
      phase: "checking",
      authenticated: false,
      user: null,
      connected: false,
      signInPath: "",
      remoteExists: false,
      revision: 0,
      updatedAt: null,
      remoteSummary: summary(null),
      reason: null,
      error: null,
    });
  }
  function commitSignIn(signed) {
    const previous = readFamilySession(storage),
      carry = carriesOver(signed.user.id);
    try {
      writeFamilySession(storage, {
        token: signed.token,
        ownerId: signed.user.id,
        username: signed.user.username,
        displayName: signed.user.displayName,
      });
    } catch {
      void authPost("logout", {}, { token: signed.token, keepalive: true });
      return failure("storage", FAMILY_MESSAGES.storage);
    }
    if (carry) forgetBaseline();
    // The token this device held before is useless now; revoke it best effort.
    if (previous && previous.token !== signed.token)
      void authPost("logout", {}, { token: previous.token, keepalive: true });
    identityChanged();
    return null;
  }
  /** Shared tail of signup and recover, which both hand out a recovery code once. */
  function signedInWithCode(response) {
    const signed = signedInFrom(response.body),
      recoveryCode = isRecoveryCode(response.body?.recoveryCode)
        ? formatRecoveryCode(response.body.recoveryCode)
        : null;
    if (!signed)
      return {
        result: failure("invalid_response", FAMILY_MESSAGES.invalidResponse, {
          recoveryCode,
        }),
      };
    const problem = commitSignIn(signed);
    // The account exists even when this device could not keep the session: still show its code.
    if (problem) return { result: { ...problem, recoveryCode } };
    return {
      result: { ok: true, user: { ...signed.user }, recoveryCode },
      refresh: true,
    };
  }
  async function familySignup({
    username,
    password,
    inviteCode,
    displayName = "",
  } = {}) {
    const name = validateUsername(username);
    if (!name.ok) return failure(name.code, name.message);
    const label = validateDisplayName(displayName);
    if (!label.ok) return failure(label.code, label.message);
    const secret = validatePassword(password, name.username);
    if (!secret.ok) return failure(secret.code, secret.message);
    const invite = String(inviteCode ?? "").trim();
    if (!invite) return failure("invite_empty", FAMILY_MESSAGES.inviteEmpty);
    if (invite.length > 200)
      return failure("invite_invalid", familyAuthMessage("invite_invalid"));
    const refusal = await autoRunRefusal();
    if (refusal) return refusal;
    return exclusive(async () => {
      const passwordKey = await deriveKey(name.username, password);
      const response = await authPost("signup", {
        username: name.username,
        passwordKey,
        inviteCode: invite,
        displayName: label.displayName,
      });
      return response.ok ? signedInWithCode(response) : { result: response };
    });
  }
  async function familyLogin({ username, password } = {}) {
    const name = validateUsername(username);
    if (!name.ok) return failure(name.code, name.message);
    const secret = validateExistingPassword(password);
    if (!secret.ok) return failure(secret.code, secret.message);
    const refusal = await autoRunRefusal();
    if (refusal) return refusal;
    return exclusive(async () => {
      const passwordKey = await deriveKey(name.username, password);
      const response = await authPost("login", {
        username: name.username,
        passwordKey,
      });
      if (!response.ok) return { result: response };
      const signed = signedInFrom(response.body);
      if (!signed)
        return {
          result: failure("invalid_response", FAMILY_MESSAGES.invalidResponse),
        };
      const problem = commitSignIn(signed);
      if (problem) return { result: problem };
      return { result: { ok: true, user: { ...signed.user } }, refresh: true };
    });
  }
  async function familyRecover({ username, recoveryCode, newPassword } = {}) {
    const name = validateUsername(username);
    if (!name.ok) return failure(name.code, name.message);
    if (!isRecoveryCode(recoveryCode))
      return failure("recovery_format", FAMILY_MESSAGES.recoveryFormat);
    const secret = validatePassword(newPassword, name.username);
    if (!secret.ok) return failure(secret.code, secret.message);
    const refusal = await autoRunRefusal();
    if (refusal) return refusal;
    return exclusive(async () => {
      const newPasswordKey = await deriveKey(name.username, newPassword);
      const response = await authPost("recover", {
        username: name.username,
        recoveryCode: normalizeRecoveryCode(recoveryCode),
        newPasswordKey,
      });
      return response.ok ? signedInWithCode(response) : { result: response };
    });
  }
  /** Signs this device out of its family account; the device library stays (locked when it has a baseline). */
  async function familyLogout() {
    const refusal = await autoRunRefusal();
    if (refusal) return refusal;
    return exclusive(async () => {
      const current = readFamilySession(storage);
      if (!current) return { result: { ok: true }, refresh: true };
      if (!clearFamilySession(storage))
        return { result: failure("storage", FAMILY_MESSAGES.storage) };
      // Best effort: the device is signed out even when the server is unreachable.
      void authPost("logout", {}, { token: current.token, keepalive: true });
      identityChanged();
      return { result: { ok: true }, refresh: true };
    });
  }
  async function familyChangePassword({
    currentPassword,
    newPassword,
    signOutOthers = false,
  } = {}) {
    const current = readFamilySession(storage);
    if (!current) return failure("family_only", FAMILY_MESSAGES.familyOnly);
    const old = validateExistingPassword(currentPassword);
    if (!old.ok) return failure(old.code, old.message);
    const next = validatePassword(newPassword, current.username);
    if (!next.ok) return failure(next.code, next.message);
    if (currentPassword === newPassword)
      return failure("password_same", FAMILY_MESSAGES.passwordSame);
    return exclusive(async () => {
      const currentPasswordKey = await deriveKey(
          current.username,
          currentPassword,
        ),
        newPasswordKey = await deriveKey(current.username, newPassword);
      const response = await authPost(
        "password",
        {
          currentPasswordKey,
          newPasswordKey,
          signOutOthers: signOutOthers === true,
        },
        { token: current.token, accountId: current.ownerId },
      );
      if (!response.ok) return { result: response };
      const token = response.body?.session?.token;
      if (!isSessionToken(token))
        return {
          result: failure("invalid_response", FAMILY_MESSAGES.invalidResponse),
          refresh: true,
        };
      if (readFamilySession(storage)?.token !== current.token) {
        // Another tab changed the sign-in meanwhile: never switch it back.
        void authPost("logout", {}, { token, keepalive: true });
        return { result: { ok: true }, refresh: true };
      }
      try {
        writeFamilySession(storage, { ...current, token, savedAt: "" });
      } catch (error) {
        return { result: failure("storage", error.message), refresh: true };
      }
      return { result: { ok: true }, refresh: true };
    });
  }
  /** Deletes the family account and its cloud library; this device keeps its books, unlinked. */
  async function familyDeleteAccount({ password, confirm = "삭제" } = {}) {
    const current = readFamilySession(storage);
    if (!current) return failure("family_only", FAMILY_MESSAGES.familyOnly);
    if (String(confirm ?? "").trim() !== "삭제")
      return failure("confirm_required", FAMILY_MESSAGES.deleteConfirm);
    const secret = validateExistingPassword(password);
    if (!secret.ok) return failure(secret.code, secret.message);
    const refusal = await autoRunRefusal();
    if (refusal) return refusal;
    return exclusive(async () => {
      const passwordKey = await deriveKey(current.username, password);
      const response = await authPost(
        "delete",
        { passwordKey, confirm: "삭제" },
        { token: current.token, accountId: current.ownerId },
      );
      if (!response.ok) return { result: response };
      if (response.body?.deleted !== true)
        return {
          result: failure("invalid_response", FAMILY_MESSAGES.invalidResponse),
          refresh: true,
        };
      if (readFamilySession(storage)?.ownerId === current.ownerId)
        clearFamilySession(storage);
      if (metadata?.accountId === current.ownerId) forgetBaseline();
      else if (previousUserId === current.ownerId)
        previousUserId = metadata?.accountId || null;
      identityChanged();
      return { result: { ok: true, deleted: true }, refresh: true };
    });
  }
  /**
   * Drops this device's cloud baseline so a locked device becomes local-only.
   * The caller has already checked the parent PIN. Signing in later offers the
   * usual source choice.
   */
  async function continueLocalOnly() {
    const refusal = await autoRunRefusal();
    if (refusal) return refusal;
    return exclusive(async () => {
      forgetBaseline();
      if (status.authenticated) {
        blocked = "choice";
        emit({
          phase: "choice",
          connected: false,
          dirty: localAvailable(),
          reason: status.remoteExists ? "choose-source" : "initial-upload",
          error: null,
        });
      } else emit({ phase: "signed-out", connected: false, error: null });
      return { result: { ok: true }, refresh: true };
    });
  }
  /** Another tab signed in or out: follow a baseline it dropped under the carry rule, then re-check. */
  function onStorage(event) {
    if (stopped || (event?.key !== FAMILY_SESSION_KEY && event?.key !== null))
      return;
    void (async () => {
      await settle();
      if (stopped) return;
      const next = readFamilySession(storage),
        shownFamily = isFamilyOwnerId(status.user?.id) ? status.user.id : null;
      if (next && !storedMetadata() && carriesOver(next.ownerId)) {
        metadata = null;
        previousUserId = null;
        blocked = null;
      }
      if ((next?.ownerId || null) !== shownFamily) identityChanged();
      await refresh();
    })();
  }
  function getFamilySession() {
    const session = readFamilySession(storage);
    return session
      ? {
          ownerId: session.ownerId,
          username: session.username,
          displayName: session.displayName,
        }
      : null;
  }
  /** {ok:true} or the refusal shown while a FULL AUTO run is active in any tab. */
  async function checkAccountSwitch() {
    return (await autoRunRefusal()) || { ok: true };
  }
  return {
    start,
    refresh,
    push,
    pull,
    changed,
    stop,
    getStatus,
    familySignup,
    familyLogin,
    familyLogout,
    familyRecover,
    familyChangePassword,
    familyDeleteAccount,
    continueLocalOnly,
    getFamilySession,
    checkAccountSwitch,
  };
}
