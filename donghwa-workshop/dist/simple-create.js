/* 쉬운 만들기 (R9-B2): five steps on top of the app's shared wizard/draft.
 * ① 주제 넣기 → ② 재료 고르기 → ③ 글 만들기 (FULL AUTO, text hold) → ④ 쪽마다 검수 → ⑤ 동화책 만들기.
 * Runs, resumes, stops and per-page work go through the FULL AUTO runner and the
 * page tools; no pipeline logic lives here. Nothing paid starts without a confirm
 * that names the cost, and completed paid steps are never bought again. */
import { activeCharacters, activeBackgrounds } from "./management.js";
import {
  startFullAutoJob,
  runFullAutoJob,
  stopFullAutoJob,
  getFullAutoJob,
  isFullAutoRunning,
} from "./full-auto-ui.js";
import { estimateFullAutoCost, fullAutoProgress } from "./full-auto.js";
import {
  rewriteBookPage,
  applyPageText,
  setPageReviewed,
  pagesNeedingImages,
  estimateSimpleCosts,
  generateBookPageImage,
} from "./story-generation/page-tools.js";
import { collectBookChecks } from "./checks-panel.js";
import {
  describeReadingViolation,
  renderReadingSelectors,
} from "./reading-ui.js";
import { getActiveWorld } from "./image-generation/world.js";
import { ENGINE_METADATA } from "./image-generation/providers.js";
import { listCredentialStatus } from "./image-generation/vault.js";
import {
  getTextGenerationSettings,
  normalizeStoryQualitySettings,
} from "./text-generation/settings-ui.js";
import {
  getTextModelInfo,
  resolveStoryStageSettings,
  resolveQualityStageSettings,
} from "./text-generation/models.js";
import { syncActiveWorldTextSettings } from "./world-variations.js";
import {
  setStoryQualityOption,
  storyWorldTopic,
} from "./story-generation/quality-settings.js";
import { isCoherenceCurrent } from "./story-generation/coherence.js";
import { currentBookPagination } from "./story-generation/book-coherence.js";
import { syncStoryDraft } from "./story-generation/ui.js";
import { isHomeBackground } from "./story-generation/pipeline.js";
import { safeTopic } from "./engine.js";

/* ---------- per-device mode ---------- */
export const UI_MODE_KEY = "donghwa-ui-mode";
export const UI_MODES = Object.freeze(["simple", "pro"]);
/** Per-device screen mode. Missing, unknown or unreadable storage means the simple screen. */
export function readUiMode(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(UI_MODE_KEY) === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}
/** Store the mode on this device only; returns the mode actually in effect. */
export function writeUiMode(mode, storage = globalThis.localStorage) {
  const next = mode === "pro" ? "pro" : "simple";
  try {
    storage?.setItem(UI_MODE_KEY, next);
  } catch {
    /* Private windows may refuse storage; the mode still applies to this page. */
  }
  return next;
}
export const nextUiMode = (mode) => (mode === "pro" ? "simple" : "pro");

/* ---------- small helpers ---------- */
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clone = (value) => (value == null ? value : structuredClone(value));
const usd = (value) => {
  const n = Number(value) || 0;
  return n <= 0 ? "$0" : "$" + n.toFixed(n < 0.1 ? 3 : 2);
};
const sbtn = (label, action, kind = "outline", attrs = "") =>
  `<button type="button" class="btn btn-${kind}" data-simple-action="${action}" ${attrs}>${label}</button>`;
export const SIMPLE_STEPS = Object.freeze([
  "주제 넣기",
  "재료 고르기",
  "생성",
  "쪽마다 검수",
  "동화책 만들기",
]);
export const SIMPLE_TOPICS = Object.freeze([
  "공룡 친구와 소풍",
  "달에 놀러 간 날",
  "비 오는 날의 모험",
  "바닷속 보물 찾기",
  "처음 유치원에 간 날",
  "친구의 생일 파티",
]);
const LANGUAGE_LABELS = {
  dual: "한글판·영어판 두 권",
  bilingual: "한 쪽에 한글 + 영어",
  ko: "한글만",
  en: "영어만",
};
const TEXT_ENGINES = ["openai", "anthropic", "google", "local"];
const TEXT_ENGINE_NAMES = {
  openai: "OpenAI",
  anthropic: "Anthropic · Claude",
  google: "Google · Gemini",
  local: "로컬 · LM Studio / Ollama",
  demo: "데모 글 · 무료",
};
const HELD = ["text-review", "pages-ready", "review"];
const RESUMABLE = ["ready", "running", "paused", "failed", ...HELD];
const MAX_FRIENDS = 2,
  MAX_PLACES = 4,
  MAX_RESUME_CARDS = 2;

/* ---------- language-aware text check (approve-book) ---------- */
const needsKo = (book) => book?.language !== "en";
const needsEn = (book) => book?.language !== "ko";
/** Page indexes whose required text is empty for the book's own language. */
export function missingPageText(book) {
  return (book?.pages || []).flatMap((page, index) =>
    (needsKo(book) && !String(page?.ko ?? page?.textKo ?? "").trim()) ||
    (needsEn(book) && !String(page?.en ?? page?.textEn ?? "").trim())
      ? [index]
      : [],
  );
}
export function pageTextProblemMessage(book) {
  const what =
    book?.language === "ko"
      ? "한글"
      : book?.language === "en"
        ? "영어"
        : "한글·영어";
  return `제목과 각 쪽의 ${what} 글을 확인해 주세요.`;
}

/* ---------- FULL AUTO bookkeeping kept on a rebuilt book ---------- */
/**
 * The story builder makes a new book object; keep the FULL AUTO link and flags
 * from the book it replaces and point the job at the new object, so resume and
 * the approve check never re-buy finished images. A running job keeps its book.
 */
export function carryFullAutoFields(state, book, prior) {
  if (!book || !prior?.fullAutoRunId) return book;
  book.fullAutoRunId = prior.fullAutoRunId;
  for (const key of ["autoReviewPending", "autoGenerationComplete"])
    if (prior[key] !== undefined) book[key] = prior[key];
  const job = state?.fullAutoJobs?.[prior.fullAutoRunId];
  if (job && job.status !== "running" && (!job.book || job.book.id === book.id))
    job.book = book;
  return book;
}

/* ---------- recommendations (a plain keyword match, no model call) ---------- */
const PLACE_HINTS = [
  [/달|별|우주|space|moon/i, ["달", "별", "우주", "로켓", "밤하늘", "행성"]],
  [
    /바다|바닷|조개|해변|sea|beach/i,
    ["바다", "바닷", "조개", "물고기", "파도", "보물", "고래", "모래"],
  ],
  [/숲|나무|forest/i, ["숲", "나무", "공룡", "소풍", "산책", "곤충"]],
  [
    /빗방울|정원|웅덩이|rain|garden/i,
    ["비 오는", "빗", "우산", "무지개", "장화", "웅덩이", "정원"],
  ],
  [/유치원|학교|school/i, ["유치원", "학교", "선생님", "교실"]],
  [/놀이터|공원|park/i, ["놀이터", "공원", "그네", "미끄럼"]],
  [/생일|파티|party/i, ["생일", "파티", "케이크"]],
];
const KIND_WORDS = {
  dinosaur: ["공룡"],
  rabbit: ["토끼"],
  cat: ["고양이"],
  dog: ["강아지"],
};
const ADJECTIVE_END = /(?:는|한|은|운|인|던|된|진|울)$/u;
function nameWords(text) {
  return String(text || "")
    .split(/[\s,·/()]+/u)
    .map((word) =>
      word.replace(
        /(?:으로|에서|이랑|에게|와|과|의|이|가|을|를|은|는|에|로)$/u,
        "",
      ),
    )
    .filter((word) => word && !ADJECTIVE_END.test(word));
}
export function placeKeywords(background = {}) {
  const text = [
      background.name,
      background.nameEn,
      background.description,
      background.type,
    ]
      .filter(Boolean)
      .join(" "),
    words = new Set(nameWords(background.name));
  for (const [pattern, hints] of PLACE_HINTS)
    if (pattern.test(text)) hints.forEach((hint) => words.add(hint));
  return [...words].filter(Boolean);
}
function topicScore(topic, keywords) {
  const text = String(topic || "");
  return keywords.filter((word) => word && text.includes(word)).length;
}
/** Non-home places whose name/description shares a keyword with the topic, best first. */
export function recommendPlaces(topic, backgrounds = []) {
  return backgrounds
    .filter((b) => !isHomeBackground(b))
    .map((b, order) => ({
      id: b.id,
      order,
      score: topicScore(topic, placeKeywords(b)),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((row) => row.id);
}
export function recommendFriends(topic, characters = []) {
  return characters
    .map((c, order) => ({
      id: c.id,
      order,
      score: topicScore(topic, [
        c.name,
        ...(KIND_WORDS[c.kind] || []),
        ...nameWords(String(c.likes || "").replace(/,/g, " ")),
      ]),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((row) => row.id);
}
/** Fill the picks once per topic: protagonist + recommended friends, one home + 2 recommended places. */
export function preselectMaterials(state, wizard) {
  const topic = String(wizard.topic || "").trim();
  if (wizard.simplePicksTouched || wizard.simplePickedFor === topic)
    return wizard;
  const characters = activeCharacters(state),
    backgrounds = activeBackgrounds(state),
    protagonist =
      wizard.characterIds?.find((id) => characters.some((c) => c.id === id)) ||
      characters[0]?.id,
    friends = recommendFriends(
      topic,
      characters.filter((c) => c.id !== protagonist),
    ).slice(0, MAX_FRIENDS),
    home = backgrounds.find(isHomeBackground),
    places = recommendPlaces(topic, backgrounds).slice(0, 2);
  wizard.characterIds = [protagonist, ...friends].filter(Boolean);
  wizard.backgroundIds = [home?.id, ...places].filter(Boolean);
  wizard.simplePickedFor = topic;
  return wizard;
}

/* ---------- wizard and job lookups ---------- */
export function formatSummary(wizard = {}) {
  const parts = [];
  if (wizard.language !== "en") parts.push(wizard.koreanLevel || "K1");
  if (wizard.language !== "ko") parts.push(wizard.englishLevel || "E0");
  parts.push(`${Number(wizard.pageCount) || 12}쪽`);
  parts.push(LANGUAGE_LABELS[wizard.language] || LANGUAGE_LABELS.dual);
  return parts.join(" · ");
}
/** Fill the simple-only fields without touching anything the pro wizard set. */
export function ensureSimpleWizard(state, wizard) {
  const w = wizard;
  if (!Number.isInteger(w.simpleStep) || w.simpleStep < 1 || w.simpleStep > 5)
    w.simpleStep = 1;
  if (typeof w.allowNew !== "boolean") w.allowNew = true;
  if (!Array.isArray(w.characterIds) || !w.characterIds.length)
    w.characterIds = [activeCharacters(state)[0]?.id].filter(Boolean);
  if (!Array.isArray(w.backgroundIds)) w.backgroundIds = [];
  if (w.previousBookId && w.simplePicksTouched === undefined)
    w.simplePicksTouched = true;
  return w;
}
export function isSimpleJob(job) {
  return (
    !!job?.id &&
    (job.wizard?.simpleFlow === true ||
      job.stopBefore === "text" ||
      job.stopBefore === "pages" ||
      job.status === "text-review" ||
      job.status === "pages-ready")
  );
}
/** Simple jobs to resume, newest first: running/paused/failed text work or a held/finished book. */
export function simpleJobs(state) {
  return Object.values(state?.fullAutoJobs || {})
    .filter(
      (job) =>
        isSimpleJob(job) &&
        !job.simpleReplacedBy &&
        RESUMABLE.includes(job.status),
    )
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
/** ③ while the text is not built yet, ④ once the job holds a book. */
export function simpleStepForJob(job) {
  if (HELD.includes(job?.status)) return 4;
  return job?.book ? 4 : 3;
}
const jobOfWizard = (state, w) =>
  (w?.simpleJobId && state?.fullAutoJobs?.[w.simpleJobId]) || null;
const jobOfBook = (state, book) =>
  (book?.fullAutoRunId && state?.fullAutoJobs?.[book.fullAutoRunId]) || null;
const UI_FIELDS = [
  "simpleStep",
  "simpleJobId",
  "simpleFormatOpen",
  "simpleEditing",
  "simpleBadgeOpen",
  "simpleForced",
  "simpleIdeaOffset",
  "simplePickedFor",
  "simplePicksTouched",
  "simpleRunToken",
];
/** The wizard copy a job freezes: screen-only fields out, the simple marker in. */
export function jobWizardFrom(wizard, token) {
  const copy = clone(wizard);
  for (const key of UI_FIELDS) delete copy[key];
  copy.simpleFlow = true;
  if (token) copy.simpleRunToken = token;
  return copy;
}
function wizardFromJob(job, step) {
  const w = clone(job.wizard || {});
  for (const key of UI_FIELDS) delete w[key];
  return {
    ...w,
    step: 1,
    simpleStep: step,
    simpleJobId: job.id,
    simplePicksTouched: true,
    allowNew: job.allowNew !== false,
  };
}
export const isSimpleBusy = () => !!(liveRun || pageOp || actionBusy);
/** Paid image/text work in flight (a confirm dialog waiting for the parent is not work). */
const workBusy = () => !!(liveRun || pageOp);
const runIsLive = (job) =>
  !!job &&
  (liveRun?.jobId === job.id ||
    (job.status === "running" && isFullAutoRunning()));

/* ---------- module state ---------- */
let api = null,
  configured = false,
  liveRun = null,
  pageOp = null,
  actionBusy = false,
  keyStatus = null,
  keyStatusLoading = false,
  readingQueued = false,
  lastProgress = null;

/* ---------- rendering ---------- */
const fallbackHeading = (title, sub, action = "") =>
  `<div class="page-heading"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>`;
function stepsBar(step) {
  return `<div class="steps simple-steps" role="list" aria-label="쉬운 만들기 단계">${SIMPLE_STEPS.map((label, i) => `<div class="step ${i + 1 === step ? "active" : i + 1 < step ? "done" : ""}" role="listitem" ${i + 1 === step ? 'aria-current="step"' : ""}><b>${i + 1 < step ? "✓" : i + 1}</b>${label}</div>`).join("")}</div>`;
}
function selectField(id, label, options, value) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${options.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
}
function renderFormatPanel(w) {
  return `<div class="simple-format-panel form-grid" id="simple-format-panel">${selectField(
    "language",
    "언어",
    [
      ["dual", "한글판 · 영어판 두 권"],
      ["bilingual", "한 쪽에 한글 + 영어"],
      ["ko", "한글만"],
      ["en", "영어만"],
    ],
    w.language,
  )}${selectField(
    "pageCount",
    "쪽 수",
    [
      [8, "8쪽 · 짧은 이야기"],
      [12, "12쪽 · 기본"],
      [16, "16쪽"],
      [24, "24쪽"],
    ],
    w.pageCount,
  )}${renderReadingSelectors(w)}</div>`;
}
function ideaState(state) {
  const quality = normalizeStoryQualitySettings(state.settings?.storyQuality);
  return quality.worldId && quality.worldId !== "drawer"
    ? { usable: true, worldId: quality.worldId, quality }
    : {
        usable: false,
        reason:
          "아이디어는 모험 무대가 정해져 있을 때 뽑을 수 있어요. 프로 모드의 이야기 품질 설정에서 기본 무대를 골라 주세요.",
      };
}
function resumeLabel(job) {
  if (job.status === "text-review") return "글 검수 대기";
  if (job.status === "pages-ready") return "그림 준비 완료";
  if (job.status === "review") return "그림 완성 · 마지막 확인";
  if (job.status === "failed") return "멈춤 · 다시 시도";
  if (runIsLive(job)) return job.book ? "그림 만드는 중" : "글 만드는 중";
  return "이어서 만들기";
}
function renderResumeCards(state) {
  const jobs = simpleJobs(state);
  if (!jobs.length) return "";
  return `<section class="simple-resume" aria-label="이어서 만들기"><h3>이어서 만들기</h3><div class="simple-resume-list">${jobs
    .slice(0, MAX_RESUME_CARDS)
    .map(
      (job) =>
        `<button type="button" class="simple-resume-card" data-simple-action="resume" data-id="${esc(job.id)}"><strong>${esc(job.book?.title || job.input?.topic || job.wizard?.topic || "이야기")}</strong><small>${esc(resumeLabel(job))} · ${simpleStepForJob(job) === 4 ? "④ 쪽마다 검수" : "③ 생성"}</small></button>`,
    )
    .join(
      "",
    )}</div>${jobs.length > MAX_RESUME_CARDS ? `<p class="small-label">나머지 ${jobs.length - MAX_RESUME_CARDS}권은 책장의 ‘제작 중인 이야기’에서 이어 갈 수 있어요.</p>` : ""}</section>`;
}
function renderTopicStep(ctx, w) {
  const state = ctx.getState(),
    idea = ideaState(state);
  return `<section class="panel simple-panel"><h3>어떤 이야기를 만들까요?</h3><p class="section-sub">아이가 좋아하는 것, 오늘 있었던 일을 한 줄로 적어 주세요.</p><div class="field"><label for="topic">이야기 주제</label><textarea id="topic" maxlength="400" placeholder="예: 유하가 공룡 친구와 함께 길을 잃은 별을 찾아주는 이야기">${esc(w.topic)}</textarea></div><div class="chips">${SIMPLE_TOPICS.map((topic) => `<button type="button" class="chip ${w.topic === topic ? "selected" : ""}" data-simple-action="topic" data-topic="${esc(topic)}">${esc(topic)}</button>`).join("")}</div><div class="simple-idea">${sbtn("아이디어 뽑기", "idea", "outline", `${idea.usable ? "" : "disabled"} ${idea.usable ? "" : 'aria-describedby="simple-idea-status"'}`)}<span class="small-label" id="simple-idea-status" role="status" aria-live="polite">${idea.usable ? "" : esc(idea.reason)}</span></div><div class="simple-format"><span class="small-label">책 형식</span><strong id="simple-format-summary">${esc(formatSummary(w))}</strong>${sbtn(w.simpleFormatOpen ? "접기" : "바꾸기", "format", "plain", `aria-expanded="${!!w.simpleFormatOpen}" aria-controls="simple-format-panel"`)}</div>${w.simpleFormatOpen ? renderFormatPanel(w) : ""}<p class="small-label simple-defaults-note">교훈·마무리·분위기는 부모 설정의 기본값을 써요.</p></section>${renderResumeCards(state)}<div class="wizard-actions"><button type="button" class="btn btn-outline" data-action="library">책장으로</button><span class="wizard-hint">부모가 확인하고 아이에게 전해요.</span>${sbtn("다음", "next", "green")}</div>`;
}
const PLACE_EMOJI = {
  home: "🏡",
  school: "🏫",
  forest: "🌳",
  space: "🌙",
  sea: "🐚",
};
function renderMaterialsStep(ctx, w) {
  const state = ctx.getState(),
    characters = activeCharacters(state),
    backgrounds = activeBackgrounds(state),
    protagonist = w.characterIds[0],
    friendRec = new Set(
      recommendFriends(
        w.topic,
        characters.filter((c) => c.id !== protagonist),
      ),
    ),
    placeRec = new Set(recommendPlaces(w.topic, backgrounds)),
    portrait = ctx.materialPortrait || (() => "");
  return `<section class="panel simple-panel"><h3>누구와 어디로 갈까요?</h3><p class="section-sub">주인공은 정해져 있어요. 친구는 2명까지, 장소는 집과 다른 장소 2곳을 골라요.</p><p class="form-label">함께할 친구 <span class="count">최대 ${MAX_FRIENDS}명</span></p><div class="selection-grid simple-cards">${characters
    .map((c) => {
      const lead = c.id === protagonist,
        selected = w.characterIds.includes(c.id),
        rec = !lead && friendRec.has(c.id);
      return `<button type="button" class="selection simple-card ${selected ? "selected" : ""}" data-simple-action="friend" data-id="${esc(c.id)}" aria-pressed="${selected}">${portrait(c)}<strong>${esc(c.name)}</strong><small>${lead ? "주인공" : esc(c.role || "친구")}</small>${rec ? '<span class="simple-rec">추천</span>' : ""}</button>`;
    })
    .join(
      "",
    )}</div><p class="form-label">이야기가 펼쳐질 장소 <span class="count">집 1곳 + 다른 장소 2곳</span></p><div class="selection-grid simple-cards">${backgrounds
    .map((b) => {
      const selected = w.backgroundIds.includes(b.id),
        home = isHomeBackground(b),
        rec = placeRec.has(b.id);
      return `<button type="button" class="selection simple-card simple-place ${selected ? "selected" : ""}" data-simple-action="place" data-id="${esc(b.id)}" aria-pressed="${selected}"><span class="simple-place-emoji" aria-hidden="true">${PLACE_EMOJI[b.type] || "🌿"}</span><strong>${esc(b.name)}</strong><small>${home ? "집 · 시작과 마무리" : esc(b.description || "이야기 장소")}</small>${rec ? '<span class="simple-rec">추천</span>' : ""}</button>`;
    })
    .join(
      "",
    )}</div><label class="audio-cache-check simple-allow"><input type="checkbox" id="simple-allow-new" ${w.allowNew !== false ? "checked" : ""}> 부족한 재료 자동 추가</label><p class="small-label">켜 두면 주제에 필요한 친구·장소를 자동으로 더해요(새 조연 최대 2명, 새 장소 최대 3곳). 끄면 고른 재료만 써요.</p></section><div class="wizard-actions">${sbtn("이전", "back")}<span class="wizard-hint">시트·옷장·사진 재료는 ‘이야기 재료’ 메뉴에 있어요.</span>${sbtn("다음", "next", "green")}</div>`;
}
function keyLabel(engine, config = {}) {
  if (engine === "local" || engine === "sample") return "키 필요 없음";
  if (engine === "demo") return "무료";
  if (config.proxyEndpoint || config.transport === "proxy")
    return "프록시 사용";
  if (!keyStatus) return "키 확인 중";
  if (keyStatus[engine] === "corrupt") return "키 손상 · 다시 저장";
  return keyStatus[engine] ? "키 저장됨" : "키 필요";
}
const keyMissing = (engine, config = {}) =>
  !!keyStatus &&
  !["local", "sample", "demo"].includes(engine) &&
  !config.proxyEndpoint &&
  config.transport !== "proxy" &&
  keyStatus[engine] !== true;
function textOverrideNote(state) {
  const settings = getTextGenerationSettings(state),
    quality = settings.storyQuality;
  return settings.hybrid?.enabled ||
    (quality?.enabled && Object.keys(quality.engines || {}).length)
    ? '<p class="small-label simple-note">프로 모드의 단계별 모델 설정이 우선 적용돼요.</p>'
    : "";
}
function progressBlock(job, title) {
  const progress = job ? fullAutoProgress(job) : { fraction: 0 },
    pct =
      Math.round(
        (lastProgress?.jobId === job?.id
          ? lastProgress.fraction
          : progress.fraction) * 100,
      ) || 0;
  return `<div class="simple-progress" role="status" aria-live="polite"><p class="simple-stages" id="simple-stages">${title}</p><div class="simple-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span id="simple-progress-bar" style="width:${pct}%"></span></div><p class="small-label" id="simple-progress-text">${esc((lastProgress?.jobId === job?.id && lastProgress.message) || job?.phase || "준비 중")}</p></div>`;
}
function stageLine(job) {
  const done = job?.completed || {},
    stages = [
      ["줄거리", !!done.outline],
      ["글", !!done.prose],
      ["쪽 나누기", !!done.pagination],
    ];
  let marked = false;
  return stages
    .map(([label, finished]) => {
      let cls = finished ? "done" : "";
      if (!finished && !marked && runIsLive(job)) {
        cls = "active";
        marked = true;
      }
      return `<span class="simple-stage ${cls}">${finished ? "✓ " : ""}${label}</span>`;
    })
    .join('<span aria-hidden="true"> · </span>');
}
function renderGenerateStep(ctx, w) {
  const state = ctx.getState(),
    job = jobOfWizard(state, w),
    settings = getTextGenerationSettings(state),
    textEngine = job
      ? job.demo
        ? "demo"
        : job.textSettings?.engine || settings.engine
      : settings.engine,
    stage = resolveStoryStageSettings(job?.textSettings || settings, "prose"),
    model =
      textEngine === "demo"
        ? "데모"
        : textEngine === "local"
          ? stage.config?.model || "로컬 모델"
          : getTextModelInfo(stage.engineId, stage.config?.model)?.name ||
            stage.config?.model ||
            "",
    textConfig = settings.providers?.[textEngine] || {},
    world = getActiveWorld(state),
    imageEngine = job?.imageEngine || world.imageEngine,
    imageConfig = world.providerConfig?.[imageEngine] || {},
    imageMeta = ENGINE_METADATA[imageEngine] || { name: imageEngine },
    planMode = w.allowNew !== false ? "auto" : "selection",
    cost = estimateFullAutoCost(state, w, { planMode }),
    quality = normalizeStoryQualitySettings(state.settings?.storyQuality),
    locked = !!job,
    live = runIsLive(job),
    distilled = quality.useDistilledExamples === true;
  if (typeof document !== "undefined") queueMicrotask(() => refreshKeyStatus());
  const engineLine = `<div class="simple-engine-row"><div class="field"><label for="simple-text-engine">글 엔진</label><select id="simple-text-engine" ${locked ? "disabled" : ""}>${(textEngine === "demo" ? ["demo"] : TEXT_ENGINES).map((id) => `<option value="${id}" ${id === textEngine ? "selected" : ""}>${esc(TEXT_ENGINE_NAMES[id])}${id === "demo" ? "" : " · " + esc(keyLabel(id, settings.providers?.[id]))}</option>`).join("")}</select><small>${esc(model)}${locked ? " · 이 이야기에 고정됨" : ""}</small></div>${!locked && keyMissing(textEngine, textConfig) ? sbtn("키 입력", "text-key", "outline", `data-engine="${esc(textEngine)}"`) : ""}</div>${textEngine === "demo" ? "" : textOverrideNote(state)}<div class="simple-engine-row"><div class="simple-engine-name"><span class="small-label">그림 엔진</span><strong>${esc(imageMeta.name)}</strong><small>${esc(keyLabel(imageEngine, imageConfig))} · 그림은 다음 단계에서 써요</small></div>${locked ? "" : sbtn("바꾸기", "image-settings", "plain", `data-engine="${esc(imageEngine)}"`)}${!locked && keyMissing(imageEngine, imageConfig) && imageMeta.requiresKey !== false ? sbtn("키 입력", "image-key", "outline", `data-engine="${esc(imageEngine)}"`) : ""}</div>`;
  const costLines = `<ul class="simple-costs"><li><span>글 만들기</span><strong>${job?.demo ? "무료" : "약 " + usd(cost.textUsd)}</strong></li><li><span>그림 ${cost.pageCount}쪽 + 표지</span><strong>${cost.imageUnitUsd > 0 ? "약 " + usd(cost.imagesUsd) : "무료"}</strong></li>${cost.imageUnitUsd > 0 ? `<li><span>새 시트가 필요하면</span><strong>최대 ${usd(cost.sheetsUpperUsd)}</strong></li>` : ""}<li class="simple-costs-note">그림은 다음 단계에서 · 지금은 글만 만들어요. 참고 단가 추정이며 실제 청구액은 공급자에서 확인해 주세요.</li></ul>`;
  const distilledLine = `<div class="simple-distilled"><span>승인 예시 함께 쓰기 · <strong>${distilled ? "켜짐" : "꺼짐"}</strong></span><span class="simple-help" tabindex="0" title="부모가 승인한 예시 동화를 줄거리 참고로 함께 보내요. 기본은 꺼짐이에요." aria-label="도움말: 부모가 승인한 예시 동화를 줄거리 참고로 함께 보내요. 기본은 꺼짐이에요.">?</span>${sbtn(distilled ? "끄기" : "켜기", "toggle-distilled", "plain", locked ? "disabled" : `aria-pressed="${distilled}"`)}</div>`;
  let status = "";
  if (!job)
    status = `<div class="simple-start">${sbtn("글 만들기", "start-text", "primary")}${sbtn("데모로 체험", "start-demo", "plain")}</div><p class="small-label">줄거리 → 글 → 쪽 나누기를 기다림 없이 이어서 만들어요. 데모는 무료 예시 글이에요.</p>`;
  else if (live)
    status = `${progressBlock(job, stageLine(job))}<div class="simple-start">${sbtn("중지", "stop", "outline")}</div><p class="small-label">이 화면을 떠나도 계속 만들어요. 중지해도 완료한 부분은 보관돼요.</p>`;
  else if (HELD.includes(job.status) || job.book)
    status = `<div class="notice simple-done">글이 완성됐어요. 쪽마다 글을 확인해 주세요.</div><div class="simple-start">${sbtn("쪽마다 검수하기", "open-review", "primary")}</div>`;
  else
    status = `${progressBlock(job, stageLine(job))}${job.error ? `<p class="pin-error">${esc(job.error)}</p>` : `<p class="small-label">${job.status === "failed" ? "멈췄어요." : "멈췄어요. 완료한 부분은 보관돼 있어요."}</p>`}<div class="simple-start">${sbtn(job.status === "failed" ? "다시 시도" : "이어서 만들기", "retry", "primary")}</div>`;
  return `<section class="panel simple-panel"><h3>글을 만들어요</h3><p class="section-sub">${esc(w.topic || "")}</p>${engineLine}${costLines}${distilledLine}${status}</section><div class="wizard-actions">${locked ? "<span></span>" : sbtn("이전", "back")}<span class="wizard-hint">그림은 ④에서 쪽마다 확인하고 만들어요.</span><span></span></div>`;
}
const hasImage = (page) =>
  !!(
    page?.imageAssetId ||
    (page?.imageUrl && !String(page.imageUrl).startsWith("asset:"))
  );
function pageBadge(book, index) {
  if (!book.readingCheck)
    return { label: "읽기 검사 중…", items: [], state: "pending" };
  if (book.readingCheck.error)
    return {
      label: "읽기 검사를 하지 못했어요",
      items: [{ message: book.readingCheck.error }],
      state: "warn",
    };
  const groups = collectBookChecks(book),
    items = (groups.find((g) => g.id === "reading")?.items || []).filter(
      (item) => Number(item.pageNo) === index + 1,
    ),
    passed = book.readingCheck.pages?.[index]?.passed !== false;
  if (!items.length && passed)
    return { label: "읽기 쉬움 ✓", items, state: "ok" };
  // Listening-level vocabulary notes are advice only; a failed page is "확인할 곳".
  if (passed)
    return { label: `읽기 쉬움 ✓ · 참고 ${items.length}`, items, state: "ok" };
  return {
    label: `확인할 곳 ${Math.max(items.length, 1)}곳`,
    items: items.length
      ? items
      : [{ message: "선택한 읽기 단계 범위를 확인해 주세요." }],
    state: "warn",
  };
}
export function imageCountLabel(book) {
  const total = book?.pages?.length || 0;
  return `그림 ${total - pagesNeedingImages(book).length} / ${total}`;
}
function renderReviewStep(ctx, w) {
  const state = ctx.getState(),
    book = ctx.getDraft();
  if (!book?.pages?.length)
    return `<section class="panel simple-panel"><h3>검수할 글이 아직 없어요</h3><p class="section-sub">③에서 글을 먼저 만들어 주세요.</p></section><div class="wizard-actions">${sbtn("이전", "back")}<span></span></div>`;
  const total = book.pages.length,
    index = Math.max(0, Math.min(ctx.getEditPage() || 0, total - 1)),
    page = book.pages[index],
    job = jobOfBook(state, book),
    live = runIsLive(job),
    busy = live || !!pageOp || actionBusy,
    editing = !!w.simpleEditing,
    off = busy ? "disabled" : "",
    image = hasImage(page),
    badge = pageBadge(book, index),
    reviewed = book.pages.filter((p) => p.reviewed).length,
    illustration = ctx.illustration || (() => "");
  const art = image
    ? `${illustration(book, index)}${page.imageStale ? '<p class="small-label simple-stale">글이 바뀌었어요. 그림을 다시 만들 수 있어요.</p>' : ""}`
    : `<div class="image-missing simple-empty-art"><p>아직 그림이 없어요.</p>${sbtn("그림 만들기", "draw-page", "green", editing ? "disabled" : off)}</div>`;
  const text = (lang, label) =>
    `<div class="field"><label for="page-${lang}">${label}</label><textarea id="page-${lang}" lang="${lang}" ${editing ? "" : "readonly"}>${esc(page[lang] ?? page[lang === "ko" ? "textKo" : "textEn"] ?? "")}</textarea></div>`;
  const pageActions = editing
    ? `${sbtn("저장", "save-text", "green")}${sbtn("취소", "cancel-text")}`
    : `${sbtn("글 고치기", "edit-text", "outline", off)}${sbtn("글 다시 만들기", "rewrite-text", "outline", off)}${image ? sbtn("그림 다시 만들기", "redraw-page", "outline", off) : ""}${sbtn(page.reviewed ? "좋아요 ✓" : "좋아요", "like", page.reviewed ? "green" : "outline", `${off} aria-pressed="${!!page.reviewed}"`)}`;
  const running =
    live || pageOp
      ? `${progressBlock(job, pageOp ? `${pageOp.index + 1}쪽 ${pageOp.kind === "rewrite" ? "글" : "그림"} 만드는 중` : "그림 만드는 중")}`
      : "";
  return `<section class="panel simple-panel simple-review"><div class="simple-review-top"><div><strong class="simple-book-title">${esc(book.title)}</strong><span class="small-label"><span id="simple-image-count">${esc(imageCountLabel(book))}</span> · 좋아요 ${reviewed} / ${total}</span></div><div class="simple-review-actions">${sbtn("모든 쪽 그림 만들기", "draw-all", "green", busy || editing ? "disabled" : "")}${sbtn("이야기 전체 다시 만들기", "restart", "plain", busy || editing ? "disabled" : "")}</div></div>${running}${job?.error && !live ? `<p class="pin-error">${esc(job.error)}</p>` : ""}<div class="simple-pager"><button type="button" class="btn btn-outline simple-arrow" data-simple-action="page-prev" data-simple-nav="prev" aria-label="이전 쪽" ${index === 0 || editing ? "disabled" : ""}>‹</button><span class="simple-page-no" aria-live="polite">${index + 1} / ${total}</span><button type="button" class="btn btn-outline simple-arrow" data-simple-action="page-next" data-simple-nav="next" aria-label="다음 쪽" ${index === total - 1 || editing ? "disabled" : ""}>›</button></div><div class="simple-page"><div class="simple-page-art">${art}</div><div class="simple-page-text">${needsKo(book) ? text("ko", `${index + 1}쪽 · 한글`) : ""}${needsEn(book) ? text("en", `English · ${index + 1}`) : ""}<button type="button" class="simple-badge simple-badge-${badge.state}" data-simple-action="badge" aria-expanded="${!!w.simpleBadgeOpen}" id="simple-reading-badge">${esc(badge.label)}</button>${w.simpleBadgeOpen && badge.items.length ? `<ul class="check-issues simple-badge-list">${badge.items.map((item) => `<li class="check-advisory">${esc(item.code || item.violations ? describeReadingViolation(item) : item.message)}</li>`).join("")}</ul>` : ""}<div class="simple-page-actions">${pageActions}</div></div></div></section><div class="wizard-actions">${live || pageOp ? sbtn("중지", "stop") : "<span></span>"}<span class="wizard-hint">글을 고쳐도 그림은 묻고 나서만 다시 만들어요.</span>${sbtn("동화책 만들기", "to-finish", "green", busy || editing ? "disabled" : "")}</div>`;
}
function renderFinishStep(ctx, w) {
  const state = ctx.getState(),
    book = ctx.getDraft();
  if (!book?.pages?.length) return renderReviewStep(ctx, w);
  const job = jobOfBook(state, book),
    live = runIsLive(job),
    busy = live || !!pageOp || actionBusy,
    titles = [
      ...new Set(
        [...(book.outline?.titleCandidates || []), book.title]
          .map((t) => String(t || "").trim())
          .filter(Boolean),
      ),
    ],
    cover = ctx.cover || (() => ""),
    needs = pagesNeedingImages(book).length,
    coverReady = !!book.cover?.imageAssetId;
  return `<section class="panel simple-panel simple-finish"><div class="simple-finish-grid"><div class="simple-cover">${cover(book)}</div><div class="simple-finish-body"><h3>동화책으로 엮어요</h3><fieldset class="simple-titles"><legend>제목 고르기</legend>${titles.map((title, i) => `<label><input type="radio" name="simple-title" value="${esc(title)}" ${title === book.title ? "checked" : ""} id="simple-title-${i}"> ${esc(title)}</label>`).join("")}</fieldset><p class="small-label">${esc(imageCountLabel(book))} · 표지 ${coverReady ? "준비됨" : "아직 없음"}${needs || !coverReady ? " · 저장할 때 남은 그림을 묻고 만들어요." : ""}</p>${live ? progressBlock(job, "남은 그림 만드는 중") : ""}${job?.error && !live ? `<p class="pin-error">${esc(job.error)}</p>` : ""}<div class="simple-finish-actions"><button type="button" class="btn btn-outline" data-action="preview-draft-print" ${busy ? "disabled" : ""}>인쇄 미리보기</button>${sbtn("책장에 저장", "save-book", "primary", busy ? "disabled" : "")}</div></div></div></section><div class="wizard-actions">${live ? sbtn("중지", "stop") : sbtn("이전", "back", "outline", busy ? "disabled" : "")}<span class="wizard-hint">저장하면 책 상세 화면으로 가요.</span><span></span></div>`;
}
/** The whole simple create page for the app's shared wizard/draft. */
export function renderSimpleCreate(ctx = api) {
  const state = ctx.getState(),
    w = ensureSimpleWizard(state, ctx.getWizard());
  if (w.simpleStep >= 4 && !ctx.getDraft()) {
    const job = jobOfWizard(state, w);
    if (job?.book) ctx.setDraft?.(job.book);
    else w.simpleStep = job ? 3 : Math.min(w.simpleStep, 3);
  }
  const step = w.simpleStep,
    heading = ctx.heading || fallbackHeading,
    body =
      step === 1
        ? renderTopicStep(ctx, w)
        : step === 2
          ? renderMaterialsStep(ctx, w)
          : step === 3
            ? renderGenerateStep(ctx, w)
            : step === 4
              ? renderReviewStep(ctx, w)
              : renderFinishStep(ctx, w);
  return `${heading(w.previousBookId ? "다음 이야기 이어 만들기" : "이야기 만들기", "다섯 단계로 한 권을 만들어요.", `<span class="role-tag">${esc(getActiveWorld(state).name)}</span>${w.simpleForced ? sbtn("프로 만들기 화면", "exit-forced", "plain") : ""}`)}<div class="wizard simple-create" data-simple-step="${step}">${stepsBar(step)}${body}</div>`;
}

/* ---------- actions ---------- */
function confirmModal(ctx, title, body, okLabel) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("donghwa:modal-closed", cancel);
      resolve(value);
    };
    const cancel = () => done(false);
    ctx.showModal(
      `${ctx.modalHeader(esc(title))}<div class="modal-intro simple-confirm">${body}</div><div class="modal-actions"><button type="button" class="btn btn-outline" id="simple-confirm-no">취소</button><button type="button" class="btn btn-primary" id="simple-confirm-yes">${esc(okLabel)}</button></div>`,
    );
    document.addEventListener("donghwa:modal-closed", cancel, { once: true });
    document.querySelector("#simple-confirm-yes").onclick = () => {
      done(true);
      ctx.closeModal();
    };
    document.querySelector("#simple-confirm-no").onclick = () => {
      done(false);
      ctx.closeModal();
    };
  });
}
async function refreshKeyStatus() {
  if (keyStatusLoading) return;
  keyStatusLoading = true;
  try {
    const next = await listCredentialStatus();
    const changed = JSON.stringify(next) !== JSON.stringify(keyStatus);
    keyStatus = next;
    if (changed && api?.isSimpleView?.() && api.getWizard()?.simpleStep === 3)
      api.render();
  } catch {
    /* The status line keeps "키 확인 중"; starting a run still checks keys. */
  } finally {
    keyStatusLoading = false;
  }
}
/** Engines whose key the text run needs but the vault does not hold (no decryption). */
async function missingTextKey(state) {
  const settings = getTextGenerationSettings(state),
    engines = new Map();
  for (const stage of ["outline", "sceneBriefs", "prose", "pagination"]) {
    const selected = resolveStoryStageSettings(settings, stage);
    engines.set(selected.engineId, selected.config || {});
  }
  if (settings.storyQuality?.enabled)
    for (const role of ["outline", "prose", "cheap"]) {
      const selected = resolveQualityStageSettings(
        settings,
        role,
        settings.storyQuality,
      );
      engines.set(selected.engineId, selected.config || {});
    }
  const status = await listCredentialStatus().catch(() => ({}));
  keyStatus = status;
  for (const [engine, config] of engines) {
    if (
      engine === "local" ||
      config.proxyEndpoint ||
      config.transport === "proxy"
    )
      continue;
    if (status[engine] !== true) return engine;
  }
  return null;
}
function onRunProgress(event) {
  const w = api?.getWizard?.();
  if (!event?.job || !w) return;
  lastProgress = {
    jobId: event.job.id,
    message: event.message || event.phase || "",
    fraction: Number(event.fraction) || 0,
  };
  if (typeof document === "undefined" || !api.isSimpleView?.()) return;
  const text = document.querySelector("#simple-progress-text"),
    bar = document.querySelector("#simple-progress-bar"),
    stages = document.querySelector("#simple-stages"),
    count = document.querySelector("#simple-image-count"),
    book = api.getDraft();
  if (text) text.textContent = lastProgress.message;
  if (bar) {
    bar.style.width = Math.round(lastProgress.fraction * 100) + "%";
    bar.parentElement?.setAttribute(
      "aria-valuenow",
      String(Math.round(lastProgress.fraction * 100)),
    );
  }
  if (stages && w.simpleStep === 3) stages.innerHTML = stageLine(event.job);
  if (count && book) {
    const label = imageCountLabel(book);
    if (count.textContent !== label && !w.simpleEditing) api.render();
  }
}
/** Release or resume a job through the shared runner; errors are kept on the job. */
async function runJob(ctx, jobId, stopBefore, kind) {
  liveRun = { jobId, kind };
  lastProgress = null;
  ctx.render();
  let job = null;
  try {
    job = await runFullAutoJob(
      jobId,
      stopBefore === undefined
        ? { navigate: false, onProgress: onRunProgress }
        : { stopBefore, navigate: false, onProgress: onRunProgress },
    );
  } catch (error) {
    ctx.toast(error);
  } finally {
    liveRun = null;
  }
  job ||= getFullAutoJob(jobId);
  const draft = ctx.getDraft();
  if (job?.book && draft && draft.id === job.book.id && draft !== job.book)
    ctx.setDraft(job.book);
  return job;
}
function enterReview(ctx, job) {
  const w = ctx.getWizard();
  ctx.setDraft(job.book);
  ctx.setEditPage(0);
  w.simpleStep = 4;
  w.simpleEditing = false;
  ctx.render();
  globalThis.scrollTo?.(0, 0);
  void refreshReading(ctx);
}
async function startText(ctx, { demo = false, onCreated } = {}) {
  const state = ctx.getState(),
    w = ctx.getWizard();
  if (!w || jobOfWizard(state, w)) return;
  const check = safeTopic(w.topic);
  if (!check.ok) {
    w.simpleStep = 1;
    ctx.render();
    ctx.toast(check.message || "이야기 주제를 입력해 주세요.");
    return;
  }
  if (!demo) {
    const engine = await missingTextKey(state);
    if (engine) {
      ctx.toast(
        `${TEXT_ENGINE_NAMES[engine] || engine} 글 엔진의 API 키를 먼저 저장해 주세요.`,
        {
          action: {
            label: "키 입력",
            run: () => ctx.openCredentialSettings("text", engine),
          },
        },
      );
      ctx.render();
      return;
    }
  }
  const allowNew = w.allowNew !== false,
    token =
      globalThis.crypto?.randomUUID?.() ||
      String(Date.now()) + Math.random().toString(16).slice(2),
    pending = startFullAutoJob(jobWizardFrom(w, token), {
      allowNew,
      stopBefore: "text",
      planMode: allowNew && !demo ? "auto" : "selection",
      demo,
      navigate: false,
      onProgress: onRunProgress,
    });
  // The runner creates and saves the job synchronously before its first await.
  const job = Object.values(state.fullAutoJobs || {}).find(
    (item) => item?.wizard?.simpleRunToken === token,
  );
  if (job) {
    w.simpleJobId = job.id;
    liveRun = { jobId: job.id, kind: "text" };
    lastProgress = null;
    onCreated?.(job);
  }
  ctx.render();
  let done = null;
  try {
    done = await pending;
  } catch (error) {
    ctx.toast(error);
  } finally {
    if (liveRun?.jobId === job?.id) liveRun = null;
  }
  const current = ctx.getWizard();
  if (done && current?.simpleJobId === done.id && ctx.isSimpleView()) {
    if (HELD.includes(done.status) && done.book) return enterReview(ctx, done);
  }
  ctx.render();
}
async function refreshReading(ctx) {
  const book = ctx.getDraft();
  if (!book || book.readingCheck || readingQueued) return;
  if (workBusy() || isFullAutoRunning()) return;
  readingQueued = true;
  try {
    await ctx.checkBook?.(book);
  } catch {
    /* A failed or cancelled check leaves the badge "검사 중" until the next change. */
  } finally {
    readingQueued = false;
  }
  if (
    ctx.getDraft() === book &&
    ctx.isSimpleView() &&
    !ctx.getWizard()?.simpleEditing
  )
    ctx.render();
}
function imageNote(state, book) {
  return book.outline?.plotContract &&
    !book.textDemo &&
    !isCoherenceCurrent(book.pageCoherence, {
      outline: book.outline,
      prose: book.prose,
      pagination: currentBookPagination(book),
      stage: "pages",
    })
    ? "<br>글이 바뀐 뒤라 그림 전에 이야기 연결 검사(글 엔진 요금)가 한 번 더 들 수 있어요."
    : "";
}
/** Draw one page at final quality; a book still in text review first prepares sheets. */
async function drawPage(
  ctx,
  index,
  { redraw = false, confirmed = false } = {},
) {
  const state = ctx.getState(),
    book = ctx.getDraft(),
    job = jobOfBook(state, book);
  if (!book || !job) return ctx.toast("이 책의 자동 작업을 찾지 못했어요.");
  const estimate = estimateSimpleCosts(state, book),
    prepare = !book.generationSnapshot,
    total = estimate.imageUnitUsd + (prepare ? estimate.sheetsUpperUsd : 0);
  if (!confirmed && total > 0) {
    const ok = await confirmModal(
      ctx,
      prepare
        ? "그림 준비와 이 쪽 그림"
        : `${index + 1}쪽 그림을 ${redraw ? "다시 " : ""}만들까요?`,
      `${prepare ? `처음 그림이라 캐릭터·배경 시트를 먼저 준비해요(필요한 만큼, 최대 약 ${usd(estimate.sheetsUpperUsd)}).<br>` : ""}${index + 1}쪽 그림 약 ${usd(estimate.imageUnitUsd)} · 최종 품질${imageNote(state, book)}`,
      prepare ? "준비하고 그림 만들기" : "그림 만들기",
    );
    if (!ok) return;
  }
  if (prepare) {
    const released = await runJob(ctx, job.id, "pages", "pages");
    if (!released?.book?.generationSnapshot) {
      ctx.render();
      return;
    }
  }
  const target = ctx.getDraft(),
    controller = new AbortController();
  pageOp = { kind: "image", index, controller };
  ctx.render();
  try {
    await generateBookPageImage(state, target, index, {
      signal: controller.signal,
      changeComposition: redraw,
      save: ctx.save,
    });
    ctx.toast(`${index + 1}쪽 그림을 저장했어요.`);
  } catch (error) {
    ctx.toast(
      error?.name === "AbortError"
        ? "그림 만들기를 멈췄어요. 이미 받은 그림은 보관해요."
        : error,
    );
  } finally {
    pageOp = null;
    ctx.render();
  }
}
async function askRedraw(ctx, index) {
  const state = ctx.getState(),
    book = ctx.getDraft();
  if (!book?.pages?.[index]?.imageStale || !book.generationSnapshot) return;
  const unit = estimateSimpleCosts(state, book).imageUnitUsd;
  const ok = await confirmModal(
    ctx,
    `이 쪽 그림도 다시 만들까요? (약 ${usd(unit)})`,
    `글이 바뀌었어요. 지금 그림을 그대로 둘 수도 있어요.${imageNote(state, book)}`,
    "그림 다시 만들기",
  );
  if (ok) await drawPage(ctx, index, { confirmed: true });
}
async function saveText(ctx) {
  const state = ctx.getState(),
    book = ctx.getDraft(),
    w = ctx.getWizard(),
    index = ctx.getEditPage();
  const ko = document.querySelector("#page-ko")?.value,
    en = document.querySelector("#page-en")?.value;
  const result = await applyPageText(state, book, index, {
    ko,
    en,
    save: ctx.save,
  });
  w.simpleEditing = false;
  ctx.render();
  if (!result.changed) return ctx.toast("바뀐 글이 없어요.");
  ctx.toast(`${index + 1}쪽 글을 저장했어요.`);
  if (result.imageStale) await askRedraw(ctx, index);
  void refreshReading(ctx);
}
async function rewriteText(ctx) {
  const state = ctx.getState(),
    book = ctx.getDraft(),
    index = ctx.getEditPage();
  if (book.textDemo)
    return ctx.toast(
      "데모 이야기는 쪽 글을 새로 쓰지 않아요. ‘글 고치기’로 직접 고쳐 주세요.",
    );
  const cost = estimateSimpleCosts(state, book).pageTextUsd;
  const ok = await confirmModal(
    ctx,
    `${index + 1}쪽 글을 다시 만들까요?`,
    `이 쪽 글만 새로 써요. 글 엔진 요금 약 ${usd(cost)} · 그림은 묻고 나서만 다시 만들어요.`,
    "글 다시 만들기",
  );
  if (!ok) return;
  const controller = new AbortController();
  pageOp = { kind: "rewrite", index, controller };
  ctx.render();
  let result = null;
  try {
    result = await rewriteBookPage(state, book, index, {
      signal: controller.signal,
      save: ctx.save,
    });
  } catch (error) {
    ctx.toast(
      error?.name === "AbortError" ? "글 다시 만들기를 멈췄어요." : error,
    );
  } finally {
    pageOp = null;
    ctx.render();
  }
  if (!result) return;
  ctx.toast(
    result.changed
      ? `${index + 1}쪽 글을 새로 썼어요.`
      : "새 글이 지금 글과 같아요.",
  );
  if (result.imageStale) await askRedraw(ctx, index);
  void refreshReading(ctx);
}
/** Release the hold to the end: sheets, missing/stale pages and the cover, nothing already final. */
async function drawAll(ctx, { finishing = false } = {}) {
  const state = ctx.getState(),
    book = ctx.getDraft(),
    job = jobOfBook(state, book);
  if (!book || !job) {
    ctx.toast("이 책의 자동 작업을 찾지 못했어요.");
    return null;
  }
  const needs = pagesNeedingImages(book),
    coverMissing = !book.cover?.imageAssetId;
  if (!needs.length && !coverMissing && book.autoGenerationComplete) {
    if (!finishing) ctx.toast("모든 쪽과 표지 그림이 이미 있어요.");
    return job;
  }
  const estimate = estimateSimpleCosts(state, book),
    total = estimate.imagesUsd + estimate.sheetsUpperUsd;
  const ok = await confirmModal(
    ctx,
    finishing ? "남은 그림을 만들고 저장할까요?" : "모든 쪽 그림을 만들까요?",
    `본문 ${needs.length}쪽${coverMissing ? " + 표지" : ""} · ${total > 0 ? `약 ${usd(estimate.imagesUsd)}${estimate.sheetsUpperUsd ? ` · 시트가 필요하면 최대 ${usd(estimate.sheetsUpperUsd)}` : ""}` : "무료 샘플 엔진이라 요금이 없어요"}.<br>이미 만든 최종 그림은 다시 만들지 않아요.${imageNote(state, book)}`,
    finishing ? "그림 마저 만들기" : "모든 쪽 그림 만들기",
  );
  if (!ok) return null;
  return runJob(ctx, job.id, null, "images");
}
async function restartStory(ctx) {
  const state = ctx.getState(),
    book = ctx.getDraft(),
    old = jobOfBook(state, book) || jobOfWizard(state, ctx.getWizard());
  if (!old) return ctx.toast("이 책의 자동 작업을 찾지 못했어요.");
  const demo = !!old.demo,
    cost = demo
      ? 0
      : estimateFullAutoCost(state, old.wizard || {}, {
          planMode: old.planMode || "auto",
        }).textUsd;
  const ok = await confirmModal(
    ctx,
    "이야기 전체를 다시 만들까요?",
    `줄거리부터 새로 써요. ${demo ? "데모라 요금이 없어요." : `글 엔진 요금 약 ${usd(cost)}.`}<br>지금 이야기는 지우지 않고 ‘제작 중인 이야기’에 보관해요.`,
    "다시 만들기",
  );
  if (!ok) return;
  if (runIsLive(old))
    await stopFullAutoJob(old.id).catch((error) => ctx.toast(error));
  const next = wizardFromJob(old, 3);
  next.simpleJobId = null;
  // A new seed offset keeps cached responses from being replayed as the "new" story.
  next.qualitySeedOffset = Math.min(
    999,
    (Number(old.wizard?.qualitySeedOffset) || 0) + 1,
  );
  if (ctx.getWizard()?.simpleForced) next.simpleForced = true;
  ctx.setWizard(next);
  ctx.setDraft(null);
  ctx.setEditPage(0);
  await startText(ctx, {
    demo,
    onCreated: (fresh) => {
      // The old story stays in the job list; only the simple resume cards skip it.
      old.simpleReplacedBy = fresh.id;
      old.updatedAt = new Date().toISOString();
      ctx.save();
    },
  });
}
async function saveBook(ctx) {
  const state = ctx.getState(),
    book = ctx.getDraft();
  if (!book) return;
  const job = jobOfBook(state, book);
  if (
    job &&
    (pagesNeedingImages(book).length ||
      !book.cover?.imageAssetId ||
      !book.autoGenerationComplete)
  ) {
    const finished = await drawAll(ctx, { finishing: true });
    if (!finished) return;
    const current = ctx.getDraft();
    if (
      finished.status !== "review" ||
      !current?.autoGenerationComplete ||
      pagesNeedingImages(current).length ||
      !current.cover?.imageAssetId
    ) {
      ctx.render();
      ctx.toast(
        finished.error ||
          "아직 모든 그림이 준비되지 않았어요. 그림을 마저 만든 뒤 저장해 주세요.",
      );
      return;
    }
  }
  await ctx.approveBook();
}
/** Open a simple job at ③ or ④ (job cards, resume cards, pro '쪽마다 검수'). */
export async function openSimpleJob(ctx, jobId) {
  const state = ctx.getState(),
    job = state.fullAutoJobs?.[jobId];
  if (!job) throw Error("자동 작업을 찾지 못했어요.");
  const step = simpleStepForJob(job),
    w = wizardFromJob(job, step);
  if (!ctx.isSimpleMode()) w.simpleForced = true;
  ctx.setWizard(w);
  ctx.setDraft(step >= 4 ? job.book : null);
  ctx.setEditPage(0);
  ctx.setView("create");
  ctx.render();
  globalThis.scrollTo?.(0, 0);
  if (step >= 4) void refreshReading(ctx);
}
function validateMaterials(state, w) {
  const backgrounds = activeBackgrounds(state).filter((b) =>
    w.backgroundIds.includes(b.id),
  );
  if (!w.characterIds.length) return "주인공을 확인해 주세요.";
  if (w.allowNew !== false) return null;
  const homes = backgrounds.filter(isHomeBackground).length,
    places = backgrounds.length - homes;
  if (!homes || places < 2)
    return "부족한 재료 자동 추가를 껐다면 집 1곳과 다른 장소 2곳을 골라 주세요.";
  return null;
}
async function handle(ctx, action, el) {
  const state = ctx.getState(),
    w = ctx.getWizard();
  if (!w) return;
  if (action === "topic") {
    w.topic = el.dataset.topic;
    const field = document.querySelector("#topic");
    if (field) field.value = w.topic;
    document
      .querySelectorAll('[data-simple-action="topic"]')
      .forEach((chip) =>
        chip.classList.toggle("selected", chip.dataset.topic === w.topic),
      );
    return;
  }
  if (action === "idea") {
    const idea = ideaState(state);
    if (!idea.usable) return ctx.toast(idea.reason);
    const status = document.querySelector("#simple-idea-status");
    try {
      const suggestion = await storyWorldTopic(idea.worldId, {
        offset: Number(w.simpleIdeaOffset) || 0,
        season: idea.quality.season,
        timeOfDay: idea.quality.timeOfDay,
      });
      w.simpleIdeaOffset = (Number(w.simpleIdeaOffset) || 0) + 1;
      w.topic = suggestion.topic;
      const field = document.querySelector("#topic");
      if (field) field.value = w.topic;
      if (status)
        status.textContent =
          "주제 칸에 아이디어를 넣었어요. 자유롭게 고쳐 주세요.";
    } catch (error) {
      if (status) status.textContent = error.message;
      ctx.toast(error);
    }
    return;
  }
  if (action === "format") {
    w.simpleFormatOpen = !w.simpleFormatOpen;
    ctx.render();
    return;
  }
  if (action === "exit-forced") {
    if (workBusy()) return ctx.toast("진행 중인 작업이 끝난 뒤 바꿔 주세요.");
    ctx.setDraft(null);
    ctx.setWizard(null);
    ctx.render();
    return;
  }
  if (action === "resume") {
    await openSimpleJob(ctx, el.dataset.id);
    return;
  }
  if (action === "next") {
    if (w.simpleStep === 1) {
      const topic = document.querySelector("#topic");
      if (topic) w.topic = topic.value;
      const check = safeTopic(w.topic);
      if (!check.ok)
        return ctx.toast(check.message || "이야기 주제를 입력해 주세요.");
      preselectMaterials(state, w);
      w.simpleStep = 2;
    } else if (w.simpleStep === 2) {
      const problem = validateMaterials(state, w);
      if (problem) return ctx.toast(problem);
      w.simpleStep = 3;
    }
    ctx.render();
    globalThis.scrollTo?.(0, 0);
    return;
  }
  if (action === "back") {
    if (w.simpleStep === 5) w.simpleStep = 4;
    else if (w.simpleStep === 3 && !jobOfWizard(state, w)) w.simpleStep = 2;
    else if (w.simpleStep === 2) w.simpleStep = 1;
    ctx.render();
    globalThis.scrollTo?.(0, 0);
    return;
  }
  if (action === "friend") {
    const id = el.dataset.id;
    if (id === w.characterIds[0])
      return ctx.toast("주인공은 이번 이야기에 꼭 함께해요.");
    w.simplePicksTouched = true;
    if (w.characterIds.includes(id))
      w.characterIds = w.characterIds.filter((value) => value !== id);
    else if (w.characterIds.length - 1 >= MAX_FRIENDS)
      return ctx.toast(`친구는 ${MAX_FRIENDS}명까지 고를 수 있어요.`);
    else w.characterIds.push(id);
    ctx.render();
    return;
  }
  if (action === "place") {
    const id = el.dataset.id;
    w.simplePicksTouched = true;
    if (w.backgroundIds.includes(id))
      w.backgroundIds = w.backgroundIds.filter((value) => value !== id);
    else if (w.backgroundIds.length >= MAX_PLACES)
      return ctx.toast(`장소는 ${MAX_PLACES}곳까지 고를 수 있어요.`);
    else w.backgroundIds.push(id);
    ctx.render();
    return;
  }
  if (
    action === "text-key" ||
    action === "image-key" ||
    action === "image-settings"
  ) {
    ctx.openCredentialSettings(
      action === "text-key" ? "text" : "image",
      el.dataset.engine,
    );
    return;
  }
  if (action === "toggle-distilled") {
    if (jobOfWizard(state, w)) return;
    const on = normalizeStoryQualitySettings(
      state.settings?.storyQuality,
    ).useDistilledExamples;
    if (setStoryQualityOption(state, "useDistilledExamples", !on) === false)
      ctx.toast("설정을 저장하지 못했어요.");
    ctx.render();
    return;
  }
  if (action === "start-text" || action === "start-demo") {
    await startText(ctx, { demo: action === "start-demo" });
    return;
  }
  if (action === "retry") {
    const job = jobOfWizard(state, w);
    if (!job) return;
    const done = await runJob(ctx, job.id, undefined, "text");
    if (done && HELD.includes(done.status) && done.book && ctx.isSimpleView())
      return enterReview(ctx, done);
    ctx.render();
    return;
  }
  if (action === "open-review") {
    const job = jobOfWizard(state, w);
    if (job?.book) enterReview(ctx, job);
    return;
  }
  if (action === "stop") {
    if (pageOp) {
      pageOp.controller.abort();
      return;
    }
    const job = jobOfBook(state, ctx.getDraft()) || jobOfWizard(state, w);
    if (job) await stopFullAutoJob(job.id).catch((error) => ctx.toast(error));
    ctx.render();
    return;
  }
  if (action === "page-prev" || action === "page-next") {
    const book = ctx.getDraft();
    if (!book || w.simpleEditing) return;
    const next = ctx.getEditPage() + (action === "page-next" ? 1 : -1);
    ctx.setEditPage(Math.max(0, Math.min(book.pages.length - 1, next)));
    w.simpleBadgeOpen = false;
    ctx.render();
    return;
  }
  if (action === "badge") {
    w.simpleBadgeOpen = !w.simpleBadgeOpen;
    ctx.render();
    void refreshReading(ctx);
    return;
  }
  if (action === "edit-text") {
    if (workBusy()) return;
    w.simpleEditing = true;
    ctx.render();
    document.querySelector("#page-ko,#page-en")?.focus();
    return;
  }
  if (action === "cancel-text") {
    w.simpleEditing = false;
    ctx.render();
    return;
  }
  if (action === "save-text") return saveText(ctx);
  if (action === "rewrite-text") return rewriteText(ctx);
  if (action === "draw-page" || action === "redraw-page")
    return drawPage(ctx, ctx.getEditPage(), {
      redraw: action === "redraw-page",
    });
  if (action === "like") {
    const book = ctx.getDraft(),
      index = ctx.getEditPage();
    await setPageReviewed(state, book, index, !book.pages[index].reviewed, {
      save: ctx.save,
    });
    ctx.render();
    return;
  }
  if (action === "draw-all") {
    await drawAll(ctx);
    ctx.render();
    return;
  }
  if (action === "restart") return restartStory(ctx);
  if (action === "to-finish") {
    w.simpleStep = 5;
    ctx.render();
    globalThis.scrollTo?.(0, 0);
    return;
  }
  if (action === "save-book") return saveBook(ctx);
}
/* Screen-only actions, and stop/resume, never wait behind a running action. */
const QUIET = new Set([
  "topic",
  "format",
  "badge",
  "page-prev",
  "page-next",
  "edit-text",
  "cancel-text",
  "back",
  "next",
  "friend",
  "place",
  "to-finish",
  "stop",
  "resume",
  "exit-forced",
  "open-review",
  "text-key",
  "image-key",
  "image-settings",
]);
function onClick(event) {
  const el = event.target.closest?.("[data-simple-action]");
  if (!el || !api || el.disabled) return;
  event.preventDefault();
  const action = el.dataset.simpleAction;
  api.protectedAction(async () => {
    if (!QUIET.has(action) && actionBusy) return;
    const tracked = !QUIET.has(action);
    if (tracked) actionBusy = true;
    try {
      await handle(api, action, el);
    } catch (error) {
      api.toast(error);
      api.render();
    } finally {
      if (tracked) {
        actionBusy = false;
        // Buttons drawn while the action ran were disabled; draw them live again.
        if (api.isSimpleView?.() && !api.getWizard()?.simpleEditing)
          api.render();
      }
    }
  });
}
function onChange(event) {
  if (!api?.isSimpleView?.()) return;
  const target = event.target,
    w = api.getWizard();
  if (!w) return;
  if (
    ["language", "pageCount", "koreanLevel", "englishLevel"].includes(target.id)
  ) {
    w[target.id] =
      target.id === "pageCount" ? Number(target.value) : target.value;
    const summary = document.querySelector("#simple-format-summary");
    if (summary) summary.textContent = formatSummary(w);
    return;
  }
  if (target.id === "simple-allow-new") {
    w.allowNew = target.checked;
    return;
  }
  if (target.name === "simple-title") {
    api.protectedAction(() => {
      const book = api.getDraft();
      if (!book) return;
      book.title = target.value;
      if (book.storyDraftId) syncStoryDraft(book, api.getState());
      api.save();
      api.render();
    });
    return;
  }
  if (target.id === "simple-text-engine") {
    api.protectedAction(() => {
      const state = api.getState();
      if (jobOfWizard(state, w) || !TEXT_ENGINES.includes(target.value)) return;
      const world = getActiveWorld(state),
        before = clone(state.settings.textGeneration ?? null),
        worldBefore = clone(world.textGeneration ?? null);
      state.settings.textGeneration = {
        ...(state.settings.textGeneration || {}),
        engine: target.value,
      };
      syncActiveWorldTextSettings(state);
      if (api.save() === false) {
        if (before === null) delete state.settings.textGeneration;
        else state.settings.textGeneration = before;
        if (worldBefore === null) delete world.textGeneration;
        else world.textGeneration = worldBefore;
        api.toast("글 엔진을 저장하지 못했어요.");
      }
      api.render();
    });
  }
}
/** Wire the simple screen once; ctx exposes the app's wizard/draft/editPage through getters and setters. */
export function configureSimpleCreate(ctx) {
  api = ctx;
  if (configured || typeof document === "undefined") return;
  configured = true;
  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
}
