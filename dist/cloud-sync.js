import { createLibraryBackup, validateImport } from "./output.js";
const REQUEST_TIMEOUT_MS = 45000,
  REQUEST_TIMEOUT_UPLOAD = 120000;

/** Per-account library replication. Credentials and parent PINs never leave the device. */
export const CLOUD_SYNC_STORAGE_KEY = "donghwa-cloud-sync-v1";
export const MAX_CLOUD_MEDIA_BYTES = 40 * 1024 * 1024;
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

/** Ignores local PINs, credentials and temporary object URLs when comparing revisions. */
export function hashCloudState(state) {
  return sha256(encoder.encode(JSON.stringify(semanticValue(state))));
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
  let metadata = null;
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
      metadata = candidate;
  } catch {}
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
    previousUserId = metadata?.accountId || null;
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
    try {
      response = await fetchImpl(base + path, {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        ...options,
        headers: {
          Accept: "application/json",
          ...(user ? { "X-Cloud-Account-ID": user.id } : {}),
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
      if (response.status === 409)
        throw new CloudSyncError(
          "다른 기기에서 책장이 바뀌었어요. 어느 내용을 사용할지 선택해 주세요.",
          "CONFLICT",
          { revision: Number(body.revision) || 0 },
        );
      if (response.status === 401 || response.status === 403)
        throw new CloudSyncError(
          "클라우드 로그인이 필요해요. 로그인 후 다시 연결해 주세요.",
          "SIGNED_OUT",
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
        reason: "sign-in",
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
    if (stopped || !status.connected || !status.dirty || blocked || !parent())
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
    const initialSequence = sequence,
      initialHash = await hashCloudState(context.getState());
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
    if (
      sequence !== initialSequence ||
      (await hashCloudState(context.getState())) !== initialHash
    )
      throw new CloudSyncError(
        "불러오는 동안 이 기기의 내용이 바뀌었어요. 저장할 내용을 다시 선택해 주세요.",
        "CONFLICT",
        { revision: record.revision },
      );
    if (deferRemote(user, automatic)) return getStatus();
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
    await twoAtATime(prepared.media, async (item) => {
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
    });
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
  async function reconcile(op) {
    const user = await session(op);
    if (!user) return getStatus();
    const meta = await libraryMeta(op, user);
    if (blocked === "account-changed") return getStatus();
    const currentBaseline = metadata?.accountId === user.id ? metadata : null;
    if (meta.exists && currentBaseline?.revision === meta.revision) {
      const dirty =
        (await hashCloudState(context.getState())) !==
        currentBaseline.stateHash;
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
    const dirty =
      (await hashCloudState(context.getState())) !== baseline.stateHash;
    check(op);
    if (
      record.exists &&
      record.revision !== baseline.revision &&
      (await hashCloudState(record.state)) ===
        (await hashCloudState(context.getState()))
    ) {
      persist({
        accountId: user.id,
        revision: record.revision,
        stateHash: await hashCloudState(context.getState()),
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
          "다른 기기에서 책장이 바뀌었어요. 어느 내용을 사용할지 선택해 주세요.",
          "CONFLICT",
          { revision: record.revision },
        );
      return apply(record, user, op, { automatic: true });
    }
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
              reason: "sign-in",
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
    visibility?.addEventListener?.("visibilitychange", focus);
    if (pollMs > 0) {
      poll = every(focus, pollMs);
      poll?.unref?.();
    }
    return refresh();
  }
  function changed() {
    if (applying || stopped) return;
    sequence++;
    emit({
      dirty: true,
      ...(status.connected && !blocked ? { reason: "local-changes" } : {}),
    });
    schedule();
  }
  function push({ force = false } = {}) {
    return execute("push", async (op) => {
      const user = await session(op);
      if (!user)
        throw new CloudSyncError("클라우드 로그인이 필요해요.", "SIGNED_OUT");
      const record = await library(op, user);
      return upload(record, user, op, force);
    });
  }
  function pull() {
    return execute("pull", async (op) => {
      const user = await session(op);
      if (!user)
        throw new CloudSyncError("클라우드 로그인이 필요해요.", "SIGNED_OUT");
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
    visibility?.removeEventListener?.("visibilitychange", focus);
    emit({ phase: "stopped", busy: false });
  }
  return { start, refresh, push, pull, changed, stop, getStatus };
}
