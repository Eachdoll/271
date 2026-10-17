import {
  generateOutline,
  rewriteBeat,
  generateProse,
  rewriteParagraph,
  paginateStory,
  rewriteStoryPage,
  repairPagination,
  summarizeStory,
  inspectOutlineRules,
  preflightOutlineLocations,
  isHomeBackground,
  paragraphBeatLabels,
  generateSceneBriefs,
  rewriteSceneBrief,
  enrichProse,
  ensurePlotContract,
  reviewStoryCoherence,
  finalizeStoryPagination,
} from "./pipeline.js";
import { BRIEF_TIMES, inspectSceneBriefs } from "./scene-briefs.js";
import {
  SHOTS,
  SHOT_LABELS,
  stagePagination,
  updatePageStaging,
} from "./staging.js";
import { buildBeatPagePlan, splitPaginationToCount } from "./pagination.js";
import {
  listTextModels,
  getTextModelInfo,
  resolveTextModel,
  resolveStoryStageSettings,
  resolveQualityStageSettings,
} from "../text-generation/models.js";
import {
  getTextGenerationSettings,
  normalizeStoryQualitySettings,
} from "../text-generation/settings-ui.js";
import { freezeReadingLevels } from "../reading-levels.js";
import { getActiveWorld } from "../image-generation/world.js";
import {
  availableCharacterVariants,
  validateWardrobeSelections,
} from "../wardrobe.js";
import { checkStory } from "./checker.js";
import { checkRichness } from "./richness.js";
import { getStylePreset } from "../image-generation/styles.js";
import { buildSeriesStorySelections } from "./continuity.js";
import {
  STORY_STRUCTURE_PRESETS,
  resolveStructurePreset,
} from "./plot-contract.js";
import { isCoherenceCurrent, coherenceFingerprint } from "./coherence.js";
import {
  renderQualityPatternSelector,
  renderQualityWorldSelectors,
  storyQualityBookRecords,
} from "./quality-settings.js";

const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clone = (v) => JSON.parse(JSON.stringify(v));
const button = (label, action, data = "", kind = "outline") =>
  `<button type="button" class="btn btn-${kind} btn-small" data-story-action="${action}" ${data}>${label}</button>`;
const STAGE_NAMES = {
  outline_draft: "줄거리 검토",
  outline_ok: "승인한 줄거리",
  prose_draft: "전문 검토",
  prose_ok: "승인한 전문",
  paged: "쪽 나누기 검토",
  illustrated: "그림 생성",
  final: "완성",
};
const TEXT_ENGINE_IDS = Object.freeze([
  "openai",
  "google",
  "anthropic",
  "local",
]);
let api,
  session,
  configured = false,
  saveTimer;

const TIME_LABELS = {
  morning: "아침",
  day: "낮",
  afternoon: "오후",
  evening: "저녁",
  night: "밤",
};
const BRIEF_FIELDS = [
  ["weather", "날씨"],
  ["light", "빛"],
  ["sounds.0", "소리 1"],
  ["sounds.1", "소리 2"],
  ["smellOrTouch", "냄새·촉감"],
  ["props.0", "소품 1"],
  ["props.1", "소품 2"],
  ["props.2", "소품 3"],
  ["creature", "작은 생물"],
  ["pose", "그릴 동작"],
];
function stagingContext(d) {
  return {
    outline: d.outline,
    sceneBriefs: d.sceneBriefs || [],
    bookId: d.bookId || d.id,
    stylePreset:
      d.worldSnapshot?.stylePreset ||
      getStylePreset(d.worldSnapshot?.stylePresetId),
    backgrounds: d.input.backgrounds,
    preserveManual: true,
  };
}
/** A completed request survives cancellation; only dependent products are invalidated. */
export function invalidateStoryDetails(
  d,
  { outline = false, prose = false } = {},
) {
  if (outline) {
    d.sceneBriefs = null;
    d.sceneBriefsMeta = null;
  }
  if (!prose) {
    d.prose = null;
    d.hybridFinal = false;
  }
  d.enrichmentCheckpoint = null;
  d.enrichmentSourceProse = null;
  d.enrichmentPending = false;
  d.pagination = null;
  d.paginationMeta = null;
  d.richnessCheck = null;
  d.checksDirty = true;
  d.pageCoherence = null;
  d.proseCoherenceDirty = true;
  d.stage = outline ? "outline_draft" : prose ? "prose_draft" : "outline_ok";
  return d;
}
export function applyStoryCheckpoint(d, checkpoint) {
  if (checkpoint?.qualityCheckpoint)
    d.qualityCheckpoint = clone(checkpoint.qualityCheckpoint);
  if (checkpoint?.childGateCheckpoint) {
    d.childGateCheckpoint = clone(checkpoint.childGateCheckpoint);
    if (
      checkpoint.childGateCheckpoint.phase === "complete" ||
      checkpoint.childGateCheckpoint.curiosity
    ) {
      d.childGate = clone(checkpoint.childGateCheckpoint);
      d.childGatePending = false;
    } else d.childGatePending = true;
  }
  if (checkpoint?.childGatePending) d.childGatePending = true;
  if (checkpoint?.coherence) {
    const report = checkpoint.coherence;
    if (report.stage === "pages") d.pageCoherence = clone(report);
    else {
      d.proseCoherence = clone(report);
      d.proseCoherenceDirty = false;
    }
  }
  if (checkpoint?.stage === "coherence") {
    if (checkpoint.prose) d.prose = clone(checkpoint.prose);
    if (checkpoint.pagination) {
      d.pagination = clone(checkpoint.pagination);
      d.stage = "paged";
      return "pages";
    }
    if (checkpoint.prose) {
      d.stage = "prose_draft";
      return "prose";
    }
  }
  if (checkpoint?.sceneBriefs) {
    d.sceneBriefs = clone(checkpoint.sceneBriefs);
    d.sceneBriefsMeta = { ...(d.sceneBriefsMeta || {}), incomplete: true };
  }
  if (checkpoint?.stage === "enrichment") {
    if (checkpoint.prose) d.prose = clone(checkpoint.prose);
    if (checkpoint.enrichmentCheckpoint)
      d.enrichmentCheckpoint = clone(checkpoint.enrichmentCheckpoint);
    d.enrichmentPending = true;
    d.stage = "prose_draft";
    return "prose";
  }
  if (checkpoint?.pagination) {
    d.pagination = clone(checkpoint.pagination);
    d.storyCheck = clone(checkpoint.checks || {});
    d.richnessCheck = clone(
      checkpoint.richnessChecks ||
        checkpoint.richnessCheck ||
        checkpoint.richness ||
        d.richnessCheck ||
        null,
    );
    d.paginationMeta = {
      checks: clone(checkpoint.checks || {}),
      richnessCheck: d.richnessCheck,
      repairAttempts: checkpoint.repairAttempts,
      incomplete: true,
    };
    d.stage = "paged";
    return "pages";
  }
  return null;
}
export function updateStoryBriefField(briefs, index, path, value) {
  const next = clone(briefs),
    parts = String(path).split(".");
  if (
    !next[index] ||
    !(
      /^(?:timeOfDay|dialogueLine|humor)$/.test(path) ||
      /^(?:weather|light|smellOrTouch|creature|pose)\.(?:ko|en)$/.test(path) ||
      /^(?:sounds\.[01]|props\.[012])\.(?:ko|en)$/.test(path)
    )
  )
    return next;
  let target = next[index];
  for (const part of parts.slice(0, -1)) {
    if (target[part] === undefined) return next;
    target = target[part];
  }
  target[parts.at(-1)] = String(value);
  return next;
}
export function renderSceneBriefs(
  d,
  { open = false, openBeats = new Set() } = {},
) {
  if (!d.sceneBriefs?.length) return "";
  const checked = inspectSceneBriefs(d.sceneBriefs, d.outline, d.input);
  const rows = d.sceneBriefs
    .map((brief, index) => {
      const field = (path, label) => {
        const value = path.split(".").reduce((v, key) => v?.[key], brief);
        return `<label class="field"><span>${esc(label)}</span><input data-brief-field="${path}" data-index="${index}" maxlength="500" value="${esc(value || "")}"></label>`;
      };
      const issues = checked.issues.filter(
        (issue) => issue.beatIndex === brief.beatIndex,
      );
      return `<details class="story-scene-brief" data-brief-details="${index}" ${openBeats.has(index) ? "open" : ""}><summary><strong>비트 ${brief.beatIndex}</strong><span>${esc(TIME_LABELS[brief.timeOfDay] || "시간 선택")} · ${esc(brief.pose?.ko || "동작 입력")}</span>${issues.length ? '<span class="story-check-badge fail">확인 필요</span>' : ""}</summary><label class="field"><span>시간</span><select data-brief-field="timeOfDay" data-index="${index}">${BRIEF_TIMES.map((time) => `<option value="${time}" ${brief.timeOfDay === time ? "selected" : ""}>${TIME_LABELS[time]}</option>`).join("")}</select></label>${BRIEF_FIELDS.map(([path, label]) => `<fieldset class="story-brief-pair"><legend>${label}</legend><div class="story-review-grid">${field(`${path}.ko`, "한글")}${field(`${path}.en`, "English · 그림에 함께 전달")}</div></fieldset>`).join("")}<div class="story-review-grid">${field("dialogueLine", "대사 한 줄")}${field("humor", "작은 재미")}</div>${issues.length ? `<ul class="story-note">${issues.map((issue) => `<li>${esc(issue.message)}</li>`).join("")}</ul>` : ""}${button("이 장면만 다시", "rewrite-scene-brief", `data-index="${brief.beatIndex}"`)}</details>`;
    })
    .join("");
  return `<details class="story-card story-briefs" id="story-scene-details" ${open ? "open" : ""}><summary>장면 디테일 <span>${d.sceneBriefs.length}개 · 글과 그림이 함께 참고해요</span></summary><p class="story-note">수정한 디테일은 다음 전문 생성에 반영됩니다. 기존 전문과 쪽 나누기는 다시 생성해야 해요.</p>${rows}</details>`;
}
export function renderStoryPageStaging(page, index) {
  const staging = page.staging || {};
  const chips = (key, values, labels) =>
    values
      .map(
        (value) =>
          `<button type="button" class="story-chip ${staging[key] === value ? "selected" : ""}" aria-pressed="${staging[key] === value}" data-story-action="set-page-staging" data-index="${index}" data-staging-field="${key}" data-staging-value="${value}">${esc(labels[value] || value)}</button>`,
      )
      .join("");
  return `<div class="story-page-staging"><fieldset><legend class="story-label">구도</legend><div class="story-chip-row">${chips("shot", SHOTS, SHOT_LABELS)}</div></fieldset><fieldset><legend class="story-label">인물 위치</legend><div class="story-chip-row">${chips("characterSide", ["left", "center", "right"], { left: "왼쪽", center: "가운데", right: "오른쪽" })}</div></fieldset><span class="story-note">여백: ${esc({ left: "왼쪽", right: "오른쪽", top: "위", bottom: "아래" }[staging.textSide] || "자동")} · 기본 인쇄는 그림 아래 글 배치</span></div>`;
}
export function renderStoryRichness(report, { dirty = false } = {}) {
  if (!report) return "";
  const issues = report.issues || report.violations || [],
    pages = report.pages || report.pageResults || [],
    failed = report.passed === false || report.valid === false;
  return `<details class="story-card story-richness"><summary>글 풍부화 검사 <span class="story-check-badge ${failed ? "fail" : ""}">${dirty ? "수정 후 재검사 필요" : failed ? "확인 필요" : "검사 완료"}</span></summary><p class="story-note">어휘 사전과 문장 형태로 추정한 결과입니다. 표현의 자연스러움은 직접 읽고 확인해 주세요.</p>${issues.length ? `<ul>${issues.map((issue) => `<li>${issue.pageNo ? `${Number(issue.pageNo)}쪽 · ` : ""}${esc(issue.message || issue.label || issue.code || issue)}</li>`).join("")}</ul>` : ""}${pages
    .map((page) => {
      const problems = page.issues || page.violations || [];
      return `<div class="story-richness-page"><strong>${Number(page.pageNo) || "?"}쪽</strong> ${page.passed === false || problems.length ? '<span class="story-check-badge fail">확인 필요</span>' : '<span class="story-check-badge">확인</span>'}${problems.length ? `<span>${problems.map((issue) => esc(issue.message || issue.code || issue)).join(" · ")}</span>` : ""}</div>`;
    })
    .join("")}</details>`;
}

/** Structural inspiration only: selected patterns never introduce reference-book events. */
export function renderStoryStructureSelector(
  input = {},
  { id = "story-structure-preset", disabled = false } = {},
) {
  const selected = input.storyStructurePresetId || "auto",
    resolved = resolveStructurePreset(selected, input.topic || "");
  const options = [
    { id: "auto", name: "주제에 맞게 자동 선택" },
    ...STORY_STRUCTURE_PRESETS.filter((preset) => preset.id !== "auto"),
  ];
  return `<div class="field story-structure-choice"><label class="story-label" for="${esc(id)}">이야기 구성</label><select id="${esc(id)}" data-story-structure-preset ${disabled ? "disabled" : ""}>${options.map((preset) => `<option value="${esc(preset.id)}" ${selected === preset.id ? "selected" : ""}>${esc(preset.name)}</option>`).join("")}</select><p class="story-note">${esc(resolved.description || "원인과 결과가 이어지는 기승전결로 구성해요.")} 구성 원리만 참고하고 사건과 문장은 새로 만듭니다.</p></div>`;
}
const displayFact = (value) =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : value?.description ||
        value?.summary ||
        value?.text ||
        value?.name ||
        value?.id ||
        "";
function stateSummary(state, input = {}) {
  if (!state) return '<p class="story-note">기록된 상태 없음</p>';
  const name = (id, rows) =>
      rows?.find((item) => item.id === id)?.name || id || "없음",
    list = (value) =>
      Array.isArray(value)
        ? value.map(displayFact).filter(Boolean).join(" · ")
        : displayFact(value);
  const characters = (state.characters || [])
    .map(
      (character) =>
        `<li><strong>${esc(name(character.characterId, input.characters))}</strong> · ${esc(name(character.locationId, input.backgrounds))}${list(character.knows) ? ` · 아는 사실: ${esc(list(character.knows))}` : ""}</li>`,
    )
    .join("");
  const props = (state.props || [])
    .map(
      (prop) =>
        `<li><strong>${esc(prop.name || prop.id)}</strong> · ${esc(prop.ownerId ? name(prop.ownerId, input.characters) : "소유자 없음")} · ${esc(name(prop.locationId, input.backgrounds))}${prop.condition ? ` · ${esc(prop.condition)}` : ""}</li>`,
    )
    .join("");
  return `<ul class="story-state-list">${characters}${props}${list(state.openPromises) ? `<li>미해결 약속 · ${esc(list(state.openPromises))}</li>` : ""}</ul>${!characters && !props && !list(state.openPromises) ? '<p class="story-note">변경된 상태 없음</p>' : ""}`;
}
export function renderStoryPlotContract(draft) {
  const contract = draft.outline?.plotContract;
  if (!contract)
    return '<p class="story-note story-legacy-contract">이전에 만든 줄거리입니다. 기존 내용은 그대로 유지하며, 새 줄거리부터 원인·결과와 상태 기록을 함께 만듭니다.</p>';
  const dirty = draft.outline.plotContractDirty;
  return `<details class="story-card story-plot-contract" ${dirty ? "open" : ""}><summary>이야기 설계 <span data-story-contract-status class="story-check-badge ${dirty ? "fail" : ""}">${dirty ? "사건 수정 · 설계 재검사 필요" : "목표와 해결 기준"}</span></summary><dl class="story-causal-list"><dt>주인공의 목표</dt><dd>${esc(contract.goal)}</dd><dt>해결 확인 기준</dt><dd>${esc(contract.resolutionCriterion)}</dd></dl><p class="story-note">아래 비트의 ‘원인·결과와 상태’는 연결된 설계 기록입니다. 사건·장소를 수정하면 다음 생성 전에 다시 맞춥니다.</p></details>`;
}
function renderBeatContract(draft, beatIndex) {
  const contract = draft.outline?.plotContract,
    beat = contract?.beats?.find(
      (item) => Number(item.beatIndex) === Number(beatIndex),
    );
  if (!beat) return "";
  const fields = [
    ["trigger", "계기"],
    ["attempt", "주인공의 시도"],
    ["obstacle", "장애물"],
    ["result", "결과"],
    ["nextDecision", "다음 결정"],
  ];
  return `<details class="story-causal-detail"><summary>원인·결과와 상태 <span>${draft.outline.plotContractDirty ? "수정 전 기록" : "설계 기록"}</span></summary><p class="story-note">${beat.becauseOfBeatIndex ? `비트 ${Number(beat.becauseOfBeatIndex)}의 결과에서 이어집니다.` : "이야기를 시작하는 사건입니다."} 이 기록은 연결된 설계이며 직접 편집하는 사건 요약과 함께 검사합니다.</p><dl class="story-causal-list">${fields.map(([key, label]) => `<dt>${label}</dt><dd>${esc(beat[key] || "—")}</dd>`).join("")}</dl><div class="story-state-grid"><section><h4>사건 전 상태</h4>${stateSummary(beat.stateBefore, draft.input)}</section><section><h4>사건 후 상태</h4>${stateSummary(beat.stateAfter, draft.input)}</section></div>${beat.setupIds?.length || beat.payoffIds?.length ? `<p class="story-note">${beat.setupIds?.length ? `단서 심기: ${esc(beat.setupIds.join(" · "))}` : ""}${beat.setupIds?.length && beat.payoffIds?.length ? " / " : ""}${beat.payoffIds?.length ? `단서 회수: ${esc(beat.payoffIds.join(" · "))}` : ""}</p>` : ""}</details>`;
}
export function renderStoryCoherence(report, { dirty = false } = {}) {
  if (!report) return "";
  const issues = report.issues || [],
    hard = issues.some((issue) => issue.severity === "error"),
    pending =
      report.pending === true || (report.passed === false && !issues.length),
    failed = !pending && (hard || report.passed === false);
  return `<details class="story-card story-coherence" ${failed && !dirty ? "open" : ""}><summary>플롯 일관성 검사 <span class="story-check-badge ${failed || dirty ? "fail" : ""}">${dirty ? "수정 후 재검사 필요" : pending ? "수정 내용 검사 이어가기" : failed ? "연결 수정 필요" : "검사 완료"}</span></summary><p class="story-note">목표·원인과 결과·인물과 소품의 상태·한영 사건 일치를 검사합니다.${dirty ? " 그림 생성 전에 최신 내용으로 다시 검사합니다." : hard ? " 오류가 해결되어야 그림 단계로 진행할 수 있어요." : ""}</p>${issues.length ? `<ol class="story-coherence-issues">${issues.map((issue) => `<li><strong>${issue.pageNo ? `${Number(issue.pageNo)}쪽 · ` : ""}${issue.beatIndex ? `비트 ${Number(issue.beatIndex)} · ` : ""}${issue.language ? `${esc({ ko: "한글", en: "English", both: "한영" }[issue.language] || issue.language)} · ` : ""}${esc({ goal_drift: "주인공 목표", causal_gap: "사건의 원인과 결과", unearned_solution: "해결 과정", prop_state: "소품 상태", state_conflict: "인물·소품 상태", unsupported_event: "승인한 사건 유지", text_scene_conflict: "글과 그림 장면 일치", character_state: "인물 상태", knowledge_state: "알게 된 정보", bilingual_mismatch: "한영 사건 일치", setup_payoff: "단서 심기와 회수", scene_mismatch: "글과 그림 장면 일치" }[issue.code] || "사건 연결 확인")}</strong>${issue.evidence ? `<blockquote>${esc(issue.evidence)}</blockquote>` : ""}${issue.suggestion ? `<p>${esc(issue.suggestion)}</p>` : ""}</li>`).join("")}</ol>` : pending ? '<p class="story-note">완료한 수정은 보관했어요. 최신 글의 검사를 이어서 진행해 주세요.</p>' : '<p class="story-note">발견된 플롯 연결 오류가 없습니다.</p>'}</details>`;
}

export function renderStoryQualityPlan(draft) {
  const metadata = draft.outline?.quality,
    plan = draft.outline?.plan;
  if (!metadata && !plan) return "";
  const chips = String(metadata?.seedSummary || "")
      .split(" · ")
      .filter(Boolean),
    labels = ["심은 물건", "반전", "생물"];
  return `<section class="story-card quality-seed"><strong>이번 이야기 재료</strong><div class="quality-seed-chips">${chips.map((text, index) => `<span>${labels[index] ? `${labels[index]} · ` : ""}${esc(text)}</span>`).join("")}</div>${!draft.demo ? button("재료 다시 뽑기", "reroll-quality-seed") : ""}${
    plan
      ? `<details class="quality-plan"><summary>작가 메모 · 구성 계획</summary><dl class="story-causal-list">${[
          ["pattern", "패턴"],
          ["planted", "심은 물건"],
          ["twistReveal", "반전에서 드러날 사실"],
          ["funnyMoment", "작은 웃음"],
          ["failureReasons", "시도별 실패 이유"],
        ]
          .map(
            ([key, label]) =>
              `<dt>${label}</dt><dd>${esc(key === "pattern" ? { journey_repeat: "반복 여정형", accumulate: "누적형", search_wrong_answers: "찾기-오답형", waiting: "기다림형", escalation: "경쟁-확장형", mystery_sound: "소리의 정체형" }[plan[key]] || plan[key] : Array.isArray(plan[key]) ? plan[key].map((value) => ({ wrong_place: "장소가 맞지 않음", wrong_method: "방법이 맞지 않음", interrupted: "작은 방해" })[value] || value).join(" → ") : plan[key] || "—")}</dd>`,
          )
          .join("")}</dl></details>`
      : ""
  }${metadata?.regenerationAttempts ? '<p class="story-note">첫 패턴 검사를 통과하지 못해 보조 패턴으로 한 번 다시 구성했어요.</p>' : ""}</section>`;
}
export function renderStoryChildGate(report, { dirty = false } = {}) {
  if (!report) return "";
  const retell = report.retell || {},
    curiosity = report.curiosity || {},
    labels = { want: "바람", turn: "반전", resolution: "해결" };
  return `<details class="story-card quality-child-gate"><summary>아이 시뮬레이터 · 모의검사 <span class="story-check-badge ${dirty || !report.pass ? "fail" : ""}">${dirty ? "수정 후 재검사 필요" : report.pass ? "검사 완료" : "읽으며 확인"}</span></summary><p class="story-note">모델이 아이의 궁금증과 되말하기를 추정한 참고 결과입니다. 실제 아이의 평가나 공식 읽기 점수가 아닙니다.</p><p class="story-note">다음 쪽 궁금증 약 ${Number.isFinite(curiosity.overall) ? curiosity.overall : "—"}/10 · 조용한 마지막 쪽은 질문이 없어도 괜찮아요.</p>${retell.retell?.length ? `<ol>${retell.retell.map((text) => `<li>${esc(text)}</li>`).join("")}</ol>` : ""}${retell.missingCore?.length ? `<p class="story-note">되말하기에서 빠진 사건: ${retell.missingCore.map((type) => esc(labels[type] || type)).join(" · ")}</p>` : ""}${retell.confusions?.length ? `<ul>${retell.confusions.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>` : ""}${report.rewritePages?.length ? `<p class="story-note">확인할 쪽: ${report.rewritePages.map(Number).join(" · ")}쪽</p>` : ""}</details>`;
}

function drafts(state) {
  if (!state.storyDrafts || typeof state.storyDrafts !== "object")
    state.storyDrafts = {};
  if (Array.isArray(state.storyDrafts))
    state.storyDrafts = Object.fromEntries(
      state.storyDrafts
        .filter((d) => d?.id && d.stage !== "final")
        .map((d) => [d.id, d]),
    );
  return state.storyDrafts;
}
function isHybrid(settings) {
  return typeof settings.hybrid === "object"
    ? settings.hybrid.enabled === true
    : !!(
        settings.hybrid ||
        settings.hybridEnabled ||
        settings.mode === "hybrid"
      );
}
function engineId(settings) {
  return isHybrid(settings) && settings.hybrid?.finalEngine
    ? settings.hybrid.finalEngine
    : settings.engineId || settings.engine || settings.provider || "openai";
}
/** A draft owns its engine choice. Provider endpoints/models stay separate; keys remain in the vault. */
export function updateStoryDraftEngine(draft, selection = {}, fallback = {}) {
  const current = draft.textSettings || {},
    source = { ...fallback, ...current },
    providers = {};
  for (const id of TEXT_ENGINE_IDS) {
    const value =
      current.providers?.[id] ||
      current.configs?.[id] ||
      fallback.providers?.[id] ||
      {};
    providers[id] = {
      ...clone(value),
      model: resolveTextModel(id, value.model),
    };
    if (id === "local" && !providers[id].baseUrl && !providers[id].endpoint)
      providers[id].baseUrl = "http://127.0.0.1:1234/v1";
  }
  const previous = engineId(source),
    engine = selection.engine ?? previous;
  if (!TEXT_ENGINE_IDS.includes(engine))
    throw new Error("지원하는 글 엔진을 골라 주세요.");
  if (Object.hasOwn(selection, "model")) {
    if (
      engine !== "local" &&
      !listTextModels(engine).some((row) => row.id === selection.model)
    )
      throw new Error("선택한 엔진에서 사용할 모델을 골라 주세요.");
    providers[engine].model = resolveTextModel(engine, selection.model);
  }
  const hybridEnabled =
    engine !== "local" && (selection.hybridEnabled ?? isHybrid(source));
  const textSettings = {
    ...clone(source),
    engine,
    providers,
    hybrid: {
      enabled: hybridEnabled,
      finalEngine:
        engine === "local" ? source.hybrid?.finalEngine || "openai" : engine,
    },
  };
  delete textSettings.engineId;
  delete textSettings.provider;
  return { ...draft, textSettings };
}
/** The wizard summarizes settings; parent settings own engines, prices and hybrid mode. */
export function renderStoryEngineSelector(
  draft,
  { busy = false, fallback = {} } = {},
) {
  const settings = updateStoryDraftEngine(draft, {}, fallback).textSettings;
  if (draft.input?.storyQuality?.enabled) {
    const roleName = (role) => {
      const { engineId: id, config } = resolveQualityStageSettings(
        settings,
        role,
        draft.input.storyQuality,
      );
      return id === "local"
        ? config.model || "로컬"
        : getTextModelInfo(id, config.model).name;
    };
    return `<section class="story-engine-card story-engine-summary" aria-label="이 초안의 글 엔진"><p>줄거리 <strong>${esc(roleName("outline"))}</strong> · 전문 <strong>${esc(roleName("prose"))}</strong> · 심사·단순화 <strong>${esc(roleName("cheap"))}</strong></p>${busy ? "" : button("변경", "open-text-settings")}</section>`;
  }
  const name = (stage) => {
    const { engineId: id, config } = resolveStoryStageSettings(settings, stage);
    return id === "local"
      ? config.model || "로컬"
      : getTextModelInfo(id, config.model).name;
  };
  return `<section class="story-engine-card story-engine-summary" aria-label="이 초안의 글 엔진"><p>${draft.demo ? '<span class="story-demo-label">데모</span>' : ""}${isHybrid(settings) ? `줄거리 <strong>${esc(name("outline"))}</strong> · 전문 <strong>${esc(name("prose"))}</strong> · 쪽 나누기 <strong>${esc(name("pagination"))}</strong> · 하이브리드 켜짐` : `줄거리·쪽 나누기 <strong>${esc(name("outline"))}</strong> · 전문 <strong>${esc(name("prose"))}</strong>`}</p>${busy ? "" : button("변경", "open-text-settings")}</section>`;
}

function options(s, stage, forceApi = false) {
  const d = s.draft,
    settings = d.textSettings,
    selected =
      d.demo && !forceApi
        ? { engineId: "demo" }
        : resolveStoryStageSettings(settings, stage);
  return {
    ...selected,
    qualityEngines: Object.fromEntries(
      ["outline", "prose", "cheap"].map((role) => [
        role,
        resolveQualityStageSettings(
          settings,
          role,
          d.input.storyQuality || settings.storyQuality || {},
        ),
      ]),
    ),
    qualityCheckpoint: d.qualityCheckpoint,
    childGateCheckpoint: d.childGateCheckpoint || d.childGate,
    proseCoherence: d.proseCoherence,
    pageCoherence: d.pageCoherence,
    coherenceOptions: {
      ...resolveStoryStageSettings(settings, "coherence"),
      signal: s.controller?.signal,
    },
    sceneBriefs: d.sceneBriefs || undefined,
    bookId: d.bookId || d.id,
    stylePreset: stagingContext(d).stylePreset,
    storyEnrichment: settings.storyEnrichment !== false,
    richness: settings.storyEnrichment !== false,
    enrichmentCheckpoint: d.enrichmentCheckpoint,
    onCheckpoint: (checkpoint) => {
      if (api.getState() !== s.state || !api.isParent()) return;
      const mode = applyStoryCheckpoint(d, checkpoint);
      if (mode) s.mode = mode;
      if (checkpoint.usage)
        addUsage(
          s,
          { usage: checkpoint.usage, meta: checkpoint.meta },
          s.runId,
        );
      saveDraft(s);
    },
    signal: s.controller?.signal,
    onProgress: (progress) => {
      if (session !== s) return;
      const el = document.querySelector("#story-progress");
      if (el)
        el.textContent =
          typeof progress === "string"
            ? progress
            : progress.message || "검사와 수정 중";
    },
  };
}
function ensure(s) {
  if (
    session !== s ||
    s.controller?.signal.aborted ||
    api.getState() !== s.state ||
    !api.isParent()
  )
    throw new DOMException("이야기 작업을 중지했어요.", "AbortError");
}
function saveDraft(s) {
  if (!s || api.getState() !== s.state || !api.isParent()) return false;
  s.draft.updatedAt = new Date().toISOString();
  s.draft.reviewMode = s.mode;
  drafts(s.state)[s.draft.id] = s.draft;
  return api.save() !== false;
}
function snapshot(s, kind) {
  s.draft.snapshots ||= {};
  s.draft.snapshots[kind] ||= [];
  const value = s.draft[kind];
  if (value)
    s.draft.snapshots[kind].push({
      at: new Date().toISOString(),
      data: clone(value),
    });
  while (s.draft.snapshots[kind].length > 2) s.draft.snapshots[kind].shift();
}
function stageStep(s) {
  const mode = s.pendingMode || s.mode;
  return mode === "pages" ? 3 : mode === "prose" ? 2 : 1;
}
function header(s, title) {
  const step = stageStep(s),
    previous = s.draft.input.previousStory;
  return `${api.modalHeader(title)}<ol class="story-steps">${["줄거리 카드", "이야기 전문", "쪽 나누기"].map((label, i) => `<li class="${step === i + 1 ? "current" : step > i + 1 ? "done" : ""}">${i + 1} · ${label}</li>`).join("")}</ol><p class="story-note story-stage-meta">그림 ${esc(s.draft.worldSnapshot.imageEngine)} · ${esc(s.draft.input.specs.ko.id)} / ${esc(s.draft.input.specs.en.id)} · ${s.draft.input.pageCount}쪽</p>${renderStoryEngineSelector(s.draft, { busy: s.busy, fallback: getTextGenerationSettings(s.state) })}${previous ? `<details class="story-card"><summary>이전 편 · ${esc(previous.title)}</summary><strong>한글 전문</strong><p style="white-space:pre-wrap;line-height:1.7">${esc(previous.prose.ko)}</p><strong>English</strong><p style="white-space:pre-wrap;line-height:1.7">${esc(previous.prose.en)}</p></details>` : ""}`;
}

function show(s, content) {
  if (session !== s) return;
  api.showModal(content, "wide story-workspace");
}
function error(s, message) {
  if (session !== s) return;
  const el = document.querySelector("#story-error");
  if (el) {
    el.textContent = message;
    try {
      el.scrollIntoView({ block: "nearest" });
    } catch {}
  }
  api.toast(message);
}
function note() {
  return '<p id="story-error" class="story-error" aria-live="polite"></p>';
}
function drawerBackgrounds(state, existing = []) {
  const fields = [
    "id",
    "name",
    "nameEn",
    "kind",
    "type",
    "description",
    "features",
    "layout",
    "rules",
    "mood",
    "color",
    "storyNotes",
    "aliases",
    "home",
    "isHome",
    "category",
  ];
  return [
    ...clone(existing),
    ...(state.backgrounds || [])
      .filter(
        (background) => !existing.some((item) => item.id === background.id),
      )
      .map((background) =>
        clone(
          Object.fromEntries(
            fields
              .filter((key) => background[key] !== undefined)
              .map((key) => [key, background[key]]),
          ),
        ),
      ),
  ];
}

export function inputFromWizard(state, wizard) {
  const choices = validateWardrobeSelections(state, wizard),
    previous = state.books.find((book) => book.id === wizard.previousBookId),
    world = clone(getActiveWorld(state));
  const inherited = buildSeriesStorySelections(state, wizard, previous),
    characters = inherited.characters;
  if (!characters.length)
    throw new Error("이야기의 주인공을 먼저 골라 주세요.");
  const readingLevels = freezeReadingLevels(
    {
      ...wizard,
      koVocabulary:
        state.settings.koVocabularies?.[
          Number(String(wizard.koreanLevel || "K1").slice(1))
        ]?.words || [],
    },
    state.settings,
  );
  const variants = (wizard.characterIds || [])
    .map((id) => state.characters.find((c) => c.id === id))
    .filter(Boolean)
    .flatMap((c) =>
      availableCharacterVariants(state, c).map((v) => ({
        id: v.id,
        characterId: c.id,
        name: v.name,
        description: v.description,
      })),
    );
  if (previous?.generationSnapshot) {
    world.imageEngine =
      previous.generationSnapshot.imageEngine ||
      previous.imageEngine ||
      world.imageEngine;
    world.stylePresetId =
      previous.generationSnapshot.stylePresetId ||
      previous.stylePresetId ||
      world.stylePresetId;
  }
  return {
    input: {
      characters,
      backgrounds: drawerBackgrounds(state, inherited.backgrounds),
      preferredBackgroundIds: clone(wizard.backgroundIds || []),
      worldNotes: inherited.worldNotes,
      topic: String(wizard.topic || "").trim(),
      storyDate: wizard.storyDate || new Date().toISOString(),
      language: wizard.language || "bilingual",
      storyStructurePresetId: wizard.storyStructurePresetId || "auto",
      storyQuality: {
        ...normalizeStoryQualitySettings(state.settings?.storyQuality),
        patternId:
          wizard.storyQualityPatternId ||
          normalizeStoryQualitySettings(state.settings?.storyQuality)
            .patternId ||
          "auto",
        worldId:
          wizard.storyWorldId ||
          normalizeStoryQualitySettings(state.settings?.storyQuality).worldId ||
          "drawer",
        season:
          wizard.storySeason ||
          normalizeStoryQualitySettings(state.settings?.storyQuality).season ||
          "auto",
        timeOfDay:
          wizard.storyTimeOfDay ||
          normalizeStoryQualitySettings(state.settings?.storyQuality)
            .timeOfDay ||
          "auto",
        approvedBooks: storyQualityBookRecords(state),
      },
      qualitySeedOffset: Math.min(
        999,
        Math.max(0, Number(wizard.qualitySeedOffset) || 0),
      ),
      pageCount: Number(wizard.pageCount || 12),
      endingType: wizard.ending === "open" ? "open" : "home_sleep",
      moral:
        wizard.value === "custom"
          ? String(wizard.valueCustom || "").trim()
          : wizard.value === "none"
            ? ""
            : wizard.value || "",
      endingNote:
        wizard.ending === "custom"
          ? String(wizard.endingCustom || "").trim()
          : "",
      previousSummary:
        previous?.summaryForNext || previous?.outline?.logline || "",
      previousStory: inherited.previousStory,
      specs: readingLevels.specs,
      variants,
      variantByCharacter: choices.characterVariants,
      variantPageRanges: choices.variantPageRanges,
    },
    readingLevels,
    world,
  };
}

export function configureStoryUI(context) {
  api = context;
  if (configured) return;
  configured = true;
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
}
export function cleanupStoryWorkflow() {
  clearTimeout(saveTimer);
  if (session?.elapsedTimer) clearInterval(session.elapsedTimer);
  if (session) {
    captureEdits(session);
    session.controller?.abort();
    saveDraft(session);
  }
  session = null;
}
export function renderStoryDrafts(state) {
  const list = Object.values(state.storyDrafts || {})
    .filter((d) => d?.id && d.stage !== "final")
    .sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    );
  if (!list.length) return "";
  return `<section class="panel"><h3>이어 만들 이야기</h3><p class="small-label">승인하기 전 줄거리와 전문도 기기에 저장돼 있어요.</p><div class="story-drafts">${list.map((d) => `<article class="story-draft-card"><strong>${d.demo ? '<span class="story-demo-label">데모</span>' : ""}${esc(d.selectedTitle || d.outline?.titleCandidates?.[0] || d.input?.topic || "새 이야기")}</strong><p>${esc(STAGE_NAMES[d.stage] || "생성 준비")} · 목표 ${d.input?.pageCount || 12}쪽${d.pagination?.pages ? ` · 현재 ${d.pagination.pages.length}쪽` : ""}</p><div class="story-inline-actions">${button("이어서 만들기", "resume", `data-id="${esc(d.id)}"`)}${button("초안 삭제", "delete-draft", `data-id="${esc(d.id)}"`)}</div></article>`).join("")}</div></section>`;
}
export function startStoryWorkflow(wizard) {
  if (!api.isParent())
    return api.protectedAction(() => startStoryWorkflow(wizard));
  cleanupStoryWorkflow();
  const state = api.getState();
  try {
    const prepared = inputFromWizard(state, wizard),
      textSettings = clone(getTextGenerationSettings(state));
    session = {
      state,
      draft: {
        id: `story-${crypto.randomUUID()}`,
        bookId: `book-${crypto.randomUUID()}`,
        stage: "outline_draft",
        wizard: clone(wizard),
        input: prepared.input,
        readingLevels: prepared.readingLevels,
        worldId: prepared.world.id,
        worldSnapshot: prepared.world,
        textSettings,
        usage: { calls: [] },
        createdAt: new Date().toISOString(),
      },
      mode: "launch",
      busy: false,
      language: "ko",
    };
    session.draft.input.bookId = session.draft.bookId;
    saveDraft(session);
    renderLaunch(session);
  } catch (err) {
    api.toast(err.message);
  }
}
export function resumeStoryDraft(id, { useCurrentTextSettings = false } = {}) {
  if (!api.isParent())
    return api.protectedAction(() =>
      resumeStoryDraft(id, { useCurrentTextSettings }),
    );
  cleanupStoryWorkflow();
  const state = api.getState(),
    draft = drafts(state)[id];
  if (!draft) return api.toast("저장한 이야기 초안을 찾지 못했어요.");
  draft.bookId ||= `book-${crypto.randomUUID()}`;
  draft.input.bookId = draft.bookId;
  draft.input.backgrounds = drawerBackgrounds(
    state,
    draft.input.backgrounds || [],
  );
  if (useCurrentTextSettings) {
    draft.textSettings = clone(getTextGenerationSettings(state));
    draft.input.storyQuality = {
      ...clone(draft.textSettings.storyQuality),
      patternId:
        draft.wizard?.storyQualityPatternId ||
        draft.textSettings.storyQuality.patternId,
      worldId:
        draft.wizard?.storyWorldId ||
        draft.input.storyQuality?.worldId ||
        draft.textSettings.storyQuality.worldId,
      season:
        draft.wizard?.storySeason ||
        draft.input.storyQuality?.season ||
        draft.textSettings.storyQuality.season,
      timeOfDay:
        draft.wizard?.storyTimeOfDay ||
        draft.input.storyQuality?.timeOfDay ||
        draft.textSettings.storyQuality.timeOfDay,
      approvedBooks: storyQualityBookRecords(state),
    };
    draft.qualityCheckpoint = null;
  }
  session = {
    state,
    draft: updateStoryDraftEngine(draft, {}, getTextGenerationSettings(state)),
    mode:
      draft.reviewMode === "outline" && draft.outline
        ? "outline"
        : draft.reviewMode === "prose" && draft.prose
          ? "prose"
          : draft.pagination
            ? "pages"
            : draft.prose
              ? "prose"
              : draft.outline
                ? "outline"
                : "launch",
    busy: false,
    language: "ko",
  };
  renderSession(session);
}
/** Keep edits made in the existing picture editor when it reopens this workflow. */
export function syncStoryDraft(book, state) {
  const d = drafts(state)[book.storyDraftId];
  if (!d) return false;
  if (book.outline) d.outline = clone(book.outline);
  if (book.prose) d.prose = clone(book.prose);
  if (book.sceneBriefs) d.sceneBriefs = clone(book.sceneBriefs);
  if (book.richnessCheck) d.richnessCheck = clone(book.richnessCheck);
  for (const key of ["proseCoherence", "pageCoherence", "childGate"])
    if (book[key]) d[key] = clone(book[key]);
  d.bookId = book.id;
  d.pictureBook = clone(book);
  if (d.pagination && book.pages?.length)
    d.pagination.pages = book.pages.map((page, index) => ({
      pageNo: index + 1,
      beatIndex: page.beatIndex ?? d.pagination.pages[index]?.beatIndex ?? 1,
      textKo: page.ko ?? page.textKo ?? "",
      textEn: page.en ?? page.textEn ?? "",
      scene: clone({ ...d.pagination.pages[index]?.scene, ...page.scene }),
      variantByCharacter: clone(
        page.variantByCharacter ||
          d.pagination.pages[index]?.variantByCharacter ||
          {},
      ),
      isRefrainPage: !!page.isRefrainPage,
      ...(page.staging
        ? {
            staging: clone(page.staging),
            stagingManual: clone(page.stagingManual || {}),
            stagingRegeneration: page.stagingRegeneration || 0,
          }
        : {}),
    }));
  d.checksDirty = true;
  d.updatedAt = new Date().toISOString();
  return true;
}

function renderLaunch(s) {
  show(
    s,
    `${header(s, "사건이 있는 이야기를 만들어요")}<p class="modal-intro">줄거리 → 전문 → 쪽 나누기를 차례로 확인하고 승인해 주세요.</p><div class="story-card"><strong>${esc(s.draft.input.topic)}</strong><p class="story-note">${esc(s.draft.input.characters.map((character) => character.name).join(" · "))} · ${s.draft.input.pageCount}쪽</p>${s.draft.input.storyQuality?.enabled ? renderQualityPatternSelector(s.draft.input, { state: s.state, id: "story-quality-pattern" }) + renderQualityWorldSelectors(s.draft.input, { state: s.state, prefix: "story-launch-", topicButton: false }) : renderStoryStructureSelector(s.draft.input)}</div><details class="story-tools"><summary>데모 살펴보기</summary><p class="story-note">API 요청 없이 세 단계를 둘러볼 수 있어요.</p>${button("데모 시작", "start-demo")}</details>${note()}<div class="modal-actions">${button("저장하고 닫기", "close")}${button("줄거리 생성", "start-api", "", "primary")}</div>`,
  );
}

function renderSession(s) {
  if (!s || session !== s) return;
  if (s.mode === "launch") renderLaunch(s);
  else if (s.mode === "outline") renderOutline(s);
  else if (s.mode === "prose") renderProse(s);
  else renderPages(s);
}

const BEAT_LABELS = {
  setup: "시작",
  want: "바람",
  attempt: "시도",
  turn: "반전",
  resolution: "해결",
  close: "마무리",
};
const EMOTIONS = [
  "설렘",
  "호기심",
  "기대",
  "걱정",
  "놀람",
  "속상함",
  "용기",
  "기쁨",
  "안도",
  "뿌듯함",
];
export function selectableBeatBackgrounds(input, index, total) {
  return (input.backgrounds || []).filter((background) =>
    index === 0 || index === total - 1
      ? isHomeBackground(background)
      : !isHomeBackground(background),
  );
}
/** Setting chips change both representations and keep the return-home pair together. */
export function updateStoryBeatLocation(outline, input, index, backgroundId) {
  if (!outline?.beats?.[index])
    throw new Error("장소를 바꿀 비트를 찾지 못했어요.");
  if (
    !selectableBeatBackgrounds(input, index, outline.beats.length).some(
      (background) => background.id === backgroundId,
    )
  )
    throw new Error(
      index === 0 || index === outline.beats.length - 1
        ? "시작과 마무리는 집 배경을 골라 주세요."
        : "배경 서랍의 다른 장소를 골라 주세요.",
    );
  const next = clone(outline),
    indices =
      index === 0 || index === outline.beats.length - 1
        ? [0, outline.beats.length - 1]
        : [index];
  if (
    next.plotContract &&
    indices.some(
      (i) =>
        (next.settings?.find(
          (setting) =>
            Number(setting.beatIndex) === Number(next.beats[i].index),
        )?.backgroundId || next.beats[i].settingKey) !== backgroundId,
    )
  )
    next.plotContractDirty = true;
  for (const i of indices) {
    next.beats[i].settingKey = backgroundId;
    next.settings ||= [];
    const previous = next.settings.find(
      (setting) => Number(setting.beatIndex) === Number(next.beats[i].index),
    );
    if (previous) {
      previous.backgroundId = backgroundId;
      delete previous.newPlace;
    } else next.settings.push({ beatIndex: next.beats[i].index, backgroundId });
  }
  return next;
}
export function renderStoryBeatCard(draft, index, { open = false } = {}) {
  const outline = draft.outline,
    beat = outline.beats[index],
    emotion = outline.emotionArc?.[index] || "",
    plan = buildBeatPagePlan(outline, draft.input.pageCount),
    place =
      outline.settings?.find(
        (setting) => Number(setting.beatIndex) === Number(beat.index),
      )?.backgroundId || beat.settingKey;
  const backgrounds = selectableBeatBackgrounds(
    draft.input,
    index,
    outline.beats.length,
  );
  return `<details class="story-card story-beat-card" data-beat-details="${index}" ${open ? "open" : ""}><summary><span class="story-beat-heading">비트 ${index + 1} · ${esc(BEAT_LABELS[beat.type] || beat.type)}<small>${plan
    .filter((page) => page.beatIndex === beat.index)
    .map((page) => page.pageNo)
    .join(
      "·",
    )}쪽</small></span><span class="story-beat-preview">${esc(beat.summary)}</span><span class="story-emotion-badge">${esc(emotion || "감정 선택")}</span></summary><div class="story-beat-body"><div class="field"><label class="story-label" for="story-beat-summary-${index}">사건</label><textarea id="story-beat-summary-${index}" data-beat-field="summary" data-index="${index}" maxlength="2000">${esc(beat.summary)}</textarea></div>${renderBeatContract(draft, beat.index)}<fieldset><legend class="story-label">장소 · ${index === 0 || index === outline.beats.length - 1 ? "집" : "배경 서랍"}</legend><div class="story-chip-row">${backgrounds.map((background) => `<button type="button" class="story-chip ${place === background.id ? "selected" : ""}" aria-pressed="${place === background.id}" data-story-action="set-beat-location" data-index="${index}" data-background-id="${esc(background.id)}">${esc(background.name || background.nameEn || background.id)}</button>`).join("") || '<span class="story-note">사용할 배경을 재료 서랍에 추가해 주세요.</span>'}</div>${!backgrounds.some((background) => background.id === place) ? '<p class="story-error">이 비트의 장소를 선택해 주세요.</p>' : ""}</fieldset><fieldset><legend class="story-label">감정</legend><div class="story-chip-row">${[...new Set([...EMOTIONS, ...(emotion ? [emotion] : [])])].map((value) => `<button type="button" class="story-chip ${emotion === value ? "selected" : ""}" aria-pressed="${emotion === value}" data-story-action="set-beat-emotion" data-index="${index}" data-emotion="${esc(value)}">${esc(value)}</button>`).join("")}</div></fieldset><div class="story-inline-actions">${button("↻ 이 비트 다시 쓰기", "rewrite-beat", `data-index="${index}"`)}</div></div></details>`;
}
function renderOutline(s) {
  const o = s.draft.outline;
  show(
    s,
    `${header(s, "줄거리 카드")}<p class="modal-intro">${o.beats.length}개 비트 · ${s.draft.input.pageCount}쪽 예정 · 집에서 출발해 두 곳 이상을 거쳐 집으로 돌아와요.</p><div class="story-card"><label class="story-label">제목</label>${o.titleCandidates.map((title, i) => `<label class="story-title-pick"><input type="radio" name="story-title" value="${i}" ${s.draft.titleIndex === i ? "checked" : ""}><input type="text" maxlength="100" data-outline-title="${i}" value="${esc(title)}" aria-label="제목 후보 ${i + 1}"></label>`).join("")}<div class="field"><label>한 줄 요약</label><input data-outline-field="logline" value="${esc(o.logline)}" maxlength="500"></div><div class="story-review-grid">${[
      ["want", "주인공의 바람"],
      ["problem", "문제"],
      ["twist", "반전"],
    ]
      .map(
        ([key, label]) =>
          `<div class="field ${key === "twist" ? "field-wide" : ""}"><label>${label}</label><input data-outline-field="${key}" maxlength="500" value="${esc(o[key])}"></div>`,
      )
      .join(
        "",
      )}</div></div>${renderStoryQualityPlan(s.draft)}${renderStoryPlotContract(s.draft)}${o.beats.map((beat, index) => renderStoryBeatCard(s.draft, index, { open: s.openBeats?.has(index) || false })).join("")}<details class="story-card story-tools"><summary>후렴·새 단어·다시 쓰기</summary><div class="story-review-grid"><div class="field"><label>후렴</label><input id="story-refrain" value="${esc(o.refrain?.text || "")}" maxlength="150"></div><div class="field"><label>후렴 비트 · 최대 3곳</label><input id="story-refrain-beats" value="${esc(o.refrain?.usedAtBeats?.join(", ") || "")}"></div><div class="field"><label>새 한글 단어</label><input data-outline-words="newWordsKo" value="${esc(o.newWordsKo?.join(", ") || "")}"></div><div class="field"><label>새 영어 단어</label><input data-outline-words="newWordsEn" value="${esc(o.newWordsEn?.join(", ") || "")}"></div></div>${button("줄거리 전체 다시 쓰기", "regenerate-outline")}${s.draft.demo ? button("실제 엔진으로 새 줄거리 생성", "replace-demo-with-api") : ""}</details>${renderSceneBriefs(s.draft, { open: s.briefsOpen, openBeats: s.openBriefs })}${note()}<div class="modal-actions">${button("저장하고 닫기", "close")}${s.draft.sceneBriefs?.length && !o.plotContractDirty ? button("장면 확인 · 전문 생성", "generate-prose", "", "primary") : button(o.plotContractDirty ? "수정한 줄거리 승인 · 장면 다시 생성" : "줄거리 승인 · 장면 디테일 생성", "approve-outline", "", "primary")}</div>`,
  );
}
export function renderStoryProseParagraphs(prose, language, outline) {
  const paragraphs = String(prose[language] || "")
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean),
    labels = paragraphBeatLabels(prose, language, outline);
  return paragraphs
    .map(
      (paragraph, index) =>
        `<article class="story-card story-paragraph"><div class="story-card-head"><label class="story-beat-heading" for="story-paragraph-${language}-${index}">비트 ${labels[index]} · ${esc(BEAT_LABELS[outline?.beats?.find((beat) => beat.index === labels[index])?.type] || "이야기")}</label>${button("↻", "rewrite-paragraph", `data-index="${index}" data-language="${language}" aria-label="${index + 1}번째 문단 다시 쓰기"`)}</div><textarea id="story-paragraph-${language}-${index}" class="story-prose-paragraph" data-prose-paragraph="${index}" data-beat-index="${labels[index]}" data-language="${language}" maxlength="12000">${esc(paragraph)}</textarea></article>`,
    )
    .join("");
}
function renderProse(s) {
  const p = s.draft.prose,
    language = s.language || "ko",
    needsFinal =
      isHybrid(s.draft.textSettings) &&
      !s.draft.input.storyQuality?.enabled &&
      !s.draft.demo &&
      !s.draft.hybridFinal;
  show(
    s,
    `${header(s, "이야기 전문")}<p class="modal-intro">비트별 사건·대화·감각 묘사를 읽고 고쳐 주세요.</p>${renderStoryCoherence(s.draft.proseCoherence, { dirty: s.draft.proseCoherenceDirty })}${needsFinal ? '<div class="notice">로컬 초안을 최종 전문 모델로 다듬어 주세요.</div>' : ""}<div class="story-prose-tabs">${button("한글", "prose-tab", 'data-language="ko"', language === "ko" ? "green" : "outline")}${button("English", "prose-tab", 'data-language="en"', language === "en" ? "green" : "outline")}</div>${renderStoryProseParagraphs(p, language, s.draft.outline)}<details class="story-card story-tools"><summary>이전 단계·다시 쓰기</summary><div class="story-inline-actions">${button("줄거리로 돌아가기", "back-outline")}${button("전문 다시 쓰기", "regenerate-prose")}</div></details>${note()}<div class="modal-actions">${button("저장하고 닫기", "close")}${s.draft.enrichmentPending ? button("글 풍부화 이어 만들기", "resume-enrichment", "", "primary") : needsFinal ? button("최종 전문 다듬기", "hybrid-final", "", "primary") : button("전문 승인 · 쪽 나누기", "approve-prose", "", "primary")}</div>`,
  );
}

function checkView(s) {
  const c = s.draft.storyCheck || s.draft.paginationMeta?.checks;
  if (!c)
    return '<p class="story-note">쪽 수정 뒤 검사 결과를 다시 확인해 주세요.</p>';
  const entries = Array.isArray(c.items)
    ? c.items
    : Array.isArray(c.checks)
      ? c.checks
      : Array.isArray(c.results)
        ? c.results
        : Object.entries(c.checks || {}).map(([id, value]) => ({
            id,
            ...(typeof value === "object" ? value : { passed: value }),
          }));
  return `<div class="story-card story-check-details"><strong>이야기 자동 검사</strong><p>${c.passed === true ? "검사 기준을 통과했어요." : c.passed === false ? "수정이 필요한 항목이 있어요. 배지를 확인해 주세요." : "최신 쪽에 대한 검사 결과입니다."}</p>${entries.map((item) => `<span class="story-check-badge ${item.passed === false || item.ok === false ? "fail" : ""}">${esc(item.label || item.name || item.id || item.type)} ${item.passed === false || item.ok === false ? "확인 필요" : "확인"}</span>`).join("")}${Array.isArray(c.violations) && c.violations.length ? `<ul>${c.violations.map((item) => `<li>${item.pageNo ? `${item.pageNo}쪽 · ` : ""}${esc(item.message || item.reason || item.type || item.code)}</li>`).join("")}</ul>` : ""}${s.draft.checksDirty ? '<p class="story-note">글이나 장면을 수정했어요. 그림 생성 전에 최신 내용으로 다시 검사합니다.</p>' : ""}</div>`;
}
function renderPages(s) {
  const p = s.draft.pagination,
    cast = s.draft.input.characters,
    target = s.draft.input.pageCount,
    mismatch = p.pages.length !== target;
  show(
    s,
    `${header(s, "쪽 나누기")}<p class="modal-intro">현재 ${p.pages.length}쪽 / 목표 ${target}쪽 · ${s.draft.outline.beats.length}개 비트를 여러 쪽에 나눠 담습니다.</p>${mismatch ? `<div class="notice story-count-warning" role="status"><strong>${p.pages.length}쪽으로 생성되어 ${target}쪽 복구가 필요해요.</strong><p>줄거리와 전문은 저장되어 있습니다. AI로 다시 나누거나, 기존 쪽 글을 그대로 나눌 수 있어요.</p><div class="story-inline-actions">${button(`AI로 ${target}쪽 다시 나누기 · API 요청`, "repaginate", "", "primary")}${p.pages.length < target ? button(`API 없이 기존 글 ${target}쪽으로 나누기`, "fit-page-count") : ""}</div></div>` : ""}${s.draft.paginationMeta?.manualRedistribution ? '<div class="notice">기존 글을 보존해 쪽만 나눈 초안입니다. 짧아진 문장과 같은 장면의 구도를 검토하고, 필요한 쪽만 AI로 다듬어 주세요.</div>' : ""}<details class="story-card story-tools"><summary>쪽 수·다시 나누기·검사</summary><div class="story-inline-actions"><label class="field">쪽 수 <select id="story-page-count">${[8, 12, 16, 24].map((n) => `<option value="${n}" ${s.draft.input.pageCount === n ? "selected" : ""}>${n}쪽</option>`).join("")}</select></label>${button("전문 유지 · 쪽만 다시 나누기", "repaginate")}${button("검사 후 실패 쪽만 수정 · 최대 2회", "repair-pages")}${button("전문으로 돌아가기", "back-prose")}</div></details>${renderStoryChildGate(s.draft.childGate, { dirty: s.draft.checksDirty })}${renderStoryCoherence(s.draft.pageCoherence || s.draft.paginationMeta?.coherence, { dirty: s.draft.checksDirty })}${checkView(s)}${renderStoryRichness(s.draft.richnessCheck, { dirty: s.draft.checksDirty })}<div class="story-card"><div class="field"><label>표지 제목</label><input data-cover-field="title" value="${esc(p.cover.title)}" maxlength="150"></div><div class="field"><label>표지 장면 · 영어</label><textarea data-cover-field="sceneAction" maxlength="1000">${esc(p.cover.sceneAction)}</textarea></div></div>${p.pages
      .map(
        (page, i) =>
          `<article class="story-card" data-story-page="${i}"><div class="story-card-head"><strong>${i + 1}쪽 · ${page.beatIndex}번 비트</strong><div class="story-inline-actions">${button("이 쪽만 다시", "rewrite-page", `data-index="${i}"`)}${button("쪽 나누기", "split-page", `data-index="${i}"`)}${i < p.pages.length - 1 ? button("다음 쪽과 합치기", "merge-page", `data-index="${i}"`) : ""}</div></div><div class="story-review-grid"><div class="field"><label>한글</label><textarea data-page-field="textKo" data-index="${i}" maxlength="15000">${esc(page.textKo)}</textarea></div><div class="field"><label>English</label><textarea data-page-field="textEn" data-index="${i}" maxlength="15000">${esc(page.textEn)}</textarea></div></div>${renderStoryPageStaging(page, i)}<div class="story-page-scene"><div class="field"><label>그릴 한 장면 · 영어 동작 설명</label><textarea data-scene-field="action" data-index="${i}" maxlength="2500">${esc(page.scene.action)}</textarea></div><div class="story-review-grid"><div class="field"><label>배경 ID 또는 장소 설명</label><input data-scene-field="where" data-index="${i}" value="${esc(page.scene.where)}"></div><div class="field"><label>감정 · 영어 한 단어</label><input data-scene-field="emotion" data-index="${i}" value="${esc(page.scene.emotion)}"></div><div class="field"><label>시간</label><select data-scene-field="timeOfDay" data-index="${i}">${BRIEF_TIMES.map((time) => `<option value="${time}" ${page.scene.timeOfDay === time ? "selected" : ""}>${TIME_LABELS[time]}</option>`).join("")}</select></div><div class="field"><label>소품 · 영어, 쉼표로 구분</label><input data-scene-field="props" data-index="${i}" value="${esc(page.scene.props?.join(", ") || "")}"></div></div><div class="story-page-variants">${cast
            .map(
              (character) =>
                `<label class="story-label">${esc(character.name)}의 모습<select data-page-variant="${esc(character.id)}" data-index="${i}"><option value="">기본 시트</option>${s.draft.input.variants
                  .filter((v) => v.characterId === character.id)
                  .map(
                    (v) =>
                      `<option value="${esc(v.id)}" ${page.variantByCharacter?.[character.id] === v.id ? "selected" : ""}>${esc(v.name || v.id)}</option>`,
                  )
                  .join("")}</select></label>`,
            )
            .join("")}</div></div></article>`,
      )
      .join(
        "",
      )}${note()}<label class="story-note"><input type="checkbox" id="story-accept-failures"> 읽기 수준·표현 검사 경고를 확인했습니다. 플롯 연결 오류는 수정 후 진행합니다.</label><div class="modal-actions">${button("저장하고 닫기", "close")}${button("쪽 승인 · 그림 단계로", "approve-pages", mismatch ? 'disabled aria-describedby="story-page-count"' : "", "primary")}</div>`,
  );
}

function refreshOutlineEditIndicators(d) {
  const action = document.querySelector(
    '.story-workspace .modal-actions [data-story-action="generate-prose"]',
  );
  if (action && (!d.sceneBriefs?.length || d.outline?.plotContractDirty)) {
    action.dataset.storyAction = "approve-outline";
    action.textContent = d.outline?.plotContractDirty
      ? "수정한 줄거리 승인 · 장면 다시 생성"
      : "줄거리 승인 · 장면 디테일 생성";
  }
  const badge = document.querySelector("[data-story-contract-status]");
  if (badge && d.outline?.plotContractDirty) {
    badge.textContent = "사건 수정 · 설계 재검사 필요";
    badge.classList?.add("fail");
  }
}
const outlineContentKey = (outline) =>
  JSON.stringify(
    outline ? { ...outline, titleCandidates: undefined } : outline,
  );
function captureEdits(s) {
  if (!s || session !== s || s.busy) return;
  const d = s.draft,
    beforeOutline = outlineContentKey(d.outline),
    beforeProse = JSON.stringify(d.prose),
    beforePlot = JSON.stringify(
      d.outline && {
        want: d.outline.want,
        problem: d.outline.problem,
        twist: d.outline.twist,
        beats: d.outline.beats,
        settings: d.outline.settings,
      },
    );
  if (s.mode === "outline" && d.outline) {
    s.openBeats = new Set(
      [...document.querySelectorAll("[data-beat-details][open]")].map((el) =>
        Number(el.dataset.beatDetails),
      ),
    );
    document
      .querySelectorAll("[data-outline-title]")
      .forEach(
        (el) =>
          (d.outline.titleCandidates[Number(el.dataset.outlineTitle)] =
            el.value),
      );
    const picked = document.querySelector('input[name="story-title"]:checked');
    d.titleIndex = Number(picked?.value ?? d.titleIndex ?? 0);
    d.selectedTitle = d.outline.titleCandidates[d.titleIndex];
    document
      .querySelectorAll("[data-outline-field]")
      .forEach((el) => (d.outline[el.dataset.outlineField] = el.value));
    document
      .querySelectorAll("[data-beat-field]")
      .forEach(
        (el) =>
          (d.outline.beats[Number(el.dataset.index)][el.dataset.beatField] =
            el.value),
      );
    document
      .querySelectorAll("[data-emotion-index]")
      .forEach(
        (el) =>
          ((d.outline.emotionArc ||= [])[Number(el.dataset.emotionIndex)] =
            el.value),
      );
    document.querySelectorAll("[data-outline-words]").forEach(
      (el) =>
        (d.outline[el.dataset.outlineWords] = el.value
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean)),
    );
    const ref = document.querySelector("#story-refrain");
    if (ref)
      d.outline.refrain = ref.value.trim()
        ? {
            ...(d.outline.refrain && typeof d.outline.refrain === "object"
              ? d.outline.refrain
              : {}),
            text: ref.value.trim(),
            usedAtBeats: (
              document.querySelector("#story-refrain-beats")?.value || ""
            )
              .split(",")
              .map(Number)
              .filter(
                (n) =>
                  Number.isInteger(n) && n >= 1 && n <= d.outline.beats.length,
              ),
          }
        : undefined;
  }
  if (
    s.mode === "outline" &&
    d.outline?.plotContract &&
    beforePlot !==
      JSON.stringify({
        want: d.outline.want,
        problem: d.outline.problem,
        twist: d.outline.twist,
        beats: d.outline.beats,
        settings: d.outline.settings,
      })
  )
    d.outline.plotContractDirty = true;
  if (
    s.mode === "outline" &&
    d.outline &&
    beforeOutline !== outlineContentKey(d.outline)
  ) {
    snapshot(s, "prose");
    snapshot(s, "pagination");
    invalidateStoryDetails(d, { outline: true });
    refreshOutlineEditIndicators(d);
  }
  if (s.mode === "outline" && d.sceneBriefs?.length) {
    s.briefsOpen = !!document.querySelector("#story-scene-details")?.open;
    s.openBriefs = new Set(
      [...document.querySelectorAll("[data-brief-details][open]")].map((el) =>
        Number(el.dataset.briefDetails),
      ),
    );
    const before = JSON.stringify(d.sceneBriefs);
    document
      .querySelectorAll("[data-brief-field]")
      .forEach(
        (el) =>
          (d.sceneBriefs = updateStoryBriefField(
            d.sceneBriefs,
            Number(el.dataset.index),
            el.dataset.briefField,
            el.value,
          )),
      );
    if (before !== JSON.stringify(d.sceneBriefs)) invalidateStoryDetails(d);
  }
  if (s.mode === "prose" && d.prose) {
    const fields = [...document.querySelectorAll("[data-prose-paragraph]")];
    if (fields.length) {
      const language = fields[0].dataset.language,
        parts = fields.flatMap((field) =>
          field.value
            .split(/\n\s*\n/)
            .map((text) => ({
              text: text.trim(),
              beat: Number(field.dataset.beatIndex),
            }))
            .filter((part) => part.text),
        ),
        text = parts.map((part) => part.text).join("\n\n");
      if (d.prose[language] !== text) {
        d.prose[language] = text;
        (d.prose.paragraphBeats ||= {})[language] = parts.map(
          (part) => part.beat,
        );
      }
    }
  }
  if (
    s.mode === "prose" &&
    d.prose &&
    beforeProse !== JSON.stringify(d.prose)
  ) {
    snapshot(s, "pagination");
    invalidateStoryDetails(d, { prose: true });
  }
  if (s.mode === "pages" && d.pagination) {
    document
      .querySelectorAll("[data-cover-field]")
      .forEach((el) => (d.pagination.cover[el.dataset.coverField] = el.value));
    document
      .querySelectorAll("[data-page-field]")
      .forEach(
        (el) =>
          (d.pagination.pages[Number(el.dataset.index)][el.dataset.pageField] =
            el.value),
      );
    document.querySelectorAll("[data-scene-field]").forEach(
      (el) =>
        (d.pagination.pages[Number(el.dataset.index)].scene[
          el.dataset.sceneField
        ] =
          el.dataset.sceneField === "props"
            ? el.value
                .split(",")
                .map((w) => w.trim())
                .filter(Boolean)
            : el.value),
    );
    document
      .querySelectorAll("[data-page-variant]")
      .forEach(
        (el) =>
          ((d.pagination.pages[Number(el.dataset.index)].variantByCharacter ||=
            {})[el.dataset.pageVariant] = el.value || null),
      );
  }
}
function addUsage(s, result, callId = s.runId) {
  if (result.meta?.requests === 0) return;
  const calls = (s.draft.usage ||= { calls: [] }).calls,
    row = {
      at: new Date().toISOString(),
      ...clone(result.usage || {}),
      ...clone(result.meta || {}),
      ...(callId ? { callId } : {}),
    },
    index = callId ? calls.findIndex((c) => c.callId === callId) : -1;
  if (index >= 0) calls[index] = row;
  else calls.push(row);
}
function recordCoherence(d, result) {
  if (result?.meta?.childGateCheckpoint)
    d.childGateCheckpoint = clone(result.meta.childGateCheckpoint);
  if (result?.meta?.approvedProse) d.prose = clone(result.meta.approvedProse);
  if (result?.meta?.proseCoherence) {
    d.proseCoherence = clone(result.meta.proseCoherence);
    d.proseCoherenceDirty = false;
  }
  if (result?.meta?.childGate) {
    d.childGate = clone(result.meta.childGate);
    d.childGatePending = false;
  }
  const report = result?.meta?.coherence;
  if (!report) return;
  if (report.stage === "pages") d.pageCoherence = clone(report);
  else {
    d.proseCoherence = clone(report);
    d.proseCoherenceDirty = false;
  }
}
function hardCoherence(report) {
  return (
    report?.issues?.some((issue) => issue.severity === "error") ||
    (report?.passed === false && !report?.issues?.length)
  );
}
async function run(s, label, fn, done) {
  if (s.busy) return;
  captureEdits(s);
  saveDraft(s);
  s.busy = true;
  s.runId = "request-" + crypto.randomUUID();
  s.controller = new AbortController();
  show(
    s,
    `${header(s, label)}<div class="story-progress" id="story-progress">${esc(label)} · 완료된 결과는 초안에 저장돼 있어요.</div><p class="story-note" id="story-elapsed" aria-live="off">경과 0초 · 중지해도 저장된 결과를 이어서 만들 수 있어요.</p><p id="story-error" class="story-error"></p><div class="modal-actions">${button("작업 중지 · 초안 보관", "stop")}</div>`,
  );
  const started = Date.now();
  s.elapsedTimer = setInterval(() => {
    const el = document.querySelector("#story-elapsed");
    if (session === s && el)
      el.textContent = `경과 ${Math.floor((Date.now() - started) / 1000)}초 · 추론 모델은 몇 분 걸릴 수 있어요. 중지하면 저장한 결과가 남습니다.`;
  }, 1000);
  let usageRecorded = false;
  try {
    const result = await fn();
    addUsage(s, result);
    usageRecorded = true;
    await done(result);
    recordCoherence(s.draft, result);
    saveDraft(s);
    if (session !== s) {
      clearInterval(s.elapsedTimer);
      s.elapsedTimer = null;
      s.pendingMode = null;
      s.busy = false;
      s.controller = null;
      return;
    }
    ensure(s);
    clearInterval(s.elapsedTimer);
    s.elapsedTimer = null;
    s.pendingMode = null;
    s.busy = false;
    s.controller = null;
    if (!saveDraft(s))
      throw new Error(
        "이야기 초안을 저장하지 못했어요. 백업 후 저장 공간을 확인해 주세요.",
      );
    renderSession(s);
  } catch (err) {
    if (session === s && err.qualityCheckpoint)
      s.draft.qualityCheckpoint = clone(err.qualityCheckpoint);
    if (session === s && err.childGateCheckpoint)
      s.draft.childGateCheckpoint = clone(err.childGateCheckpoint);
    if (session === s && (err.coherence || err.prose || err.pagination)) {
      applyStoryCheckpoint(s.draft, {
        stage: "coherence",
        coherence: err.coherence,
        prose: err.prose,
        pagination: err.pagination,
      });
      s.mode = err.pagination ? "pages" : "prose";
      saveDraft(s);
    }
    if (err.usage && !usageRecorded) {
      addUsage(s, { usage: err.usage, meta: { ...err.meta, failed: true } });
      saveDraft(s);
    }
    if (session !== s) return;
    clearInterval(s.elapsedTimer);
    s.elapsedTimer = null;
    s.pendingMode = null;
    s.busy = false;
    s.controller = null;
    renderSession(s);
    error(
      s,
      err.name === "AbortError"
        ? "이번 요청을 중지했어요. 이전 단계와 부모 수정은 초안에 남아 있습니다."
        : err.message || "이야기 생성에 실패했어요.",
    );
  }
}
function acceptOutline(s, { allowDirty = false } = {}) {
  captureEdits(s);
  const o = s.draft.outline;
  if (!o.titleCandidates[s.draft.titleIndex || 0]?.trim())
    throw new Error("제목을 적어 주세요.");
  if (o.beats.some((b) => !b.summary?.trim()))
    throw new Error("비트마다 사건을 적어 주세요.");
  if (!s.draft.demo) {
    const checked = allowDirty && o.plotContractDirty ? clone(o) : o;
    if (checked !== o) {
      delete checked.plotContract;
      delete checked.plotContractDirty;
    }
    const rules = inspectOutlineRules(checked, s.draft.input);
    if (!rules.valid) throw new Error(rules.errors.join("\n"));
  }
  if (o.refrain?.usedAtBeats?.length > 3)
    throw new Error("후렴은 최대 3개 비트에서 사용해 주세요.");
  s.draft.selectedTitle = o.titleCandidates[s.draft.titleIndex || 0];
  s.draft.input.title = s.draft.selectedTitle;
  s.draft.stage = "outline_ok";
  snapshot(s, "outline");
}
function acceptProse(s) {
  captureEdits(s);
  if (s.draft.enrichmentPending)
    throw new Error("중단된 글 풍부화를 이어 만든 뒤 승인해 주세요.");
  if (!s.draft.prose.ko?.trim() || !s.draft.prose.en?.trim())
    throw new Error("한글과 영어 전문을 모두 확인해 주세요.");
  if (
    isHybrid(s.draft.textSettings) &&
    !s.draft.input.storyQuality?.enabled &&
    !s.draft.demo &&
    !s.draft.hybridFinal
  )
    throw new Error("선택한 API로 최종 전문을 다듬은 뒤 승인해 주세요.");
  s.draft.stage = "prose_ok";
  snapshot(s, "prose");
}
function markPagesDirty(s) {
  s.draft.checksDirty = true;
  s.draft.stage = "paged";
}
function renumber(s) {
  s.draft.pagination.pages.forEach((page, i) => (page.pageNo = i + 1));
  s.draft.pagination = stagePagination(
    s.draft.pagination,
    stagingContext(s.draft),
  );
  markPagesDirty(s);
  saveDraft(s);
  renderPages(s);
}
function divide(text) {
  const sentences =
    String(text || "").match(
      /[^.!?。！？]+[.!?。！？]+[”’"']?|[^.!?。！？]+$/g,
    ) || [];
  if (sentences.length >= 2) {
    const middle = Math.ceil(sentences.length / 2);
    return [
      sentences.slice(0, middle).join("").trim(),
      sentences.slice(middle).join("").trim(),
    ];
  }
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return [text, ""];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}
async function approvePages(
  s,
  { warningsAccepted, reviewed = false, qualityFinalized = false } = {},
) {
  captureEdits(s);
  const d = s.draft,
    accepted =
      warningsAccepted ??
      !!document.querySelector("#story-accept-failures")?.checked;
  if (d.outline?.plotContractDirty)
    throw new Error(
      "줄거리의 사건·장소가 바뀌었어요. 줄거리에서 설계와 장면을 다시 확인해 주세요.",
    );
  if (d.pagination.pages.length !== d.input.pageCount)
    throw new Error(
      `현재 ${d.pagination.pages.length}쪽 / 목표 ${d.input.pageCount}쪽입니다. 위의 복구 버튼으로 쪽 수를 맞춰 주세요.`,
    );
  const childCurrent =
    d.childGate &&
    !d.childGatePending &&
    d.childGate.contentFingerprint ===
      coherenceFingerprint({
        outline: d.outline,
        prose: d.prose,
        pagination: d.pagination,
        stage: "pages",
      }) &&
    (d.childGate.version === 1 || d.childGate.phase === "complete");
  if (
    d.input.storyQuality?.enabled &&
    d.input.storyQuality.childSimulator !== false &&
    !d.demo &&
    !qualityFinalized &&
    !childCurrent
  ) {
    return run(
      s,
      "아이 모의검사와 최종 플롯 검사를 이어가요",
      () =>
        finalizeStoryPagination(
          d.outline,
          d.prose,
          d.pagination,
          d.input,
          options(s, "pagination"),
        ),
      async (result) => {
        d.pagination = result.data;
        d.paginationMeta = { ...(d.paginationMeta || {}), ...result.meta };
        recordCoherence(d, result);
        d.storyCheck = result.meta?.checks || d.storyCheck;
        d.richnessCheck = result.meta?.richnessChecks || d.richnessCheck;
        d.checksDirty = false;
        await approvePages(s, {
          warningsAccepted: accepted,
          reviewed: false,
          qualityFinalized: true,
        });
      },
    );
  }
  if (
    d.outline?.plotContract &&
    !d.demo &&
    !reviewed &&
    !isCoherenceCurrent(d.pageCoherence || d.paginationMeta?.coherence, {
      outline: d.outline,
      prose: d.prose,
      pagination: d.pagination,
      stage: "pages",
    })
  ) {
    return run(
      s,
      "그림 생성 전 플롯 연결을 검사하고 있어요",
      () =>
        reviewStoryCoherence(
          d.outline,
          d.prose,
          d.pagination,
          d.input,
          options(s, "coherence"),
        ),
      async (result) => {
        if (result.data.prose) d.prose = result.data.prose;
        if (result.data.pagination) d.pagination = result.data.pagination;
        recordCoherence(d, result);
        d.paginationMeta = {
          ...(d.paginationMeta || {}),
          coherence: clone(result.meta.coherence),
        };
        d.checksDirty = false;
        if (hardCoherence(d.pageCoherence))
          throw new Error(
            "플롯 연결 오류를 수정한 뒤 그림 단계로 진행해 주세요.",
          );
        await approvePages(s, {
          warningsAccepted: accepted,
          reviewed: true,
          qualityFinalized,
        });
      },
    );
  }
  if (
    d.outline?.plotContract &&
    !d.demo &&
    hardCoherence(d.pageCoherence || d.paginationMeta?.coherence)
  )
    throw new Error("플롯 연결 오류를 수정한 뒤 그림 단계로 진행해 주세요.");
  if (d.sceneBriefs?.length) {
    d.pagination = stagePagination(d.pagination, stagingContext(d));
    if (d.textSettings.storyEnrichment !== false)
      d.richnessCheck = checkRichness(
        d.pagination,
        d.input,
        d.outline,
        d.sceneBriefs,
      );
  }
  const checked = checkStory(d.outline, d.pagination, {
    specs: d.input.specs,
    allowedNames: d.input.characters
      .flatMap((c) => [c.name, c.nameEn])
      .filter(Boolean),
  });
  ensure(s);
  if (checked) d.storyCheck = checked;
  d.checksDirty = false;
  if (
    (d.storyCheck?.passed === false || d.richnessCheck?.valid === false) &&
    !accepted
  ) {
    renderPages(s);
    throw new Error(
      "검사 경고를 먼저 확인하거나 글을 수정해 주세요. 확인 후 진행하려면 아래 체크란을 선택해 주세요.",
    );
  }
  d.stage = "paged";
  snapshot(s, "pagination");
  saveDraft(s);
  const proseSettings = d.input.storyQuality?.enabled
      ? resolveQualityStageSettings(
          d.textSettings,
          "prose",
          d.input.storyQuality,
        )
      : resolveStoryStageSettings(d.textSettings, "prose"),
    payload = {
      id: d.id,
      bookId: d.bookId || d.id,
      sceneBriefs: clone(d.sceneBriefs || []),
      richnessCheck: clone(d.richnessCheck || null),
      proseCoherence: clone(d.proseCoherence || null),
      pageCoherence: clone(d.pageCoherence || null),
      childGate: clone(d.childGate || null),
      wizard: clone(d.wizard),
      input: clone(d.input),
      outline: clone(d.outline),
      prose: clone(d.prose),
      pagination: clone(d.pagination),
      stage: "paged",
      textEngineId: d.demo ? "demo" : proseSettings.engineId,
      textModelId: d.demo ? "demo" : proseSettings.config.model || null,
      textSettings: clone(d.textSettings),
      summaryForNext: summarizeStory(d.outline, {
        ...d.input,
        prose: d.prose,
        pagination: d.pagination,
      }),
      readingLevels: clone(d.readingLevels),
      usage: clone(d.usage),
      storyCheck: clone(d.storyCheck || d.paginationMeta?.checks || {}),
      demo: !!d.demo,
      worldId: d.worldId,
      worldSnapshot: clone(d.worldSnapshot),
    };
  s.busy = true;
  try {
    await api.onReady(payload);
    if (session === s) session = null;
  } catch (err) {
    s.busy = false;
    throw err;
  }
}
async function approvedSceneBriefs(s) {
  const d = s.draft;
  if (d.outline?.plotContract && d.outline.plotContractDirty && !d.demo) {
    const fixed = await ensurePlotContract(
      d.outline,
      d.input,
      options(s, "outline"),
    );
    addUsage(s, fixed, s.runId + ":contract");
    snapshot(s, "outline");
    d.outline = fixed.data;
    delete d.outline.plotContractDirty;
    d.sceneBriefs = null;
    d.sceneBriefsMeta = null;
    saveDraft(s);
  }
  acceptOutline(s);
  return generateSceneBriefs(d.outline, d.input, options(s, "sceneBriefs"));
}

async function writeProse(s, { hybridFinal = false } = {}) {
  const d = s.draft,
    hybrid =
      isHybrid(d.textSettings) && !d.input.storyQuality?.enabled && !d.demo;
  const source = {
    ...d.input,
    ...(hybridFinal ? { draftProse: clone(d.prose) } : {}),
  };
  const result = await generateProse(
    d.outline,
    source,
    options(s, hybrid && !hybridFinal ? "proseDraft" : "prose"),
  );
  snapshot(s, "prose");
  invalidateStoryDetails(d, { prose: true });
  d.prose = result.data;
  recordCoherence(d, result);
  d.hybridFinal = !hybrid || hybridFinal;
  d.stage = "prose_draft";
  s.mode = "prose";
  if (
    !d.hybridFinal ||
    d.demo ||
    d.input.storyQuality?.enabled ||
    d.textSettings.storyEnrichment === false
  ) {
    saveDraft(s);
    return result;
  }
  addUsage(s, result, s.runId + ":prose");
  d.enrichmentPending = true;
  d.enrichmentSourceProse = clone(result.data);
  saveDraft(s);
  return enrichProse(d.prose, d.outline, d.input, options(s, "enrichment"));
}
async function handleClick(event) {
  const el = event.target.closest("[data-story-action]");
  if (!el) return;
  event.preventDefault();
  const action = el.dataset.storyAction;
  if (action === "resume") {
    api.protectedAction(() => resumeStoryDraft(el.dataset.id));
    return;
  }
  if (action === "delete-draft") {
    api.protectedAction(() => {
      const state = api.getState();
      delete drafts(state)[el.dataset.id];
      if (api.save() !== false) {
        api.render();
        api.toast("이야기 초안을 삭제했어요.");
      }
    });
    return;
  }
  const s = session;
  if (!s || !api.isParent()) return;
  if (action === "close") {
    cleanupStoryWorkflow();
    api.closeModal();
    api.render();
    return;
  }
  if (action === "stop") {
    s.controller?.abort();
    return;
  }
  if (s.busy) return;
  s.pendingMode = [
    "generate-prose",
    "resume-enrichment",
    "regenerate-prose",
    "hybrid-final",
    "rewrite-paragraph",
  ].includes(action)
    ? "prose"
    : ["approve-prose", "repaginate", "repair-pages", "rewrite-page"].includes(
          action,
        )
      ? "pages"
      : null;
  try {
    captureEdits(s);
    saveDraft(s);
    const d = s.draft;
    if (action === "open-text-settings") {
      cleanupStoryWorkflow();
      api.closeModal();
      api.openTextSettings?.(d.id);
      return;
    }
    if (action === "set-beat-location" || action === "set-beat-emotion") {
      snapshot(s, "prose");
      snapshot(s, "pagination");
      const beforeChip = outlineContentKey(d.outline);
      if (action === "set-beat-location")
        d.outline = updateStoryBeatLocation(
          d.outline,
          d.input,
          Number(el.dataset.index),
          el.dataset.backgroundId,
        );
      else
        (d.outline.emotionArc ||= [])[Number(el.dataset.index)] =
          el.dataset.emotion;
      if (outlineContentKey(d.outline) !== beforeChip) {
        snapshot(s, "prose");
        snapshot(s, "pagination");
        invalidateStoryDetails(d, { outline: true });
      }
      saveDraft(s);
      renderOutline(s);
      return;
    }
    if (action === "use-current-text-settings") {
      d.textSettings = clone(getTextGenerationSettings(s.state));
      d.input.storyQuality = {
        ...clone(d.textSettings.storyQuality),
        patternId:
          d.wizard?.storyQualityPatternId ||
          d.textSettings.storyQuality.patternId,
        worldId:
          d.wizard?.storyWorldId ||
          d.input.storyQuality?.worldId ||
          d.textSettings.storyQuality.worldId,
        season:
          d.wizard?.storySeason ||
          d.input.storyQuality?.season ||
          d.textSettings.storyQuality.season,
        timeOfDay:
          d.wizard?.storyTimeOfDay ||
          d.input.storyQuality?.timeOfDay ||
          d.textSettings.storyQuality.timeOfDay,
        approvedBooks: storyQualityBookRecords(s.state),
      };
      d.qualityCheckpoint = null;
      saveDraft(s);
      renderSession(s);
      api.toast(
        "저장된 글과 줄거리는 유지하고 현재 World의 글 엔진을 적용했어요.",
      );
      return;
    }
    if (action === "replace-demo-with-api") {
      if (!d.demo) return;
      return run(
        s,
        "선택 엔진으로 새 줄거리를 만들고 있어요",
        () => generateOutline(d.input, options(s, "outline", true)),
        (r) => {
          snapshot(s, "outline");
          snapshot(s, "prose");
          snapshot(s, "pagination");
          d.outline = r.data;
          invalidateStoryDetails(d, { outline: true });
          d.demo = false;
          d.titleIndex = 0;
          d.selectedTitle = r.data.titleCandidates[0];
          d.stage = "outline_draft";
          s.mode = "outline";
        },
      );
    }
    if (action === "fit-page-count") {
      snapshot(s, "pagination");
      const fitted = splitPaginationToCount(d.pagination, d.input.pageCount, {
        outline: d.outline,
      });
      d.pagination = fitted;
      d.storyCheck = checkStory(d.outline, fitted, {
        specs: d.input.specs,
        allowedNames: d.input.characters
          .flatMap((c) => [c.name, c.nameEn])
          .filter(Boolean),
      });
      d.paginationMeta = { checks: d.storyCheck, manualRedistribution: true };
      d.checksDirty = false;
      renumber(s);
      return;
    }
    if (action === "start-api" || action === "start-demo") {
      if (action === "start-api") {
        const locations = preflightOutlineLocations(d.input);
        if (!locations.valid) throw new Error(locations.errors.join("\n"));
      }
      d.demo = action === "start-demo";
      return run(
        s,
        "줄거리를 만들고 있어요",
        () => generateOutline(d.input, options(s, "outline")),
        (r) => {
          d.outline = r.data;
          d.titleIndex = 0;
          d.selectedTitle = d.outline.titleCandidates[0];
          d.stage = "outline_draft";
          s.mode = "outline";
        },
      );
    }
    if (action === "reroll-quality-seed") {
      d.input.qualitySeedOffset = Math.min(
        999,
        (Number(d.input.qualitySeedOffset) || 0) + 1,
      );
      d.wizard.qualitySeedOffset = d.input.qualitySeedOffset;
      d.qualityCheckpoint = null;
      return run(
        s,
        "다른 재료로 줄거리를 구성하고 있어요",
        () => generateOutline(d.input, options(s, "outline")),
        (r) => {
          snapshot(s, "outline");
          d.outline = r.data;
          invalidateStoryDetails(d, { outline: true });
          s.mode = "outline";
        },
      );
    }
    if (action === "regenerate-outline")
      return run(
        s,
        "줄거리 전체를 다시 만들고 있어요",
        () => generateOutline(d.input, options(s, "outline")),
        (r) => {
          snapshot(s, "outline");
          d.outline = r.data;
          invalidateStoryDetails(d, { outline: true });
          s.mode = "outline";
        },
      );
    if (action === "rewrite-beat")
      return run(
        s,
        `${Number(el.dataset.index) + 1}번 비트만 다시 만들고 있어요`,
        () =>
          rewriteBeat(
            d.outline,
            Number(el.dataset.index),
            d.input,
            options(s, "outline"),
          ),
        (r) => {
          snapshot(s, "outline");
          d.outline = r.data;
          invalidateStoryDetails(d, { outline: true });
        },
      );
    if (action === "approve-outline") {
      acceptOutline(s, { allowDirty: true });
      return run(
        s,
        "비트별 장면 디테일을 만들고 있어요",
        () => approvedSceneBriefs(s),
        (r) => {
          d.sceneBriefs = r.data;
          d.sceneBriefsMeta = r.meta;
          d.stage = "outline_ok";
          s.mode = "outline";
        },
      );
    }
    if (action === "rewrite-scene-brief")
      return run(
        s,
        "이 장면 디테일만 다시 만들고 있어요",
        () =>
          rewriteSceneBrief(
            d.sceneBriefs,
            Number(el.dataset.index),
            d.outline,
            d.input,
            options(s, "sceneBriefs"),
          ),
        (r) => {
          invalidateStoryDetails(d);
          d.sceneBriefs = r.data;
          d.sceneBriefsMeta = r.meta;
          s.mode = "outline";
        },
      );
    if (action === "generate-prose") {
      if (d.outline?.plotContractDirty)
        throw new Error(
          "수정한 줄거리를 승인해 설계와 장면을 다시 맞춰 주세요.",
        );
      acceptOutline(s);
      const report = inspectSceneBriefs(d.sceneBriefs, d.outline, d.input);
      if (!report.valid) throw new Error(report.errors.join("\n"));
      return run(
        s,
        "장면 디테일로 전문을 쓰고 다듬고 있어요",
        () => writeProse(s),
        (r) => {
          d.prose = r.data;
          d.enrichmentPending = false;
          d.enrichmentCheckpoint =
            r.meta?.enrichmentCheckpoint || d.enrichmentCheckpoint;
          d.stage = "prose_draft";
          s.mode = "prose";
        },
      );
    }
    if (action === "resume-enrichment")
      return run(
        s,
        "완료한 문단 다음부터 풍부화를 이어가요",
        () =>
          enrichProse(d.prose, d.outline, d.input, options(s, "enrichment")),
        (r) => {
          d.prose = r.data;
          d.enrichmentPending = false;
          d.enrichmentCheckpoint = r.meta?.enrichmentCheckpoint;
          d.stage = "prose_draft";
          s.mode = "prose";
        },
      );
    if (action === "set-page-staging") {
      d.pagination = updatePageStaging(
        d.pagination,
        Number(el.dataset.index),
        { [el.dataset.stagingField]: el.dataset.stagingValue },
        stagingContext(d),
      );
      saveDraft(s);
      renderPages(s);
      return;
    }
    if (action === "prose-tab") {
      s.language = el.dataset.language;
      renderProse(s);
      return;
    }
    if (action === "back-outline") {
      s.mode = "outline";
      renderOutline(s);
      return;
    }
    if (action === "back-prose") {
      s.mode = "prose";
      renderProse(s);
      return;
    }
    if (action === "regenerate-prose" || action === "hybrid-final")
      return run(
        s,
        "전문을 쓰고 장면 디테일을 다듬고 있어요",
        () => writeProse(s, { hybridFinal: action === "hybrid-final" }),
        (r) => {
          d.prose = r.data;
          d.enrichmentPending = false;
          d.stage = "prose_draft";
          s.mode = "prose";
        },
      );
    if (action === "rewrite-paragraph")
      return run(
        s,
        "선택한 문단만 다시 쓰고 있어요",
        () =>
          rewriteParagraph(
            d.prose,
            el.dataset.language,
            Number(el.dataset.index),
            d.outline,
            d.input,
            options(s, d.hybridFinal ? "prose" : "proseDraft"),
          ),
        (r) => {
          snapshot(s, "prose");
          invalidateStoryDetails(d, { prose: true });
          d.prose = r.data;
          d.stage = "prose_draft";
        },
      );
    if (action === "approve-prose") {
      acceptProse(s);
      return run(
        s,
        "승인한 전문을 쪽으로 나누고 검사하고 있어요",
        () =>
          paginateStory(d.outline, d.prose, d.input, options(s, "pagination")),
        (r) => {
          d.pagination = r.data;
          d.paginationMeta = r.meta;
          recordCoherence(d, r);
          d.storyCheck = r.meta?.checks;
          d.richnessCheck = r.meta?.richnessChecks || null;
          d.checksDirty = false;
          d.stage = "paged";
          s.mode = "pages";
        },
      );
    }
    if (action === "repaginate") {
      const targetPages =
        Number(document.querySelector("#story-page-count")?.value) ||
        d.input.pageCount;
      return run(
        s,
        "전문은 유지하고 쪽만 다시 나누고 있어요",
        () =>
          paginateStory(
            d.outline,
            d.prose,
            { ...d.input, pageCount: targetPages },
            options(s, "pagination"),
          ),
        (r) => {
          d.input.pageCount = targetPages;
          if (d.wizard) d.wizard.pageCount = targetPages;
          snapshot(s, "pagination");
          d.pagination = r.data;
          d.paginationMeta = r.meta;
          recordCoherence(d, r);
          d.storyCheck = r.meta?.checks;
          d.richnessCheck = r.meta?.richnessChecks || null;
          d.checksDirty = false;
        },
      );
    }
    if (action === "repair-pages")
      return run(
        s,
        "실패한 쪽을 최대 두 번 수정하고 있어요",
        () =>
          repairPagination(
            d.outline,
            d.prose,
            d.pagination,
            d.input,
            options(s, "pagination"),
          ),
        (r) => {
          snapshot(s, "pagination");
          d.pagination = r.data;
          d.paginationMeta = r.meta;
          recordCoherence(d, r);
          d.storyCheck = r.meta?.checks;
          d.richnessCheck = r.meta?.richnessChecks || null;
          d.checksDirty = false;
        },
      );
    if (action === "rewrite-page")
      return run(
        s,
        `${Number(el.dataset.index) + 1}쪽만 다시 쓰고 있어요`,
        () =>
          rewriteStoryPage(
            d.pagination,
            Number(el.dataset.index) + 1,
            d.outline,
            d.prose,
            d.input,
            options(s, "pagination"),
          ),
        (r) => {
          snapshot(s, "pagination");
          d.pagination = r.data;
          d.paginationMeta = r.meta;
          recordCoherence(d, r);
          d.storyCheck = r.meta?.checks;
          d.richnessCheck = r.meta?.richnessChecks || null;
          d.checksDirty = !r.meta?.checks;
        },
      );
    if (action === "split-page") {
      const i = Number(el.dataset.index),
        page = d.pagination.pages[i],
        ko = divide(page.textKo),
        en = divide(page.textEn);
      if (!ko[1] && !en[1])
        throw new Error(
          "한 문장만 있는 쪽은 직접 글을 나누거나 쪽만 다시 나누기를 사용해 주세요.",
        );
      snapshot(s, "pagination");
      page.textKo = ko[0];
      page.textEn = en[0];
      d.pagination.pages.splice(i + 1, 0, {
        ...clone(page),
        textKo: ko[1],
        textEn: en[1],
      });
      renumber(s);
      return;
    }
    if (action === "merge-page") {
      const i = Number(el.dataset.index),
        a = d.pagination.pages[i],
        b = d.pagination.pages[i + 1];
      if (!b) return;
      if (
        a.beatIndex !== b.beatIndex ||
        a.scene.where !== b.scene.where ||
        a.scene.timeOfDay !== b.scene.timeOfDay
      )
        throw new Error(
          "같은 비트·장소·시간의 쪽을 합칠 수 있어요. 장면이 다르면 쪽만 다시 나누기를 사용해 주세요.",
        );
      snapshot(s, "pagination");
      a.textKo = [a.textKo, b.textKo].filter(Boolean).join(" ");
      a.textEn = [a.textEn, b.textEn].filter(Boolean).join(" ");
      a.isRefrainPage = !!(a.isRefrainPage || b.isRefrainPage);
      d.pagination.pages.splice(i + 1, 1);
      renumber(s);
      return;
    }
    if (action === "approve-pages") await approvePages(s);
  } catch (err) {
    if (err.name !== "AbortError") error(s, err.message);
  }
}
function handleInput(event) {
  if (event.target.closest(".story-engine-card")) return;
  if (
    !session ||
    session.busy ||
    !api.isParent() ||
    !event.target.closest(".story-workspace")
  )
    return;
  if (session.mode === "pages") markPagesDirty(session);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (session) {
      captureEdits(session);
      saveDraft(session);
    }
  }, 250);
}
function handleChange(event) {
  if (
    !session ||
    session.busy ||
    !api.isParent() ||
    !event.target.closest(".story-workspace")
  )
    return;
  const s = session;
  try {
    captureEdits(s);
    if (event.target.dataset?.qualityWorldField) {
      const key = {
        storyWorldId: "worldId",
        storySeason: "season",
        storyTimeOfDay: "timeOfDay",
      }[event.target.dataset.qualityWorldField];
      if (key) {
        s.draft.input.storyQuality[key] = event.target.value;
        s.draft.wizard[event.target.dataset.qualityWorldField] =
          event.target.value;
        s.draft.qualityCheckpoint = null;
        saveDraft(s);
        return;
      }
    }
    if (event.target.matches?.("[data-quality-pattern-choice]")) {
      s.draft.input.storyQuality.patternId = event.target.value;
      s.draft.wizard.storyQualityPatternId = event.target.value;
      s.draft.qualityCheckpoint = null;
      saveDraft(s);
      renderLaunch(s);
      return;
    }
    if (event.target.matches?.("[data-story-structure-preset]")) {
      s.draft.input.storyStructurePresetId = event.target.value;
      s.draft.wizard.storyStructurePresetId = event.target.value;
      saveDraft(s);
      renderLaunch(s);
      return;
    }
    if (
      [
        "story-text-engine",
        "story-text-model",
        "story-local-model",
        "story-text-hybrid",
      ].includes(event.target.id)
    ) {
      const selection =
        event.target.id === "story-text-engine"
          ? { engine: event.target.value }
          : event.target.id === "story-text-hybrid"
            ? { hybridEnabled: event.target.checked }
            : { model: event.target.value };
      s.draft = updateStoryDraftEngine(
        s.draft,
        selection,
        getTextGenerationSettings(s.state),
      );
      if (!saveDraft(s))
        throw new Error(
          "글 엔진 선택을 저장하지 못했어요. 저장 공간을 확인해 주세요.",
        );
      renderSession(s);
      return;
    }
    saveDraft(s);
  } catch (err) {
    error(s, err.message);
  }
}
