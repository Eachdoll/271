import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { generateImage } from "../dist/image-generation/providers.js";
import { translateWardrobeWithGoogle } from "../dist/wardrobe-translation.js";
import { createTextEngine } from "../dist/text-generation/providers.js";
import { isModelId, listTextModels } from "../dist/text-generation/models.js";
import {
  fetchProviderModels,
  supportsModelList,
} from "../dist/text-generation/model-list.js";

const KEY_ENV = Object.freeze({
  google: "GOOGLE_IMAGE_API_KEY",
  openai: "OPENAI_API_KEY",
  bfl: "BFL_API_KEY",
  fal: "FAL_KEY",
  local: "COMFYUI_API_KEY",
});
const ENDPOINT_ENV = Object.freeze({
  google: "GOOGLE_IMAGE_ENDPOINT",
  openai: "OPENAI_IMAGE_ENDPOINT",
  bfl: "BFL_IMAGE_ENDPOINT",
  fal: "FAL_IMAGE_ENDPOINT",
  local: "COMFYUI_BASE_URL",
});

const TEXT_KEY_ENV = Object.freeze({
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_IMAGE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
});
const TEXT_BASE_ENV = Object.freeze({
  openai: "OPENAI_TEXT_ENDPOINT",
  google: "GOOGLE_TEXT_ENDPOINT",
  anthropic: "ANTHROPIC_TEXT_ENDPOINT",
  local: "LOCAL_TEXT_BASE_URL",
});
function proxyError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function originsFromEnv(env) {
  return new Set(
    String(
      env.IMAGE_PROXY_ALLOWED_ORIGINS ||
        "http://127.0.0.1:8080,http://localhost:8080",
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}
function rejectCredentials(value, depth = 0) {
  if (depth > 32)
    throw proxyError(
      413,
      "요청 구조가 너무 깊어요. 참조와 설정을 줄여 주세요.",
    );
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(apiKey|api_key|key|token|authorization|password|pin)$/i.test(key))
      throw proxyError(
        400,
        "프록시 요청에 인증 정보를 넣을 수 없어요. 서버 환경변수에만 설정해 주세요.",
      );
    rejectCredentials(child, depth + 1);
  }
}
async function readBody(request, limit) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")
  )
    throw proxyError(415, "JSON 요청만 받을 수 있어요.");
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit)
      throw proxyError(
        413,
        "참조 이미지 요청이 너무 커요. 이미지 크기를 줄여 주세요.",
      );
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw proxyError(400, "요청 JSON을 읽을 수 없어요.");
  }
}
function respond(response, status, payload, origin, methods = "POST, OPTIONS") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = methods;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  response.writeHead(status, headers);
  response.end(status === 204 ? "" : JSON.stringify(payload));
}

/** Loopback service. Credentials are read exclusively from its environment. */
export function createImageProxyHandler({
  env = process.env,
  generate = generateImage,
  translate = translateWardrobeWithGoogle,
  textEngineFactory = createTextEngine,
  listModels = fetchProviderModels,
  maxBodyBytes = 70 * 1024 * 1024,
} = {}) {
  const allowedOrigins = originsFromEnv(env);
  return async (request, response) => {
    let origin;
    try {
      const claimedOrigin = request.headers.origin;
      if (claimedOrigin && !allowedOrigins.has(claimedOrigin))
        throw proxyError(403, "이 앱 주소의 프록시 접근이 허용되지 않았어요.");
      origin = claimedOrigin;
      const path = new URL(request.url, "http://localhost").pathname;
      const match = path.match(/^\/api\/image\/(google|openai|bfl|fal|local)$/);
      const translation = path === "/api/translate/wardrobe/google";
      const textMatch = path.match(
        /^\/api\/text\/(openai|google|anthropic|local)$/,
      );
      // R13 '모델 목록 불러오기' through the proxy: a free GET list call made
      // with the server's own key. Only model IDs and names come back.
      const modelsMatch = path.match(
        /^\/api\/models\/(text|image)\/(openai|google|anthropic|local)$/,
      );
      if (!match && !translation && !textMatch && !modelsMatch)
        throw proxyError(404, "엔진 주소를 확인해 주세요.");
      if (modelsMatch) {
        if (request.method === "OPTIONS") {
          respond(response, 204, null, origin, "GET, OPTIONS");
          return;
        }
        if (request.method !== "GET")
          throw proxyError(405, "모델 목록은 GET 요청으로만 받을 수 있어요.");
        if (!claimedOrigin) {
          const supplied = String(request.headers["x-image-proxy-token"] || ""),
            expected = String(env.IMAGE_PROXY_TOKEN || "");
          if (
            !expected ||
            supplied.length !== expected.length ||
            supplied.length > 1024 ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
          )
            throw proxyError(
              403,
              "Origin 헤더 또는 서버 프록시 토큰이 필요해요.",
            );
        }
        const [, kind, engine] = modelsMatch;
        if (!supportsModelList(kind, engine))
          throw proxyError(
            404,
            "이 공급자는 모델 목록을 제공하지 않아요. 모델 ID를 직접 입력해 주세요.",
          );
        const config =
          kind === "text"
            ? {
                apiKey: env[TEXT_KEY_ENV[engine]] || undefined,
                ...(env[TEXT_BASE_ENV[engine]]
                  ? { baseUrl: env[TEXT_BASE_ENV[engine]] }
                  : engine === "local"
                    ? { baseUrl: "http://127.0.0.1:1234/v1" }
                    : {}),
              }
            : {
                apiKey: env[KEY_ENV[engine]] || undefined,
                ...(env[ENDPOINT_ENV[engine]]
                  ? { endpoint: env[ENDPOINT_ENV[engine]] }
                  : {}),
              };
        if (engine !== "local" && !config.apiKey)
          throw proxyError(
            503,
            "서버 환경변수에 이 공급자의 API 키를 설정해 주세요.",
          );
        const controller = new AbortController(),
          close = () => {
            if (!response.writableEnded) controller.abort();
          };
        response.once("close", close);
        try {
          const list = await listModels({
            kind,
            engine,
            config,
            signal: controller.signal,
          });
          if (!response.destroyed)
            respond(
              response,
              200,
              { fetchedAt: list.fetchedAt, models: list.models },
              origin,
              "GET, OPTIONS",
            );
        } finally {
          response.removeListener("close", close);
        }
        return;
      }
      if (request.method === "OPTIONS") {
        respond(response, 204, null, origin);
        return;
      }
      if (request.method !== "POST")
        throw proxyError(405, "POST 이미지 요청만 받을 수 있어요.");
      if (!claimedOrigin) {
        const supplied = String(request.headers["x-image-proxy-token"] || ""),
          expected = String(env.IMAGE_PROXY_TOKEN || "");
        if (
          !expected ||
          supplied.length !== expected.length ||
          supplied.length > 1024 ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
        )
          throw proxyError(
            403,
            "Origin 헤더 또는 서버 프록시 토큰이 필요해요.",
          );
      }
      const engine = textMatch
        ? textMatch[1]
        : translation
          ? "google"
          : match[1];
      const payload = await readBody(
        request,
        textMatch ? 1024 * 1024 : translation ? 4096 : maxBodyBytes,
      );
      rejectCredentials(payload);
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw proxyError(400, "이미지 요청 형식이 올바르지 않아요.");
      if (textMatch) {
        if (
          Object.keys(payload).some(
            (key) =>
              ![
                "system",
                "user",
                "jsonSchema",
                "temperature",
                "maxTokens",
                "model",
              ].includes(key),
          ) ||
          typeof payload.system !== "string" ||
          typeof payload.user !== "string" ||
          payload.system.length + payload.user.length > 300000
        )
          throw proxyError(400, "글 생성 입력 형식을 확인해 주세요.");
        const keys = {
          openai: "OPENAI_API_KEY",
          google: "GOOGLE_IMAGE_API_KEY",
          anthropic: "ANTHROPIC_API_KEY",
        };
        const base = {
          openai: env.OPENAI_TEXT_ENDPOINT,
          google: env.GOOGLE_TEXT_ENDPOINT,
          anthropic: env.ANTHROPIC_TEXT_ENDPOINT,
          local: env.LOCAL_TEXT_BASE_URL || "http://127.0.0.1:1234/v1",
        };
        if (engine !== "local" && !env[keys[engine]])
          throw proxyError(
            503,
            "서버 환경변수에 글 엔진의 API 키를 설정해 주세요.",
          );
        const controller = new AbortController(),
          close = () => {
            if (!response.writableEnded) controller.abort();
          };
        response.once("close", close);
        // R13: a fetched or typed model outside the catalog is registered for
        // this one request so the shared engine sends it (conservative shape);
        // catalog models and requests without a model are unchanged.
        const outside =
          engine !== "local" &&
          isModelId(payload.model) &&
          !listTextModels(engine).some((row) => row.id === payload.model);
        try {
          const adapter = textEngineFactory({
            engine,
            config: {
              ...(engine === "local" ? {} : { apiKey: env[keys[engine]] }),
              ...(base[engine] ? { baseUrl: base[engine] } : {}),
              ...((
                engine === "local"
                  ? env.LOCAL_TEXT_MODEL || payload.model
                  : payload.model
              )
                ? {
                    model:
                      engine === "local"
                        ? env.LOCAL_TEXT_MODEL || payload.model
                        : payload.model,
                  }
                : {}),
              ...(outside ? { customModels: [payload.model.trim()] } : {}),
            },
          });
          const result = await adapter.complete({
            ...payload,
            signal: controller.signal,
          });
          if (!response.destroyed) respond(response, 200, result, origin);
        } finally {
          response.removeListener("close", close);
        }
        return;
      }
      if (translation) {
        if (
          Object.keys(payload).some((key) => key !== "description") ||
          typeof payload.description !== "string" ||
          !payload.description.trim() ||
          payload.description.length > 500
        )
          throw proxyError(
            400,
            "옷·소품·머리 설명을 500자 이하로 보내 주세요.",
          );
        if (!env.GOOGLE_IMAGE_API_KEY)
          throw proxyError(
            503,
            "서버 환경변수에 Google API 키를 설정해 주세요.",
          );
        const controller = new AbortController();
        const close = () => {
          if (!response.writableEnded) controller.abort();
        };
        response.once("close", close);
        try {
          const result = await translate(payload.description, {
            config: {
              apiKey: env.GOOGLE_IMAGE_API_KEY,
              ...(env.GOOGLE_IMAGE_ENDPOINT
                ? { endpoint: env.GOOGLE_IMAGE_ENDPOINT }
                : {}),
            },
            signal: controller.signal,
            approved: true,
          });
          if (!response.destroyed) respond(response, 200, result, origin);
        } finally {
          response.removeListener("close", close);
        }
        return;
      }
      const references = payload.referenceImages || [];
      if (
        !Array.isArray(references) ||
        references.length > 30 ||
        references.some(
          (ref) =>
            typeof ref?.dataUrl !== "string" ||
            !/^data:image\/(png|jpeg|webp);base64,/.test(ref.dataUrl),
        )
      )
        throw proxyError(
          400,
          "참조 이미지는 PNG·JPEG·WebP 데이터로 보내 주세요.",
        );
      const config = {
        apiKey: env[KEY_ENV[engine]] || undefined,
        ...(env[ENDPOINT_ENV[engine]]
          ? { endpoint: env[ENDPOINT_ENV[engine]] }
          : {}),
        googlePro: payload.googlePro === true,
        modelVariant: payload.modelVariant === "pro" ? "pro" : undefined,
        // R13: the browser's chosen final-picture model (an ID, never a URL).
        ...(isModelId(payload.model) ? { model: payload.model.trim() } : {}),
      };
      if (engine === "local") {
        if (env.COMFYUI_WORKFLOW_JSON) {
          try {
            config.workflow = JSON.parse(env.COMFYUI_WORKFLOW_JSON);
          } catch {
            throw proxyError(
              503,
              "서버의 ComfyUI 워크플로 JSON을 확인해 주세요.",
            );
          }
        } else
          throw proxyError(
            503,
            "서버 환경변수 COMFYUI_WORKFLOW_JSON에 API 워크플로를 설정해 주세요.",
          );
      } else if (!config.apiKey)
        throw proxyError(
          503,
          "서버 환경변수에 이 엔진의 API 키를 설정해 주세요.",
        );
      const controller = new AbortController();
      const close = () => {
        if (!response.writableEnded) controller.abort();
      };
      response.once("close", close);
      try {
        const result = await generate(
          {
            scenePrompt: payload.scenePrompt,
            stylePrompt: payload.stylePrompt,
            negativePrompt: payload.negativePrompt,
            stylePreset: payload.stylePreset,
            referenceImages: references,
            seed: payload.seed,
            size: payload.size,
            quality: payload.quality,
            signal: controller.signal,
          },
          { engine, config },
        );
        if (response.destroyed) return;
        respond(
          response,
          200,
          {
            imageUrl: result.imageUrl,
            seed: result.seed,
            model: result.meta.model,
            meta: result.meta,
            ...(result.meta.costUsd !== undefined
              ? { cost_usd: result.meta.costUsd }
              : {}),
          },
          origin,
        );
      } finally {
        response.removeListener("close", close);
      }
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      // Never include provider response bodies, URLs, stack traces or keys.
      const status =
        error.status ||
        (["ImageGenerationError", "TextEngineError"].includes(error.name)
          ? 502
          : 500);
      const message = error.status
        ? error.message
        : "이미지 요청을 처리하지 못했어요. 서버의 엔진 설정과 사용량을 확인해 주세요.";
      respond(response, status, { error: message }, origin);
    }
  };
}

export function startImageProxy({ env = process.env } = {}) {
  const server = http.createServer(createImageProxyHandler({ env }));
  // Bind only to the local device. No public key-bearing endpoint by default.
  server.listen(Number(env.IMAGE_PROXY_PORT) || 8787, "127.0.0.1");
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startImageProxy();
