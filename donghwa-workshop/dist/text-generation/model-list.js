/**
 * R13 '모델 목록 불러오기': ask a provider which models this key can use.
 * It is a list call only (no tokens, no cost). The result keeps model IDs and
 * display names, never a key. A configured proxy answers with its own server
 * key, so the browser sends none. Image providers without a list API (BFL,
 * fal, ComfyUI, the free sample) are not asked.
 */
import { isModelId, MAX_FETCHED_MODELS } from "./models.js";

export class ModelListError extends Error {
  constructor(message, code = "model_list", status = null) {
    super(message);
    this.name = "ModelListError";
    this.code = code;
    this.status = status;
  }
}
const fail = (message, code, status) => {
  throw new ModelListError(message, code, status);
};
export const MODEL_LIST_ENGINES = Object.freeze({
  text: Object.freeze(["openai", "anthropic", "google", "local"]),
  image: Object.freeze(["openai", "google"]),
});
export function supportsModelList(kind, engine) {
  return (MODEL_LIST_ENGINES[kind] || []).includes(engine);
}
const DEFAULT_BASE = Object.freeze({
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  local: "http://127.0.0.1:1234/v1",
});
function baseUrl(value, fallback) {
  let url;
  try {
    url = new URL(value || fallback);
  } catch {
    fail("주소를 확인해 주세요. HTTP(S) 주소만 쓸 수 있어요.", "endpoint");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail("주소에 인증 정보나 쿼리를 넣을 수 없어요.", "endpoint");
  return url.href.replace(/\/+$/, "");
}
const TEXT_EXCLUDE =
  /(embed|whisper|tts|audio|realtime|transcribe|image|dall-e|moderation|search|instruct|davinci|babbage|computer-use|deep-research|codex|sora|diariz|imagen|veo|aqa|live|robotics)/i;
/** Newer first: compares the version numbers in an ID (gemini-4 > gemini-2.5). */
function versionKey(id) {
  return (String(id).match(/\d+(?:\.\d+)?/g) || []).flatMap((part) =>
    part.split(".").map(Number),
  );
}
function byVersionDesc(a, b) {
  const x = versionKey(a.id),
    y = versionKey(b.id);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1);
    if (d) return d;
  }
  const preview = (id) => (/(preview|exp|latest)/i.test(id) ? 1 : 0);
  return preview(a.id) - preview(b.id) || a.id.localeCompare(b.id);
}
const label = (value) =>
  typeof value === "string" && value.trim()
    ? { label: value.trim().slice(0, 120) }
    : {};
/**
 * Keep generation models only, newest first, each ID once, at most 200.
 * Text: chat/completion models. Images: image models the app's adapter can call.
 */
export function parseModelList(kind, engine, data) {
  if (!data || typeof data !== "object")
    fail("모델 목록 응답을 읽지 못했어요.", "response");
  let rows = [];
  if (engine === "google") {
    rows = (Array.isArray(data.models) ? data.models : [])
      .filter(
        (row) =>
          typeof row?.name === "string" &&
          (!Array.isArray(row.supportedGenerationMethods) ||
            row.supportedGenerationMethods.includes("generateContent")),
      )
      .map((row) => ({
        id: row.name.replace(/^models\//, ""),
        ...label(row.displayName),
      }))
      .filter((row) =>
        kind === "image"
          ? /^gemini/i.test(row.id) && /image/i.test(row.id)
          : /^(gemini|gemma)/i.test(row.id) && !TEXT_EXCLUDE.test(row.id),
      )
      .sort(byVersionDesc);
  } else if (engine === "anthropic") {
    rows = (Array.isArray(data.data) ? data.data : [])
      .filter(
        (row) =>
          typeof row?.id === "string" && (!row.type || row.type === "model"),
      )
      .map((row) => ({
        id: row.id,
        ...label(row.display_name),
        at: Date.parse(row.created_at) || 0,
      }))
      .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
      .map(({ at, ...row }) => row);
  } else if (engine === "openai") {
    rows = (Array.isArray(data.data) ? data.data : [])
      .filter((row) => typeof row?.id === "string")
      .filter((row) =>
        kind === "image"
          ? /^(gpt|chatgpt)-.*image/i.test(row.id)
          : /^(gpt-|o\d|chatgpt-)/i.test(row.id) && !TEXT_EXCLUDE.test(row.id),
      )
      .map((row) => ({ id: row.id, at: Number(row.created) || 0 }))
      .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))
      .map(({ id }) => ({ id }));
  } else if (engine === "local") {
    // LM Studio and Ollama list what is loaded; they give no dates, so keep their order.
    rows = (Array.isArray(data.data) ? data.data : [])
      .filter((row) => typeof row?.id === "string" && !/embed/i.test(row.id))
      .map((row) => ({ id: row.id }));
  } else fail("이 공급자는 모델 목록을 제공하지 않아요.", "unsupported");
  const seen = new Set();
  return rows
    .map((row) => ({ ...row, id: row.id.trim() }))
    .filter((row) => isModelId(row.id) && !seen.has(row.id) && seen.add(row.id))
    .slice(0, MAX_FETCHED_MODELS);
}
/** A proxy answers with an already filtered list; check it again here. */
function parseProxyList(data) {
  if (!data || !Array.isArray(data.models))
    fail("프록시의 모델 목록 응답을 읽지 못했어요.", "response");
  const seen = new Set();
  return data.models
    .map((row) => (typeof row === "string" ? { id: row } : row))
    .filter((row) => typeof row?.id === "string")
    .map((row) => ({ id: row.id.trim(), ...label(row.label) }))
    .filter(
      (row) => isModelId(row.id) && !seen.has(row.id) && seen.add(row.id),
    )
    .slice(0, MAX_FETCHED_MODELS);
}
function httpMessage(status) {
  return status === 401 || status === 403
    ? `키를 확인해 주세요. 이 키로는 모델 목록을 볼 수 없어요. (HTTP ${status})`
    : status === 404
      ? `모델 목록 주소를 찾지 못했어요. 주소나 프록시를 확인해 주세요. (HTTP ${status})`
      : status === 429
        ? `요청 한도에 걸렸어요. 잠시 뒤 다시 불러와 주세요. (HTTP ${status})`
        : `공급자가 모델 목록을 주지 않았어요. 잠시 뒤 다시 시도해 주세요. (HTTP ${status})`;
}
async function getJson(url, headers, config, signal) {
  let response;
  try {
    response = await (config.fetch || globalThis.fetch)(url, {
      method: "GET",
      headers,
      signal,
      credentials: "omit",
    });
  } catch {
    if (signal?.aborted)
      throw new DOMException("모델 목록 불러오기를 멈췄어요.", "AbortError");
    fail(
      "모델 목록을 불러오지 못했어요. 인터넷·주소·CORS·프록시 설정을 확인해 주세요.",
      "network",
    );
  }
  if (!response.ok) fail(httpMessage(response.status), "http", response.status);
  try {
    return await response.json();
  } catch {
    fail("모델 목록 응답을 읽지 못했어요.", "response");
  }
}
/** The wire request for one list call (exported for the proxy and tests). */
export function modelListRequest(kind, engine, config = {}) {
  if (!supportsModelList(kind, engine))
    fail(
      "이 공급자는 모델 목록을 제공하지 않아요. 모델 ID를 직접 입력해 주세요.",
      "unsupported",
    );
  if (config.proxyEndpoint || config.transport === "proxy") {
    const base = baseUrl(
      config.proxyEndpoint,
      globalThis.location?.origin || "http://127.0.0.1:8787",
    );
    return {
      url: `${base}/api/models/${kind}/${engine}`,
      headers: {},
      proxy: true,
    };
  }
  const key = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  if (!key && engine !== "local")
    fail("먼저 이 공급자의 API 키를 저장해 주세요.", "missing_key");
  const base = baseUrl(
    kind === "text" ? config.baseUrl || config.endpoint : config.endpoint,
    DEFAULT_BASE[engine],
  );
  if (engine === "anthropic")
    return {
      url: `${base}/models?limit=1000`,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    };
  if (engine === "google")
    return {
      url: `${base}/models?pageSize=1000`,
      headers: { "x-goog-api-key": key },
    };
  return {
    url: `${base}/models`,
    headers: key ? { Authorization: "Bearer " + key } : {},
  };
}
/**
 * Fetch one provider's usable models. Returns {fetchedAt, models:[{id,label?}]};
 * throws a ModelListError with a Korean message and changes nothing on failure.
 */
export async function fetchProviderModels({
  kind = "text",
  engine,
  config = {},
  signal,
  now = () => new Date(),
} = {}) {
  const request = modelListRequest(kind, engine, config),
    data = await getJson(request.url, request.headers, config, signal),
    models = request.proxy
      ? parseProxyList(data)
      : parseModelList(kind, engine, data);
  if (!models.length)
    fail(
      kind === "image"
        ? "이 키로 쓸 수 있는 그림 모델을 찾지 못했어요."
        : "이 키로 쓸 수 있는 글 모델을 찾지 못했어요.",
      "empty",
    );
  return { fetchedAt: now().toISOString(), models };
}
