import {
  getActiveWorld,
  getWorldStyleReferences,
  getWorldBackgroundSnapshot,
  imageWordCheck,
} from "./image-generation/world.js";
import { getStylePreset } from "./image-generation/styles.js";
import {
  generateImage,
  ENGINE_METADATA,
} from "./image-generation/providers.js";
import { getCredential } from "./image-generation/vault.js";
import {
  saveImage,
  getImageURL,
  deleteImageAsset,
} from "./image-generation/assets.js";
import { estimateImageCost } from "./image-generation/models.js";
const clone = (x) => JSON.parse(JSON.stringify(x)),
  esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let api,
  flow = null,
  configured = false;
export const backgroundSettingsKey = (b) =>
  JSON.stringify({
    name: b.name,
    type: b.type,
    description: b.description || b.features || "",
    layout: b.layout || "",
  });
export function renderBackgroundSheetActions(background, state) {
  const selected = getWorldBackgroundSnapshot(state, background),
    has = !!(selected.imageAssetId || selected.imageUrl);
  return `<p class="small-label">${selected.backgroundSheetStale ? "이 World의 배경 시트 다시 생성 필요" : has ? "고정 배경 참조 있음" : "아직 고정 배경 시트 없음"}</p><button type="button" class="btn btn-outline btn-small" data-background-sheet="generate" data-id="${esc(background.id)}">${has ? "배경 시트 다시 생성" : "엔진으로 배경 시트 미리 생성"}</button>`;
}
export function backgroundSheetRequest(
  state,
  background,
  { quality = "draft", seed } = {},
) {
  const world = getActiveWorld(state),
    style = getStylePreset(world.stylePresetId),
    selected = getWorldBackgroundSnapshot(state, background, world),
    source = selected.imageAssetId || selected.imageUrl ? selected : background,
    existing = source.imageAssetId
      ? getImageURL(source.imageAssetId)
      : source.imageUrl;
  if (source.imageAssetId && !existing)
    throw new Error(
      "저장된 배경 그림을 불러오는 중이에요. 잠시 후 다시 시도해 주세요.",
    );
  return {
    // The place fields are parent text (strict); the fixed instructions are never checked.
    forbiddenWordCheck: imageWordCheck({
      strict: [
        background.name,
        background.type,
        background.description || background.features,
        background.layout,
      ],
    }),
    prompt: `Create a reusable environment reference sheet for ONE original children's picture-book location. Location name and requested facts: ${background.name}; type ${background.type || ""}; ${background.description || background.features || ""}; fixed layout ${background.layout || ""}. Show three complementary reference panels: a wide establishing view, a closer view from another useful angle, and a small detail view of the important fixed objects. All panels depict the SAME exact place and consistent geometry, wall/roof colors, window and door positions, furniture arrangement, materials, and recurring objects. For an interior show the same bed/table/window positions; for outdoors preserve path, tree and building shapes. ${existing ? "The first background reference defines this established place and its layout. Preserve it except explicit parent-requested changes in the facts above." : ""} Style images define painting medium only. Empty environment: no people, animals, faces, story action, words, captions, labels, arrows, watermarks, logos, or map text.`,
    stylePreset: clone(style),
    referenceImages: [
      ...(existing
        ? [
            {
              imageUrl: existing,
              role: "background",
              label: background.name + " established layout",
            },
          ]
        : []),
      ...getWorldStyleReferences(state, world),
    ],
    size: "1536x1024",
    quality,
    seed: seed ?? crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff,
  };
}
function current(s) {
  return (
    flow === s &&
    api.getState() === s.state &&
    api.isParent() &&
    !s.controller.signal.aborted &&
    getActiveWorld(s.state).id === s.worldId &&
    getActiveWorld(s.state).revision === s.worldRevision
  );
}
export function cleanupBackgroundSheets() {
  const s = flow;
  flow = null;
  if (!s) return;
  s.controller.abort();
  if (s.candidate?.imageAssetId && !s.kept)
    void deleteImageAsset(s.candidate.imageAssetId).catch(() => {});
}
async function generate(s, quality = "draft") {
  if (!current(s)) return;
  const world = getActiveWorld(s.state),
    config = {
      ...(s.state.settings.imageProviderConfig?.[world.imageEngine] || {}),
      ...(world.providerConfig?.[world.imageEngine] || {}),
    };
  s.busy = true;
  api.showModal(
    `${api.modalHeader(esc(s.background.name + " 배경 시트"))}<p class="modal-intro">${quality === "draft" ? "미리보기" : "최종"} 배경의 넓은 모습·다른 각도·고정 소품을 생성하고 있어요.</p><div class="modal-actions"><button class="btn btn-outline" data-action="close-modal">생성 중지</button></div>`,
    "wide",
  );
  let asset;
  try {
    if (!config.proxyEndpoint && config.transport !== "proxy")
      config.apiKey = await getCredential(world.imageEngine);
    if (!current(s)) return;
    const request = backgroundSheetRequest(s.state, s.background, {
      quality,
      seed: s.seed,
    });
    s.seed = request.seed;
    const result = await generateImage(request, {
      engine: world.imageEngine,
      config: { ...config, signal: s.controller.signal },
    });
    if (!current(s)) return;
    asset = await saveImage(result.imageUrl, { signal: s.controller.signal });
    if (!current(s)) {
      await deleteImageAsset(asset.assetId);
      return;
    }
    s.candidate = {
      id: asset.assetId,
      imageAssetId: asset.assetId,
      imageUrl: "asset:" + asset.assetId,
      seed: result.seed ?? null,
      meta: {
        ...result.meta,
        imageEngine: world.imageEngine,
        stylePresetId: world.stylePresetId,
        worldId: world.id,
        worldRevision: world.revision,
        quality,
        source: "app-background-sheet",
        requestedSeed: s.seed,
        returnedSeed: result.seed ?? null,
        seed: result.seed ?? null,
      },
    };
    s.quality = quality;
    s.busy = false;
    api.showModal(
      `${api.modalHeader(esc(s.background.name + "의 고정 배경 시트"))}<img class="ig-sheet-preview" src="${esc(asset.imageUrl)}" alt="${esc(s.background.name)} 배경 시트"><p class="modal-intro">문·창 위치, 방과 가구 배치, 색상이 같은 장소로 보이는지 확인하세요. 이후 해당 장소 장면과 다음 편에 이 시트를 참조로 전송합니다.</p><div class="modal-actions"><button class="btn btn-outline" data-action="close-modal">확정하지 않기</button><button class="btn btn-primary" data-background-sheet="confirm">${quality === "draft" ? "최종 배경 시트 생성 · 예상 $" + estimateImageCost({ engine: world.imageEngine, quality: "final", size: "1536x1024", config }).costUsd.toFixed(2) : "이 배경 시트 확정"}</button></div>`,
      "wide",
    );
  } catch (error) {
    if (asset && !s.candidate)
      await deleteImageAsset(asset.assetId).catch(() => {});
    if (!current(s)) return;
    s.busy = false;
    api.closeModal();
    api.toast(error.message);
  }
}
async function begin(id) {
  cleanupBackgroundSheets();
  const state = api.getState(),
    background = state.backgrounds.find((b) => b.id === id),
    world = getActiveWorld(state);
  if (!background) return;
  if (world.imageEngine === "sample") {
    api.toast(
      "무료 샘플은 AI 배경 시트를 만들지 않아요. 부모 설정에서 AI 엔진·ComfyUI를 선택하거나 완성 배경 그림을 가져와 주세요.",
    );
    return;
  }
  const estimate = estimateImageCost({
    engine: world.imageEngine,
    quality: "draft",
    size: "1536x1024",
    config: world.providerConfig?.[world.imageEngine] || {},
  });
  const s = {
    state,
    background,
    worldId: world.id,
    worldRevision: world.revision,
    controller: new AbortController(),
    busy: false,
  };
  flow = s;
  api.showModal(
    `${api.modalHeader(esc(background.name + "의 배경을 먼저 고정하기"))}<p class="modal-intro">${esc(ENGINE_METADATA[world.imageEngine].name)} · ${esc(getStylePreset(world.stylePresetId).name)}<br>캐릭터가 없는 장소 참조 시트를 만들고 부모가 확정합니다. 저장된 배경 그림이 있으면 같은 장소를 유지하는 참조로 함께 전송합니다.</p><div class="notice">draft 미리보기 예상 $${estimate.costUsd.toFixed(2)} · 최종 생성은 결과 확인 뒤 별도 요청합니다.</div><div class="modal-actions"><button class="btn btn-outline" data-action="close-modal">닫기</button><button class="btn btn-primary" data-background-sheet="start">비용 확인 · 미리 생성</button></div>`,
  );
}
export function configureBackgroundSheets(context) {
  api = context;
  if (configured) return;
  configured = true;
  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-background-sheet]");
    if (!el) return;
    event.preventDefault();
    api.protectedAction(async () => {
      const action = el.dataset.backgroundSheet;
      if (action === "generate") {
        await begin(el.dataset.id);
        return;
      }
      const s = flow;
      if (!s || !current(s) || s.busy) return;
      if (action === "start") {
        await generate(s);
        return;
      }
      if (action === "confirm") {
        if (s.quality === "draft") {
          const old = s.candidate;
          s.candidate = null;
          await deleteImageAsset(old.imageAssetId);
          await generate(s, "final");
          return;
        }
        const previous = clone(s.background);
        try {
          const c = s.candidate;
          s.background.backgroundSheets ||= [];
          s.background.backgroundSheets.push({
            ...clone(c),
            confirmedAt: new Date().toISOString(),
            settings: backgroundSettingsKey(s.background),
          });
          s.background.imageAssetId = c.imageAssetId;
          s.background.imageUrl = c.imageUrl;
          s.background.backgroundSheetMeta = clone(c.meta);
          s.background.backgroundSheetSettingsKey = backgroundSettingsKey(
            s.background,
          );
          s.background.backgroundSheetSeed = c.seed;
          s.background.backgroundSheetConfirmedAt = new Date().toISOString();
          if (api.save() === false)
            throw new Error("배경 시트를 저장하지 못했어요.");
          s.kept = true;
          flow = null;
          api.closeModal();
          api.render();
          api.toast(
            "배경 시트를 고정했어요. 해당 장소와 다음 편에서 같은 참조를 사용합니다.",
          );
        } catch (error) {
          for (const key of Object.keys(s.background)) delete s.background[key];
          Object.assign(s.background, previous);
          api.toast(error.message);
        }
      }
    });
  });
}
