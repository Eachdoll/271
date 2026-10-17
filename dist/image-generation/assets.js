/* Large illustration blobs live in IndexedDB; the application state keeps asset IDs. */
const DATABASE = "donghwa-workshop-image-assets";
const STORE = "images";
const urls = new Map();
const blobs = new Map();
let databasePromise;

export class ImageAssetError extends Error {
  constructor(message, code = "IMAGE_ASSET_ERROR", cause) {
    super(message);
    this.name = "ImageAssetError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function normalizeId(assetId) {
  return typeof assetId === "string" ? assetId.replace(/^asset:/, "") : "";
}

function database() {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new ImageAssetError(
        "이 브라우저에서는 그림 보관함을 사용할 수 없어요. IndexedDB를 지원하는 브라우저로 열어 주세요.",
        "ASSET_STORAGE_UNAVAILABLE",
      ),
    );
  if (!databasePromise)
    databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const fail = (message, code, cause) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new ImageAssetError(message, code, cause));
        }
      };
      const timeout = setTimeout(
        () =>
          fail(
            "그림 보관함이 응답하지 않아요. 다른 창을 닫고 다시 시도해 주세요.",
            "ASSET_STORAGE_TIMEOUT",
          ),
        8000,
      );
      try {
        request = indexedDB.open(DATABASE, 1);
      } catch (error) {
        fail(
          "그림 보관함을 열 수 없어요. 브라우저의 저장소 권한을 확인해 주세요.",
          "ASSET_STORAGE_UNAVAILABLE",
          error,
        );
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onerror = () =>
        fail(
          "그림 보관함을 열 수 없어요. 브라우저의 저장소 권한을 확인해 주세요.",
          "ASSET_STORAGE_UNAVAILABLE",
          request.error,
        );
      request.onblocked = () =>
        fail(
          "다른 창에서 그림 보관함을 사용 중이에요. 다른 창을 닫고 다시 시도해 주세요.",
          "ASSET_STORAGE_BLOCKED",
        );
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        db.onversionchange = () => {
          db.close();
          databasePromise = undefined;
        };
        resolve(db);
      };
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  return databasePromise;
}

async function readRecord(assetId) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(assetId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () =>
      reject(
        new ImageAssetError(
          "저장된 그림을 읽지 못했어요.",
          "ASSET_READ_FAILED",
          request.error,
        ),
      );
    tx.onabort = () =>
      reject(
        new ImageAssetError(
          "저장된 그림을 읽지 못했어요.",
          "ASSET_READ_FAILED",
          tx.error,
        ),
      );
  });
}

async function writeRecord(record) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        new ImageAssetError(
          "그림을 보관하지 못했어요. 브라우저 저장 공간을 확인해 주세요.",
          "ASSET_WRITE_FAILED",
          tx.error,
        ),
      );
  });
}

function cache(assetId, blob) {
  blobs.set(assetId, blob);
  if (!urls.has(assetId)) urls.set(assetId, URL.createObjectURL(blob));
  return urls.get(assetId);
}

/** Synchronous display lookup after save/hydration. Object URLs are never persisted. */
export function getImageURL(assetId) {
  return urls.get(normalizeId(assetId)) || null;
}

/** Retrieve the original image bytes for portable exports or provider references. */
export async function getAsset(assetId) {
  const id = normalizeId(assetId);
  if (!id) return null;
  if (blobs.has(id)) return blobs.get(id);
  const record = await readRecord(id);
  if (!record?.blob) return null;
  cache(id, record.blob);
  return record.blob;
}

async function imageBlob(imageUrl, signal) {
  if (imageUrl instanceof Blob) {
    if (!imageUrl.size)
      throw new ImageAssetError(
        "생성 결과에 그림 데이터가 없어요.",
        "EMPTY_IMAGE",
      );
    return imageUrl;
  }
  if (typeof imageUrl !== "string" || !imageUrl)
    throw new ImageAssetError(
      "생성 결과에 그림 주소가 없어요.",
      "MISSING_IMAGE_URL",
    );
  if (imageUrl.startsWith("asset:")) {
    const existing = await getAsset(imageUrl);
    if (!existing)
      throw new ImageAssetError(
        "보관함에서 이 그림을 찾을 수 없어요.",
        "ASSET_NOT_FOUND",
      );
    return existing;
  }
  if (!/^(data:image\/|blob:|https?:\/\/)/i.test(imageUrl))
    throw new ImageAssetError(
      "지원하지 않는 그림 주소예요.",
      "INVALID_IMAGE_URL",
    );
  let response;
  try {
    response = await fetch(imageUrl, { signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ImageAssetError(
      "그림을 보관함으로 가져오지 못했어요. 제공자의 이미지 주소와 CORS 설정을 확인해 주세요.",
      "IMAGE_FETCH_FAILED",
      error,
    );
  }
  if (!response.ok)
    throw new ImageAssetError(
      `그림을 가져오지 못했어요. (HTTP ${response.status})`,
      "IMAGE_FETCH_FAILED",
    );
  const blob = await response.blob();
  if (!blob.size)
    throw new ImageAssetError(
      "생성 결과에 그림 데이터가 없어요.",
      "EMPTY_IMAGE",
    );
  if (
    blob.type &&
    !/^image\//i.test(blob.type) &&
    blob.type !== "application/octet-stream"
  )
    throw new ImageAssetError(
      "제공자가 그림 파일 대신 다른 데이터를 반환했어요.",
      "INVALID_IMAGE_CONTENT",
    );
  return blob;
}

/** Save a result durably before exposing it to the application. */
export async function saveImage(imageUrl, options = {}) {
  const blob = await imageBlob(imageUrl, options.signal);
  if (options.signal?.aborted)
    throw new DOMException("그림 저장이 취소됐어요.", "AbortError");
  const assetId =
    "image-" +
    (globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
  await writeRecord({
    id: assetId,
    blob,
    createdAt: new Date().toISOString(),
    type: blob.type || "image/png",
  });
  if (options.signal?.aborted) {
    await deleteImageAsset(assetId);
    throw new DOMException("그림 저장이 취소됐어요.", "AbortError");
  }
  return { assetId, imageUrl: cache(assetId, blob) };
}

/** Restore backup bytes under their original ID so book/sheet snapshots stay valid. */
export async function restoreImageAsset(assetId, imageUrl) {
  const id = normalizeId(assetId);
  if (!/^image-[a-zA-Z0-9-]{8,120}$/.test(id))
    throw new ImageAssetError(
      "백업 그림의 식별자를 확인해 주세요.",
      "INVALID_ASSET_ID",
    );
  const blob = await imageBlob(imageUrl);
  await writeRecord({
    id,
    blob,
    createdAt: new Date().toISOString(),
    type: blob.type || "image/png",
  });
  const previous = urls.get(id);
  if (previous) URL.revokeObjectURL(previous);
  urls.delete(id);
  return { assetId: id, imageUrl: cache(id, blob) };
}

/** Remove an unconfirmed candidate; original source photos are never stored here. */
export async function deleteImageAsset(assetId) {
  const id = normalizeId(assetId);
  if (!id) return false;
  const db = await database();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () =>
      reject(
        new ImageAssetError(
          "확정하지 않은 그림을 지우지 못했어요.",
          "ASSET_DELETE_FAILED",
          tx.error,
        ),
      );
  });
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  blobs.delete(id);
  return true;
}

function assetIdsFromState(state) {
  const ids = new Set();
  const seen = new WeakSet();
  const visit = (value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value.imageAssetId) ids.add(normalizeId(value.imageAssetId));
    if (typeof value.assetId === "string" && value.assetId.startsWith("image-"))
      ids.add(normalizeId(value.assetId));
    if (
      typeof value.imageUrl === "string" &&
      value.imageUrl.startsWith("asset:")
    )
      ids.add(normalizeId(value.imageUrl));
    for (const entry of Object.values(value))
      if (entry && typeof entry === "object") visit(entry);
  };
  visit(state);
  return [...ids].filter(Boolean);
}

/** Hydrate saved references/pages once at app startup; missing images are reported. */
export async function hydrateImageAssets(state) {
  const ids = assetIdsFromState(state);
  const missing = [];
  let loaded = 0;
  // A small batch avoids opening hundreds of transactions at the same time.
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(
      ids.slice(i, i + 8).map(async (id) => ({ id, blob: await getAsset(id) })),
    );
    for (const item of batch) {
      if (item.blob) loaded++;
      else missing.push(item.id);
    }
  }
  return { loaded, missing };
}

export function revokeImageURLs() {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  blobs.clear();
}
