import {
  TEXT_MODELS,
  getTextModel,
  getTextModelInfo,
  estimateTextCost,
} from "./models.js";
import { validateCredentialInput } from "../image-generation/credential-validation.js";
import { fetchWithRetry, isRetryableStatus } from "../transient-retry.js";
export class TextEngineError extends Error {
  constructor(message, code = "text_error", status = null) {
    super(message);
    this.name = "TextEngineError";
    this.code = code;
    this.status = status;
  }
}
const failure = (message, code, status) => {
  throw new TextEngineError(message, code, status);
};
function baseUrl(value, fallback) {
  let url;
  try {
    url = new URL(value || fallback);
  } catch {
    failure("글 엔진의 HTTP(S) 주소를 확인해 주세요.", "endpoint");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    failure("글 엔진 주소에 인증 정보나 쿼리를 넣을 수 없어요.", "endpoint");
  return url.href.replace(/\/+$/, "");
}
function safeSchema(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}
const safeJsonKeys = (key, item) => {
  if (["__proto__", "prototype", "constructor"].includes(key))
    throw new Error("Invalid JSON key");
  return item;
};
/** The first balanced {...} or [...] (a fence anywhere is tried first), skipping string contents. */
function balancedJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const candidate of [fenced?.[1], text]) {
    if (!candidate) continue;
    const starts = ["{", "["]
      .map((char) => candidate.indexOf(char))
      .filter((at) => at >= 0);
    if (!starts.length) continue;
    const start = Math.min(...starts),
      open = candidate[start],
      close = open === "{" ? "}" : "]";
    let depth = 0,
      inString = false,
      escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const char = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === open) depth++;
      else if (char === close && --depth === 0)
        return candidate.slice(start, i + 1);
    }
  }
  return null;
}
function parseJson(value) {
  if (typeof value === "object" && value !== null) return value;
  const raw = String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(raw, safeJsonKeys);
  } catch (error) {
    // Commentary after the JSON, or a leading sentence plus a fence: take the
    // balanced JSON instead of paying for a second request.
    const slice = balancedJson(String(value || ""));
    if (!slice || slice === raw) throw error;
    return JSON.parse(slice, safeJsonKeys);
  }
}
async function fetchJson(url, options, config, signal) {
  let response;
  try {
    // R25: a busy answer (429/5xx/529) is sent again after a short wait.
    response = await fetchWithRetry(
      config.fetch || globalThis.fetch,
      url,
      { ...options, signal, credentials: "omit" },
      {
        signal,
        ...(Array.isArray(config.retryDelaysMs) ? { delays: config.retryDelaysMs } : {}),
      },
    );
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("글 생성을 중지했어요.", "AbortError");
    failure(
      "글 엔진에 연결하지 못했어요. 주소·CORS·프록시 설정을 확인해 주세요.",
      "network",
    );
  }
  if (!response.ok) {
    const status = response.status;
    failure(
      `${status === 401 ? "글 엔진 인증에 실패했어요. 추적 ID 대신 비밀 키 전체를 저장했는지 확인해 주세요." : status === 403 ? "이 글 모델의 프로젝트 사용 권한을 확인해 주세요." : status === 429 ? "글 엔진의 잔액·사용량·요청 한도를 확인해 주세요." : status === 404 ? "글 엔진 주소와 모델 이름을 확인해 주세요." : isRetryableStatus(status) ? "글 엔진이 지금 바빠요. 기다렸다가 두 번 더 보냈지만 받지 못했어요. 잠시 뒤 ‘다시 시도’를 눌러 주세요. 이미 받은 결과는 다시 사지 않아요." : "글 엔진이 요청을 처리하지 못했어요. 모델과 요청 설정을 확인해 주세요."} (HTTP ${status})`,
      "http",
      status,
    );
  }
  try {
    return await response.json();
  } catch {
    failure("글 엔진의 JSON 응답을 읽을 수 없어요.", "response");
  }
}
const post = (body, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
function usageOf(data, engine) {
  return engine === "google"
    ? {
        input: Number(data.usageMetadata?.promptTokenCount) || 0,
        output:
          (Number(data.usageMetadata?.candidatesTokenCount) || 0) +
          (Number(data.usageMetadata?.thoughtsTokenCount) || 0),
      }
    : engine === "anthropic"
      ? {
          input: Number(data.usage?.input_tokens) || 0,
          output: Number(data.usage?.output_tokens) || 0,
        }
      : {
          input: Number(data.usage?.prompt_tokens) || 0,
          output: Number(data.usage?.completion_tokens) || 0,
        };
}
function checkCompletion(data) {
  if (
    data.continuation_token ||
    data.continuationToken ||
    data.candidates?.[0]?.continuation_token ||
    data.candidates?.[0]?.continuationToken
  )
    failure(
      "이 모델이 추가 생성을 위한 이어쓰기 응답을 반환했어요. 과금이 반복되지 않도록 멈췄어요. 전문을 짧게 조정하거나 다른 모델로 다시 생성해 주세요.",
      "continuation_required",
    );
  const stop =
    data.stop_reason ||
    data.finishReason ||
    data.meta?.finishReason ||
    data.choices?.[0]?.finish_reason ||
    data.candidates?.[0]?.finishReason;
  if (
    ["length", "max_tokens", "MAX_TOKENS", "MAX_OUTPUT_TOKENS"].includes(stop)
  )
    failure(
      "글 엔진의 출력 한도에 도달해 본문이 잘렸어요. 과금이 반복되지 않도록 멈췄어요. 분량을 줄이거나 다른 모델로 다시 생성해 주세요.",
      "output_limit",
    );
  if (stop === "refusal" || data.choices?.[0]?.message?.refusal)
    failure(
      "글 엔진이 이 내용의 생성을 거절했어요. 주제를 수정해 주세요.",
      "refusal",
    );
}
async function requestOnce(engine, config, req, signal) {
  const schema = safeSchema(req.jsonSchema),
    model = getTextModel(engine, config),
    info = getTextModelInfo(engine, model, config),
    // R13: a fetched or typed model gets no structured-output, temperature,
    // reasoning, effort or thinking fields; its output limit is the stage budget.
    custom = info.custom === true,
    maxTokens = Math.min(
      info.maxOutputTokens,
      Math.max(req.maxTokens, info.requestOutputTokens),
    ),
    proxy = config.proxyEndpoint || config.transport === "proxy";
  if (proxy) {
    const base = baseUrl(
      config.proxyEndpoint,
      globalThis.location?.origin || "http://127.0.0.1:8787",
    );
    const data = await fetchJson(
      `${base}/api/text/${engine}`,
      post({
        system: req.system,
        user: req.user,
        jsonSchema: schema,
        ...(info.supportsTemperature ? { temperature: req.temperature } : {}),
        maxTokens,
        ...(model ? { model } : {}),
      }),
      config,
      signal,
    );
    checkCompletion(data);
    return {
      ...data,
      usage: data.usage || { input: 0, output: 0 },
      model: data.meta?.model || model,
    };
  }
  const credential =
    engine === "local" ? null : validateCredentialInput(engine, config.apiKey);
  const instruction = schema
    ? `${req.system}\nReturn only JSON matching this schema: ${JSON.stringify(schema)}. No Markdown or explanatory text.`
    : req.system;
  let data,
    text,
    json,
    resolvedModel = model;
  if (engine === "openai" || engine === "local") {
    const base = baseUrl(
      config.baseUrl || config.endpoint,
      engine === "local"
        ? "http://127.0.0.1:1234/v1"
        : "https://api.openai.com/v1",
    );
    if (engine === "local" && !resolvedModel) {
      const models = await fetchJson(
        base + "/models",
        { method: "GET" },
        config,
        signal,
      );
      resolvedModel = models.data?.find((m) => typeof m.id === "string")?.id;
      if (!resolvedModel)
        failure(
          "로컬 서버에서 실행할 모델을 먼저 불러오거나 모델 이름을 입력해 주세요.",
          "local_model",
        );
    }
    const body = {
      model: resolvedModel,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: req.user },
      ],
      ...(info.supportsTemperature ? { temperature: req.temperature } : {}),
      ...(info.reasoning.profile === "openai"
        ? { reasoning_effort: info.reasoning.effort }
        : {}),
      ...(engine === "local"
        ? { max_tokens: maxTokens }
        : { max_completion_tokens: maxTokens }),
    };
    if (schema && engine === "openai" && !custom)
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "story_result", schema, strict: false },
      };
    data = await fetchJson(
      base + "/chat/completions",
      post(body, credential ? { Authorization: "Bearer " + credential } : {}),
      config,
      signal,
    );
    checkCompletion(data);
    text = data.choices?.[0]?.message?.content || "";
  } else if (engine === "google") {
    const base = baseUrl(
      config.baseUrl || config.endpoint,
      "https://generativelanguage.googleapis.com/v1beta",
    );
    const generationConfig = custom
      ? { maxOutputTokens: maxTokens }
      : {
          ...(info.supportsTemperature ? { temperature: req.temperature } : {}),
          maxOutputTokens: maxTokens,
          thinkingConfig:
            info.reasoning.profile === "google-thinking-level"
              ? { thinkingLevel: info.reasoning.effort }
              : { thinkingBudget: 0 },
          ...(schema
            ? {
                responseMimeType: "application/json",
                responseJsonSchema: schema,
              }
            : {}),
        };
    data = await fetchJson(
      `${base}/models/${model}:generateContent`,
      post(
        {
          systemInstruction: { parts: [{ text: instruction }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig,
        },
        { "x-goog-api-key": credential },
      ),
      config,
      signal,
    );
    checkCompletion(data);
    text = (data.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  } else {
    const base = baseUrl(
      config.baseUrl || config.endpoint,
      "https://api.anthropic.com/v1",
    );
    const adaptive = info.reasoning.profile === "anthropic-adaptive";
    const betweenTools = info.reasoning.profile === "anthropic-between-tools";
    const disabled = info.reasoning.profile === "anthropic-disabled";
    const body = {
      model,
      system: instruction,
      messages: [{ role: "user", content: req.user }],
      ...(info.supportsTemperature ? { temperature: req.temperature } : {}),
      max_tokens: maxTokens,
      ...(adaptive || betweenTools
        ? {
            thinking: { type: betweenTools ? "between_tools" : "adaptive" },
            output_config: { effort: info.reasoning.effort },
          }
        : disabled
          ? { thinking: { type: "disabled" } }
          : {}),
    };
    // Current Claude models cannot force tools while thinking. Keep the full dynamic
    // story schema in the instruction and use our bounded JSON parse retry instead.
    if (schema && !adaptive && !betweenTools && !custom) {
      body.tools = [
        {
          name: "return_story_json",
          description: "Return the completed story stage as JSON.",
          input_schema: schema,
        },
      ];
      body.tool_choice = { type: "tool", name: "return_story_json" };
    }
    data = await fetchJson(
      base + "/messages",
      post(body, {
        "x-api-key": credential,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      }),
      config,
      signal,
    );
    checkCompletion(data);
    const tool = data.content?.find(
      (part) => part.type === "tool_use" && part.name === "return_story_json",
    );
    json = tool?.input;
    text = json
      ? JSON.stringify(json)
      : (data.content || [])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n");
  }
  if (text?.length > 400000)
    failure(
      "글 엔진의 결과가 앱에서 처리할 수 있는 분량을 넘었어요. 분량을 줄여 주세요.",
      "output_limit",
    );
  if (!text) failure("글 엔진이 유효한 본문을 반환하지 않았어요.", "empty");
  const billed = data.cost_usd ?? data.billing?.cost_usd;
  return {
    text,
    json,
    usage: usageOf(data, engine),
    model: resolvedModel,
    ...(Number.isFinite(billed) ? { costUsd: billed } : {}),
  };
}
export function createTextEngine({ engine, config = {} } = {}) {
  if (!Object.hasOwn(TEXT_MODELS, engine))
    failure("지원하는 글 엔진을 선택해 주세요.", "engine");
  return {
    id: engine,
    async complete(req) {
      if (
        typeof req?.system !== "string" ||
        typeof req?.user !== "string" ||
        req.system.length + req.user.length > 300000
      )
        failure("글 생성 입력을 확인해 주세요.", "input");
      const info = getTextModelInfo(
          engine,
          getTextModel(engine, config),
          config,
        ),
        temperature = Number(req.temperature ?? 0.8),
        maxTokens = Number(req.maxTokens);
      if (
        !Number.isFinite(temperature) ||
        temperature < 0 ||
        temperature > 1 ||
        !Number.isInteger(maxTokens) ||
        maxTokens < 1 ||
        maxTokens > Math.max(32000, info.requestOutputTokens)
      )
        failure("글 생성 온도·토큰 한도를 확인해 주세요.", "input");
      if (req.signal?.aborted)
        throw new DOMException("글 생성을 중지했어요.", "AbortError");
      let timedOut = false;
      const controller = new AbortController(),
        abort = () => controller.abort();
      req.signal?.addEventListener("abort", abort, { once: true });
      // R12: an openings request may ask for a longer timeout (req.timeoutMs);
      // without it (every pre-R12 request) the timeout is unchanged.
      const timeoutMs = Math.max(
        Number(config.timeoutMs) || info.timeoutMs,
        Number(req.timeoutMs) || 0,
      );
      let timer = null;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timedOut = true;
          abort();
        }, timeoutMs);
      };
      arm();
      let input = 0,
        output = 0,
        actual = 0,
        actualKnown = true,
        answered = 0,
        lastModel = null;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) arm();
          const result = await requestOnce(
            engine,
            config,
            {
              ...req,
              temperature,
              maxTokens,
              user: attempt
                ? req.user +
                  "\nThe previous answer could not be parsed as JSON. Return valid JSON only."
                : req.user,
            },
            controller.signal,
          );
          answered++;
          lastModel = result.model || lastModel;
          input += result.usage.input;
          output += result.usage.output;
          if (Number.isFinite(result.costUsd)) actual += result.costUsd;
          else actualKnown = false;
          let json = result.json;
          try {
            if (req.jsonSchema) json = parseJson(json ?? result.text);
          } catch {
            if (attempt === 0) continue;
            failure(
              "JSON 형식으로 한 번 다시 요청했지만 결과를 읽을 수 없어요. 이 단계를 다시 생성해 주세요.",
              "json",
            );
          }
          const estimate = estimateTextCost({ engine, config, input, output });
          return {
            text: result.text,
            ...(json !== undefined ? { json } : {}),
            usage: { input, output },
            ...(actualKnown ? { costUsd: actual } : {}),
            meta: {
              engine,
              model: result.model,
              requestedModel: getTextModel(engine, config),
              requests: attempt + 1,
              costUsdEstimated: estimate.costUsd,
              pricingEstimated: true,
              ...(estimate.pricingUnknown ? { pricingUnknown: true } : {}),
              transport:
                config.proxyEndpoint || config.transport === "proxy"
                  ? "proxy"
                  : "direct",
            },
          };
        }
      } catch (error) {
        // Responses already received were paid: the stage and FULL AUTO record them.
        const paid = (target) => {
          if (answered && target instanceof TextEngineError && !target.usage) {
            target.usage = { input, output };
            if (actualKnown) target.costUsd = actual;
            target.meta = {
              ...(target.meta || {}),
              engine,
              model: lastModel,
              requestedModel: getTextModel(engine, config),
              requests: answered,
              costUsdEstimated: estimateTextCost({ engine, config, input, output })
                .costUsd,
              pricingEstimated: true,
            };
          }
          return target;
        };
        if (timedOut && !req.signal?.aborted) {
          try {
            failure(
              "글 엔진의 응답 대기 시간이 지났어요. 진행 중이던 단계를 확인하고 다시 시도해 주세요.",
              "timeout",
            );
          } catch (timeout) {
            throw paid(timeout);
          }
        }
        throw paid(error);
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", abort);
      }
    },
  };
}
