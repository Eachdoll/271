/**
 * Browser image generation plugins. Credentials are supplied for one request;
 * this module never writes configuration, keys, or responses to storage.
 *
 * generateImage({prompt, stylePreset, referenceImages, seed, size, quality},
 *               {engine, config}) -> {imageUrl, seed, meta}
 */
import { characterSVG, sceneSVG } from "../engine.js";
import { ENGINE_MODELS, getEngineModel, estimateImageCost } from "./models.js";
import { renderImageRequest, StoryRendererError } from "./story-renderer.js";
import { forbiddenStyleMatches } from "./styles.js";
import { validateCredentialInput } from "./credential-validation.js";

export const ENGINE_IDS = Object.freeze([
  "google",
  "openai",
  "bfl",
  "fal",
  "local",
  "sample",
]);
export const ENGINE_METADATA = Object.freeze({
  sample: Object.freeze({
    id: "sample",
    name: "무료 샘플 · 기기 내",
    model: "original-svg-template-v1",
    requiresKey: false,
    seedSupported: true,
    referenceLimit: null,
    photoToCharacter: false,
    cost: "free",
    description: "기기 안에서 만드는 그림 템플릿 · AI 생성 아님",
    docs: null,
  }),
  google: Object.freeze({
    id: "google",
    name: "Google · 나노바나나 2",
    model: ENGINE_MODELS.google.final,
    draftModel: ENGINE_MODELS.google.draft,
    proModel: ENGINE_MODELS.google.pro,
    requiresKey: true,
    seedSupported: false,
    referenceLimit: 14,
    supportsNegative: false,
    photoToCharacter: true,
    cost: "paid",
    description:
      "Gemini 앱의 무료 사용 한도와 별도인 유료 이미지 API · 초안 Lite / 확정 Nano Banana 2 / Pro 선택",
    pricingDocs: ENGINE_MODELS.google.pricingDocs,
    docs: "https://ai.google.dev/gemini-api/docs/image-generation",
  }),
  openai: Object.freeze({
    id: "openai",
    name: "OpenAI",
    model: ENGINE_MODELS.openai.final,
    requiresKey: true,
    seedSupported: false,
    referenceLimit: 16,
    supportsNegative: false,
    docs: ENGINE_MODELS.openai.docs,
  }),
  bfl: Object.freeze({
    id: "bfl",
    name: "Black Forest Labs",
    model: ENGINE_MODELS.bfl.final,
    requiresKey: true,
    seedSupported: true,
    referenceLimit: 8,
    supportsNegative: false,
    docs: ENGINE_MODELS.bfl.docs,
  }),
  fal: Object.freeze({
    id: "fal",
    name: "fal · Seedream 5",
    model: "seedream-5",
    apiModel: ENGINE_MODELS.fal.final,
    draftModel: ENGINE_MODELS.fal.draft,
    requiresKey: true,
    seedSupported: false,
    referenceLimit: 10,
    supportsNegative: false,
    description: "초안 Seedream 5 Lite / 확정 Seedream 5 Pro",
    docs: ENGINE_MODELS.fal.docs,
  }),
  local: Object.freeze({
    id: "local",
    name: "로컬 ComfyUI · API 요금 없음",
    model: "ComfyUI workflow",
    requiresKey: false,
    seedSupported: true,
    referenceLimit: null,
    photoToCharacter: true,
    cost: "local",
    description: "직접 설치한 모델로 생성 · 컴퓨터·전기 비용은 별도",
    docs: "https://docs.comfy.org/development/comfyui-server/comms_routes",
  }),
});

export class ImageGenerationError extends Error {
  constructor(message, code = "generation_failed", status = null) {
    super(message);
    this.name = "ImageGenerationError";
    this.code = code;
    this.status = status;
  }
}

function fail(message, code, status) {
  throw new ImageGenerationError(message, code, status);
}
function abortError() {
  return new ImageGenerationError("이미지 생성을 취소했어요.", "aborted");
}
function randomSeed() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(values);
  else values[0] = Math.floor(Math.random() * 0xffffffff);
  return values[0] & 0x7fffffff;
}
function seedValue(value) {
  if (value === undefined || value === null || value === "")
    return randomSeed();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 0x7fffffff)
    fail("시드는 0~2147483647 사이의 정수여야 해요.", "invalid_seed");
  return result;
}
function normalizeSize(size) {
  if (size === undefined || size === null || size === "auto")
    return { width: 1024, height: 1024, automatic: true };
  const match =
    typeof size === "string" && size.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  const width = Number(match ? match[1] : size?.width);
  const height = Number(match ? match[2] : size?.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 64 ||
    height < 64 ||
    width > 4096 ||
    height > 4096
  )
    fail(
      "이미지 크기는 64~4096 픽셀의 가로·세로 값으로 입력해 주세요.",
      "invalid_size",
    );
  return { width, height, automatic: false };
}

/** Preset descriptions use visual properties, never engine-specific style names. */
export function composeImagePrompt(
  prompt,
  stylePreset = {},
  referenceImages = [],
) {
  return renderImageRequest(
    { prompt, stylePreset, referenceImages },
    { supportsNegative: false },
  ).composedPrompt;
}

function normalizeRequest(request, metadata) {
  let rendered;
  try {
    rendered = renderImageRequest(request, {
      maxReferenceImages: metadata.referenceLimit,
      supportsNegative: metadata.id === "local",
    });
  } catch (error) {
    if (error instanceof StoryRendererError) fail(error.message, error.code);
    throw error;
  }
  if (
    forbiddenStyleMatches(
      [
        rendered.composedPrompt,
        rendered.negativePrompt,
        rendered.stylePreset.name || "",
      ].join("\n"),
    ).length
  )
    fail(
      "설명과 화풍에는 스튜디오·작가·작품·기존 캐릭터 이름을 사용할 수 없어요. 색·질감·빛·선으로 설명해 주세요.",
      "forbidden_style_name",
    );
  return {
    ...rendered,
    seed: seedValue(request.seed),
    size: normalizeSize(request.size),
    quality: request.quality || "medium",
  };
}

function requestContext(config, signal) {
  const controller = new AbortController();
  const timeoutMs = Number(config.timeoutMs) || 180000;
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted || config.signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  config.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(100, timeoutMs),
  );
  return {
    signal: controller.signal,
    fetch: config.fetch || globalThis.fetch.bind(globalThis),
    interval: Math.max(100, Number(config.pollIntervalMs) || 1000),
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      config.signal?.removeEventListener("abort", abort);
    },
    wasTimeout() {
      return timedOut;
    },
  };
}

async function fetchResponse(url, options, context) {
  if (context.signal.aborted) throw abortError();
  let response;
  try {
    response = await context.fetch(url, { ...options, signal: context.signal });
  } catch (error) {
    if (context.signal.aborted || error?.name === "AbortError")
      throw abortError();
    // Network errors and upstream bodies can contain request URLs or credentials.
    // Expose only a fixed, actionable message, never the raw exception/body.
    fail(
      "엔진에 연결하지 못했어요. 네트워크·엔드포인트와 브라우저 CORS 허용 설정을 확인해 주세요. 로컬 HTTP 연결은 브라우저의 보안 제한을 받을 수 있어요.",
      "network_error",
    );
  }
  if (!response.ok) {
    const status = response.status;
    const message =
      status === 401 && context.engine === "openai" && !context.useProxy
        ? "OpenAI 인증에 실패했어요. 추적 ID 대신 비밀 키 전체를 저장했는지, 키가 삭제되거나 만료되지 않았는지 확인해 주세요."
        : status === 401 || status === 403
          ? "API 키와 모델 사용 권한을 확인해 주세요."
          : status === 429
            ? "엔진의 사용량 또는 요청 한도를 초과했어요. 잠시 뒤 다시 시도해 주세요."
            : status === 400 || status === 422
              ? "엔진이 요청을 받지 못했어요. 이미지 크기·참조 파일 형식과 모델 설정을 확인해 주세요."
              : status === 404
                ? "엔진 주소 또는 모델을 찾지 못했어요. 엔드포인트를 확인해 주세요."
                : "엔진에서 이미지 생성 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
    fail(`${message} (HTTP ${status})`, "http_error", status);
  }
  return response;
}
async function fetchJSON(url, options, context) {
  const response = await fetchResponse(url, options, context);
  try {
    return await response.json();
  } catch {
    fail("엔진이 올바른 JSON 응답을 반환하지 않았어요.", "invalid_response");
  }
}
function jsonOptions(body, headers = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}
function billedCost(result) {
  const cost =
    result?.cost_usd ?? result?.usage?.cost_usd ?? result?.billing?.cost_usd;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : undefined;
}
function apiKey(config) {
  const key = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  if (!key)
    fail(
      "부모 설정에서 이 엔진의 API 키를 입력하고 잠금을 해제해 주세요.",
      "missing_key",
    );
  return key;
}
function endpoint(config, fallback) {
  const value = String(config.endpoint || fallback)
    .trim()
    .replace(/\/$/, "");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(
      "엔드포인트는 전체 HTTP 또는 HTTPS 주소여야 해요.",
      "invalid_endpoint",
    );
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    fail(
      "엔드포인트에는 HTTP(S) 주소만 입력해 주세요. 인증 정보는 API 키 칸에 입력해 주세요.",
      "invalid_endpoint",
    );
  return value;
}
function trustedResultURL(value, base, provider) {
  let result;
  try {
    result = new URL(value, base);
  } catch {
    fail("엔진이 올바른 작업 주소를 반환하지 않았어요.", "invalid_response");
  }
  const configured = new URL(base);
  const official =
    provider === "bfl"
      ? result.hostname === "bfl.ai" || result.hostname.endsWith(".bfl.ai")
      : provider === "fal"
        ? result.hostname === "fal.run" || result.hostname.endsWith(".fal.run")
        : false;
  if (
    result.origin !== configured.origin &&
    !(result.protocol === "https:" && official)
  )
    fail(
      "엔진이 다른 서버의 작업 주소를 반환하여 연결을 중단했어요.",
      "untrusted_result_url",
    );
  if (result.username || result.password)
    fail(
      "엔진 작업 주소에 인증 정보가 들어 있어 연결을 중단했어요.",
      "untrusted_result_url",
    );
  return result.href;
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function blobDataURL(blob, signal) {
  if (signal?.aborted) throw abortError();
  // Reading through ArrayBuffer works in browsers, workers and Node test harnesses.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 16384)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  if (signal?.aborted) throw abortError();
  return `data:${blob.type || "image/png"};base64,${btoa(chunks.join(""))}`;
}
function dataURLBlob(dataURL) {
  const match = dataURL.match(/^data:([^,]+),([\s\S]*)$/);
  const header = match?.[1].split(";") || [];
  const mimeType = header[0]?.toLowerCase();
  const base64 = header
    .slice(1)
    .some((value) => value.toLowerCase() === "base64");
  if (!match || !mimeType?.startsWith("image/"))
    fail("참조 파일은 이미지여야 해요.", "invalid_reference");
  try {
    const decoded = base64 ? atob(match[2]) : decodeURIComponent(match[2]);
    const bytes = base64
      ? Uint8Array.from(decoded, (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decoded);
    return new Blob([bytes], { type: mimeType });
  } catch {
    fail("참조 이미지 데이터를 읽지 못했어요.", "invalid_reference");
  }
}
async function rasterizeSVG(blob, signal, outputSize = null) {
  if (typeof document === "undefined" || typeof Image === "undefined")
    fail(
      "SVG 참조 이미지는 브라우저에서 PNG로 변환해야 해요. PNG 파일로 다시 업로드해 주세요.",
      "svg_requires_browser",
    );
  const objectURL = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      const abort = () => {
        img.src = "";
        reject(abortError());
      };
      const finish = (fn) => {
        signal.removeEventListener("abort", abort);
        fn();
      };
      img.onload = () => finish(resolve);
      img.onerror = () =>
        finish(() =>
          reject(
            new ImageGenerationError(
              "SVG 참조 이미지를 PNG로 변환하지 못했어요.",
              "invalid_reference",
            ),
          ),
        );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      img.src = objectURL;
    });
    const canvas = document.createElement("canvas");
    const factor = Math.min(
      1,
      2048 / Math.max(img.naturalWidth || 512, img.naturalHeight || 512),
    );
    canvas.width =
      outputSize?.width ||
      Math.max(1, Math.round((img.naturalWidth || 512) * factor));
    canvas.height =
      outputSize?.height ||
      Math.max(1, Math.round((img.naturalHeight || 512) * factor));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!png)
      fail("SVG 참조 이미지를 PNG로 변환하지 못했어요.", "invalid_reference");
    if (signal.aborted) throw abortError();
    return png;
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}
async function referenceBlob(reference, context) {
  let source =
    reference instanceof Blob
      ? reference
      : reference?.blob ||
        reference?.dataUrl ||
        reference?.imageUrl ||
        reference?.url ||
        reference;
  let blob;
  if (source instanceof Blob) blob = source;
  else if (typeof source === "string" && source.startsWith("data:"))
    blob = dataURLBlob(source);
  else if (typeof source === "string") {
    let parsed;
    try {
      parsed = new URL(source, globalThis.location?.href || "http://localhost");
    } catch {
      fail("참조 이미지 주소를 읽지 못했어요.", "invalid_reference");
    }
    if (
      !["http:", "https:", "blob:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      fail("참조 이미지 주소 형식을 확인해 주세요.", "invalid_reference");
    blob = await (await fetchResponse(parsed.href, {}, context)).blob();
  } else fail("참조 이미지 파일이나 주소가 비어 있어요.", "invalid_reference");
  if (!blob.type.startsWith("image/"))
    fail(
      "참조 파일은 PNG·JPEG·WebP 또는 SVG 이미지여야 해요.",
      "invalid_reference",
    );
  if (blob.size > 50 * 1024 * 1024)
    fail("참조 이미지 한 개의 크기는 50MB 이하여야 해요.", "invalid_reference");
  if (blob.type === "image/svg+xml")
    blob = await rasterizeSVG(blob, context.signal);
  if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type))
    fail(
      "이 참조 이미지 형식은 지원하지 않아요. PNG·JPEG·WebP로 다시 업로드해 주세요.",
      "invalid_reference",
    );
  return blob;
}
async function imageResultURL(value, context, config) {
  if (typeof value !== "string" || !value)
    fail("엔진 응답에 생성된 이미지가 없어요.", "missing_image");
  if (value.startsWith("data:")) {
    const blob = dataURLBlob(value);
    if (blob.type === "image/svg+xml")
      fail("엔진이 래스터 이미지 대신 SVG를 반환했어요.", "invalid_response");
    return value;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("엔진이 올바른 이미지 주소를 반환하지 않았어요.", "invalid_response");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    fail("엔진이 올바른 이미지 주소를 반환하지 않았어요.", "invalid_response");
  if (parsed.username || parsed.password)
    fail("엔진 이미지 주소에 인증 정보가 포함되어 있어요.", "invalid_response");
  // BFL output URLs expire after ten minutes. Save pixels immediately, not an
  // expiring remote URL. No provider credential is sent to image hosts.
  if (config.persistResults === false) return parsed.href;
  const blob = await (await fetchResponse(parsed.href, {}, context)).blob();
  if (!blob.type.startsWith("image/") || blob.type === "image/svg+xml")
    fail("엔진의 이미지 파일을 읽지 못했어요.", "invalid_response");
  return blobDataURL(blob, context.signal);
}

function aspectRatio(size) {
  const ratios = [
    "1:1",
    "1:4",
    "1:8",
    "2:3",
    "3:2",
    "3:4",
    "4:1",
    "4:3",
    "4:5",
    "5:4",
    "8:1",
    "9:16",
    "16:9",
    "21:9",
  ];
  return ratios.reduce((closest, ratio) => {
    const [w, h] = ratio.split(":").map(Number);
    const [cw, ch] = closest.split(":").map(Number);
    return Math.abs(Math.log(w / h / (size.width / size.height))) <
      Math.abs(Math.log(cw / ch / (size.width / size.height)))
      ? ratio
      : closest;
  }, "1:1");
}

/**
 * A fully offline option for trying the app without an API key. These original
 * vector templates use saved character settings, not image-model inference.
 * Photos and remote reference pixels are deliberately not fetched or analyzed.
 */
function sampleCharacter(source = {}, prompt = "") {
  const kind = ["child", "adult", "dinosaur", "rabbit"].includes(source.kind)
    ? source.kind
    : /rabbit|토끼/i.test(prompt)
      ? "rabbit"
      : /dinosaur|공룡/i.test(prompt)
        ? "dinosaur"
        : /adult|어른/i.test(prompt)
          ? "adult"
          : "child";
  const pickColor = (value, label, fallback) => {
    if (/^#[\da-f]{6}$/i.test(String(value))) return value;
    return (
      prompt.match(new RegExp(`${label}\\s+(#[\\da-f]{6})`, "i"))?.[1] ||
      fallback
    );
  };
  return {
    id: String(source.id || "sample-character"),
    name: String(source.name || "이야기 친구"),
    kind,
    color: pickColor(source.color, "body/clothing color", "#ddb07b"),
    hairColor: pickColor(source.hairColor, "hair color", "#60584d"),
    skinColor: pickColor(source.skinColor, "skin color", "#edc8a9"),
  };
}

async function sampleAdapter(request, config, context) {
  if (context.signal.aborted) throw abortError();
  const sampleContext = request.sampleContext || {};
  if (
    request.photoToCharacter ||
    request.source === "photo" ||
    sampleContext.kind === "photo"
  )
    fail(
      "무료 샘플은 사진을 캐릭터로 변환하지 않아요. 사진을 참조할 수 있는 AI 엔진을 선택해 주세요.",
      "photo_not_supported",
    );
  const isSheet =
    sampleContext.kind === "sheet" ||
    /character (?:reference )?sheet/i.test(request.prompt);
  const characters = (
    Array.isArray(sampleContext.characters)
      ? sampleContext.characters
      : [sampleContext.character || {}]
  ).map((character) => sampleCharacter(character || {}, request.prompt));
  if (!characters.length) characters.push(sampleCharacter({}, request.prompt));
  const paper = /^#[\da-f]{6}$/i.test(request.stylePreset.palette?.[0])
    ? request.stylePreset.palette[0]
    : "#f5eedc";
  let svg;
  if (isSheet) {
    const panels = [0, 1, 2, 4].map((variation, index) =>
      characterSVG(characters[0], request.seed + variation).replace(
        /^<svg\b[^>]*>/,
        `<svg x="${(index % 2) * 420}" y="${Math.floor(index / 2) * 420}" width="420" height="420" viewBox="0 0 420 420">`,
      ),
    );
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 840" width="${request.size.width}" height="${request.size.height}"><rect width="840" height="840" fill="${paper}"/>${panels.join("")}</svg>`;
  } else {
    // The application supplies a saved scene. The public interface also works
    // without application state, using a small theme selected from the prompt.
    svg = sceneSVG(
      sampleContext.scene || request.prompt,
      characters,
      request.seed,
    )
      .replace(
        /\bwidth="800" height="580"/,
        `width="${request.size.width}" height="${request.size.height}"`,
      )
      .replace(/fill="#eae9d9"/g, `fill="${paper}"`);
  }
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const imageUrl =
    typeof document !== "undefined" && typeof Image !== "undefined"
      ? await blobDataURL(
          await rasterizeSVG(blob, context.signal, request.size),
          context.signal,
        )
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return {
    imageUrl,
    seed: request.seed,
    model: ENGINE_METADATA.sample.model,
    qualitySupported: false,
    generationMode: "offline-template",
    photoToCharacter: false,
    referenceImagesUsed: false,
    sampleNote:
      "기기 안의 그림 템플릿과 저장된 캐릭터 설정을 사용했어요. AI 생성·사진 변환은 지원하지 않으며 참조 이미지의 픽셀과 자유로운 화풍 설명을 분석하지 않아요.",
  };
}

async function googleAdapter(request, config, context, blobs) {
  const model = getEngineModel("google", request.quality, config);
  const base = endpoint(
    config,
    "https://generativelanguage.googleapis.com/v1beta",
  );
  const parts = [{ text: request.composedPrompt }];
  for (const blob of blobs) {
    const dataURL = await blobDataURL(blob, context.signal);
    parts.push({
      inlineData: {
        mimeType: blob.type,
        data: dataURL.slice(dataURL.indexOf(",") + 1),
      },
    });
  }
  const dimension = Math.max(request.size.width, request.size.height);
  const imageSize =
    model === ENGINE_MODELS.google.draft
      ? "1K"
      : dimension > 2048
        ? "4K"
        : dimension > 1024
          ? "2K"
          : "1K";
  // Gemini accepts a best-effort sampling seed, but does not expose the seed
  // actually used for generated pixels. Keep effective image seed unconfirmed.
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      seed: request.seed,
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: aspectRatio(request.size), imageSize },
    },
  };
  const result = await fetchJSON(
    `${base}/models/${model}:generateContent`,
    jsonOptions(body, { "x-goog-api-key": apiKey(config) }),
    context,
  );
  const image = result.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    .find(
      (part) =>
        !part.thought &&
        ((part.inlineData || part.inline_data)?.mimeType?.startsWith(
          "image/",
        ) ||
          (part.inlineData || part.inline_data)?.mime_type?.startsWith(
            "image/",
          )),
    );
  const data = image?.inlineData || image?.inline_data;
  if (!data?.data)
    fail(
      "Google이 이미지 결과를 반환하지 않았어요. 설명과 참조 이미지를 확인해 다시 시도해 주세요.",
      "missing_image",
    );
  return {
    imageUrl: `data:${data.mimeType || data.mime_type};base64,${data.data}`,
    seed: null,
    model,
    costUsd: billedCost(result),
    providerSize: {
      aspectRatio: body.generationConfig.imageConfig.aspectRatio,
      imageSize,
    },
    qualitySupported: false,
  };
}
async function openaiAdapter(request, config, context, blobs) {
  const model = getEngineModel("openai", request.quality, config);
  const base = endpoint(config, "https://api.openai.com/v1");
  const quality =
    request.quality === "draft"
      ? "low"
      : request.quality === "final"
        ? "high"
        : ["low", "medium", "high", "auto"].includes(request.quality)
          ? request.quality
          : "medium";
  const size = request.size.automatic
    ? "auto"
    : `${request.size.width}x${request.size.height}`;
  if (
    !request.size.automatic &&
    (request.size.width % 16 ||
      request.size.height % 16 ||
      request.size.width / request.size.height < 1 / 3 ||
      request.size.width / request.size.height > 3)
  )
    fail(
      "OpenAI 이미지 크기는 16의 배수여야 하며 가로·세로 비율은 1:3~3:1이어야 해요.",
      "invalid_size",
    );
  const headers = { Authorization: `Bearer ${apiKey(config)}` };
  let options;
  if (blobs.length) {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", request.composedPrompt);
    form.set("n", "1");
    form.set("size", size);
    form.set("quality", quality);
    form.set("output_format", "png");
    blobs.forEach((blob, index) =>
      form.append(
        "image[]",
        blob,
        `reference-${index}.${blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1]}`,
      ),
    );
    options = { method: "POST", headers, body: form };
  } else
    options = jsonOptions(
      {
        model,
        prompt: request.composedPrompt,
        n: 1,
        size,
        quality,
        output_format: "png",
      },
      headers,
    );
  const result = await fetchJSON(
    `${base}/images/${blobs.length ? "edits" : "generations"}`,
    options,
    context,
  );
  const image = result.data?.[0];
  if (!image?.b64_json && !image?.url)
    fail("OpenAI 응답에 생성된 이미지가 없어요.", "missing_image");
  return {
    imageUrl: image.b64_json
      ? `data:image/${result.output_format || "png"};base64,${image.b64_json}`
      : image.url,
    seed: null,
    model,
    costUsd: billedCost(result),
    providerSize: result.size || size,
    qualitySupported: true,
    effectiveQuality: result.quality || quality,
  };
}
async function bflAdapter(request, config, context, blobs) {
  const model = getEngineModel("bfl", request.quality, config);
  const base = endpoint(config, "https://api.bfl.ai/v1");
  const headers = { "x-key": apiKey(config), accept: "application/json" };
  const factor =
    request.quality === "draft"
      ? Math.min(1, 1024 / Math.max(request.size.width, request.size.height))
      : 1;
  const width = Math.max(
    64,
    Math.round((request.size.width * factor) / 16) * 16,
  );
  const height = Math.max(
    64,
    Math.round((request.size.height * factor) / 16) * 16,
  );
  const body = {
    prompt: request.composedPrompt,
    seed: request.seed,
    width,
    height,
    output_format: "png",
  };
  for (let index = 0; index < blobs.length; index++) {
    const dataURL = await blobDataURL(blobs[index], context.signal);
    body[index ? `input_image_${index + 1}` : "input_image"] = dataURL.slice(
      dataURL.indexOf(",") + 1,
    );
  }
  const job = await fetchJSON(
    `${base}/${model}`,
    jsonOptions(body, headers),
    context,
  );
  if (!job.id || !job.polling_url)
    fail("BFL이 작업 주소를 반환하지 않았어요.", "invalid_response");
  const pollingURL = trustedResultURL(job.polling_url, base, "bfl");
  while (true) {
    await delay(context.interval, context.signal);
    const result = await fetchJSON(pollingURL, { headers }, context);
    if (result.status === "Ready")
      return {
        imageUrl: result.result?.sample,
        seed: Number.isSafeInteger(result.result?.seed)
          ? result.result.seed
          : request.seed,
        model,
        costUsd: billedCost(result),
        requestId: job.id,
        qualitySupported: false,
        providerSize: { width, height },
      };
    if (
      [
        "Error",
        "Failed",
        "Request Moderated",
        "Content Moderated",
        "Task not found",
      ].includes(result.status)
    )
      fail(
        "BFL 이미지 생성이 완료되지 않았어요. 설명과 모델 사용량을 확인해 주세요.",
        "generation_failed",
      );
  }
}
async function falAdapter(request, config, context, blobs) {
  const base = endpoint(config, "https://queue.fal.run");
  const model = `${getEngineModel("fal", request.quality, config)}/${blobs.length ? "edit" : "text-to-image"}`;
  const headers = { Authorization: `Key ${apiKey(config)}` };
  const body = {
    prompt: request.composedPrompt,
    image_size: request.size.automatic
      ? "auto_2K"
      : { width: request.size.width, height: request.size.height },
    num_images: 1,
    output_format: "png",
  };
  if (blobs.length)
    body.image_urls = await Promise.all(
      blobs.map((blob) => blobDataURL(blob, context.signal)),
    );
  const job = await fetchJSON(
    `${base}/${model}`,
    jsonOptions(body, headers),
    context,
  );
  if (!job.request_id || !job.status_url || !job.response_url)
    fail("fal이 작업 주소를 반환하지 않았어요.", "invalid_response");
  const statusURL = trustedResultURL(job.status_url, base, "fal");
  const responseURL = trustedResultURL(job.response_url, base, "fal");
  while (true) {
    await delay(context.interval, context.signal);
    const status = await fetchJSON(statusURL, { headers }, context);
    if (status.status === "COMPLETED") {
      const result = await fetchJSON(responseURL, { headers }, context);
      return {
        imageUrl: result.images?.[0]?.url,
        seed: Number.isSafeInteger(result.seed) ? result.seed : null,
        model,
        costUsd: billedCost(result),
        requestId: job.request_id,
        qualitySupported: false,
      };
    }
    if (["FAILED", "ERROR", "CANCELLED"].includes(status.status))
      fail(
        "fal 이미지 생성이 완료되지 않았어요. 설명과 모델 사용량을 확인해 주세요.",
        "generation_failed",
      );
  }
}

/** Replace only explicit API workflow inputs, retaining numeric/array types. */
export function prepareComfyWorkflow(
  template,
  request,
  filenames,
  bindings = {},
  options = {},
) {
  let source;
  try {
    source =
      typeof template === "string"
        ? JSON.parse(template)
        : JSON.parse(JSON.stringify(template));
  } catch {
    fail(
      "ComfyUI 워크플로는 API 형식 JSON으로 입력해 주세요.",
      "invalid_workflow",
    );
  }
  if (source?.prompt && typeof source.prompt === "object")
    source = source.prompt;
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    !Object.values(source).every((node) => node?.class_type && node?.inputs)
  )
    fail(
      "ComfyUI에서 내보낸 API 형식 워크플로를 입력해 주세요.",
      "invalid_workflow",
    );
  const used = {
    prompt: false,
    seed: false,
    references: new Set(),
    nodes: new Set(),
  };
  const values = {
    prompt: request.composedPrompt || request.prompt,
    negativePrompt: request.stylePreset?.negativePrompt || "",
    seed: request.seed,
    width: request.size.width,
    height: request.size.height,
    quality: request.quality,
  };
  function replace(value, nodeId) {
    if (typeof value === "string") {
      const exact = value.match(
        /^\{\{(prompt|negativePrompt|seed|width|height|quality|referenceImages|referenceImage:(\d+))\}\}$/,
      );
      if (exact) {
        const token = exact[1];
        if (token === "referenceImages") {
          filenames.forEach((_, index) => used.references.add(index));
          if (filenames.length) used.nodes.add(nodeId);
          return [...filenames];
        }
        if (exact[2] !== undefined) {
          const index = Number(exact[2]);
          if (filenames[index] === undefined)
            fail(
              "ComfyUI 워크플로의 참조 이미지 자리 수와 요청의 이미지 수가 달라요.",
              "invalid_workflow",
            );
          used.references.add(index);
          used.nodes.add(nodeId);
          return filenames[index];
        }
        if (token === "prompt" || token === "seed") {
          used[token] = true;
          used.nodes.add(nodeId);
        }
        return values[token];
      }
      return value.replace(/\{\{(prompt|negativePrompt)\}\}/g, (_, token) => {
        if (token === "prompt") {
          used.prompt = true;
          used.nodes.add(nodeId);
        }
        return values[token];
      });
    }
    if (Array.isArray(value))
      return value.map((child) => replace(child, nodeId));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          replace(child, nodeId),
        ]),
      );
    return value;
  }
  const workflow = Object.fromEntries(
    Object.entries(source).map(([nodeId, node]) => [
      nodeId,
      replace(node, nodeId),
    ]),
  );
  function bind(slot, value) {
    const nodeId = String(slot.nodeId ?? slot.node ?? "");
    const input = slot.input || slot.field;
    if (
      !workflow[nodeId]?.inputs ||
      !input ||
      !(input in workflow[nodeId].inputs)
    )
      fail(
        "ComfyUI 입력 연결의 노드 번호와 입력 이름을 확인해 주세요.",
        "invalid_workflow",
      );
    workflow[nodeId].inputs[input] = value;
    return nodeId;
  }
  for (const token of [
    "prompt",
    "negativePrompt",
    "seed",
    "width",
    "height",
    "quality",
  ]) {
    const slots = Array.isArray(bindings[token])
      ? bindings[token]
      : bindings[token]
        ? [bindings[token]]
        : [];
    slots.forEach((slot) => {
      const nodeId = bind(slot, values[token]);
      if (token === "prompt" || token === "seed") used.nodes.add(nodeId);
    });
    if (slots.length && (token === "prompt" || token === "seed"))
      used[token] = true;
  }
  const refSlots = bindings.referenceImages || [];
  if (!Array.isArray(refSlots))
    fail("ComfyUI 참조 이미지 연결은 배열이어야 해요.", "invalid_workflow");
  refSlots.forEach((slot, index) => {
    if (filenames[index] === undefined)
      fail(
        "ComfyUI 참조 이미지 입력 연결 수가 요청의 이미지 수와 달라요.",
        "invalid_workflow",
      );
    used.nodes.add(bind(slot, filenames[index]));
    used.references.add(index);
  });
  if (!used.prompt || !used.seed)
    fail(
      "ComfyUI 워크플로에는 {{prompt}}와 {{seed}} 입력 또는 해당 입력 연결이 필요해요.",
      "invalid_workflow",
    );
  if (used.references.size !== filenames.length)
    fail(
      "ComfyUI 워크플로에 모든 참조 이미지를 연결해 주세요. {{referenceImage:0}}부터 순서대로 지정하거나 {{referenceImages}} 배열을 사용하세요.",
      "unbound_references",
    );
  const outputNodes = options.outputNodeId
    ? [String(options.outputNodeId)]
    : Object.keys(workflow).filter((nodeId) =>
        /^(SaveImage|PreviewImage)$/.test(workflow[nodeId].class_type),
      );
  if (!outputNodes.length || outputNodes.some((nodeId) => !workflow[nodeId]))
    fail(
      "ComfyUI 워크플로에 SaveImage 또는 PreviewImage 출력 노드를 연결해 주세요.",
      "invalid_workflow",
    );
  const reachable = new Set();
  function visit(nodeId) {
    if (reachable.has(nodeId) || !workflow[nodeId]) return;
    reachable.add(nodeId);
    function links(value) {
      if (Array.isArray(value)) {
        if (
          value.length === 2 &&
          typeof value[1] === "number" &&
          workflow[String(value[0])]
        )
          visit(String(value[0]));
        else value.forEach(links);
      } else if (value && typeof value === "object")
        Object.values(value).forEach(links);
    }
    links(workflow[nodeId].inputs);
  }
  outputNodes.forEach(visit);
  if ([...used.nodes].some((nodeId) => !reachable.has(nodeId)))
    fail(
      "ComfyUI의 프롬프트·시드·참조 이미지 입력을 실제 이미지 출력 노드까지 연결해 주세요.",
      "unconnected_inputs",
    );
  return workflow;
}
async function localAdapter(request, config, context, blobs) {
  if (!config.workflow)
    fail(
      "부모 설정에 ComfyUI API 워크플로를 입력해 주세요. 캐릭터 시트와 스타일 참조 입력을 연결해야 해요.",
      "missing_workflow",
    );
  const base = endpoint(config, "http://127.0.0.1:8188");
  const headers = config.apiKey
    ? { Authorization: `Bearer ${config.apiKey}` }
    : {};
  // Check placeholder completeness before uploading any files to the local server.
  prepareComfyWorkflow(
    config.workflow,
    request,
    blobs.map((_, index) => `reference-${index}.png`),
    config.workflowBindings,
    config,
  );
  const filenames = [];
  for (let index = 0; index < blobs.length; index++) {
    const form = new FormData();
    form.set(
      "image",
      blobs[index],
      `donghwa-ref-${globalThis.crypto?.randomUUID?.() || Date.now()}-${index}.${blobs[index].type === "image/jpeg" ? "jpg" : blobs[index].type.split("/")[1]}`,
    );
    form.set("type", "input");
    form.set("overwrite", "false");
    const uploaded = await fetchJSON(
      `${base}/upload/image`,
      { method: "POST", headers, body: form },
      context,
    );
    if (!uploaded.name)
      fail(
        "ComfyUI 참조 이미지 업로드가 완료되지 않았어요.",
        "invalid_response",
      );
    filenames.push(
      uploaded.subfolder
        ? `${uploaded.subfolder}/${uploaded.name}`
        : uploaded.name,
    );
  }
  const workflow = prepareComfyWorkflow(
    config.workflow,
    request,
    filenames,
    config.workflowBindings,
    config,
  );
  const clientId =
    globalThis.crypto?.randomUUID?.() ||
    `donghwa-${Date.now()}-${randomSeed()}`;
  const job = await fetchJSON(
    `${base}/prompt`,
    jsonOptions({ prompt: workflow, client_id: clientId }, headers),
    context,
  );
  if (!job.prompt_id || Object.keys(job.node_errors || {}).length)
    fail(
      "ComfyUI 워크플로 입력을 검증하지 못했어요. 설치된 노드와 모델을 확인해 주세요.",
      "invalid_workflow",
    );
  while (true) {
    await delay(context.interval, context.signal);
    const result = await fetchJSON(
      `${base}/history/${encodeURIComponent(job.prompt_id)}`,
      { headers },
      context,
    );
    const history = result[job.prompt_id];
    if (!history) continue;
    if (
      history.status?.status_str === "error" ||
      history.status?.messages?.some(
        (message) => message[0] === "execution_error",
      )
    )
      fail(
        "ComfyUI 워크플로 실행 중 오류가 생겼어요. 로컬 서버에서 노드와 모델 설정을 확인해 주세요.",
        "generation_failed",
      );
    const outputs = config.outputNodeId
      ? [history.outputs?.[config.outputNodeId]]
      : Object.values(history.outputs || {});
    const image = outputs.find((output) => output?.images?.length)?.images?.[0];
    if (image?.filename) {
      const query = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder || "",
        type: image.type || "output",
      });
      const blob = await (
        await fetchResponse(`${base}/view?${query}`, { headers }, context)
      ).blob();
      if (!blob.type.startsWith("image/"))
        fail("ComfyUI 생성 이미지 파일을 읽지 못했어요.", "invalid_response");
      return {
        imageUrl: await blobDataURL(blob, context.signal),
        seed: request.seed,
        model: "ComfyUI workflow",
        requestId: job.prompt_id,
        qualitySupported: false,
      };
    }
    if (history.status?.completed)
      fail(
        "ComfyUI 워크플로가 이미지를 저장하지 않았어요. SaveImage 출력 노드를 연결해 주세요.",
        "missing_image",
      );
  }
}

const adapters = {
  sample: sampleAdapter,
  google: googleAdapter,
  openai: openaiAdapter,
  bfl: bflAdapter,
  fal: falAdapter,
  local: localAdapter,
};

/** A configured proxy receives pixels and rendering settings, never browser API keys. */
async function proxyAdapter(engine, request, config, context, blobs) {
  const base = endpoint(
    { endpoint: config.proxyEndpoint },
    globalThis.location?.origin || "http://127.0.0.1:8787",
  );
  const referenceImages = await Promise.all(
    blobs.map(async (blob, index) => ({
      dataUrl: await blobDataURL(blob, context.signal),
      role: request.referenceImages[index]?.role || null,
      label: request.referenceImages[index]?.label || null,
      ...(request.referenceImages[index]?.required !== undefined
        ? { required: request.referenceImages[index].required }
        : {}),
    })),
  );
  const body = {
    scenePrompt: request.scenePrompt,
    stylePrompt: request.stylePrompt,
    negativePrompt: request.negativePrompt,
    stylePreset: {
      id: request.stylePreset.id,
      name: request.stylePreset.name,
      palette: request.stylePreset.palette,
    },
    referenceImages,
    seed: request.seed,
    size: { width: request.size.width, height: request.size.height },
    quality: request.quality,
    modelVariant: config.modelVariant,
    googlePro: config.googlePro === true,
  };
  const result = await fetchJSON(
    `${base}/api/image/${engine}`,
    jsonOptions(body),
    context,
  );
  if (!result.imageUrl || typeof result.model !== "string")
    fail("이미지 프록시 응답 형식을 확인해 주세요.", "invalid_response");
  return {
    imageUrl: result.imageUrl,
    seed: Number.isSafeInteger(result.seed) ? result.seed : null,
    model: result.model,
    costUsd: billedCost(result),
    qualitySupported: !!result.meta?.qualitySupported,
    providerSize: result.meta?.providerSize,
    effectiveQuality: result.meta?.effectiveQuality,
    requestId: result.meta?.requestId,
  };
}

export function imageEngineCapabilities(engine) {
  const metadata = ENGINE_METADATA[engine];
  if (!metadata)
    fail("지원하는 이미지 엔진을 선택해 주세요.", "invalid_engine");
  return {
    maxReferenceImages: metadata.referenceLimit || Infinity,
    supportsSeed: metadata.seedSupported,
    supportsNegative: engine === "local",
  };
}

/** New Blob interface, backed by the same adapters as the original imageUrl API. */
export function createImageEngine({ engine, config = {} } = {}) {
  const generate = createImageGenerator({ engine, config });
  return Object.freeze({
    id: engine,
    capabilities: () => imageEngineCapabilities(engine),
    async generate(request) {
      const result = await generate(request);
      const imageBlob = result.imageUrl.startsWith("data:")
        ? dataURLBlob(result.imageUrl)
        : await (
            await (config.fetch || globalThis.fetch)(result.imageUrl)
          ).blob();
      return {
        imageBlob,
        seed: result.seed ?? result.meta.requestedSeed,
        engineId: engine,
        model: result.meta.model,
        ...(result.meta.costUsd !== undefined
          ? { costUsd: result.meta.costUsd }
          : {}),
        metadata: result.meta,
      };
    },
  });
}

export function createImageGenerator({ engine, config = {} } = {}) {
  if (!ENGINE_IDS.includes(engine))
    fail("지원하는 이미지 엔진을 선택해 주세요.", "invalid_engine");
  // Keep an in-memory snapshot; callers own encryption and persistence.
  const runtimeConfig = { ...config };
  return (request) => generateImage(request, { engine, config: runtimeConfig });
}

export async function generateImage(request, { engine, config = {} } = {}) {
  const metadata = ENGINE_METADATA[engine];
  if (!metadata)
    fail("지원하는 이미지 엔진을 선택해 주세요.", "invalid_engine");
  const normalized = normalizeRequest(request, metadata);
  const useProxy = config.transport === "proxy" || !!config.proxyEndpoint;
  if (metadata.requiresKey && !useProxy) {
    const credential = apiKey(config);
    try {
      validateCredentialInput(engine, credential);
    } catch (error) {
      fail(error.message, "invalid_key_input");
    }
  }
  const context = requestContext(config, request.signal);
  context.engine = engine;
  context.useProxy = useProxy;
  const startedAt = Date.now();
  try {
    const blobs =
      engine === "sample"
        ? []
        : await Promise.all(
            normalized.referenceImages.map((reference) =>
              referenceBlob(reference, context),
            ),
          );
    const result =
      useProxy && engine !== "sample"
        ? await proxyAdapter(engine, normalized, config, context, blobs)
        : await adapters[engine](normalized, config, context, blobs);
    // Only our own offline SVG can bypass provider result validation. In a
    // browser it has already been rasterized to PNG before it reaches storage.
    const imageUrl =
      engine === "sample"
        ? result.imageUrl
        : await imageResultURL(result.imageUrl, context, config);
    return {
      imageUrl,
      seed: result.seed,
      meta: {
        provider: engine,
        engine,
        model: result.model,
        requestedSeed: normalized.seed,
        seedSupported: metadata.seedSupported,
        prompt: normalized.prompt,
        composedPrompt: normalized.composedPrompt,
        stylePreset:
          normalized.stylePreset.id || normalized.stylePreset.name || null,
        referenceCount: normalized.referenceImages.length,
        referenceMetadata: normalized.referenceMetadata,
        originalReferenceCount: normalized.originalReferenceCount,
        droppedReferenceCount: normalized.droppedReferenceCount,
        size: { width: normalized.size.width, height: normalized.size.height },
        quality: normalized.quality,
        qualitySupported: result.qualitySupported,
        costUsdEstimated: estimateImageCost({
          engine,
          quality: normalized.quality,
          size: normalized.size,
          config,
        }).costUsd,
        costEstimate: estimateImageCost({
          engine,
          quality: normalized.quality,
          size: normalized.size,
          config,
        }),
        ...(result.costUsd !== undefined
          ? { costUsd: result.costUsd, costSource: "provider-response" }
          : {}),
        transport: useProxy ? "proxy" : "direct",
        ...(result.providerSize ? { providerSize: result.providerSize } : {}),
        ...(result.effectiveQuality
          ? { effectiveQuality: result.effectiveQuality }
          : {}),
        ...(result.requestId ? { requestId: result.requestId } : {}),
        ...(result.generationMode
          ? {
              generationMode: result.generationMode,
              photoToCharacter: result.photoToCharacter,
              referenceImagesUsed: result.referenceImagesUsed,
              sampleNote: result.sampleNote,
              cost: "free",
            }
          : {}),
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        ...(!metadata.seedSupported
          ? {
              seedNote:
                "이 이미지 API는 실제 사용된 이미지 시드를 반환하지 않아 요청 시드만 기록합니다.",
            }
          : {}),
      },
    };
  } catch (error) {
    if (context.wasTimeout())
      fail(
        "이미지 생성 대기 시간을 초과했어요. 엔진 작업 상태를 확인한 뒤 다시 시도해 주세요.",
        "timeout",
      );
    if (context.signal.aborted) throw abortError();
    if (error instanceof ImageGenerationError) throw error;
    fail(
      "이미지 요청을 처리하지 못했어요. 엔진 설정과 참조 이미지 형식을 확인해 주세요.",
      "generation_failed",
    );
  } finally {
    context.cleanup();
  }
}
