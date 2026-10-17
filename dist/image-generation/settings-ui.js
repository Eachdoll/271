import { ENGINE_IDS, ENGINE_METADATA, generateImage } from "./providers.js";
import { STYLE_PRESETS, getStylePreset, listStylePresets } from "./styles.js";
import {
  getActiveWorld,
  updateWorldGenerationSettings,
  getCharacterSheet,
  markCharacterSheetConfirmed,
  getWorldStyleReferences,
} from "./world.js";
import {
  listCredentialStatus,
  saveCredential,
  removeCredential,
} from "./vault.js";
import {
  generateScene,
  generateAllScenes,
  generateCharacterSheet,
} from "./pipeline.js";
import { estimateImageCost, estimateBookCost } from "./models.js";
import { getImageURL, deleteImageAsset } from "./assets.js";
// 설정 화면은 스타일 시트 그림이 아직 없거나 복원되지 않았어도 열려야 합니다.
function safeStyleReferences(state, world) {
  try {
    return getWorldStyleReferences(state, world);
  } catch {
    return [];
  }
}

let api,
  credentialStatus = {},
  comparisonResults = [],
  comparisonRunning = false,
  currentOperation = null,
  pendingSheetCandidate = null;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const meta = (id) => ENGINE_METADATA[id] || { name: id, model: id };
const styleName = (id) => getStylePreset(id).name;
const resolveSheet = (sheet) =>
  sheet?.imageAssetId ? getImageURL(sheet.imageAssetId) : sheet?.imageUrl;
const stylePreview = (preset) => {
  const source = preset.styleRefImages?.[0];
  return source?.startsWith("asset:")
    ? getImageURL(source) || ""
    : source || getImageURL(preset.styleRefImageIds?.[0]) || "";
};
const formatSeed = (result) =>
  result?.seed == null ? "결과 시드 미지원" : `결과 시드 ${result.seed}`;
const option = (value, label, selected) =>
  `<option value="${value}" ${value === selected ? "selected" : ""}>${escape(label)}</option>`;
const button = (label, action, attrs = "") =>
  `<button type="button" class="btn btn-outline btn-small" data-ig-action="${action}" ${attrs}>${label}</button>`;
function providerFields(world, engine) {
  const config = world.providerConfig?.[engine] || {};
  if (engine === "sample")
    return `<div class="notice"><strong>기기 내 무료 샘플 · API 키 없음</strong><br>인터넷이나 API 비용 없이 종류·색상이 반영된 고정 그림 템플릿을 사용해요. 커버의 정교한 수채화를 AI로 재생성하거나 사진을 그림으로 바꾸는 엔진은 아닙니다.<br><br>커버 화풍을 무료로 쓰려면 Gemini 웹 앱의 무료 한도에서 직접 만든 그림을 가져오거나, 직접 설치한 ComfyUI를 연결해 주세요.</div><div class="material-add-actions"><button type="button" class="btn btn-outline btn-small" data-photo-action="import-character">완성된 캐릭터 그림 가져오기 · 무료</button></div>`;
  return `<div class="ig-provider-title"><strong>${escape(meta(engine).name)}</strong><span>${escape(meta(engine).model)}</span></div><p class="small-label">${escape(meta(engine).description || "공급자의 유료 API 요금이 적용됩니다.")}</p><div class="field"><label for="ig-api-key">${engine === "local" ? "인증 토큰 · 선택" : "API 키"}</label><input type="password" id="ig-api-key" autocomplete="off" maxlength="16384" ${engine === "openai" ? 'aria-describedby="ig-openai-key-help"' : ""} placeholder="${credentialStatus[engine] ? "암호화된 키가 저장되어 있어요 · 바꾸려면 새로 입력" : "키를 입력하면 이 브라우저에 암호화해 저장해요"}"><small data-credential-status="${engine}">${credentialStatus[engine] ? "키 저장됨 · 평문은 표시하지 않습니다." : "저장된 키 없음"}</small></div>${engine === "openai" ? '<p class="small-label">이미지는 GPT Image 2를 사용합니다. 미리보기는 low, 최종 생성은 high 품질입니다.</p><p id="ig-openai-key-help" class="small-label">OpenAI 화면의 추적 ID(key_)가 아니라 비밀 키(sk-) 전체를 입력하세요. sk-…처럼 가려진 값은 사용할 수 없습니다. 비밀 키는 생성할 때만 전체를 복사할 수 있어요. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI에서 새 비밀 키 만들기 ↗</a></p>' : ""}<div class="ig-key-actions">${button("키 암호화 저장", "save-key")}${button("저장된 키 삭제", "delete-key")}</div><p id="ig-key-error" class="pin-error" role="status" aria-live="polite"></p>${engine !== "local" ? `<div class="field" style="margin-top:18px"><label for="ig-proxy-endpoint">CORS 프록시 주소 · 선택</label><input id="ig-proxy-endpoint" type="url" value="${escape(config.proxyEndpoint || "")}" placeholder="https://image-proxy.example.com"><small>주소를 저장하면 브라우저의 키를 보내지 않고 프록시의 환경변수 키로 생성해요. 비워두면 공급자에 직접 연결합니다.</small></div>` : ""}${engine === "google" ? `<label class="reading-consent" style="margin-top:18px"><input type="checkbox" id="ig-google-pro" ${config.googlePro ? "checked" : ""}>최종 그림에 Gemini 3 Pro Image 사용 · 상위 모델 · 추가 API 요금</label>` : ""}${engine === "local" ? `<div class="field" style="margin-top:19px"><label for="ig-endpoint">ComfyUI 엔드포인트</label><input id="ig-endpoint" type="url" value="${escape(config.endpoint || "http://127.0.0.1:8188")}" placeholder="https://comfy.example.com"><small>이 브라우저에서 접근할 수 있어야 합니다. HTTPS 앱에서 HTTP 주소는 브라우저가 차단할 수 있어요.</small></div><div class="field" style="margin-top:14px"><label for="ig-workflow">API 형식 워크플로 JSON</label><textarea id="ig-workflow" rows="7" spellcheck="false" placeholder="ComfyUI의 Save (API Format)으로 내보낸 JSON">${escape(config.workflow ? JSON.stringify(config.workflow, null, 2) : "")}</textarea><small>텍스트: {{prompt}}, {{negativePrompt}} · 시드: {{seed}} · 크기: {{width}}, {{height}}<br>참조: {{referenceImage:0}}, {{referenceImage:1}}… 또는 {{referenceImages}}. 캐릭터 시트와 화풍 참조를 모두 사용해야 해요.</small></div>` : ""}`;
}
export function renderImageSettings(state) {
  const world = getActiveWorld(state);
  const preset = getStylePreset(world.stylePresetId);
  return `<section class="image-settings"><div class="section-header"><h3>이미지 엔진 · 우리 집 World</h3><span class="role-tag">${escape(world.name)} · v${world.revision}</span></div>${world.styleUpgradeNotice ? `<div class="notice" style="margin-bottom:16px">${escape(world.styleUpgradeNotice)}</div>` : ""}<div class="ig-layout"><section class="panel"><h3>World의 그림을 정해요</h3><p class="section-sub">이 세계의 등장인물과 모든 장면이 같은 엔진·화풍을 사용해요.</p><form id="ig-world-form"><div class="form-grid"><div class="field"><label for="ig-world-name">World 이름</label><input id="ig-world-name" value="${escape(world.name)}" maxlength="70" required></div><div class="field"><label for="ig-engine">이미지 엔진</label><select id="ig-engine">${ENGINE_IDS.map((id) => option(id, meta(id).name, world.imageEngine)).join("")}</select></div><div class="field field-wide"><label for="ig-style">화풍 프리셋</label><select id="ig-style">${listStylePresets(
    state,
  )
    .map((s) => option(s.id, s.name, world.stylePresetId))
    .join(
      "",
    )}</select><small>스튜디오·작가 이름 대신 재료, 선, 색, 구도로 정의한 화풍입니다.</small></div></div><div class="ig-style-target">${safeStyleReferences(state, world)[0] ? `<img src="${escape(safeStyleReferences(state, world)[0].imageUrl)}" alt="${escape(preset.name)} 화풍 기준">` : "<p>스타일 시트 생성 전 · 아래에서 3개 장면을 시험하고 고정해 주세요.</p>"}<small>이 이미지가 화풍 기준입니다. 캐릭터 시트는 외모를, 이 참조는 그림의 질감을 정합니다.</small></div><div id="ig-provider-fields" style="margin-top:22px">${providerFields(world, world.imageEngine)}</div><div class="ig-world-status ${world.characterSheetsStale ? "stale" : ""}">${world.characterSheetsStale ? "시트 다시 생성 필요 · 새 장면을 만들기 전에 선택한 친구들의 시트를 다시 확정해 주세요." : "캐릭터 외모 참조와 실제 화풍 이미지가 함께 사용됩니다."}</div><div class="modal-actions"><button type="submit" class="btn btn-green">World 설정 저장</button><button type="button" class="btn btn-outline" data-management-action="reset-provider-config">연결 설정 초기화</button></div></form><p class="small-label" style="margin-top:20px">API 키는 AES-GCM으로 암호화하고 부모 PIN에서 파생한 암호화 키는 잠금 해제 동안만 메모리에 보관해요. 라이브러리 백업에는 API 키가 포함되지 않습니다. 생성 버튼을 누르면 선택한 엔진에 프롬프트와 참조 이미지가 전송되며 API 비용이 발생할 수 있어요.</p></section><section class="panel"><h3>World의 캐릭터 시트</h3><p class="section-sub">생성한 시트를 확인하고 확정하면 이후 장면의 참조로 사용합니다.</p><div class="ig-sheets">${state.characters
    .filter((c) => !c.archivedAt && world.characterIds.includes(c.id))
    .map((c) => renderSheetRow(c, state))
    .join(
      "",
    )}</div><div class="notice" style="margin-top:18px">기존 샘플 시트는 캐릭터의 모습과 색상을 고정한 SVG입니다. 원하는 엔진으로 다시 생성한 뒤 부모가 확정할 수 있어요.</div><p class="small-label" style="margin-top:18px">엔진이 시드를 지원하면 결과 시드를 저장합니다. 지원하지 않으면 요청 시드와 지원 여부를 기록해요.</p></section></div><section class="panel ig-preset-panel"><h3>화풍 프리셋 테이블</h3><div class="ig-preset-table"><table><thead><tr><th>name · 레퍼런스</th><th>stylePrompt / negativePrompt</th><th>palette</th></tr></thead><tbody>${listStylePresets(
    state,
  )
    .map(
      (s) =>
        `<tr class="${s.id === preset.id ? "selected-preset" : ""}"><td>${stylePreview(s) ? `<img src="${escape(stylePreview(s))}" alt="${escape(s.name)}의 색과 질감 참조">` : "<small>스타일 시트 생성 전</small>"}<strong>${escape(s.name)}</strong><small>styleRefImages ${s.styleRefImages.length}장</small></td><td><p>${escape(s.stylePrompt)}</p><small>negativePrompt: ${escape(s.negativePrompt)}</small></td><td><div class="ig-palette">${s.palette.map((color) => `<span style="background:${color}" title="${color}"></span>`).join("")}</div><small>${s.palette.map(escape).join(" ")}</small></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div></section><section class="panel ig-compare-panel"><h3>같은 프롬프트로 엔진 3개 비교</h3><p class="section-sub">같은 캐릭터 시트·화풍 참조·요청 시드·크기를 사용합니다. 현재 World의 확정 시트는 바뀌지 않아요.</p><form id="ig-compare-form"><div class="field"><label for="ig-compare-prompt">비교할 장면</label><textarea id="ig-compare-prompt" required maxlength="3000">노란 티셔츠를 입은 아이가 작은 초록 공룡 친구와 함께 햇살이 드는 숲길을 걸어요. 참조 이미지의 얼굴, 의상, 색상을 그대로 유지하고 그림 안에는 글자를 넣지 마세요.</textarea></div><div class="ig-engine-checks">${ENGINE_IDS.map((id, i) => `<label><input name="ig-compare-engine" type="checkbox" value="${id}" ${i < 3 ? "checked" : ""}><span>${escape(meta(id).name)}</span><small data-credential-status="${id}">${id === "sample" ? "무료 · 키 없음" : credentialStatus[id] ? "키 저장됨" : id === "local" ? "엔드포인트 필요" : "키 필요"}</small></label>`).join("")}</div><div class="form-grid"><div class="field"><label for="ig-compare-seed">동일 요청 시드</label><input id="ig-compare-seed" type="number" min="0" max="2147483647" step="1" value="20261014" required></div><div class="field"><label for="ig-compare-size">크기</label><select id="ig-compare-size"><option value="1024x1024">1024 × 1024</option><option value="1536x1024">1536 × 1024</option></select></div></div><div class="modal-actions"><span class="small-label" id="ig-compare-progress">${comparisonRunning ? "2~3개 엔진 비교 중…" : "선택한 엔진마다 draft 생성 요청이 실행됩니다."}</span><button type="submit" class="btn btn-primary" ${comparisonRunning ? "disabled" : ""}>선택한 엔진으로 비교 생성</button></div></form><div class="ig-comparison-results" id="ig-comparison-results">${renderComparisonResults()}</div></section></section>`;
}
function renderSheetRow(character, state) {
  const world = getActiveWorld(state);
  const sheet = getCharacterSheet(state, character.id, world);
  const current =
    sheet?.worldRevision === world.revision &&
    sheet?.imageEngine === world.imageEngine &&
    sheet?.stylePresetId === world.stylePresetId;
  return `<div class="ig-sheet-row"><div><strong>${escape(character.name)}</strong><small>${current ? (character.autoReviewPending ? "자동 생성 시트 · 검토 필요" : sheet.meta?.source === "local-svg" ? "샘플 SVG 시트 확정" : "현재 World 시트 확정") : "시트 다시 생성 필요"}</small></div><span class="ig-sheet-revision ${current ? "" : "stale"}">${current ? "v" + sheet.worldRevision : "새 시트 필요"}</span>${button("시트 생성", "generate-sheet", `data-id="${escape(character.id)}"`)}</div>`;
}
export function renderCharacterImageControls(character, state) {
  const world = getActiveWorld(state);
  const sheet = getCharacterSheet(state, character.id, world);
  return `<div class="ig-character-controls"><small>${sheet && sheet.worldRevision === world.revision ? "World 시트 확정" : "시트 다시 생성 필요"}</small>${button("엔진으로 시트 생성", "generate-sheet", `data-id="${escape(character.id)}"`)}</div>`;
}
export function renderGenerationControls(book) {
  const world = getActiveWorld(api.getState()),
    engine = book.generationSnapshot?.imageEngine || world.imageEngine,
    estimated = estimateBookCost({
      engine,
      pageCount: book.pages.length,
      quality: "draft",
      includeCover: false,
      size: "1536x1024",
      config: {
        ...world.providerConfig?.[engine],
        ...book.generationSnapshot?.imageModelConfig,
      },
    });
  const generated = book.pages.filter(
    (p) => p.imageAssetId || p.imageUrl,
  ).length;
  return `<div class="ig-editor-bar"><div><strong>World 엔진으로 미리보기 만들기</strong><small>${generated} / ${book.pages.length}쪽 생성 · 캐릭터·옷장·스타일·고정 장소 참조 · 앞쪽부터 순서대로 생성 · 전체 draft 예상 $${estimated.costUsd.toFixed(2)} · 유사 그림은 책당 확인 후 선택한 쪽만 다시 생성</small>${book.pages[api.getEditPage?.() || 0]?.imageDiversity?.warning ? `<small role="status">${escape(book.pages[api.getEditPage?.() || 0].imageDiversity.warning)}</small>` : ""}${book.imageTimeWarning ? `<small role="status">${escape(book.imageTimeWarning.message)}</small>` : ""}</div><button type="button" class="btn btn-outline" data-ig-action="generate-page">이 쪽 draft 생성</button><button type="button" class="btn btn-outline" data-ig-action="change-composition">이 쪽 다른 구도로</button><button type="button" class="btn btn-green" data-ig-action="generate-book">${book.pages.length}쪽 draft 전체 생성</button></div>`;
}
function renderComparisonResults() {
  return comparisonResults
    .map(
      (r) =>
        `<article class="ig-comparison-card"><strong>${escape(meta(r.engine).name)}</strong><small>${escape(meta(r.engine).model)}</small>${r.error ? `<div class="ig-comparison-error">${escape(r.error)}</div>` : `<img src="${escape(r.result.imageUrl)}" alt="${escape(meta(r.engine).name)}로 만든 비교 장면"><small>${formatSeed(r.result)} · 요청 ${escape(r.result.meta?.requestedSeed ?? "—")}</small><small>참조 ${r.result.meta?.referenceCount ?? 0}장 · ${Math.round(r.ms / 1000)}초</small>${button("이 엔진 쓰기", "use-engine", `data-engine="${escape(r.engine)}"`)}`}</article>`,
    )
    .join("");
}
async function refreshStatuses() {
  try {
    credentialStatus = await listCredentialStatus();
    document.querySelectorAll("[data-credential-status]").forEach((el) => {
      const id = el.dataset.credentialStatus;
      el.textContent =
        id === "sample"
          ? "무료 · 키 없음"
          : credentialStatus[id] === "corrupt"
            ? "손상됨 · 삭제 후 다시 등록"
            : credentialStatus[id]
              ? "키 저장됨 · 암호화 보관"
              : id === "local"
                ? "인증 토큰 없음 · 선택"
                : "키 필요";
    });
  } catch (error) {
    api?.toast(error.message);
  }
}
function engineConfig(state, engine) {
  const world = getActiveWorld(state);
  return (
    world.providerConfig?.[engine] ||
    state.settings.imageProviderConfig?.[engine] ||
    {}
  );
}
function updateProviderConfig(world, engine) {
  world.providerConfig = world.providerConfig || {};
  if (engine !== "local") return;
  const endpoint = document.querySelector("#ig-endpoint")?.value.trim();
  const raw = document.querySelector("#ig-workflow")?.value.trim();
  if (!endpoint || !/^https?:\/\//.test(endpoint))
    throw new Error("ComfyUI의 HTTP 또는 HTTPS 엔드포인트를 입력해 주세요.");
  let workflow = null;
  if (raw) {
    try {
      workflow = JSON.parse(raw);
    } catch {
      throw new Error("워크플로 JSON 형식을 확인해 주세요.");
    }
  }
  world.providerConfig.local = {
    ...world.providerConfig.local,
    endpoint,
    workflow,
  };
}
export function configureImageUI(context) {
  api = context;
  refreshStatuses();
  document.addEventListener("change", (e) => {
    if (e.target.id === "ig-engine") {
      const state = api.getState();
      document.querySelector("#ig-provider-fields").innerHTML = providerFields(
        getActiveWorld(state),
        e.target.value,
      );
    }
    if (e.target.id === "ig-style") {
      const preset = getStylePreset(e.target.value),
        image = document.querySelector(".ig-style-target img");
      if (image && stylePreview(preset)) {
        image.src = stylePreview(preset);
        image.alt = preset.name;
      }
    }
  });
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-ig-action]");
    if (!el) return;
    e.preventDefault();
    api.protectedAction(async () => {
      try {
        const action = el.dataset.igAction,
          engine =
            document.querySelector("#ig-engine")?.value ||
            getActiveWorld(api.getState()).imageEngine;
        if (action === "save-key") {
          const field = document.querySelector("#ig-api-key");
          document.querySelector("#ig-key-error").textContent = "";
          field.removeAttribute("aria-invalid");
          const key = field.value;
          await saveCredential(engine, key);
          field.value = "";
          await refreshStatuses();
          api.toast(meta(engine).name + " 키를 암호화해 저장했어요.");
          return;
        }
        if (action === "delete-key") {
          await removeCredential(engine);
          document.querySelector("#ig-api-key").value = "";
          await refreshStatuses();
          api.toast("이 엔진의 저장된 키를 삭제했어요.");
          return;
        }
        if (action === "cancel-generation") {
          currentOperation?.abort();
          api.closeModal();
          return;
        }
        if (action === "use-engine") {
          chooseComparedEngine(el.dataset.engine);
          return;
        }
        if (action === "generate-sheet") {
          await runSheetGeneration(el.dataset.id);
          return;
        }
        if (
          action === "generate-page" ||
          action === "generate-book" ||
          action === "change-composition"
        ) {
          await runSceneGeneration(
            action === "generate-book",
            action === "change-composition",
          );
          return;
        }
      } catch (error) {
        if (el.dataset.igAction === "save-key") {
          const message = document.querySelector("#ig-key-error");
          if (message) message.textContent = error.message;
          document
            .querySelector("#ig-api-key")
            ?.setAttribute("aria-invalid", "true");
        }
        api.toast(error.message);
      }
    });
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id === "ig-world-form") {
      e.preventDefault();
      api.protectedAction(() => saveWorldSettings());
    }
    if (e.target.id === "ig-compare-form") {
      e.preventDefault();
      api.protectedAction(() => compareEngines());
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentOperation) currentOperation.abort();
  });
}
function saveWorldSettings() {
  try {
    const state = api.getState(),
      world = getActiveWorld(state),
      engine = document.querySelector("#ig-engine").value,
      style = document.querySelector("#ig-style").value,
      name = document.querySelector("#ig-world-name").value.trim();
    const configInput =
      engine === "local"
        ? {
            endpoint: document.querySelector("#ig-endpoint").value.trim(),
            workflow: document.querySelector("#ig-workflow").value.trim(),
          }
        : null;
    const connection = {
      proxyEndpoint:
        document.querySelector("#ig-proxy-endpoint")?.value.trim() || "",
      googlePro: document.querySelector("#ig-google-pro")?.checked || false,
    };
    if (engine === "google")
      connection.modelVariant = connection.googlePro ? "pro" : "default";
    if (connection.proxyEndpoint) {
      const address = new URL(connection.proxyEndpoint);
      if (
        !["https:", "http:"].includes(address.protocol) ||
        address.username ||
        address.password ||
        address.search ||
        address.hash
      )
        throw new Error("프록시 주소를 확인해 주세요.");
    }
    const changed =
      engine !== world.imageEngine ||
      style !== world.stylePresetId ||
      (engine === "google" &&
        connection.googlePro !==
          Boolean(world.providerConfig?.google?.googlePro));
    const apply = () => {
      if (configInput) {
        world.providerConfig = world.providerConfig || {};
        let workflow = null;
        if (configInput.workflow) {
          try {
            workflow = JSON.parse(configInput.workflow);
          } catch {
            throw new Error("워크플로 JSON 형식을 확인해 주세요.");
          }
        }
        if (!/^https?:\/\//.test(configInput.endpoint))
          throw new Error("ComfyUI 엔드포인트를 확인해 주세요.");
        world.providerConfig.local = {
          ...world.providerConfig.local,
          endpoint: configInput.endpoint,
          workflow,
        };
      }
      world.providerConfig ||= {};
      if (!["local", "sample"].includes(engine))
        world.providerConfig[engine] = {
          ...world.providerConfig[engine],
          ...connection,
          transport: connection.proxyEndpoint ? "proxy" : "direct",
        };
      const result = updateWorldGenerationSettings(state, {
        imageEngine: engine,
        stylePresetId: style,
        modelVariant: connection.googlePro ? "pro" : "default",
      });
      world.name = name || world.name;
      state.settings.style = styleName(style);
      api.save();
      api.closeModal();
      api.render();
      api.toast(
        result.requiresRegeneration
          ? "World 설정을 바꿨어요. 캐릭터 시트를 다시 생성하고 확정해 주세요."
          : "World 이미지 설정을 저장했어요.",
      );
    };
    if (changed && state.characters.some((c) => c.characterSheets?.length)) {
      api.showModal(
        `${api.modalHeader("시트 다시 생성 필요")}<p class="modal-intro">${escape(meta(world.imageEngine).name)} · ${escape(styleName(world.stylePresetId))}에서<br><strong>${escape(meta(engine).name)} · ${escape(styleName(style))}</strong>로 변경합니다.<br><br>새 장면에는 이 World 설정으로 다시 생성하고 확정한 캐릭터 시트가 필요합니다. 기존 책은 생성 당시의 시트와 화풍을 보관합니다.</p><div class="modal-actions"><button type="button" class="btn btn-outline" id="ig-world-cancel">취소</button><button type="button" class="btn btn-primary" id="ig-world-confirm">변경하고 시트 다시 생성</button></div>`,
      );
      document.querySelector("#ig-world-cancel").onclick = api.closeModal;
      document.querySelector("#ig-world-confirm").onclick = () => {
        try {
          apply();
        } catch (err) {
          api.toast(err.message);
        }
      };
    } else apply();
  } catch (error) {
    api.toast(error.message);
  }
}
async function comparisonConfig(state, engine) {
  const { getCredential } = await import("./vault.js");
  const config = engineConfig(state, engine);
  const proxy = config.proxyEndpoint || config.transport === "proxy";
  const apiKey =
    engine === "sample" || proxy ? null : await getCredential(engine);
  if (meta(engine).requiresKey && !apiKey && !proxy)
    throw new Error(
      meta(engine).name + "의 API 키를 먼저 암호화해 저장해 주세요.",
    );
  if (engine === "local" && !config.endpoint)
    throw new Error(
      "ComfyUI 엔드포인트와 참조를 사용하는 워크플로를 저장해 주세요.",
    );
  return { ...config, apiKey };
}
export async function compareEngines() {
  if (comparisonRunning || currentOperation) return;
  const chosen = [
    ...document.querySelectorAll("[name=ig-compare-engine]:checked"),
  ].map((e) => e.value);
  if (chosen.length < 2 || chosen.length > 3) {
    api.toast("비교할 엔진을 2~3개 골라 주세요.");
    return;
  }
  const state = api.getState(),
    world = getActiveWorld(state),
    prompt = document.querySelector("#ig-compare-prompt").value.trim(),
    seed = Number(document.querySelector("#ig-compare-seed").value),
    size = document.querySelector("#ig-compare-size").value;
  if (!prompt || !Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    api.toast("프롬프트와 0–2147483647 사이의 시드를 입력해 주세요.");
    return;
  }
  const preset = getStylePreset(world.stylePresetId);
  const sheets = state.characters
    .filter((c) => !c.archivedAt && world.characterIds.includes(c.id))
    .map((c) => getCharacterSheet(state, c.id, world))
    .filter(Boolean)
    .slice(0, 2);
  const refs = [
    ...sheets.map((sheet) => ({
      imageUrl: resolveSheet(sheet),
      role: "character_front",
      label: sheet.characterSnapshot?.name || sheet.characterId,
    })),
    ...safeStyleReferences(state, world).map((reference) => ({
      ...reference,
      label: preset.name,
    })),
  ];
  if (!sheets.length) {
    api.toast("비교할 캐릭터 시트를 한 명 이상 확정해 주세요.");
    return;
  }
  const operation = new AbortController();
  currentOperation = operation;
  let configs;
  try {
    configs = await Promise.all(
      chosen.map((engine) => comparisonConfig(state, engine)),
    );
  } catch (error) {
    if (currentOperation === operation) currentOperation = null;
    if (!operation.signal.aborted) api.toast(error.message);
    return;
  }
  if (operation.signal.aborted) return;
  comparisonRunning = true;
  comparisonResults = [];
  const submit = document.querySelector("#ig-compare-form button[type=submit]");
  submit.disabled = true;
  document.querySelector("#ig-compare-progress").textContent =
    "같은 프롬프트로 2~3개 엔진 비교 중…";
  document.querySelector("#ig-comparison-results").innerHTML = "";
  await Promise.all(
    chosen.map(async (engine, i) => {
      const start = performance.now();
      let item;
      try {
        const result = await generateImage(
          {
            prompt,
            stylePreset: preset,
            referenceImages: refs,
            seed,
            size,
            quality: "draft",
            signal: operation.signal,
            sampleContext: {
              kind: "scene",
              scene: { theme: "dinosaur", beat: "walk" },
              characters: sheets.map((sheet) => sheet.characterSnapshot),
            },
          },
          { engine, config: configs[i] },
        );
        item = { engine, result, ms: performance.now() - start };
      } catch (error) {
        item = { engine, error: error.message, ms: performance.now() - start };
      }
      if (operation.signal.aborted) return;
      comparisonResults.push(item);
      comparisonResults.sort(
        (a, b) => chosen.indexOf(a.engine) - chosen.indexOf(b.engine),
      );
      const panel = document.querySelector("#ig-comparison-results");
      if (panel) panel.innerHTML = renderComparisonResults();
    }),
  );
  comparisonRunning = false;
  if (currentOperation === operation) currentOperation = null;
  if (operation.signal.aborted) return;
  const progress = document.querySelector("#ig-compare-progress");
  if (progress)
    progress.textContent = "비교 완료 · 결과는 라이브러리에 저장되지 않습니다.";
  if (submit.isConnected) submit.disabled = false;
}
function operationModal(title, message) {
  api.showModal(
    `<div class="modal-header"><h3>${escape(title)}</h3><button type="button" class="close-btn" data-ig-action="cancel-generation" aria-label="생성 취소하고 닫기">×</button></div><div class="ig-operation-progress"><div class="spinner"></div><p id="ig-operation-message">${escape(message)}</p><small>${getActiveWorld(api.getState()).imageEngine === "sample" ? "기기 안에서 고정 그림 템플릿을 만들고 있습니다." : "캐릭터 외모와 실제 화풍 참조를 함께 전송하고 있습니다."}</small></div><div class="modal-actions"><button type="button" class="btn btn-outline" data-ig-action="cancel-generation">생성 취소</button></div>`,
  );
}
export async function previewNewCharacter(character) {
  return runSheetGeneration(character);
}
export function cleanupImageUI() {
  currentOperation?.abort();
  currentOperation = null;
  comparisonRunning = false;
  if (pendingSheetCandidate) {
    const candidate = pendingSheetCandidate;
    pendingSheetCandidate = null;
    void deleteImageAsset(candidate.imageAssetId).catch(() => {});
  }
}
async function runSheetGeneration(input, { quality = "draft", seed } = {}) {
  if (currentOperation) {
    api.toast("현재 생성을 마친 뒤 다시 시도해 주세요.");
    return;
  }
  const state = api.getState(),
    character =
      typeof input === "object"
        ? input
        : state.characters.find((c) => c.id === input),
    id = character?.id;
  if (!character) throw new Error("캐릭터를 찾을 수 없어요.");
  const isNew = !state.characters.some((c) => c.id === id);
  const operation = new AbortController();
  currentOperation = operation;
  operationModal(
    character.name + "의 시트 생성",
    "정면·측면·뒷모습과 표정을 한 장에 만들어요.",
  );
  try {
    const result = await generateCharacterSheet(state, character, {
      quality,
      seed,
      signal: operation.signal,
    });
    if (
      operation.signal.aborted ||
      api.getState() !== state ||
      !api.isParent()
    ) {
      await deleteImageAsset(result.imageAssetId);
      throw new DOMException("생성을 취소했어요.", "AbortError");
    }
    currentOperation = null;
    pendingSheetCandidate = result;
    api.showModal(
      `${api.modalHeader(escape(character.name + "의 시트를 확인해 주세요"))}<img class="ig-sheet-preview" src="${escape(result.imageUrl)}" alt="${escape(character.name)}의 새 캐릭터 시트"><p class="modal-intro">얼굴, 옷과 표정이 같은 친구로 보이는지 확인해 주세요. ${formatSeed(result)} · 요청 ${escape(result.meta?.requestedSeed ?? "—")}</p><div class="modal-actions"><button type="button" class="btn btn-outline" id="ig-sheet-cancel">확정하지 않기</button><button type="button" class="btn btn-primary" id="ig-sheet-confirm">${quality === "draft" && getActiveWorld(state).imageEngine !== "sample" ? "최종 시트 생성 · 예상 $" + estimateImageCost({ engine: getActiveWorld(state).imageEngine, quality: "final", size: "1536x1024", config: engineConfig(state, getActiveWorld(state).imageEngine) }).costUsd.toFixed(2) : "이 최종 시트 확정"}</button></div>`,
      "wide",
    );
    document.querySelector("#ig-sheet-cancel").onclick = api.closeModal;
    document.querySelector("#ig-sheet-confirm").onclick = async (event) => {
      const button =
        event?.currentTarget || document.querySelector("#ig-sheet-confirm");
      button.disabled = true;
      try {
        if (
          quality === "draft" &&
          getActiveWorld(state).imageEngine !== "sample"
        ) {
          await deleteImageAsset(result.imageAssetId);
          pendingSheetCandidate = null;
          await runSheetGeneration(character, {
            quality: "final",
            seed: result.meta.requestedSeed,
          });
          return;
        }
        const previousCharacters = structuredClone(state.characters),
          previousWorlds = structuredClone(state.worlds);
        if (isNew) state.characters.push(structuredClone(character));
        markCharacterSheetConfirmed(state, id, result);
        if (api.save() === false) {
          state.characters = previousCharacters;
          state.worlds = previousWorlds;
          return;
        }
        pendingSheetCandidate = null;
        api.closeModal();
        api.render();
        api.toast(character.name + "의 World 시트를 확정했어요.");
      } catch (error) {
        api.toast(error.message);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    };
  } catch (error) {
    if (currentOperation === operation) {
      currentOperation = null;
      api.closeModal();
    }
    if (
      isNew &&
      error.name !== "AbortError" &&
      api.isParent() &&
      api.getState() === state
    )
      api.onNewCharacterFailure?.();
    api.toast(
      error.name === "AbortError" ? "시트 생성을 취소했어요." : error.message,
    );
  }
}
export function selectSimilarPages(book, { quality = "final", signal } = {}) {
  const pages = (book.pages || []).flatMap((page, index) =>
    page.imageDiversity?.tooSimilar ? [index] : [],
  );
  const state = api.getState(),
    world = getActiveWorld(state),
    engine = book.generationSnapshot?.imageEngine || world.imageEngine;
  if (!pages.length || engine === "sample" || book.similarityReviewDismissed)
    return Promise.resolve([]);
  const unit = estimateImageCost({
    engine,
    quality,
    size: "1536x1024",
    config: {
      ...world.providerConfig?.[engine],
      ...book.generationSnapshot?.imageModelConfig,
    },
  }).costUsd;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("작업을 중지했어요.", "AbortError"));
    };
    const done = (selected) => {
      signal?.removeEventListener("abort", abort);
      book.similarityReviewDismissed = true;
      resolve(selected);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    api.showModal(
      `${api.modalHeader(`비슷한 구도 ${pages.length}쪽 · 다시 그릴까요?`)}<p>고른 쪽만 추가 생성해요. 쪽당 약 $${unit.toFixed(3)} · 모두 선택하면 약 $${(unit * pages.length).toFixed(3)}.</p>${pages.map((index) => `<label class="similar-page-choice"><input name="similar-final-page" type="checkbox" value="${index}">${index + 1}쪽</label>`).join("")}<p id="similar-final-error" role="status"></p><div class="modal-actions"><button class="btn btn-outline" id="similar-final-keep">지금 그림 유지하고 확정</button><button class="btn btn-green" id="similar-final-retry">고른 쪽 다시 그리기</button></div>`,
    );
    document.querySelector("#similar-final-keep").onclick = () => done([]);
    document.querySelector("#similar-final-retry").onclick = () => {
      const selected = [
        ...document.querySelectorAll('[name="similar-final-page"]:checked'),
      ].map((input) => Number(input.value));
      if (!selected.length) {
        document.querySelector("#similar-final-error").textContent =
          "다시 그릴 쪽을 골라 주세요.";
        return;
      }
      done(selected);
    };
  });
}

/** A paid retry always requires this explicit, per-book selection. */
export function showSimilarPagesReview(book, { quality = "draft" } = {}) {
  const similarPages = (book.pages || []).flatMap((page, index) =>
    page.imageDiversity?.tooSimilar ? [index] : [],
  );
  const state = api.getState(),
    world = getActiveWorld(state),
    engine = book.generationSnapshot?.imageEngine || world.imageEngine;
  if (
    !similarPages.length ||
    engine === "sample" ||
    book.similarityReviewDismissed
  )
    return;
  const unit = estimateImageCost({
    engine,
    quality,
    size: "1536x1024",
    config: {
      ...world.providerConfig?.[engine],
      ...book.generationSnapshot?.imageModelConfig,
    },
  }).costUsd;
  api.showModal(
    `${api.modalHeader("비슷한 구도 " + similarPages.length + "쪽 · 다시 그릴까요?")}<p>선택한 쪽만 추가 생성해요. 쪽당 예상 $${unit.toFixed(3)} · 전체 선택 시 약 $${(unit * similarPages.length).toFixed(3)}. 실제 요금은 공급자에서 확인해 주세요.</p><div class="similar-pages-options">${similarPages.map((index) => `<label><input type="checkbox" name="similar-page" value="${index}">${index + 1}쪽</label>`).join("")}</div><p id="similar-retry-error" role="status"></p><div class="modal-actions"><button class="btn btn-outline" id="similar-keep">지금 그림 유지</button><button class="btn btn-primary" id="similar-confirm">선택한 쪽만 다시 그리기</button></div>`,
  );
  document.querySelector("#similar-keep").onclick = () => {
    book.similarityReviewDismissed = true;
    api.syncDraft?.();
    api.save();
    api.closeModal();
  };
  document.querySelector("#similar-confirm").onclick = async () => {
    const indexes = [
      ...document.querySelectorAll('[name="similar-page"]:checked'),
    ].map((input) => Number(input.value));
    if (!indexes.length) {
      document.querySelector("#similar-retry-error").textContent =
        "다시 그릴 쪽을 선택해 주세요.";
      return;
    }
    const operation = new AbortController();
    currentOperation = operation;
    operationModal(
      "선택한 쪽의 구도를 바꾸고 있어요",
      `추가 생성 ${indexes.length}쪽 · 예상 $${(unit * indexes.length).toFixed(3)}`,
    );
    try {
      for (const index of indexes) {
        await generateScene(state, book, index, {
          quality,
          changeComposition: true,
          signal: operation.signal,
        });
        api.syncDraft?.();
        api.save();
      }
      book.similarityReviewDismissed = true;
      if (currentOperation === operation) currentOperation = null;
      api.closeModal();
      api.render();
      api.toast("선택한 쪽의 새 그림을 저장했어요.");
    } catch (error) {
      if (currentOperation === operation) currentOperation = null;
      api.closeModal();
      api.render();
      api.toast(
        error.name === "AbortError"
          ? "중지했어요. 완료한 그림은 보관합니다."
          : error.message,
      );
    } finally {
      api.syncDraft?.();
      api.save();
    }
  };
}
async function runSceneGeneration(all, changeComposition = false) {
  if (currentOperation) return;
  api.syncDraft();
  const book = api.getDraft();
  if (!book) {
    api.toast("이야기 초안을 먼저 만들어 주세요.");
    return;
  }
  const state = api.getState(),
    pageIndex = api.getEditPage();
  const operation = new AbortController();
  currentOperation = operation;
  operationModal(
    all ? "이야기의 그림을 엮고 있어요" : "이 쪽의 그림을 만들고 있어요",
    all
      ? `0 / ${book.pages.length}쪽 · 확정된 시트가 모든 장면에 함께해요.`
      : `${pageIndex + 1}쪽 · 다른 쪽은 유지됩니다.`,
  );
  try {
    if (all)
      await generateAllScenes(state, book, {
        quality: "draft",
        signal: operation.signal,
        onProgress: (p) => {
          if (p.status === "complete") {
            api.syncDraft();
            api.save();
          }
          const el = document.querySelector("#ig-operation-message");
          if (el)
            el.textContent = `${p.completed} / ${p.total}쪽 생성${p.pageIndex == null ? "" : " · " + (p.pageIndex + 1) + "쪽"} ${p.status === "complete" ? "완료" : "작업 중"}`;
        },
      });
    else
      await generateScene(state, book, pageIndex, {
        quality: "draft",
        changeComposition,
        signal: operation.signal,
      });
    if (operation.signal.aborted || api.getState() !== state || !api.isParent())
      throw new DOMException("생성을 취소했어요.", "AbortError");
    currentOperation = null;
    api.closeModal();
    api.render();
    api.toast(
      all
        ? "모든 장면에 같은 시트와 화풍을 사용했어요. 내용을 확인하고 확정해 주세요."
        : "이 쪽의 생성 그림과 시드를 저장했어요.",
    );
    if (all) showSimilarPagesReview(book);
  } catch (error) {
    if (currentOperation === operation) {
      currentOperation = null;
      api.closeModal();
    }
    api.render();
    api.toast(
      error.name === "AbortError"
        ? "생성을 취소했어요. 완료된 쪽은 초안에 남아 있어요."
        : error.message,
    );
  } finally {
    api.syncDraft();
    api.save();
  }
}

function chooseComparedEngine(engine) {
  const state = api.getState(),
    world = getActiveWorld(state);
  if (engine === world.imageEngine) {
    api.toast("이미 이 엔진을 사용하고 있어요.");
    return;
  }
  const apply = () => {
    updateWorldGenerationSettings(state, {
      imageEngine: engine,
      stylePresetId: world.stylePresetId,
    });
    if (api.save()) {
      api.closeModal();
      api.render();
      api.toast(
        "이 엔진을 World 기본으로 정했어요. 캐릭터 시트를 다시 생성해 주세요.",
      );
    }
  };
  api.showModal(
    `${api.modalHeader("그림체가 달라집니다")}<p class="modal-intro">${escape(meta(engine).name)}를 사용하면 캐릭터 시트를 다시 만들어야 합니다. 기존 책은 원래 그림과 참조를 보관합니다.</p><div class="modal-actions"><button type="button" class="btn btn-outline" id="ig-use-cancel">취소</button><button type="button" class="btn btn-primary" id="ig-use-confirm">시트 다시 만들기</button></div>`,
  );
  document.querySelector("#ig-use-cancel").onclick = api.closeModal;
  document.querySelector("#ig-use-confirm").onclick = apply;
}
