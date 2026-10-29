/**
 * Private per-account cloud library API for the Sites dispatch runtime.
 * An owner is identified either by a family session token (X-Family-Session,
 * looked up by its SHA-256 digest in D1) or, without that header, by the
 * Sites-injected authenticated headers. A family header always wins and never
 * falls back to the Sites account. The matching X-Cloud-Account-ID is a race
 * guard, never a source of authentication.
 */
export const CLOUD_LIMITS = Object.freeze({
  mediaBytes: 40 * 1024 * 1024,
  // R44: the library text lives in an R2 object (the D1 row holds a pointer), so 16MB is a choice, not a storage limit.
  stateBytes: 16 * 1024 * 1024,
  requestBytes: 18 * 1024 * 1024,
  manifestEntries: 10000,
});
const encoder = new TextEncoder();
const IMAGE_ID = /^image-[a-zA-Z0-9-]{8,120}$/;
const AUDIO_ID = /^audio-[a-zA-Z0-9-]{5,100}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
]);
const FORBIDDEN_KEYS = new Set([
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
  "passwordkey",
  "currentpasswordkey",
  "newpasswordkey",
  "recoverycode",
  "sessiontoken",
  "familysession",
  "__proto__",
  "constructor",
  "prototype",
]);

class CloudError extends Error {
  constructor(status, code, message, extra = {}, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}
const fail = (status, code, message, extra, headers) => {
  throw new CloudError(status, code, message, extra, headers);
};
function privateHeaders(extra = {}) {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    Vary: "Cookie, oai-authenticated-user-id",
    ...extra,
  });
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: privateHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...extra,
    }),
  });
}
function authenticatedUser(request) {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id || id.length > 256 || /[\x00-\x1f\x7f]/.test(id)) return null;
  let displayName =
    request.headers.get("oai-authenticated-user-full-name") || "";
  if (
    request.headers.get("oai-authenticated-user-full-name-encoding") ===
    "percent-encoded-utf-8"
  ) {
    try {
      displayName = decodeURIComponent(displayName);
    } catch {
      displayName = "";
    }
  }
  return {
    id,
    email: (request.headers.get("oai-authenticated-user-email") || "").slice(
      0,
      512,
    ),
    displayName: displayName.slice(0, 512),
  };
}
function checkAccount(request, user, { required = false } = {}) {
  const account = request.headers.get("X-Cloud-Account-ID");
  if ((required && !account) || (account !== null && account !== user.id))
    fail(
      403,
      "account_changed",
      "로그인 계정이 바뀌었어요. 동기화 화면을 새로 연 뒤 다시 시도해 주세요.",
    );
}
function checkMutationOrigin(request, url) {
  if (
    request.headers.get("Origin") !== url.origin ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    fail(
      403,
      "origin_forbidden",
      "같은 동화공방 사이트에서만 클라우드 자료를 변경할 수 있어요.",
    );
}
function storage(env, { bucket = true } = {}) {
  if (!env?.DB?.prepare || (bucket && !env?.BUCKET?.get))
    fail(
      503,
      "storage_unavailable",
      "클라우드 보관함을 준비하고 있어요. 기기의 원본 자료는 유지됩니다.",
    );
}
async function boundedBody(request, limit) {
  const declared = request.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  )
    fail(
      413,
      "request_too_large",
      "보낼 자료가 한 번에 저장할 수 있는 크기를 넘었어요.",
    );
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        fail(
          413,
          "request_too_large",
          "보낼 자료가 한 번에 저장할 수 있는 크기를 넘었어요.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CloudError) throw error;
    fail(
      400,
      "request_interrupted",
      "자료 전송이 중단됐어요. 원본을 유지한 채 다시 시도해 주세요.",
    );
  }
  if (declared !== null && size !== Number(declared))
    fail(400, "size_mismatch", "전송한 자료의 크기가 일치하지 않아요.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
async function readJSON(request) {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail(415, "json_required", "JSON 형식의 라이브러리를 보내 주세요.");
  const bytes = await boundedBody(request, CLOUD_LIMITS.requestBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(
      400,
      "invalid_json",
      "라이브러리 JSON을 읽을 수 없어요. 원본 자료는 바꾸지 않았어요.",
    );
  }
}
async function digest(bytes) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function kindForId(id) {
  if (IMAGE_ID.test(id)) return "image";
  if (AUDIO_ID.test(id)) return "audio";
  fail(400, "invalid_asset_id", "그림·음원의 식별자가 올바르지 않아요.");
}
function mimeForKind(raw, kind) {
  if (typeof raw !== "string" || raw.length > 180)
    fail(415, "unsupported_media", "지원하는 그림·음원 형식을 보내 주세요.");
  const mime = raw.split(";")[0].trim().toLowerCase();
  if (
    kind === "image"
      ? !IMAGE_MIMES.has(mime)
      : !(/^audio\/[a-z0-9.+-]+$/.test(mime) || mime === "video/webm")
  )
    fail(415, "unsupported_media", "지원하는 그림·음원 형식을 보내 주세요.");
  return mime;
}
function checkImageBytes(bytes, mime) {
  const first = new TextDecoder().decode(bytes.subarray(0, 32));
  let valid = false;
  if (mime === "image/png")
    valid = bytes[0] === 137 && first.slice(1, 8) === "PNG\r\n\x1a\n";
  else if (mime === "image/jpeg")
    valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  else if (mime === "image/webp")
    valid = first.startsWith("RIFF") && first.slice(8, 12) === "WEBP";
  else if (mime === "image/gif") valid = /^GIF8[79]a/.test(first);
  else if (mime === "image/bmp") valid = first.startsWith("BM");
  else if (mime === "image/avif")
    valid = first.slice(4, 8) === "ftyp" && /avif|avis/.test(first.slice(8));
  else if (mime === "image/svg+xml") {
    let svg = "";
    try {
      svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {}
    valid =
      /<svg(?:\s|>)/i.test(svg) &&
      !/<(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*(?:javascript:|https?:|\/\/)|<!DOCTYPE|<!ENTITY/i.test(
        svg,
      );
  }
  if (!valid)
    fail(
      415,
      "media_type_mismatch",
      "그림 내용과 파일 형식이 일치하지 않아요.",
    );
}
function assetManifest(row) {
  return {
    id: row.asset_id,
    kind: row.kind,
    mimeType: row.mime_type,
    size: Number(row.byte_size),
    sha256: row.sha256,
  };
}
async function assetRow(env, owner, id) {
  return env.DB.prepare(
    "SELECT owner_id, asset_id, kind, mime_type, byte_size, sha256, object_key FROM cloud_assets WHERE owner_id = ? AND asset_id = ?",
  )
    .bind(owner, id)
    .first();
}
const sameAsset = (row, asset) =>
  row &&
  row.kind === asset.kind &&
  row.mime_type === asset.mimeType &&
  Number(row.byte_size) === asset.size &&
  row.sha256 === asset.sha256;
async function putMedia(request, env, user, id) {
  const kind = kindForId(id),
    mimeType = mimeForKind(request.headers.get("Content-Type"), kind);
  const sha256 = (request.headers.get("X-Content-SHA256") || "").toLowerCase();
  if (!SHA256.test(sha256))
    fail(400, "invalid_digest", "그림·음원의 SHA-256 확인값이 필요해요.");
  // A family over its quota is refused on the declared size, before any of the
  // body (up to 40 MB) is read. An id already stored is no new usage.
  const declared = request.headers.get("Content-Length");
  if (
    user.id.startsWith(FAMILY_OWNER_PREFIX) &&
    declared !== null &&
    /^\d+$/.test(declared) &&
    Number(declared) <= CLOUD_LIMITS.mediaBytes &&
    !(await assetRow(env, user.id, id))
  )
    await checkFamilyQuota(env, user.id, Number(declared));
  const bytes = await boundedBody(request, CLOUD_LIMITS.mediaBytes);
  if (!bytes.length)
    fail(400, "empty_media", "빈 그림·음원 파일은 저장할 수 없어요.");
  if ((await digest(bytes)) !== sha256)
    fail(
      400,
      "digest_mismatch",
      "전송 중 그림·음원의 내용이 달라졌어요. 원본을 다시 보내 주세요.",
    );
  if (kind === "image") checkImageBytes(bytes, mimeType);
  const asset = { id, kind, mimeType, size: bytes.byteLength, sha256 };
  let existing = await assetRow(env, user.id, id);
  if (existing) {
    if (!sameAsset(existing, asset))
      fail(
        409,
        "asset_conflict",
        "같은 식별자의 다른 그림·음원이 이미 있어요. 기존 원본을 덮어쓰지 않았어요.",
      );
    return json({ asset: assetManifest(existing), reused: true });
  }
  if (user.id.startsWith(FAMILY_OWNER_PREFIX))
    await checkFamilyQuota(env, user.id, bytes.byteLength);
  // Content-specific paths ensure concurrent differing uploads never overwrite.
  const ownerHash = await digest(encoder.encode(user.id));
  const objectKey = `cloud-media/${ownerHash}/${id}/${sha256}`;
  await env.BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { sha256, kind },
  });
  const result = await env.DB.prepare(
    "INSERT INTO cloud_assets (owner_id, asset_id, kind, mime_type, byte_size, sha256, object_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, asset_id) DO NOTHING",
  )
    .bind(
      user.id,
      id,
      kind,
      mimeType,
      bytes.byteLength,
      sha256,
      objectKey,
      new Date().toISOString(),
    )
    .run();
  if (!Number(result.meta?.changes)) {
    existing = await assetRow(env, user.id, id);
    if (!sameAsset(existing, asset))
      fail(
        409,
        "asset_conflict",
        "다른 기기에서 같은 식별자의 다른 원본을 저장했어요. 기존 원본을 덮어쓰지 않았어요.",
      );
    return json({ asset: assetManifest(existing), reused: true });
  }
  return json({ asset, reused: false }, 201);
}
// Family owners share one site-wide bucket, so each family gets a fixed quota.
async function checkFamilyQuota(env, owner, size) {
  const usage = await env.DB.prepare(
    "SELECT COALESCE(SUM(byte_size), 0) AS bytes, COUNT(*) AS count FROM cloud_assets WHERE owner_id = ?",
  )
    .bind(owner)
    .first();
  if (
    Number(usage?.bytes || 0) + size > FAMILY_LIMITS.quotaBytes ||
    Number(usage?.count || 0) >= FAMILY_LIMITS.quotaAssets
  )
    fail(413, "quota_exceeded", "가족 클라우드 저장 공간(5GB)을 다 썼어요.");
}
async function getMedia(env, user, id) {
  kindForId(id);
  const row = await assetRow(env, user.id, id);
  if (!row)
    fail(
      404,
      "media_not_found",
      "이 계정의 보관함에서 원본 그림·음원을 찾지 못했어요.",
    );
  const object = await env.BUCKET.get(row.object_key);
  if (!object)
    fail(
      503,
      "media_unavailable",
      "그림·음원 원본을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.",
    );
  return new Response(object.body, {
    headers: privateHeaders({
      "Content-Type": row.mime_type,
      "Content-Length": String(row.byte_size),
      "X-Content-SHA256": row.sha256,
      "Content-Disposition": `inline; filename="${id}"`,
      // SVG or mislabeled audio must never execute in this site's origin.
      "Content-Security-Policy": "default-src 'none'; sandbox",
    }),
  });
}
function validateState(state) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    !Array.isArray(state.books) ||
    !Array.isArray(state.characters)
  )
    fail(
      400,
      "invalid_state",
      "책과 재료가 포함된 동화공방 라이브러리를 보내 주세요.",
    );
  const references = new Set(),
    stack = [{ value: state, key: "", depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { value, key, depth } = stack.pop();
    if (++count > 250000 || depth > 100)
      fail(
        400,
        "state_too_complex",
        "라이브러리의 구조가 너무 복잡해 저장할 수 없어요.",
      );
    if (typeof value === "string") {
      if (/^(?:data:|blob:)/i.test(value))
        fail(
          400,
          "inline_media_forbidden",
          "그림·음원은 본문 JSON과 분리해 원본 파일로 먼저 저장해 주세요.",
        );
      if (value.startsWith("asset:")) {
        const id = value.slice(6);
        kindForId(id);
        references.add(id);
      } else if (
        (key === "assetId" ||
          /(?:image|sheet|character).*assetids?$/i.test(key) ||
          /imageids?$/i.test(key) ||
          /audioAssetIds?$/i.test(key)) &&
        value
      ) {
        kindForId(value);
        references.add(value);
      }
    } else if (Array.isArray(value)) {
      for (const item of value)
        stack.push({ value: item, key, depth: depth + 1 });
    } else if (value && typeof value === "object") {
      for (const [field, item] of Object.entries(value)) {
        const normalized = field.replace(/[-_\s]/g, "").toLowerCase();
        if (
          FORBIDDEN_KEYS.has(normalized) ||
          ["__proto__", "constructor", "prototype"].includes(field)
        )
          fail(
            400,
            "credentials_forbidden",
            "API 키·부모 PIN·인증 정보는 클라우드에 저장할 수 없어요. 이 기기에만 보관해 주세요.",
          );
        stack.push({ value: item, key: field, depth: depth + 1 });
      }
    }
  }
  return references;
}
function validateManifest(manifest, references) {
  if (
    !Array.isArray(manifest) ||
    manifest.length > CLOUD_LIMITS.manifestEntries
  )
    fail(400, "invalid_manifest", "그림·음원 목록의 형식을 확인해 주세요.");
  const ids = new Set(),
    normalized = [];
  for (const item of manifest) {
    if (!item || typeof item !== "object")
      fail(400, "invalid_manifest", "그림·음원 목록의 형식을 확인해 주세요.");
    const kind = kindForId(item.id);
    if (
      ids.has(item.id) ||
      item.kind !== kind ||
      !Number.isSafeInteger(item.size) ||
      item.size <= 0 ||
      item.size > CLOUD_LIMITS.mediaBytes ||
      typeof item.sha256 !== "string" ||
      !SHA256.test(item.sha256)
    )
      fail(
        400,
        "invalid_manifest",
        "그림·음원 목록에 잘못되거나 중복된 항목이 있어요.",
      );
    ids.add(item.id);
    normalized.push({
      id: item.id,
      kind,
      mimeType: mimeForKind(item.mimeType, kind),
      size: item.size,
      sha256: item.sha256,
    });
  }
  for (const id of references)
    if (!ids.has(id))
      fail(
        400,
        "missing_manifest_asset",
        "참조하는 그림·음원이 빠졌어요. 기기의 원본은 바꾸지 않았어요.",
      );
  return normalized;
}
async function checkUploadedAssets(env, owner, manifest) {
  for (let offset = 0; offset < manifest.length; offset += 80) {
    const chunk = manifest.slice(offset, offset + 80);
    const result = await env.DB.prepare(
      `SELECT asset_id, kind, mime_type, byte_size, sha256 FROM cloud_assets WHERE owner_id = ? AND asset_id IN (${chunk.map(() => "?").join(", ")})`,
    )
      .bind(owner, ...chunk.map((item) => item.id))
      .all();
    const rows = new Map(
      (result.results || []).map((row) => [row.asset_id, row]),
    );
    for (const asset of chunk)
      if (!sameAsset(rows.get(asset.id), asset))
        fail(
          400,
          "asset_not_uploaded",
          "이 계정의 원본 보관함에 없는 그림·음원이 있어요. 원본 파일을 먼저 저장해 주세요.",
        );
  }
}
async function libraryRow(env, owner) {
  return env.DB.prepare(
    "SELECT revision, state_json, manifest_json, updated_at FROM cloud_libraries WHERE owner_id = ?",
  )
    .bind(owner)
    .first();
}
async function getLibrary(env, user, { meta = false } = {}) {
  const row = await libraryRow(env, user.id);
  if (!row)
    return json({
      exists: false,
      revision: 0,
      ...(meta
        ? {
            updatedAt: null,
            summary: { bookCount: 0, characterCount: 0, backgroundCount: 0 },
          }
        : {}),
    });
  let pointer, snapshot;
  try {
    pointer = JSON.parse(row.state_json);
  } catch {
    fail(
      503,
      "library_unavailable",
      "클라우드 라이브러리를 읽지 못했어요. 기기의 원본은 유지됩니다.",
    );
  }
  if (meta)
    return json({
      exists: true,
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      summary: pointer.summary || {
        bookCount: pointer.books?.length || 0,
        characterCount: pointer.characters?.length || 0,
        backgroundCount: pointer.backgrounds?.length || 0,
      },
    });
  if (pointer.storage === "r2") {
    const object = await env.BUCKET.get(pointer.objectKey);
    if (!object)
      fail(
        503,
        "library_unavailable",
        "클라우드 라이브러리 원본을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.",
      );
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (
      bytes.byteLength !== pointer.size ||
      (await digest(bytes)) !== pointer.sha256
    )
      fail(
        503,
        "library_unavailable",
        "클라우드 원본의 확인값이 일치하지 않아요. 기기의 원본은 유지됩니다.",
      );
    try {
      snapshot = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      fail(503, "library_unavailable", "클라우드 라이브러리를 읽지 못했어요.");
    }
  } else {
    // Allows a small pre-pointer library to migrate on its next successful save.
    try {
      snapshot = { state: pointer, manifest: JSON.parse(row.manifest_json) };
    } catch {
      fail(503, "library_unavailable", "클라우드 라이브러리를 읽지 못했어요.");
    }
  }
  return json({
    exists: true,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    state: snapshot.state,
    manifest: snapshot.manifest,
  });
}
async function putLibrary(request, env, user) {
  const body = await readJSON(request);
  if (
    !body ||
    typeof body !== "object" ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    body.expectedRevision >= Number.MAX_SAFE_INTEGER
  )
    fail(400, "invalid_revision", "클라우드 자료의 이전 버전 번호가 필요해요.");
  const references = validateState(body.state),
    stateJSON = JSON.stringify(body.state);
  if (encoder.encode(stateJSON).byteLength > CLOUD_LIMITS.stateBytes)
    fail(
      413,
      "state_too_large",
      "글과 설정 자료는 16MB까지 저장할 수 있어요. 그림·음원은 별도로 전송해 주세요.",
    );
  const manifest = validateManifest(body.manifest, references);
  await checkUploadedAssets(env, user.id, manifest);
  const current = await libraryRow(env, user.id);
  if (Number(current?.revision || 0) !== body.expectedRevision)
    fail(
      409,
      "revision_conflict",
      "다른 기기에서 먼저 저장한 자료가 있어요. 클라우드 자료를 확인한 뒤 다시 저장해 주세요.",
      { revision: Number(current?.revision || 0) },
    );
  const snapshot = JSON.stringify({ state: body.state, manifest }),
    bytes = encoder.encode(snapshot);
  const objectKey = `cloud-snapshots/${await digest(encoder.encode(user.id))}/${crypto.randomUUID()}.json`;
  const sha256 = await digest(bytes),
    updatedAt = new Date().toISOString();
  await env.BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256 },
  });
  const pointer = JSON.stringify({
    storage: "r2",
    objectKey,
    sha256,
    size: bytes.byteLength,
    summary: {
      bookCount: body.state.books.length,
      characterCount: body.state.characters.length,
      backgroundCount: body.state.backgrounds?.length || 0,
    },
  });
  const manifestPointer = JSON.stringify({
    storage: "r2",
    count: manifest.length,
  });
  let result;
  if (body.expectedRevision === 0) {
    result = await env.DB.prepare(
      "INSERT INTO cloud_libraries (owner_id, revision, state_json, manifest_json, updated_at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(owner_id) DO NOTHING",
    )
      .bind(user.id, pointer, manifestPointer, updatedAt)
      .run();
  } else {
    result = await env.DB.prepare(
      "UPDATE cloud_libraries SET revision = revision + 1, state_json = ?, manifest_json = ?, updated_at = ? WHERE owner_id = ? AND revision = ?",
    )
      .bind(pointer, manifestPointer, updatedAt, user.id, body.expectedRevision)
      .run();
  }
  if (!Number(result.meta?.changes)) {
    await removeObject(env, objectKey);
    const latest = await libraryRow(env, user.id);
    fail(
      409,
      "revision_conflict",
      "다른 기기에서 먼저 저장한 자료가 있어요. 기존 클라우드 자료를 덮어쓰지 않았어요.",
      { revision: Number(latest?.revision || 0) },
    );
  }
  await removeSupersededSnapshot(env, current, objectKey);
  return json({ ok: true, revision: body.expectedRevision + 1, updatedAt });
}
async function removeObject(env, key) {
  try {
    await env.BUCKET.delete?.(key);
  } catch {
    /* 정리 실패는 저장 결과에 영향을 주지 않습니다. */
  }
}
async function removeSupersededSnapshot(env, row, keep) {
  if (!row?.state_json) return;
  let pointer = null;
  try {
    pointer = JSON.parse(row.state_json);
  } catch {
    return;
  }
  if (
    pointer?.storage === "r2" &&
    typeof pointer.objectKey === "string" &&
    pointer.objectKey.startsWith("cloud-snapshots/") &&
    pointer.objectKey !== keep
  )
    await removeObject(env, pointer.objectKey);
}

// Stop controls are independent of large library revisions and never contain API keys.
async function autoJobControl(request, env, user, id) {
  if (!/^auto-[a-zA-Z0-9-]{8,100}$/.test(id))
    fail(400, "invalid_job_id", "자동 제작 식별자를 확인해 주세요.");
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT stop_nonce, requested_at FROM auto_job_controls WHERE owner_id = ? AND job_id = ?",
    )
      .bind(user.id, id)
      .first();
    return json({
      jobId: id,
      stop: row
        ? { nonce: row.stop_nonce, requestedAt: row.requested_at }
        : null,
    });
  }
  if (request.method !== "POST")
    return json(
      {
        error: {
          code: "method_not_allowed",
          message: "GET 또는 POST 요청을 사용해 주세요.",
        },
      },
      405,
      { Allow: "GET, POST" },
    );
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  )
    fail(415, "json_required", "JSON 중지 요청이 필요해요.");
  let body;
  try {
    body = JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 2048)),
    );
  } catch (error) {
    if (error instanceof CloudError) throw error;
    fail(400, "invalid_json", "중지 요청 JSON을 확인해 주세요.");
  }
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(body?.nonce || ""))
    fail(400, "invalid_stop_nonce", "중지 요청 식별자를 확인해 주세요.");
  const requestedAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO auto_job_controls (owner_id, job_id, stop_nonce, requested_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, job_id) DO UPDATE SET stop_nonce = excluded.stop_nonce, requested_at = excluded.requested_at",
  )
    .bind(user.id, id, body.nonce, requestedAt)
    .run();
  return json({ jobId: id, stop: { nonce: body.nonce, requestedAt } });
}

// ---------------------------------------------------------------------------
// Family ID/password accounts. The browser derives passwordKey with PBKDF2
// (600k) so the password never leaves the device; the server stores only a
// second PBKDF2 over that key and SHA-256 digests of session tokens, recovery
// codes and throttle scopes. Sessions travel only in the X-Family-Session header.
const FAMILY_SESSION_HEADER = "X-Family-Session";
const FAMILY_OWNER_PREFIX = "family:";
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const USERNAME = /^[a-z][a-z0-9_]{3,19}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "root",
  "system",
  "support",
  "chatgpt",
  "openai",
  "family",
  "donghwa",
  "guest",
  "test",
]);
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_CODE = /^[0-9A-HJKMNP-TV-Z]{20}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
export const FAMILY_LIMITS = Object.freeze({
  sessionIdleMs: 180 * DAY_MS,
  sessionAbsoluteMs: 400 * DAY_MS,
  sessionRenewMs: DAY_MS,
  sessionsPerAccount: 20,
  passwordIterations: 20000,
  minIterations: 10000,
  maxIterations: 100000,
  authBodyBytes: 4096,
  // The invite is compared before any throttle, so its entropy is what stops
  // guessing: deploy a random value (e.g. `openssl rand -base64 24`).
  signupCodeMinLength: 20,
  quotaBytes: 5 * 1024 * 1024 * 1024,
  quotaAssets: 20000,
});
const THROTTLES = Object.freeze({
  // Only requests holding the right invite share this bucket (it caps hashing).
  signup: { limit: 30, windowSeconds: 60 * 60 },
  // Wrong invites count in their own bucket and never block a right invite.
  signupWrongInvite: { limit: 300, windowSeconds: 60 * 60 },
  login: { limit: 10, windowSeconds: 15 * 60 },
  recover: { limit: 5, windowSeconds: 60 * 60 },
  account: { limit: 10, windowSeconds: 60 * 60 },
});
const AUTH_ROUTES = new Set([
  "signup",
  "login",
  "logout",
  "recover",
  "password",
  "delete",
]);
const AUTH_REQUIRED_MESSAGE =
  "가족 아이디나 ChatGPT 계정으로 로그인하면 클라우드 보관함을 사용할 수 있어요.";
const INVALID_CREDENTIALS = "아이디 또는 비밀번호가 맞지 않아요.";
const INVALID_RECOVERY = "아이디나 복구 코드가 맞지 않아요.";
const SESSION_EXPIRED = "family-session-expired";

const isoAt = (ms) => new Date(ms).toISOString();
const randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));
const hexDigest = (text) => digest(encoder.encode(text));
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
/** Decodes canonical unpadded base64url of exactly `length` bytes, else null. */
function fromBase64url(text, length) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  let binary;
  try {
    binary = atob(
      text.replace(/-/g, "+").replace(/_/g, "/") +
        "=".repeat((4 - (text.length % 4)) % 4),
    );
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.length === length && base64url(bytes) === text ? bytes : null;
}
/** Constant-time comparison for equal-length secrets (lengths are public). */
function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function")
    return crypto.subtle.timingSafeEqual(a, b);
  let difference = 0;
  for (let index = 0; index < a.byteLength; index += 1)
    difference |= a[index] ^ b[index];
  return difference === 0;
}
const sameHex = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  sameBytes(encoder.encode(a), encoder.encode(b));

function canonicalUsername(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase()
    : "";
}
function checkUsername(username) {
  if (!USERNAME.test(username))
    fail(
      400,
      "invalid_username",
      "아이디는 영문 소문자로 시작하고 영문 소문자·숫자·밑줄(_)로 4~20자예요.",
    );
  if (RESERVED_USERNAMES.has(username))
    fail(400, "reserved_username", "쓸 수 없는 아이디예요.");
}
function passwordKeyBytes(value) {
  const bytes = fromBase64url(value, 32);
  if (!bytes)
    fail(
      400,
      "invalid_password_key",
      "비밀번호 확인값이 올바르지 않아요. 화면을 새로 고친 뒤 다시 해 주세요.",
    );
  return bytes;
}
function displayNameOf(value) {
  if (value === undefined || value === null) return "";
  const name = typeof value === "string" ? value.normalize("NFC").trim() : null;
  if (
    name === null ||
    [...name].length > 20 ||
    /[\p{Cc}\u2028\u2029]/u.test(name)
  )
    fail(
      400,
      "invalid_display_name",
      "가족 이름은 줄바꿈 같은 특수 문자 없이 20자까지 쓸 수 있어요.",
    );
  return name;
}

async function pbkdf2(keyBytes, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", keyBytes, "PBKDF2", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      256,
    ),
  );
}
async function hashPasswordKey(keyBytes) {
  const salt = randomBytes(16),
    iterations = FAMILY_LIMITS.passwordIterations;
  const derived = await pbkdf2(keyBytes, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${base64url(salt)}$${base64url(derived)}`;
}
async function verifyPasswordKey(stored, keyBytes) {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  if (
    parts.length !== 4 ||
    parts[0] !== "pbkdf2-sha256" ||
    !/^[1-9][0-9]{0,8}$/.test(parts[1])
  )
    return false;
  const iterations = Number(parts[1]);
  // Workers cap PBKDF2 at 100000 iterations; refuse anything outside the bounds.
  if (
    iterations < FAMILY_LIMITS.minIterations ||
    iterations > FAMILY_LIMITS.maxIterations
  )
    return false;
  const salt = fromBase64url(parts[2], 16),
    expected = fromBase64url(parts[3], 32);
  if (!salt || !expected) return false;
  return sameBytes(await pbkdf2(keyBytes, salt, iterations), expected);
}

function newRecoveryCode() {
  return Array.from(randomBytes(20), (byte) => CROCKFORD[byte & 31]).join("");
}
const formatRecoveryCode = (code) => code.match(/.{4}/g).join("-");
function normalizeRecoveryCode(value) {
  if (typeof value !== "string" || value.length > 80) return "";
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}
const recoveryHash = (accountId, code) =>
  hexDigest(`dhw-recovery-v1:${accountId}:${code}`);

/** Fixed-window attempt counter; counts every attempt before any hashing. */
async function throttle(env, scope, { limit, windowSeconds }, now) {
  const seconds = Math.floor(now / 1000),
    windowStart = seconds - (seconds % windowSeconds);
  const row = await env.DB.prepare(
    "INSERT INTO auth_throttle (bucket, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count",
  )
    .bind(await hexDigest(scope), windowStart)
    .first();
  if (!(Number(row?.count) <= limit)) {
    const retryAfter = Math.max(1, windowStart + windowSeconds - seconds);
    fail(
      429,
      "too_many_attempts",
      `시도가 너무 많아요. ${Math.ceil(retryAfter / 60)}분 뒤 다시 해 주세요.`,
      { retryAfter },
      { "Retry-After": String(retryAfter) },
    );
  }
}
async function clearThrottle(env, scope) {
  try {
    await env.DB.prepare("DELETE FROM auth_throttle WHERE bucket = ?")
      .bind(await hexDigest(scope))
      .run();
  } catch {
    /* 오래된 시도 기록은 시간이 지나면 저절로 풀립니다. */
  }
}
async function pruneThrottle(env, now) {
  try {
    await env.DB.prepare(
      "DELETE FROM auth_throttle WHERE rowid IN (SELECT rowid FROM auth_throttle WHERE window_start < ? LIMIT 100)",
    )
      .bind(Math.floor(now / 1000) - 2 * 24 * 60 * 60)
      .run();
  } catch {
    /* 정리는 다음 요청에서 다시 시도합니다. */
  }
}

const familyUser = (account) => ({
  id: account.owner_id,
  kind: "family",
  username: account.username,
  displayName: account.display_name || "",
  email: "",
});
async function accountByUsername(env, username) {
  return env.DB.prepare(
    "SELECT id, owner_id, username, display_name, password_hash, recovery_hash FROM family_accounts WHERE username = ?",
  )
    .bind(username)
    .first();
}
/**
 * Issues a session only while the account still holds `passwordHash` (the
 * hash the caller checked or just wrote). A login that raced a recovery or a
 * "sign out other devices" password change then gets no session: an INSERT
 * that landed before that change is removed by its DELETE, and one that lands
 * after it matches no row (INSERT ... SELECT is one statement).
 */
async function createSession(env, account, now, passwordHash) {
  const token = base64url(randomBytes(32)),
    tokenHash = await hexDigest(token);
  const created = isoAt(now),
    expiresAt = isoAt(now + FAMILY_LIMITS.sessionIdleMs);
  await env.DB.prepare(
    "DELETE FROM family_sessions WHERE account_id = ? AND (idle_expires_at <= ? OR absolute_expires_at <= ?)",
  )
    .bind(account.id, created, created)
    .run();
  const inserted = await env.DB.prepare(
    "INSERT INTO family_sessions (token_hash, account_id, owner_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at) SELECT ?, id, owner_id, ?, ?, ?, ? FROM family_accounts WHERE id = ? AND owner_id = ? AND password_hash = ?",
  )
    .bind(
      tokenHash,
      created,
      created,
      expiresAt,
      isoAt(now + FAMILY_LIMITS.sessionAbsoluteMs),
      account.id,
      account.owner_id,
      passwordHash,
    )
    .run();
  if (!Number(inserted.meta?.changes))
    fail(401, "invalid_credentials", INVALID_CREDENTIALS);
  await env.DB.prepare(
    "DELETE FROM family_sessions WHERE account_id = ? AND token_hash NOT IN (SELECT token_hash FROM family_sessions WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
  )
    .bind(account.id, account.id, FAMILY_LIMITS.sessionsPerAccount)
    .run();
  return { tokenHash, session: { token, expiresAt } };
}

/**
 * Resolves the request owner. A present X-Family-Session header is decisive:
 * valid -> family user; malformed, unknown or expired -> anonymous with a
 * reason (Sites headers are ignored). D1 is read only when that header exists;
 * storage failures propagate (503) and never degrade to anonymous.
 */
export async function resolveIdentity(request, env, now = Date.now()) {
  const token = request.headers.get(FAMILY_SESSION_HEADER);
  if (token !== null) {
    if (!SESSION_TOKEN.test(token))
      return { user: null, reason: SESSION_EXPIRED };
    storage(env, { bucket: false });
    const tokenHash = await hexDigest(token);
    const row = await env.DB.prepare(
      "SELECT s.account_id, s.owner_id, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at, a.username, a.display_name FROM family_sessions AS s JOIN family_accounts AS a ON a.id = s.account_id AND a.owner_id = s.owner_id WHERE s.token_hash = ?",
    )
      .bind(tokenHash)
      .first();
    const current = isoAt(now);
    if (
      !row ||
      !(row.idle_expires_at > current) ||
      !(row.absolute_expires_at > current)
    )
      return { user: null, reason: SESSION_EXPIRED };
    const renewBefore = isoAt(now - FAMILY_LIMITS.sessionRenewMs);
    if (row.last_seen_at < renewBefore) {
      try {
        await env.DB.prepare(
          "UPDATE family_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE token_hash = ? AND last_seen_at < ?",
        )
          .bind(
            current,
            isoAt(now + FAMILY_LIMITS.sessionIdleMs),
            tokenHash,
            renewBefore,
          )
          .run();
      } catch {
        /* 갱신은 하루 한 번 다시 시도합니다. */
      }
    }
    return {
      user: familyUser(row),
      session: { tokenHash, accountId: row.account_id },
    };
  }
  const user = authenticatedUser(request);
  // The family: owner prefix is reserved; a Sites id must never claim it.
  if (!user || user.id.startsWith(FAMILY_OWNER_PREFIX)) return { user: null };
  return { user };
}

async function readAuthJSON(request) {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail(415, "json_required", "JSON 형식으로 보내 주세요.");
  const bytes = await boundedBody(request, FAMILY_LIMITS.authBodyBytes);
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(
      400,
      "invalid_json",
      "요청 내용을 읽을 수 없어요. 다시 시도해 주세요.",
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail(400, "invalid_request", "요청 내용을 확인해 주세요.");
  return body;
}
async function requireFamilyAccount(request, env, now) {
  const identity = await resolveIdentity(request, env, now);
  if (!identity.user)
    fail(
      401,
      "authentication_required",
      AUTH_REQUIRED_MESSAGE,
      identity.reason ? { reason: identity.reason } : {},
    );
  if (identity.user.kind !== "family")
    fail(403, "family_only", "가족 아이디로 로그인했을 때만 쓸 수 있어요.");
  checkAccount(request, identity.user, { required: true });
  const account = await env.DB.prepare(
    "SELECT id, owner_id, username, display_name, password_hash FROM family_accounts WHERE id = ? AND owner_id = ?",
  )
    .bind(identity.session.accountId, identity.user.id)
    .first();
  if (!account)
    fail(401, "authentication_required", AUTH_REQUIRED_MESSAGE, {
      reason: SESSION_EXPIRED,
    });
  return { account, tokenHash: identity.session.tokenHash };
}

async function familySignup(body, env, now) {
  const configured =
    typeof env?.FAMILY_SIGNUP_CODE === "string"
      ? env.FAMILY_SIGNUP_CODE.trim()
      : "";
  if (configured.length < FAMILY_LIMITS.signupCodeMinLength)
    fail(
      503,
      "signup_closed",
      "가족 계정 만들기가 아직 열리지 않았어요. 사이트 관리자에게 가족 초대 코드를 받아 주세요.",
    );
  storage(env, { bucket: false });
  // The invite is checked first (a constant-time digest compare, no PBKDF2):
  // wrong-invite traffic can never use up the bucket that right invites share.
  const invite =
    typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
  if (!sameHex(await hexDigest(invite), await hexDigest(configured))) {
    await throttle(env, "signup:wrong-invite", THROTTLES.signupWrongInvite, now);
    fail(403, "invite_invalid", "가족 초대 코드가 맞지 않아요.");
  }
  await throttle(env, "signup", THROTTLES.signup, now);
  await pruneThrottle(env, now);
  const username = canonicalUsername(body.username);
  checkUsername(username);
  const keyBytes = passwordKeyBytes(body.passwordKey);
  const displayName = displayNameOf(body.displayName);
  const taken = () =>
    fail(
      409,
      "username_taken",
      "이미 있는 아이디예요. 로그인하거나 다른 아이디를 써 주세요.",
    );
  if (
    await env.DB.prepare(
      "SELECT 1 AS taken FROM family_accounts WHERE username = ?",
    )
      .bind(username)
      .first()
  )
    taken();
  const account = {
    id: crypto.randomUUID(),
    owner_id: FAMILY_OWNER_PREFIX + crypto.randomUUID(),
    username,
    display_name: displayName,
  };
  const code = newRecoveryCode(),
    created = isoAt(now),
    passwordHash = await hashPasswordKey(keyBytes);
  const result = await env.DB.prepare(
    "INSERT INTO family_accounts (id, owner_id, username, display_name, password_hash, recovery_hash, password_changed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING",
  )
    .bind(
      account.id,
      account.owner_id,
      username,
      displayName,
      passwordHash,
      await recoveryHash(account.id, code),
      created,
      created,
    )
    .run();
  if (!Number(result.meta?.changes)) taken();
  const { session } = await createSession(env, account, now, passwordHash);
  return json(
    {
      user: familyUser(account),
      session,
      recoveryCode: formatRecoveryCode(code),
    },
    201,
  );
}
async function familyLogin(body, env, now) {
  storage(env, { bucket: false });
  const username = canonicalUsername(body.username),
    keyBytes = passwordKeyBytes(body.passwordKey);
  if (!USERNAME.test(username))
    fail(401, "invalid_credentials", INVALID_CREDENTIALS);
  await throttle(env, "login:" + username, THROTTLES.login, now);
  await pruneThrottle(env, now);
  const account = await accountByUsername(env, username);
  // Unknown usernames return the same 401 without computing a hash.
  if (!account || !(await verifyPasswordKey(account.password_hash, keyBytes)))
    fail(401, "invalid_credentials", INVALID_CREDENTIALS);
  await clearThrottle(env, "login:" + username);
  const { session } = await createSession(
    env,
    account,
    now,
    account.password_hash,
  );
  return json({ user: familyUser(account), session });
}
async function familyLogout(request, env) {
  const token = request.headers.get(FAMILY_SESSION_HEADER);
  if (token !== null && SESSION_TOKEN.test(token)) {
    try {
      await env.DB.prepare("DELETE FROM family_sessions WHERE token_hash = ?")
        .bind(await hexDigest(token))
        .run();
    } catch {
      /* 로그아웃은 저장소 장애와 상관없이 이 기기에서 끝납니다. */
    }
  }
  return json({ ok: true });
}
async function familyRecover(body, env, now) {
  storage(env, { bucket: false });
  const username = canonicalUsername(body.username),
    keyBytes = passwordKeyBytes(body.newPasswordKey);
  if (!USERNAME.test(username)) fail(401, "invalid_recovery", INVALID_RECOVERY);
  await throttle(env, "recover:" + username, THROTTLES.recover, now);
  const account = await accountByUsername(env, username);
  const code = normalizeRecoveryCode(body.recoveryCode);
  if (
    !account ||
    !RECOVERY_CODE.test(code) ||
    !sameHex(await recoveryHash(account.id, code), account.recovery_hash)
  )
    fail(401, "invalid_recovery", INVALID_RECOVERY);
  const next = newRecoveryCode(),
    passwordHash = await hashPasswordKey(keyBytes);
  // Single use: only the request that still sees the old digest may rotate it.
  const result = await env.DB.prepare(
    "UPDATE family_accounts SET password_hash = ?, recovery_hash = ?, password_changed_at = ? WHERE id = ? AND recovery_hash = ?",
  )
    .bind(
      passwordHash,
      await recoveryHash(account.id, next),
      isoAt(now),
      account.id,
      account.recovery_hash,
    )
    .run();
  if (!Number(result.meta?.changes))
    fail(401, "invalid_recovery", INVALID_RECOVERY);
  await env.DB.prepare("DELETE FROM family_sessions WHERE account_id = ?")
    .bind(account.id)
    .run();
  await clearThrottle(env, "login:" + username);
  const { session } = await createSession(env, account, now, passwordHash);
  return json({
    user: familyUser(account),
    session,
    recoveryCode: formatRecoveryCode(next),
  });
}
async function familyPassword(request, body, env, now) {
  const { account, tokenHash } = await requireFamilyAccount(request, env, now);
  const current = passwordKeyBytes(body.currentPasswordKey),
    next = passwordKeyBytes(body.newPasswordKey);
  if (
    body.signOutOthers !== undefined &&
    typeof body.signOutOthers !== "boolean"
  )
    fail(400, "invalid_request", "요청 내용을 확인해 주세요.");
  await throttle(env, "account:" + account.id, THROTTLES.account, now);
  if (!(await verifyPasswordKey(account.password_hash, current)))
    fail(401, "invalid_credentials", INVALID_CREDENTIALS);
  // CAS: a concurrent change that landed first is never reverted.
  const passwordHash = await hashPasswordKey(next);
  const result = await env.DB.prepare(
    "UPDATE family_accounts SET password_hash = ?, password_changed_at = ? WHERE id = ? AND password_hash = ?",
  )
    .bind(
      passwordHash,
      isoAt(now),
      account.id,
      account.password_hash,
    )
    .run();
  if (!Number(result.meta?.changes))
    fail(401, "invalid_credentials", INVALID_CREDENTIALS);
  const created = await createSession(env, account, now, passwordHash);
  await env.DB.prepare("DELETE FROM family_sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
  if (body.signOutOthers === true)
    await env.DB.prepare(
      "DELETE FROM family_sessions WHERE account_id = ? AND token_hash <> ?",
    )
      .bind(account.id, created.tokenHash)
      .run();
  return json({ session: created.session });
}
async function familyDelete(request, body, env, now) {
  const { account } = await requireFamilyAccount(request, env, now);
  if (body.confirm !== "삭제")
    fail(400, "confirm_required", '확인 칸에 "삭제"라고 적어 주세요.');
  const keyBytes = passwordKeyBytes(body.passwordKey);
  await throttle(env, "account:" + account.id, THROTTLES.account, now);
  if (!(await verifyPasswordKey(account.password_hash, keyBytes)))
    fail(401, "invalid_credentials", INVALID_CREDENTIALS);
  const owner = account.owner_id,
    ownerHash = await hexDigest(owner),
    keys = new Set();
  const library = await env.DB.prepare(
    "SELECT state_json FROM cloud_libraries WHERE owner_id = ?",
  )
    .bind(owner)
    .first();
  try {
    const pointer = JSON.parse(library?.state_json || "null");
    if (pointer?.storage === "r2" && typeof pointer.objectKey === "string")
      keys.add(pointer.objectKey);
  } catch {
    /* 읽을 수 없는 포인터는 지울 객체가 없습니다. */
  }
  const assets = await env.DB.prepare(
    "SELECT object_key FROM cloud_assets WHERE owner_id = ?",
  )
    .bind(owner)
    .all();
  for (const row of assets.results || [])
    if (typeof row.object_key === "string") keys.add(row.object_key);
  // Sessions go first so other devices lose access before data disappears;
  // the account row goes last so a failed run can be retried after login.
  await env.DB.prepare("DELETE FROM family_sessions WHERE account_id = ?")
    .bind(account.id)
    .run();
  for (const table of ["cloud_libraries", "cloud_assets", "auto_job_controls"])
    await env.DB.prepare(`DELETE FROM ${table} WHERE owner_id = ?`)
      .bind(owner)
      .run();
  await env.DB.prepare(
    "DELETE FROM family_accounts WHERE id = ? AND owner_id = ?",
  )
    .bind(account.id, owner)
    .run();
  // Only objects under this owner's own key prefixes are ever removed.
  for (const key of keys)
    if (
      key.startsWith(`cloud-snapshots/${ownerHash}/`) ||
      key.startsWith(`cloud-media/${ownerHash}/`)
    )
      await removeObject(env, key);
  return json({ deleted: true });
}
async function handleFamilyAuth(request, env, url, now) {
  const route = url.pathname.slice("/api/cloud/auth/".length);
  if (!AUTH_ROUTES.has(route))
    fail(404, "not_found", "클라우드 보관함 주소를 확인해 주세요.");
  if (request.method !== "POST")
    return json(
      {
        error: {
          code: "method_not_allowed",
          message: "POST 요청을 사용해 주세요.",
        },
      },
      405,
      { Allow: "POST" },
    );
  checkMutationOrigin(request, url);
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin")
    fail(
      403,
      "origin_forbidden",
      "같은 동화공방 사이트에서만 가족 계정을 쓸 수 있어요.",
    );
  if (route === "logout") return await familyLogout(request, env);
  const body = await readAuthJSON(request);
  if (route === "signup") return await familySignup(body, env, now);
  if (route === "login") return await familyLogin(body, env, now);
  if (route === "recover") return await familyRecover(body, env, now);
  if (route === "password")
    return await familyPassword(request, body, env, now);
  return await familyDelete(request, body, env, now);
}

/**
 * Returns null for all routes outside /api/cloud. No client secrets are used.
 * `options.now` (a function returning epoch ms) is injectable for tests.
 */
export async function handleCloudRequest(request, env, options = {}) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cloud" && !url.pathname.startsWith("/api/cloud/"))
    return null;
  const clock = typeof options?.now === "function" ? options.now : Date.now;
  try {
    const now = Number(clock());
    if (url.pathname.startsWith("/api/cloud/auth/"))
      return await handleFamilyAuth(request, env, url, now);
    const identity = await resolveIdentity(request, env, now),
      user = identity.user;
    if (url.pathname === "/api/cloud/session" && request.method === "GET")
      return json(
        user
          ? { authenticated: true, user }
          : {
              authenticated: false,
              signInPath: "/signin-with-chatgpt?return_to=%2F",
              ...(identity.reason ? { reason: identity.reason } : {}),
            },
      );
    if (!user)
      fail(
        401,
        "authentication_required",
        AUTH_REQUIRED_MESSAGE,
        identity.reason ? { reason: identity.reason } : {},
      );
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    checkAccount(request, user, { required: mutation });
    if (mutation) checkMutationOrigin(request, url);
    const control = /^\/api\/cloud\/jobs\/(auto-[^/]+)\/control$/.exec(
      url.pathname,
    );
    if (control) {
      storage(env, { bucket: false });
      return await autoJobControl(request, env, user, control[1]);
    }
    storage(env);
    if (url.pathname === "/api/cloud/library") {
      if (request.method === "GET")
        return await getLibrary(env, user, {
          meta: url.searchParams.get("meta") === "1",
        });
      if (request.method === "PUT") return await putLibrary(request, env, user);
      return json(
        {
          error: {
            code: "method_not_allowed",
            message: "GET 또는 PUT 요청을 사용해 주세요.",
          },
        },
        405,
        { Allow: "GET, PUT" },
      );
    }
    const media = /^\/api\/cloud\/media\/([^/]+)$/.exec(url.pathname);
    if (media) {
      let id;
      try {
        id = decodeURIComponent(media[1]);
      } catch {
        fail(400, "invalid_asset_id", "그림·음원의 식별자를 확인해 주세요.");
      }
      if (request.method === "GET") return await getMedia(env, user, id);
      if (request.method === "PUT")
        return await putMedia(request, env, user, id);
      return json(
        {
          error: {
            code: "method_not_allowed",
            message: "GET 또는 PUT 요청을 사용해 주세요.",
          },
        },
        405,
        { Allow: "GET, PUT" },
      );
    }
    fail(404, "not_found", "클라우드 보관함 주소를 확인해 주세요.");
  } catch (error) {
    if (error instanceof CloudError)
      return json(
        { error: { code: error.code, message: error.message }, ...error.extra },
        error.status,
        error.headers,
      );
    // Storage/provider exceptions must not expose owner IDs, object keys or data.
    return json(
      {
        error: {
          code: "cloud_unavailable",
          message:
            "클라우드 저장에 연결하지 못했어요. 기기의 원본은 유지됩니다. 잠시 뒤 다시 시도해 주세요.",
        },
      },
      503,
    );
  }
}
