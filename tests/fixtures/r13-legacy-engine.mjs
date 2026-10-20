// R13 legacy pin: settings saved before the per-provider model picker (no
// customModels, fetchedModels or image `model` fields) must produce the same
// wire requests, resolved models and estimates as the pre-R13 app. The same
// harness runs against any app root (PRE_R13_APP_ROOT) so the pinned hash can
// be re-derived from the pre-R13 sources. Only fake fetch is used.
const PIXELS =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=";
const PNG = `data:image/png;base64,${PIXELS}`;
const AT = "2026-10-19T00:00:00Z";
const clone = (value) => JSON.parse(JSON.stringify(value));
const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
const imageResponse = () =>
  new Response(
    new Blob([Uint8Array.from(atob(PIXELS), (x) => x.charCodeAt(0))], {
      type: "image/png",
    }),
  );
async function bodyOf(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const rows = [];
    for (const [name, value] of body.entries())
      rows.push([
        name,
        typeof value === "string"
          ? value
          : { blob: value.type, size: value.size, name: value.name },
      ]);
    return rows;
  }
  return String(body);
}

/** Legacy text settings as parents saved them before R13 (no new fields). */
export const LEGACY_TEXT_SETTINGS = Object.freeze([
  { engine: "openai" },
  {
    engine: "openai",
    providers: {
      openai: { stageModels: { medium: "gpt-4.1-mini", upper: "gpt-6.1-sol" } },
    },
  },
  {
    // A saved id outside the catalog fell back to the stage default before R13.
    engine: "openai",
    providers: {
      openai: { stageModels: { medium: "gpt-5.6-sol", upper: "gpt-6-astra" } },
    },
  },
  {
    engine: "anthropic",
    providers: {
      anthropic: {
        stageModels: { medium: "claude-haiku-5-5", upper: "claude-fable-5-1" },
        proxyEndpoint: "https://proxy.example.test",
        transport: "proxy",
      },
    },
  },
  { engine: "google", providers: { google: { model: "gemini-4-argon" } } },
  {
    engine: "local",
    providers: { local: { baseUrl: "http://127.0.0.1:1234/v1", model: "" } },
  },
  {
    engine: "openai",
    providers: {
      local: { baseUrl: "http://127.0.0.1:1234/v1", model: "my-local" },
    },
    hybrid: { enabled: true, finalEngine: "anthropic" },
  },
]);

const TEXT_REQUESTS = [
  {
    system: "S",
    user: "U",
    jsonSchema: { type: "object" },
    temperature: 0.7,
    maxTokens: 4000,
  },
  { system: "S2", user: "U2", temperature: 0.2, maxTokens: 900 },
];

function textReply(url, engine) {
  if (url.endsWith("/models")) return json({ data: [{ id: "local-model" }] });
  if (url.includes("/api/text/"))
    return json({ text: '{"ok":true}', usage: { input: 3, output: 4 } });
  if (engine === "google")
    return json({
      candidates: [
        { content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" },
      ],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
    });
  if (engine === "anthropic")
    return json({
      content: [{ type: "text", text: '{"ok":true}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 4 },
    });
  return json({
    choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  });
}

export async function legacyEngineSnapshot(rootUrl) {
  const load = (path) => import(new URL(path, rootUrl).href);
  const textModels = await load("dist/text-generation/models.js"),
    { createTextEngine } = await load("dist/text-generation/providers.js"),
    { getTextGenerationSettings } = await load(
      "dist/text-generation/settings-ui.js",
    ),
    imageModels = await load("dist/image-generation/models.js"),
    { generateImage } = await load("dist/image-generation/providers.js");
  const out = {
    text: [],
    settings: [],
    stages: [],
    estimates: [],
    images: [],
    imageModels: [],
  };
  // 1. Every catalog model on the wire, direct and through a proxy.
  for (const engine of ["openai", "anthropic", "google", "local"]) {
    const models =
      engine === "local"
        ? ["", "my-local"]
        : textModels.listTextModels(engine).map((row) => row.id);
    for (const model of [...models, "not-in-catalog"]) {
      for (const proxy of engine === "local" ? [false] : [false, true]) {
        const calls = [];
        const config = {
          model,
          ...(engine === "local"
            ? { baseUrl: "http://127.0.0.1:1234/v1" }
            : { apiKey: "sk-fixture-legacy" }),
          ...(proxy
            ? {
                proxyEndpoint: "https://proxy.example.test",
                transport: "proxy",
              }
            : {}),
          fetch: async (url, options = {}) => {
            calls.push({
              url,
              method: options.method || "GET",
              headers: options.headers || null,
              body: await bodyOf(options.body),
            });
            return textReply(url, engine);
          },
        };
        const engineApi = createTextEngine({ engine, config });
        for (const request of TEXT_REQUESTS) {
          const result = await engineApi.complete(clone(request));
          out.text.push({
            engine,
            model,
            proxy,
            meta: result.meta,
            usage: result.usage,
          });
        }
        out.text.push({ engine, model, proxy, calls });
      }
    }
  }
  // 2. Normalized settings, stage routing and estimates from legacy saves.
  for (const saved of LEGACY_TEXT_SETTINGS) {
    const settings = getTextGenerationSettings({
      settings: { textGeneration: clone(saved) },
    });
    out.settings.push(settings);
    for (const stage of [
      "outline",
      "plotContract",
      "sceneBriefs",
      "proseDraft",
      "prose",
      "enrichment",
      "pagination",
      "coherence",
      "coherenceRepair",
    ])
      out.stages.push(textModels.resolveStoryStageSettings(settings, stage));
    for (const role of ["outline", "prose", "cheap", "coach"]) {
      out.stages.push(
        textModels.resolveQualityStageSettings(settings, role, {
          enabled: true,
        }),
      );
      out.stages.push(
        textModels.resolveQualityStageSettings(settings, role, {
          enabled: true,
          engines: { [role]: { engine: "openai", model: "gpt-6-astra" } },
        }),
      );
      out.stages.push(
        textModels.resolveQualityStageSettings(settings, role, {
          enabled: true,
          engines: { [role]: { engine: "anthropic", model: "claude-x-9" } },
        }),
      );
    }
    for (const quality of [
      undefined,
      { enabled: false },
      { enabled: true, useBeamSearch: true },
    ])
      out.estimates.push(
        textModels.estimateStoryTextCost({
          settings: {
            ...settings,
            ...(quality ? { storyQuality: quality } : {}),
          },
          pageCount: 12,
          at: AT,
        }),
      );
  }
  for (const engine of ["openai", "anthropic", "google", "local"])
    for (const model of [
      ...textModels.listTextModels(engine).map((row) => row.id),
      "gpt-5.6-sol",
      "",
    ])
      out.estimates.push(
        textModels.estimateTextCost({
          engine,
          model,
          input: 12345,
          output: 6789,
          at: AT,
        }),
        textModels.getTextModelInfo(engine, model),
      );
  // 3. Image models, prices and requests from legacy World provider configs.
  const imageConfigs = [
    {},
    { googlePro: true },
    { modelVariant: "pro" },
    { googlePro: false, modelVariant: "default", transport: "direct" },
  ];
  for (const engine of ["google", "openai", "bfl", "fal", "local", "sample"])
    for (const config of imageConfigs)
      for (const quality of ["draft", "final", "high", "low", "medium"]) {
        out.imageModels.push(
          imageModels.getEngineModel(engine, quality, config),
        );
        for (const size of ["1024x1024", "1536x1024", "2048x2048", "4096x2048"])
          out.imageModels.push(
            imageModels.estimateImageCost({ engine, quality, size, config }),
          );
        out.imageModels.push(
          imageModels.estimateBookCost({
            engine,
            quality,
            config,
            pageCount: 12,
            size: "1536x1024",
          }),
        );
      }
  const preset = {
    id: "legacy-style",
    name: "종이와 색연필",
    stylePrompt: "soft pencil texture",
    negativePrompt: "sharp shadows",
    palette: ["#F2C178"],
    styleRefImages: [PNG],
  };
  for (const engine of ["google", "openai", "bfl", "fal"])
    for (const config of imageConfigs.slice(0, 2))
      for (const quality of ["draft", "final"])
        for (const proxy of [false, true])
          for (const references of [[], [PNG]]) {
            const calls = [];
            let step = 0;
            const result = await generateImage(
              {
                prompt: "A small rabbit opens a book.",
                stylePreset: preset,
                referenceImages: references,
                seed: 42,
                size: "1536x1024",
                quality,
              },
              {
                engine,
                config: {
                  ...config,
                  apiKey: "sk-fixture-legacy",
                  pollIntervalMs: 100,
                  ...(proxy
                    ? {
                        proxyEndpoint: "https://proxy.example.test",
                        transport: "proxy",
                      }
                    : {}),
                  fetch: async (url, options = {}) => {
                    calls.push({
                      url,
                      method: options.method || "GET",
                      headers: options.headers || null,
                      body: await bodyOf(options.body),
                    });
                    step++;
                    if (url.includes("/api/image/"))
                      return json({
                        imageUrl: PNG,
                        model: "proxy-model",
                        seed: 7,
                      });
                    if (url.startsWith("https://images.example.test"))
                      return imageResponse();
                    if (engine === "google")
                      return json({
                        candidates: [
                          {
                            content: {
                              parts: [
                                {
                                  inlineData: {
                                    mimeType: "image/png",
                                    data: PIXELS,
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      });
                    if (engine === "openai")
                      return json({ data: [{ b64_json: PIXELS }] });
                    if (engine === "bfl")
                      return step === 1
                        ? json({
                            id: "bfl-job",
                            polling_url:
                              "https://api.bfl.ai/v1/get_result?id=bfl-job",
                          })
                        : json({
                            status: "Ready",
                            result: {
                              sample: "https://images.example.test/a.png",
                              seed: 42,
                            },
                          });
                    return step === 1
                      ? json({
                          request_id: "fal-job",
                          status_url: "https://queue.fal.run/x/status",
                          response_url: "https://queue.fal.run/x",
                        })
                      : step === 2
                        ? json({ status: "COMPLETED" })
                        : json({
                            images: [
                              { url: "https://images.example.test/b.png" },
                            ],
                          });
                  },
                },
              },
            );
            out.images.push({
              engine,
              config,
              quality,
              proxy,
              references: references.length,
              model: result.meta.model,
              costUsdEstimated: result.meta.costUsdEstimated,
              costEstimate: result.meta.costEstimate,
              calls,
            });
          }
  return out;
}

/** App-level legacy pin: FULL AUTO estimates, simple estimates and book snapshots. */
export async function legacyAppSnapshot(rootUrl) {
  const load = (path) => import(new URL(path, rootUrl).href);
  const { seedState } = await load("dist/engine.js"),
    world = await load("dist/image-generation/world.js"),
    { estimateFullAutoCost } = await load("dist/full-auto.js"),
    { estimateSimpleCosts } = await load("dist/story-generation/page-tools.js"),
    { getTextGenerationSettings } = await load(
      "dist/text-generation/settings-ui.js",
    );
  const out = [];
  // Gemini 4 Argon has a dated price change, so the undated FULL AUTO estimate
  // is pinned for the providers whose rates do not move with the clock.
  for (const saved of LEGACY_TEXT_SETTINGS.filter(
    (row) => row.engine !== "google",
  ))
    for (const imageEngine of ["google", "openai", "bfl", "fal", "sample"])
      for (const providerConfig of [
        undefined,
        { google: { googlePro: true, modelVariant: "pro" } },
      ]) {
        const state = seedState();
        world.migrateWorldState(state);
        state.settings.textGeneration = clone(saved);
        world.updateWorldGenerationSettings(state, { imageEngine });
        const active = world.getActiveWorld(state);
        if (providerConfig) active.providerConfig = clone(providerConfig);
        const wizard = { pageCount: 8, characterIds: ["yuha"] };
        out.push(estimateFullAutoCost(state, wizard));
        out.push(
          estimateFullAutoCost(state, wizard, { planMode: "selection" }),
        );
        out.push(estimateSimpleCosts(state, wizard));
        world.markCharacterSheetConfirmed(state, "yuha", {
          imageUrl: "data:image/png;base64,fixture",
          seed: null,
          meta: { requestedSeed: 10 },
        });
        const book = {
          id: "legacy-book",
          characterIds: ["yuha"],
          pages: Array.from({ length: 4 }, (_, i) => ({ pageNo: i + 1 })),
          pagination: { pages: [] },
          textGenerationSettings: getTextGenerationSettings(state),
        };
        world.captureBookGenerationSnapshot(state, book);
        out.push(book.generationSnapshot.imageModelConfig);
        out.push(estimateSimpleCosts(state, book));
        // A legacy book keeps its frozen model after the World changes.
        world.updateWorldGenerationSettings(state, {
          imageEngine,
          modelVariant: "pro",
        });
        out.push(estimateSimpleCosts(state, book));
      }
  return out;
}
