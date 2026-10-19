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
  keepEditedPictures,
  isSimpleJob,
} from "./full-auto-ui.js";
import { estimateFullAutoCost, fullAutoProgress } from "./full-auto.js";
import { readAutoStop } from "./full-auto-control.js";
import {
  rewriteBookPage,
  applyPageText,
  setPageReviewed,
  estimateSimpleCosts,
  generateBookPageImage,
  isPageImageStale,
  isPageOperationBusy,
  pagesNeedingImages,
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
  estimateStoryTextCost,
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
import {
  heldPageCount,
  layoutFor,
  pageCountOptions,
  snapPageCount,
  textEstimateArgs,
} from "./book-layout.js";

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
/**
 * 아이디어 뽑기 without a story world: short, everyday topics for young children.
 * Plain situations only (no catchphrase-like lines), so the story finds its own words.
 */
export const IDEA_TOPICS = Object.freeze([
  "잃어버린 장갑 한 짝을 찾는 날",
  "구름 위에서 열린 작은 음악회",
  "텃밭에 처음 심은 방울토마토",
  "이가 흔들리기 시작한 날",
  "동생이 처음 집에 온 날",
  "우산 속에 들어온 작은 손님",
  "눈사람이 녹지 않게 지키는 방법",
  "밤하늘에 새 별자리 그리기",
  "할머니 댁 다락방의 오래된 상자",
  "개미 마을의 이사하는 날",
  "무지개 끝에서 찾은 것",
  "혼자 신발 끈을 묶어 본 날",
  "바람에 날아간 연을 찾아서",
  "도서관에서 길을 잃은 그림책",
  "시장에서 처음 해 본 심부름",
  "고장 난 장난감 자동차 고치기",
  "꿀벌이 꽃밭을 찾아가는 길",
  "첫눈이 내린 아침",
  "달팽이와 느릿느릿 산책",
  "바닷가에서 모래성 쌓기",
  "숨바꼭질하다 찾은 비밀 장소",
  "아기 새가 처음 날아오른 날",
  "엄마 생일 깜짝 선물 준비",
  "무서운 꿈을 이겨 낸 밤",
  "친구와 다툰 뒤 화해한 날",
  "가을 낙엽으로 만든 왕관",
  "잠이 오지 않는 아기 곰",
  "물웅덩이에 비친 거꾸로 세상",
  "기차를 타고 떠난 첫 여행",
  "동물원에서 만난 키 큰 기린",
  "반짝이는 조약돌 모으기",
  "빵집에서 처음 구워 본 빵",
  "바람개비가 멈춘 날",
  "꼬마 소방관의 하루",
  "겨울잠을 자지 않은 다람쥐",
  "그림자와 술래잡기",
  "새 친구에게 먼저 인사한 날",
  "캠핑장에서 본 반딧불이",
  "고양이가 숨겨 둔 털실 뭉치",
  "해바라기가 쑥쑥 자라는 여름",
  "냉장고 속 채소들의 회의",
  "사라진 소풍 도시락",
  "등대 할아버지와 밤바다",
  "처음 두발자전거를 탄 날",
  "공룡 화석을 발견한 날",
  "우주 정거장에 보내는 편지",
  "비 오는 날 열린 장화 행진",
  "할아버지와 함께 낚시한 날",
]);
/** One built-in idea that is not the current topic. */
export function pickIdeaTopic(current = "", random = Math.random) {
  const now = String(current || "").trim(),
    pool = IDEA_TOPICS.filter((topic) => topic !== now),
    index = Math.min(
      pool.length - 1,
      Math.max(0, Math.floor(Number(random()) * pool.length) || 0),
    );
  return pool[index];
}
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
  MAX_RESUME_CARDS = 2,
  /** R9-B2 rule 3: at most 12 visible buttons per simple step. */
  MAX_STEP_BUTTONS = 12;
const IDEA_NOTE = "주제 칸에 아이디어를 넣었어요. 자유롭게 고쳐 주세요.";

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

/* ---------- final pictures approving still has to buy ---------- */
/**
 * What approving (확정, approve-book) must still draw at final quality, given
 * the image engine the book draws with. Never a page that already has a
 * current final picture: only pages without one (missing, a draft-quality
 * picture, or the runner's stale mark after a text edit) and a missing or
 * draft cover. A FULL AUTO book whose run never recorded its finish (stopped,
 * failed or interrupted after buying pages) is therefore not bought again.
 * {finalize:false} keeps the old free cases: a finished FULL AUTO book, or
 * the sample engine with no draft pictures to replace.
 */
export function approvalImageWork(book, engine) {
  const pages = book?.pages || [],
    coverDone = !!book?.cover?.imageAssetId,
    autoReady =
      !!book?.autoGenerationComplete &&
      coverDone &&
      pages.every((p) => p?.imageAssetId && p.imageMeta?.quality === "final"),
    finalize =
      !autoReady &&
      (engine !== "sample" ||
        pages.some((p) => p?.imageAssetId && p.imageMeta?.quality === "draft"));
  if (!finalize) return { finalize: false, pages: [], cover: false, stale: [] };
  const redraw = pagesNeedingImages(book);
  return {
    finalize: true,
    pages: redraw,
    cover: !coverDone || book.cover?.meta?.quality === "draft",
    // Pages with a final picture whose text changed since (the runner's mark).
    stale: redraw.filter(
      (i) => pages[i]?.imageAssetId && pages[i].imageMeta?.quality === "final",
    ),
  };
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
  // A new wizard is a new story for the browser's Back/Forward entries.
  if (!w.simpleStoryKey) w.simpleStoryKey = newStoryKey();
  return w;
}
// isSimpleJob lives with the library cards (full-auto-ui.js), which use it too.
export { isSimpleJob };
/** Simple jobs to resume, newest first: running/paused/failed text work or a held/finished book. */
export function simpleJobs(state) {
  return Object.values(state?.fullAutoJobs || {})
    .filter(
      (job) =>
        isSimpleJob(job) &&
        !job.simpleReplacedBy &&
        !job.simpleAbandoned &&
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
  "simpleIdeaNote",
  "simplePickedFor",
  "simplePicksTouched",
  "simpleRunToken",
  "simpleStoryKey",
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
  // The marker belongs to the frozen job copy only; a pro run started from this
  // wizard must not be listed as a simple job (jobWizardFrom adds it back).
  delete w.simpleFlow;
  return {
    ...w,
    step: 1,
    simpleStep: step,
    simpleJobId: job.id,
    simplePicksTouched: true,
    allowNew: job.allowNew !== false,
  };
}
/**
 * R12: the page count a wizard that starts a new story from an old job's wizard
 * may hold (forkWizard, ③ '주제·엔진 바꾸기', restartStory), also the safety net of
 * every unbound render: a pre-R12 K2 job's 8 or 24 pages become 12 or 16 when
 * the new story is an openings book, instead of failing at ③. Page wizards keep
 * their count, so with openings off nothing changes.
 */
function holdPageCount(w) {
  const held = heldPageCount(w);
  if (held !== w.pageCount) w.pageCount = held;
  return w;
}
export const isSimpleBusy = () => !!(liveRun || pageOp || actionBusy);
/** Paid image/text work in flight (a confirm dialog waiting for the parent is not work). */
const workBusy = () => !!(liveRun || pageOp);
const runIsLive = (job) =>
  !!job &&
  (liveRun?.jobId === job.id ||
    (job.status === "running" && isFullAutoRunning()));
/** Marked running by a tab that closed or crashed: nothing is drawing it here. */
const runInterrupted = (job) => job?.status === "running" && !runIsLive(job);
/** Stopped, failed or never started before the text was built: ③ may start over. */
const canAbandon = (job) =>
  !!job &&
  !job.book &&
  !runIsLive(job) &&
  ["paused", "failed", "ready", "running"].includes(job.status);

/* ---------- moving between the five steps (R11) ---------- */
const STEP_EDITING = "고치던 글을 저장하거나 취소해 주세요.",
  STEP_NO_TEXT = "③에서 글을 먼저 만들어 주세요.",
  STEP_FINISH_BUSY = "만드는 중이에요. 끝난 뒤 ⑤로 갈 수 있어요.",
  TEXT_READY_ELSEWHERE = "글이 완성됐어요. 단계 표시의 ④에서 검수해요.",
  FORK_BUSY =
    "만드는 중에는 새 이야기를 시작할 수 없어요. 중지하거나 끝난 뒤에 해 주세요.",
  REOPEN_PICTURE_BUSY = "그림을 만드는 중이에요. 끝난 뒤 다시 열어 주세요.",
  REOPEN_TEXT_BUSY = "글을 만드는 중이에요. 끝난 뒤 다시 열어 주세요.",
  REOPEN_OTHER_BUSY = "진행 중인 작업이 끝난 뒤 다른 이야기를 열어 주세요.";
/**
 * Which of the five steps the parent can open from where they are, and how
 * each would show. Pure: nothing on the wizard or the job changes (materials
 * are recommended on a copy). Rows are {step, reachable, mode, reason}:
 * 'edit' (no job yet, the parent's own inputs), 'frozen' (①② of a job: its
 * frozen copy), 'status' (③ of a job), 'review' (④), 'finish' (⑤).
 * `busy` is what disables 동화책 만들기 on ④; ⑤ is closed while it is true.
 */
export function simpleStepAccess(state, w = {}, { busy = false } = {}) {
  const job = jobOfWizard(state, w),
    text = !!job?.book || HELD.includes(job?.status),
    row = (step, reachable, mode, reason = "") => ({
      step,
      reachable: !!reachable,
      mode,
      reason: reachable ? "" : reason,
    });
  let rows;
  if (!job) {
    const topic = safeTopic(w?.topic),
      topicReason = topic.message || "이야기 주제를 입력해 주세요.";
    let materials = topicReason;
    if (topic.ok) {
      // A copy, so the access check never fills the parent's picks itself.
      const probe = {
        ...w,
        characterIds: [...(w.characterIds || [])],
        backgroundIds: [...(w.backgroundIds || [])],
      };
      if (!probe.simplePicksTouched) preselectMaterials(state, probe);
      materials = validateMaterials(state, probe);
    }
    rows = [
      row(1, true, "edit"),
      row(2, topic.ok, "edit", topicReason),
      row(3, topic.ok && !materials, "edit", materials || topicReason),
      row(4, false, "review", STEP_NO_TEXT),
      row(5, false, "finish", STEP_NO_TEXT),
    ];
  } else
    rows = [
      row(1, true, "frozen"),
      row(2, true, "frozen"),
      row(3, true, "status"),
      row(4, text, "review", STEP_NO_TEXT),
      row(5, text && !busy, "finish", text ? STEP_FINISH_BUSY : STEP_NO_TEXT),
    ];
  if (w?.simpleEditing)
    rows = rows.map((r) =>
      r.step === w.simpleStep ? r : { ...r, reachable: false, reason: STEP_EDITING },
    );
  return rows;
}
/** The expression ④ uses to disable 동화책 만들기, for the wizard's own job. */
function finishBusy(state, w) {
  const job = jobOfWizard(state, w),
    bookId = job?.book?.id;
  return !!(
    runIsLive(job) ||
    pageOp ||
    actionBusy ||
    (bookId && isPageOperationBusy(bookId))
  );
}
/** A picture is being drawn by this screen (a page, the sheets or a whole run). */
export function simpleDrawingInFlight() {
  return !!(
    (pageOp && pageOp.kind !== "rewrite") ||
    (liveRun && liveRun.kind !== "text")
  );
}
/** ④ page last shown per job, in memory only (this tab). */
const reviewPages = new Map();
function rememberedPage(job, book = job?.book) {
  const total = book?.pages?.length || 0,
    saved = Number(reviewPages.get(job?.id)) || 0;
  return total ? Math.max(0, Math.min(saved, total - 1)) : 0;
}

/* ---------- pictures kept after a text edit ---------- */
/*
 * Keeping a picture after its text changed is the parent's lasting decision.
 * The runner-visible stale mark (imageStale, imageStaleAt, imageStaleAssetId)
 * would let any later run (the library card's 이어서 만들기, a resume, the pro
 * editor) buy that page again without asking, so a kept page carries a
 * simple-only marker instead, bound to the picture it was kept with. Only a
 * run the parent chose with '고친 n쪽 … 다시 만들기' puts the real mark back,
 * for the pages it named and only for that run. keepEditedPictures lives in
 * full-auto-ui.js, so every run start (any resume path) applies it too.
 */
export { keepEditedPictures };
const pictureOf = (page) => page?.imageAssetId || page?.imageUrl || null;
/** True while the page still shows the picture the parent kept after editing its text; a redrawn page drops the marker. */
export function isPictureKeptAfterEdit(page) {
  if (!page || page.simpleTextEditedAssetId === undefined) return false;
  const current = pictureOf(page);
  if (current !== null && current === page.simpleTextEditedAssetId) return true;
  delete page.simpleTextEditedAssetId;
  delete page.simpleTextEditedAt;
  return false;
}
/** '글 바뀐 쪽': text changed after drawing, still undecided (runner mark) or kept by the parent. */
export function isPageTextEdited(page) {
  // Both checks run: each drops its own marker once the page was redrawn.
  const stale = isPageImageStale(page),
    kept = isPictureKeptAfterEdit(page);
  return stale || kept;
}
/** For a run the parent chose to include these pages: the runner's stale mark goes back on them. */
function markChosenRedraws(book, indexes) {
  const marked = [];
  for (const index of indexes) {
    const page = book?.pages?.[index];
    if (isPictureKeptAfterEdit(page)) {
      page.imageStale = true;
      page.imageStaleAt = page.simpleTextEditedAt || new Date().toISOString();
      page.imageStaleAssetId = page.simpleTextEditedAssetId;
      delete page.simpleTextEditedAssetId;
      delete page.simpleTextEditedAt;
    }
    if (isPageImageStale(page)) marked.push(index);
  }
  return marked;
}

/* ---------- image work on a book ---------- */
/**
 * What drawing would still have to do for a book:
 * missing = pages without a final image (must be drawn before saving),
 * stale = pages with a final image whose text changed since (the parent may keep them),
 * needsRun = missing pages, a missing cover or an unfinished run (saving must run the drawer).
 */
export function imageWork(book) {
  const missing = [],
    stale = [];
  (book?.pages || []).forEach((page, index) => {
    if (!page?.imageAssetId || page.imageMeta?.quality !== "final")
      missing.push(index);
    else if (isPageTextEdited(page)) stale.push(index);
  });
  const coverMissing = !book?.cover?.imageAssetId;
  return {
    missing,
    stale,
    coverMissing,
    needsRun: !!(
      missing.length ||
      coverMissing ||
      !book?.autoGenerationComplete
    ),
  };
}
const pageList = (indexes) => indexes.map((i) => i + 1).join("·") + "쪽";
/**
 * The image engine a book draws with, or null when it needs no saved key
 * (free sample, local ComfyUI or a proxy). Reads only the saved status.
 */
async function missingImageKey(state, book) {
  const world = getActiveWorld(state),
    engine = book?.generationSnapshot?.imageEngine || world.imageEngine,
    config = {
      ...(world.providerConfig?.[engine] || {}),
      ...(book?.generationSnapshot?.imageModelConfig || {}),
    };
  if (
    ["sample", "local", "demo"].includes(engine) ||
    ENGINE_METADATA[engine]?.requiresKey === false ||
    config.proxyEndpoint ||
    config.transport === "proxy"
  )
    return null;
  const status = await listCredentialStatus().catch(() => ({}));
  keyStatus = status;
  return status[engine] === true ? null : engine;
}
/** Toast the missing image key with a button to the parent settings field. Returns true on a miss. */
async function stopForImageKey(ctx, book) {
  const engine = await missingImageKey(ctx.getState(), book);
  if (!engine) return false;
  ctx.toast(
    `${ENGINE_METADATA[engine]?.name || engine} 그림 엔진의 API 키를 먼저 저장해 주세요.`,
    {
      action: {
        label: "키 입력",
        run: () => ctx.openCredentialSettings("image", engine),
      },
    },
  );
  return true;
}

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
/** 중지 presses on this screen, per job id (see stopMark). */
const stopClicks = new Map();
/**
 * Changes whenever a stop is asked for this job: 중지 here, a stop request
 * stored by the library card or another tab, or one a run acknowledged.
 */
function stopMark(state, jobId) {
  return [
    stopClicks.get(jobId) || 0,
    readAutoStop(jobId)?.nonce || "",
    state?.fullAutoJobs?.[jobId]?.stopRequestedAt || "",
  ].join("|");
}

/* ---------- rendering ---------- */
const fallbackHeading = (title, sub, action = "") =>
  `<div class="page-heading"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>`;
/** '으로' after a final consonant other than ㄹ, '로' otherwise (생성으로, 검수로). */
function toParticle(word) {
  const code = String(word).trim().slice(-1).charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "로";
  const final = code % 28;
  return final && final !== 8 ? "으로" : "로";
}
/**
 * The five-step indicator. A step the parent can open from here is a button
 * (data-simple-nav: outside the 12-button count); the current step and the
 * closed ones stay plain, a closed one titled with why it is closed.
 */
function stepsBar(step, access = [], { text = false } = {}) {
  const open = access.map((row) => (row?.reachable ? 1 : 0)).join("");
  return `<div class="steps simple-steps" role="list" aria-label="쉬운 만들기 단계" data-open="${open}">${SIMPLE_STEPS.map(
    (label, i) => {
      const n = i + 1,
        row = access[i] || { reachable: false, mode: "", reason: "" },
        current = n === step,
        done =
          !current &&
          (row.mode === "frozen" ||
            (row.mode === "status" && text) ||
            n < step),
        inner = `<b>${done ? "✓" : n}</b>${label}`,
        body =
          !current && row.reachable
            ? `<button type="button" class="simple-step-link" data-simple-action="goto-step" data-step="${n}" data-simple-nav="step" aria-label="${n}단계 ${label}${toParticle(label)} 가기">${inner}</button>`
            : inner,
        closed = !current && !row.reachable;
      return `<div class="step ${current ? "active" : done ? "done" : ""}" role="listitem"${current ? ' aria-current="step" tabindex="-1"' : ""}${closed ? ` aria-disabled="true" title="${esc(row.reason)}"` : ""}>${body}</div>`;
    },
  ).join("")}</div>`;
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
    pageCountOptions(w),
    w.pageCount,
  )}${renderReadingSelectors(w)}</div>`;
}
/** A story world chosen in pro mode gives world ideas; otherwise the built-in list is used. */
function ideaState(state) {
  const quality = normalizeStoryQualitySettings(state.settings?.storyQuality);
  return quality.worldId && quality.worldId !== "drawer"
    ? { world: true, worldId: quality.worldId, quality }
    : { world: false };
}
function resumeLabel(job) {
  if (job.status === "text-review") return "글 검수 대기";
  if (job.status === "pages-ready") return "그림 준비 완료";
  if (job.status === "review") return "그림 완성 · 마지막 확인";
  if (job.status === "failed") return "멈춤 · 다시 시도";
  if (runIsLive(job)) return job.book ? "그림 만드는 중" : "글 만드는 중";
  return "이어서 만들기";
}
/**
 * ①'s own visible buttons: the topic chips, 아이디어 뽑기, 책 형식 바꾸기,
 * 책장으로 and 다음, plus '프로 만들기 화면' in the heading on the forced
 * screen. Resume cards fill only what is left of the 12-button limit.
 */
export function topicStepButtonCount(w = {}) {
  return SIMPLE_TOPICS.length + 4 + (w.simpleForced ? 1 : 0);
}
function renderResumeCards(state, w) {
  const jobs = simpleJobs(state);
  if (!jobs.length) return "";
  const shown = Math.max(
    0,
    Math.min(MAX_RESUME_CARDS, MAX_STEP_BUTTONS - topicStepButtonCount(w)),
  );
  return `<section class="simple-resume" aria-label="이어서 만들기"><h3>이어서 만들기</h3><div class="simple-resume-list">${jobs
    .slice(0, shown)
    .map(
      (job) =>
        `<button type="button" class="simple-resume-card" data-simple-action="resume" data-id="${esc(job.id)}"><strong>${esc(job.book?.title || job.input?.topic || job.wizard?.topic || "이야기")}</strong><small>${esc(resumeLabel(job))} · ${simpleStepForJob(job) === 4 ? "④ 쪽마다 검수" : "③ 생성"}</small></button>`,
    )
    .join(
      "",
    )}</div>${jobs.length > shown ? `<p class="small-label">나머지 ${jobs.length - shown}권은 책장의 ‘제작 중인 이야기’에서 이어 갈 수 있어요.</p>` : ""}</section>`;
}
const FROZEN_NOTE =
  "이 이야기에 쓴 주제예요. 바꾸려면 새 이야기로 만들어요. 지금 이야기는 그대로 남아요.";
/** '이 주제로 새로 만들기': closed while anything is being made for the story. */
function forkButton(job) {
  return sbtn(
    "이 주제로 새로 만들기",
    "fork",
    "outline",
    runIsLive(job) || workBusy() ? "disabled" : "",
  );
}
/** ① of a story that has a job: the job's own frozen copy, read only. */
function renderFrozenTopic(ctx, w, job) {
  const frozen = job.wizard || {},
    topic = frozen.topic || job.input?.topic || "",
    title = String(job.book?.title || "").trim();
  return `<section class="panel simple-panel simple-frozen"><h3>이 이야기의 주제</h3><p class="simple-frozen-topic">${esc(topic)}</p>${title ? `<p class="simple-frozen-title"><span class="small-label">책 제목</span> <strong>${esc(title)}</strong></p>` : ""}<div class="simple-format"><span class="small-label">책 형식</span><strong>${esc(formatSummary(frozen))}</strong></div><p class="small-label simple-frozen-note">${FROZEN_NOTE}</p><div class="simple-start">${forkButton(job)}</div></section><div class="wizard-actions"><button type="button" class="btn btn-outline" data-action="library">책장으로</button><span class="wizard-hint">주제를 바꾸면 새 이야기가 돼요.</span>${sbtn("다음", "next", "green")}</div>`;
}
function renderTopicStep(ctx, w) {
  const state = ctx.getState(),
    job = jobOfWizard(state, w);
  if (job) return renderFrozenTopic(ctx, w, job);
  return `<section class="panel simple-panel"><h3>어떤 이야기를 만들까요?</h3><p class="section-sub">아이가 좋아하는 것, 오늘 있었던 일을 한 줄로 적어 주세요.</p><div class="field"><label for="topic">이야기 주제</label><textarea id="topic" maxlength="400" placeholder="예: 유하가 공룡 친구와 함께 길을 잃은 별을 찾아주는 이야기">${esc(w.topic)}</textarea></div><div class="chips">${SIMPLE_TOPICS.map((topic) => `<button type="button" class="chip ${w.topic === topic ? "selected" : ""}" data-simple-action="topic" data-topic="${esc(topic)}">${esc(topic)}</button>`).join("")}</div><div class="simple-idea">${sbtn("아이디어 뽑기", "idea", "outline", 'aria-describedby="simple-idea-status"')}<span class="small-label" id="simple-idea-status" role="status" aria-live="polite">${w.simpleIdeaNote && w.simpleIdeaNote === w.topic ? IDEA_NOTE : ""}</span></div><div class="simple-format"><span class="small-label">책 형식</span><strong id="simple-format-summary">${esc(formatSummary(w))}</strong>${sbtn(w.simpleFormatOpen ? "접기" : "바꾸기", "format", "plain", `aria-expanded="${!!w.simpleFormatOpen}" aria-controls="simple-format-panel"`)}</div>${w.simpleFormatOpen ? renderFormatPanel(w) : ""}<p class="small-label simple-defaults-note">교훈·마무리·분위기는 부모 설정의 기본값을 써요.</p></section>${renderResumeCards(state, w)}<div class="wizard-actions"><button type="button" class="btn btn-outline" data-action="library">책장으로</button><span class="wizard-hint">부모가 확인하고 아이에게 전해요.</span>${sbtn("다음", "next", "green")}</div>`;
}
const PLACE_EMOJI = {
  home: "🏡",
  school: "🏫",
  forest: "🌳",
  space: "🌙",
  sea: "🐚",
};
/** ② of a story that has a job: the friends and places it was made with, not clickable. */
function renderFrozenMaterials(ctx, w, job) {
  const state = ctx.getState(),
    frozen = job.wizard || {},
    plan = job.plan || {},
    added = (list) => new Set((list || []).map((item) => item?.id)),
    newCharacters = added(plan.newCharacters),
    newPlaces = added(plan.newBackgrounds),
    find = (list, extra, id) =>
      (list || []).find((item) => item?.id === id) ||
      (extra || []).find((item) => item?.id === id) ||
      null,
    characters = (frozen.characterIds || [])
      .map((id) => find(state.characters, plan.newCharacters, id))
      .filter(Boolean),
    places = (frozen.backgroundIds || [])
      .map((id) => find(state.backgrounds, plan.newBackgrounds, id))
      .filter(Boolean),
    portrait = ctx.materialPortrait || (() => ""),
    card = (inner) =>
      `<div class="selection simple-card selected" aria-disabled="true">${inner}</div>`,
    auto = '<span class="simple-rec">자동 추가</span>';
  return `<section class="panel simple-panel simple-frozen"><h3>이 이야기의 친구와 장소</h3><p class="section-sub">이 이야기에 쓴 재료예요. 바꾸려면 새 이야기로 만들어요. 지금 이야기는 그대로 남아요.</p><p class="form-label">함께하는 친구</p><div class="selection-grid simple-cards">${characters
    .map((c, i) =>
      card(
        `${portrait(c)}<strong>${esc(c.name)}</strong><small>${i === 0 ? "주인공" : esc(c.role || "친구")}</small>${newCharacters.has(c.id) ? auto : ""}`,
      ),
    )
    .join(
      "",
    )}</div><p class="form-label">이야기 장소</p><div class="selection-grid simple-cards">${places
    .map((b) =>
      card(
        `<span class="simple-place-emoji" aria-hidden="true">${PLACE_EMOJI[b.type] || "🌿"}</span><strong>${esc(b.name)}</strong><small>${isHomeBackground(b) ? "집 · 시작과 마무리" : esc(b.description || "이야기 장소")}</small>${newPlaces.has(b.id) ? auto : ""}`,
      ),
    )
    .join(
      "",
    )}</div><p class="small-label simple-allow">부족한 재료 자동 추가: ${job.allowNew !== false ? "켜짐" : "꺼짐"}</p><div class="simple-start">${forkButton(job)}</div></section><div class="wizard-actions">${sbtn("이전", "back")}<span class="wizard-hint">재료를 바꾸면 새 이야기가 돼요.</span>${sbtn("다음", "next", "green")}</div>`;
}
function renderMaterialsStep(ctx, w) {
  const job = jobOfWizard(ctx.getState(), w);
  if (job) return renderFrozenMaterials(ctx, w, job);
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
  const text = !!job && (!!job.book || HELD.includes(job.status));
  const costLines = `<ul class="simple-costs">${text ? '<li class="simple-costs-done"><span>글 만들기 · 완료</span></li>' : `<li><span>글 만들기</span><strong>${job?.demo ? "무료" : "약 " + usd(cost.textUsd)}</strong></li>`}<li><span>그림 ${cost.pageCount}쪽 + 표지</span><strong>${cost.imageUnitUsd > 0 ? "약 " + usd(cost.imagesUsd) : "무료"}</strong></li>${cost.imageUnitUsd > 0 ? `<li><span>새 시트가 필요하면</span><strong>최대 ${usd(cost.sheetsUpperUsd)}</strong></li>` : ""}<li class="simple-costs-note">그림은 다음 단계에서 · 지금은 글만 만들어요. 참고 단가 추정이며 실제 청구액은 공급자에서 확인해 주세요.</li></ul>`;
  const distilledLine = `<div class="simple-distilled"><span>승인 예시 함께 쓰기 · <strong>${distilled ? "켜짐" : "꺼짐"}</strong></span><span class="simple-help" tabindex="0" title="부모가 승인한 예시 동화를 줄거리 참고로 함께 보내요. 기본은 꺼짐이에요." aria-label="도움말: 부모가 승인한 예시 동화를 줄거리 참고로 함께 보내요. 기본은 꺼짐이에요.">?</span>${sbtn(distilled ? "끄기" : "켜기", "toggle-distilled", "plain", locked ? "disabled" : `aria-pressed="${distilled}"`)}</div>`;
  let status = "";
  if (!job)
    status = `<div class="simple-start">${sbtn("글 만들기", "start-text", "primary")}${sbtn("데모로 체험", "start-demo", "plain")}</div><p class="small-label">줄거리 → 글 → 쪽 나누기를 기다림 없이 이어서 만들어요. 데모는 무료 예시 글이에요.</p>`;
  else if (text) {
    const pages = job.book?.pages?.length || 0,
      bookId = job.book?.id,
      drawing =
        live ||
        (!!pageOp && pageOp.bookId === bookId) ||
        (!!bookId && isPageOperationBusy(bookId));
    status = `<div class="notice simple-done">글이 완성됐어요${pages ? ` · 쪽 ${pages}개` : ""}</div>${drawing ? '<p class="small-label simple-drawing-note">지금 그림을 만들고 있어요 · ④에서 볼 수 있어요</p>' : ""}`;
  } else if (live)
    status = `${progressBlock(job, stageLine(job))}<div class="simple-start">${sbtn("중지", "stop", "outline")}</div><p class="small-label">이 화면을 떠나도 계속 만들어요. 중지해도 완료한 부분은 보관돼요.</p>`;
  else
    status = `${progressBlock(job, stageLine(job))}${job.error ? `<p class="pin-error">${esc(job.error)}</p>` : `<p class="small-label">${job.status === "failed" ? "멈췄어요." : runInterrupted(job) ? "창이 닫혀 멈췄어요. 완료한 부분은 보관돼 있어요." : "멈췄어요. 완료한 부분은 보관돼 있어요."}</p>`}<div class="simple-start">${sbtn(job.status === "failed" ? "다시 시도" : "이어서 만들기", "retry", "primary")}${canAbandon(job) ? sbtn("주제·엔진 바꾸기", "abandon", "outline") : ""}</div>${canAbandon(job) ? '<p class="small-label">주제·엔진 바꾸기: 멈춘 이야기는 ‘제작 중인 이야기’(프로 모드)에 그대로 두고, 고른 주제·재료로 처음부터 다시 골라요.</p>' : ""}`;
  return `<section class="panel simple-panel"><h3>글을 만들어요</h3><p class="section-sub">${esc(w.topic || "")}</p>${engineLine}${costLines}${distilledLine}${status}</section><div class="wizard-actions">${sbtn("이전", "back")}<span class="wizard-hint">그림은 ④에서 쪽마다 확인하고 만들어요.</span>${text ? sbtn("검수로 가기", "open-review", "green") : "<span></span>"}</div>`;
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
/** "그림 8 / 8 · 글 바뀐 쪽 1": final pictures, then pages whose text changed after drawing. */
export function imageCountLabel(book) {
  const total = book?.pages?.length || 0,
    work = imageWork(book);
  return `그림 ${total - work.missing.length} / ${total}${work.stale.length ? ` · 글 바뀐 쪽 ${work.stale.length}` : ""}`;
}
const INTERRUPTED_NOTE =
  '<div class="notice simple-interrupted">그림 만들기가 중간에 멈췄어요(창이 닫혔거나 새로 열었어요). ‘이어서 만들기’를 누르면 남은 그림만 만들어요. 이미 만든 그림은 다시 만들지 않아요.</div>';
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
    interrupted = runInterrupted(job),
    pageBusy = !!pageOp || isPageOperationBusy(book.id),
    busy = live || pageBusy || actionBusy,
    editing = !!w.simpleEditing,
    off = busy || interrupted ? "disabled" : "",
    image = hasImage(page),
    badge = pageBadge(book, index),
    reviewed = book.pages.filter((p) => p.reviewed).length,
    illustration = ctx.illustration || (() => "");
  const art = image
    ? `${illustration(book, index)}${isPageTextEdited(page) ? '<p class="small-label simple-stale">글이 바뀌었어요. 지금 그림을 그대로 두었어요 · ‘그림 다시 만들기’로 바꿀 수 있어요.</p>' : ""}`
    : `<div class="image-missing simple-empty-art"><p>아직 그림이 없어요.</p>${sbtn("그림 만들기", "draw-page", "green", editing ? "disabled" : off)}</div>`;
  const text = (lang, label) =>
    `<div class="field"><label for="page-${lang}">${label}</label><textarea id="page-${lang}" lang="${lang}" ${editing ? "" : "readonly"}>${esc(page[lang] ?? page[lang === "ko" ? "textKo" : "textEn"] ?? "")}</textarea></div>`;
  const pageActions = editing
    ? `${sbtn("저장", "save-text", "green")}${sbtn("취소", "cancel-text")}`
    : `${sbtn("글 고치기", "edit-text", "outline", off)}${sbtn("글 다시 만들기", "rewrite-text", "outline", off)}${image ? sbtn("그림 다시 만들기", "redraw-page", "outline", off) : ""}${sbtn(page.reviewed ? "좋아요 ✓" : "좋아요", "like", page.reviewed ? "green" : "outline", `${off} aria-pressed="${!!page.reviewed}"`)}`;
  const ownOp = pageOp && pageOp.bookId === book.id ? pageOp : null,
    running =
      live || ownOp
        ? `${progressBlock(job, ownOp ? `${ownOp.index + 1}쪽 ${ownOp.kind === "rewrite" ? "글" : "그림"} 만드는 중` : "그림 만드는 중")}`
        : "",
    topAction = interrupted
      ? sbtn(
          "이어서 만들기",
          "resume-run",
          "green",
          busy || editing ? "disabled" : "",
        )
      : sbtn(
          "모든 쪽 그림 만들기",
          "draw-all",
          "green",
          busy || editing ? "disabled" : "",
        );
  return `<section class="panel simple-panel simple-review"><div class="simple-review-top"><div><strong class="simple-book-title">${esc(book.title)}</strong><span class="small-label"><span id="simple-image-count">${esc(imageCountLabel(book))}</span> · 좋아요 ${reviewed} / ${total}</span></div><div class="simple-review-actions">${topAction}${sbtn("이야기 전체 다시 만들기", "restart", "plain", busy || editing ? "disabled" : "")}</div></div>${running}${interrupted ? INTERRUPTED_NOTE : ""}${job?.error && !live ? `<p class="pin-error">${esc(job.error)}</p>` : ""}<div class="simple-pager"><button type="button" class="btn btn-outline simple-arrow" data-simple-action="page-prev" data-simple-nav="prev" aria-label="이전 쪽" ${index === 0 || editing ? "disabled" : ""}>‹</button><span class="simple-page-no" aria-live="polite">${index + 1} / ${total}</span><button type="button" class="btn btn-outline simple-arrow" data-simple-action="page-next" data-simple-nav="next" aria-label="다음 쪽" ${index === total - 1 || editing ? "disabled" : ""}>›</button></div><div class="simple-page"><div class="simple-page-art">${art}</div><div class="simple-page-text">${needsKo(book) ? text("ko", `${index + 1}쪽 · 한글`) : ""}${needsEn(book) ? text("en", `English · ${index + 1}`) : ""}<button type="button" class="simple-badge simple-badge-${badge.state}" data-simple-action="badge" aria-expanded="${!!w.simpleBadgeOpen}" id="simple-reading-badge">${esc(badge.label)}</button>${w.simpleBadgeOpen && badge.items.length ? `<ul class="check-issues simple-badge-list">${badge.items.map((item) => `<li class="check-advisory">${esc(item.code || item.violations ? describeReadingViolation(item) : item.message)}</li>`).join("")}</ul>` : ""}<div class="simple-page-actions">${pageActions}</div></div></div></section><div class="wizard-actions">${live || pageOp || interrupted ? sbtn("중지", "stop") : sbtn("이전", "back", "outline", editing ? "disabled" : "")}<span class="wizard-hint">글을 고쳐도 그림은 묻고 나서만 다시 만들어요.</span>${sbtn("동화책 만들기", "to-finish", "green", busy || editing ? "disabled" : "")}</div>`;
}
function renderFinishStep(ctx, w) {
  const state = ctx.getState(),
    book = ctx.getDraft();
  if (!book?.pages?.length) return renderReviewStep(ctx, w);
  const job = jobOfBook(state, book),
    live = runIsLive(job),
    interrupted = runInterrupted(job),
    busy = live || !!pageOp || actionBusy || isPageOperationBusy(book.id),
    titles = [
      ...new Set(
        [...(book.outline?.titleCandidates || []), book.title]
          .map((t) => String(t || "").trim())
          .filter(Boolean),
      ),
    ],
    cover = ctx.cover || (() => ""),
    work = imageWork(book),
    coverReady = !work.coverMissing,
    saveNote = work.needsRun
      ? work.missing.length || work.coverMissing
        ? " · 저장할 때 남은 그림을 묻고 만들어요."
        : " · 남은 그림이 없어요. 저장하면 마무리해요."
      : work.stale.length
        ? " · 글을 고친 쪽 그림은 저장할 때 그대로 둘지 물어요."
        : "";
  return `<section class="panel simple-panel simple-finish"><div class="simple-finish-grid"><div class="simple-cover">${cover(book)}</div><div class="simple-finish-body"><h3>동화책으로 엮어요</h3><fieldset class="simple-titles"><legend>제목 고르기</legend>${titles.map((title, i) => `<label><input type="radio" name="simple-title" value="${esc(title)}" ${title === book.title ? "checked" : ""} id="simple-title-${i}"> ${esc(title)}</label>`).join("")}</fieldset><p class="small-label">${esc(imageCountLabel(book))} · 표지 ${coverReady ? "준비됨" : "아직 없음"}${saveNote}</p>${live ? progressBlock(job, "남은 그림 만드는 중") : ""}${interrupted ? INTERRUPTED_NOTE : ""}${job?.error && !live ? `<p class="pin-error">${esc(job.error)}</p>` : ""}<div class="simple-finish-actions"><button type="button" class="btn btn-outline" data-action="preview-draft-print" ${busy ? "disabled" : ""}>인쇄 미리보기</button>${interrupted ? sbtn("이어서 만들기", "resume-run", "green", busy ? "disabled" : "") : ""}${sbtn("책장에 저장", "save-book", "primary", busy || interrupted ? "disabled" : "")}</div></div></div></section><div class="wizard-actions">${live ? sbtn("중지", "stop") : sbtn("이전", "back", "outline", busy ? "disabled" : "")}<span class="wizard-hint">저장하면 책 상세 화면으로 가요.</span>${interrupted ? sbtn("중지", "stop") : "<span></span>"}</div>`;
}
/** The whole simple create page for the app's shared wizard/draft. */
export function renderSimpleCreate(ctx = api) {
  const state = ctx.getState(),
    w = ensureSimpleWizard(state, ctx.getWizard());
  // A story without a job may still be changed: its format select and summary
  // never show a page count the wizard does not hold (R12 safety net).
  if (!jobOfWizard(state, w)) holdPageCount(w);
  if (w.simpleStep >= 4 && !ctx.getDraft()) {
    const job = jobOfWizard(state, w);
    if (job?.book) ctx.setDraft?.(job.book);
    else w.simpleStep = job ? 3 : Math.min(w.simpleStep, 3);
  }
  const step = w.simpleStep,
    job = jobOfWizard(state, w),
    access = simpleStepAccess(state, w, { busy: finishBusy(state, w) }),
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
  const html = `${heading(w.previousBookId ? "다음 이야기 이어 만들기" : "이야기 만들기", "다섯 단계로 한 권을 만들어요.", `<span class="role-tag">${esc(getActiveWorld(state).name)}</span>${w.simpleForced ? sbtn("프로 만들기 화면", "exit-forced", "plain") : ""}`)}<div class="wizard simple-create" data-simple-step="${step}">${stepsBar(step, access, { text: !!job?.book || HELD.includes(job?.status) })}${body}</div>`;
  // The browser history entry follows the step shown (first render included).
  if (ownsHistory(ctx)) syncStepHistory(w, step);
  return html;
}

/* ---------- browser Back/Forward between steps ---------- */
/*
 * Every step entry is {donghwaSimpleStep, i, story}: `i` is its place in the
 * tab's history (one more than the entry it was pushed on) and `story` the
 * story it belongs to (the job id, or the unbound wizard's simpleStoryKey).
 * A refused move goes back to the entry the parent was on (history.go), so the
 * popped entry is never rewritten and Back can never be used up. Entries of
 * another story are passed over silently; an entry of another view (no step)
 * leaves through the app's guarded way to the library.
 */
const HISTORY_KEY = "donghwaSimpleStep";
const browserHistory = () =>
  globalThis.location && typeof globalThis.history?.pushState === "function"
    ? globalThis.history
    : null;
let historyIndex = null, // `i` of the entry the screen shows
  browserIndex = null, // `i` of the entry the browser is on (best guess)
  historyGoAt = 0; // a history.go this screen asked for, until its popstate
const isStepEntry = (entry) => {
  const step = entry?.[HISTORY_KEY];
  return Number.isInteger(step) && step >= 1 && step <= 5;
};
const entryIndex = (entry) => (Number.isInteger(entry?.i) ? entry.i : null);
function newStoryKey() {
  return (
    "story-" +
    (globalThis.crypto?.randomUUID?.() ||
      Date.now().toString(36) + Math.random().toString(36).slice(2))
  );
}
/** The story a wizard's entries name: its job, or its own key before the job exists. */
function storyOf(w) {
  if (w.simpleJobId) return w.simpleJobId;
  w.simpleStoryKey ||= newStoryKey();
  return w.simpleStoryKey;
}
/** Entries pushed before the job existed keep working once it does (same wizard). */
const belongsTo = (entry, w) =>
  !!entry?.story &&
  (entry.story === w.simpleJobId || entry.story === w.simpleStoryKey);
const historyMoving = () => !!historyGoAt && Date.now() - historyGoAt < 1500;
/** Only the app's own simple screen writes history (not a census or test copy). */
const ownsHistory = (ctx) => ctx === api && !!ctx?.isSimpleView?.();
function writeStepEntry(w, step, push) {
  const history = browserHistory();
  if (!history) return;
  const here = entryIndex(history.state) ?? browserIndex ?? 0,
    i = push ? here + 1 : here;
  try {
    // Same URL and hash: only the entry's state names the step.
    history[push ? "pushState" : "replaceState"](
      { [HISTORY_KEY]: step, i, story: storyOf(w) },
      "",
      globalThis.location.href,
    );
    historyIndex = browserIndex = i;
  } catch {
    /* A sandboxed frame may refuse history; the steps still work. */
  }
}
function goHistory(delta) {
  const history = browserHistory();
  if (!history || !delta || typeof history.go !== "function") return;
  historyGoAt = Date.now();
  try {
    history.go(delta);
  } catch {
    historyGoAt = 0;
  }
}
/** A refused Back/Forward: back to the entry the parent was on. */
function returnToEntry(popped) {
  if (Number.isInteger(popped) && Number.isInteger(historyIndex))
    goHistory(historyIndex - popped);
}
/** An entry that is not this story's step to show: keep going the same way. */
function skipEntry(popped) {
  goHistory(
    Number.isInteger(popped) &&
      Number.isInteger(historyIndex) &&
      popped > historyIndex
      ? 1
      : -1,
  );
}
/** The entry the browser is on follows the step shown (first render included). */
function syncStepHistory(w, step) {
  const history = browserHistory();
  if (!history || historyMoving()) return;
  const entry = history.state;
  // First shown from another view (the library card, 이야기 만들기, a resume
  // card on another screen): an entry of its own, so Back returns there.
  if (!globalThis.document?.querySelector?.(".simple-create"))
    return writeStepEntry(w, step, true);
  // The browser is on another view's entry while this screen is still shown
  // (Back's leave dialog is open): that entry is not ours to rewrite.
  if (!isStepEntry(entry)) return;
  if (entry[HISTORY_KEY] !== step || !belongsTo(entry, w))
    return writeStepEntry(w, step, false);
  historyIndex = browserIndex = entryIndex(entry);
}
/** Back past this screen's first entry: the app's guarded way to the library. */
function leaveByHistory(w) {
  if (typeof api.leaveToLibrary !== "function") return;
  api.leaveToLibrary(() => {
    // The parent stayed: the popped entry is the other view's, so this
    // screen gets its own entry again.
    if (api.getWizard() === w && api.isSimpleView?.())
      writeStepEntry(w, w.simpleStep, true);
  });
}
/**
 * Back/Forward on the simple create screen moves between steps through the
 * same rules as the step bar; nothing starts, resumes or is bought. Any other
 * screen is left to the app.
 */
export function onSimplePopState(event) {
  historyGoAt = 0;
  const entry = event?.state ?? null,
    popped = entryIndex(entry);
  // Where the browser is now; an entry without an index is taken as one back.
  browserIndex =
    popped ?? (Number.isInteger(browserIndex) ? browserIndex - 1 : null);
  if (!api || !api.isSimpleView?.() || api.isParent?.() === false) return;
  const w = api.getWizard();
  if (!w) return;
  // A dialog is open (the one-time recovery code, a confirm, the leave
  // dialog): Back/Forward never acts under it. The browser goes back to the
  // entry the parent was on and the dialog stays as it is.
  if (api.isModalOpen?.()) {
    if (Number.isInteger(historyIndex) && Number.isInteger(browserIndex))
      goHistory(historyIndex - browserIndex);
    return;
  }
  if (!isStepEntry(entry)) {
    // A step entry this version cannot read is left alone.
    if (entry && typeof entry === "object" && HISTORY_KEY in entry) return;
    return leaveByHistory(w);
  }
  // A step entry with no story (written before entries named theirs) may be
  // the app's first entry: passing over it could unload the app, so it is
  // treated as another view's entry.
  if (!entry.story) return leaveByHistory(w);
  // Another story's entry (before '이 주제로 새로 만들기', a reload or a
  // reopened story): not this wizard's, passed over without a word.
  if (!belongsTo(entry, w)) return skipEntry(popped);
  const step = entry[HISTORY_KEY];
  if (step === w.simpleStep) {
    // The entry the screen is on (also the return from a refused move).
    if (popped === null || popped === historyIndex) return;
    return skipEntry(popped);
  }
  gotoStep(api, w, step, { fromHistory: true, entry: popped });
}
/** After a step change, keyboard and screen-reader users land on the new step. */
function focusActiveStep() {
  globalThis.document
    ?.querySelector?.('.simple-steps [aria-current="step"]')
    ?.focus?.({ preventScroll: true });
}

/* ---------- actions ---------- */
/**
 * A modal with 취소 and one or more named choices; resolves the chosen value or
 * null. A single choice uses #simple-confirm-yes, several use #simple-choice-<value>.
 */
function choiceModal(ctx, title, body, choices) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("donghwa:modal-closed", cancel);
      resolve(value);
    };
    const cancel = () => done(null),
      single = choices.length === 1,
      idOf = (choice) =>
        single ? "simple-confirm-yes" : `simple-choice-${choice.value}`;
    ctx.showModal(
      `${ctx.modalHeader(esc(title))}<div class="modal-intro simple-confirm">${body}</div><div class="modal-actions simple-choices"><button type="button" class="btn btn-outline" id="simple-confirm-no">취소</button>${choices.map((choice, i) => `<button type="button" class="btn ${i === choices.length - 1 ? "btn-primary" : "btn-outline"}" id="${idOf(choice)}">${esc(choice.label)}</button>`).join("")}</div>`,
    );
    document.addEventListener("donghwa:modal-closed", cancel, { once: true });
    for (const choice of choices)
      document.querySelector("#" + idOf(choice)).onclick = () => {
        done(choice.value);
        ctx.closeModal();
      };
    document.querySelector("#simple-confirm-no").onclick = () => {
      done(null);
      ctx.closeModal();
    };
  });
}
async function confirmModal(ctx, title, body, okLabel) {
  return (
    (await choiceModal(ctx, title, body, [
      { value: "yes", label: okLabel },
    ])) === "yes"
  );
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
/**
 * An engine whose key the text run needs but the vault does not hold (no
 * decryption), or null. The same stages as the runner's preflight; a job's
 * own frozen settings and story-quality input are passed for a resume.
 */
async function missingTextKey(
  state,
  settings = getTextGenerationSettings(state),
  quality = settings.storyQuality,
) {
  const engines = new Map();
  for (const stage of [
    "outline",
    "sceneBriefs",
    ...(settings.hybrid?.enabled ? ["proseDraft"] : []),
    "prose",
    "enrichment",
    "pagination",
  ]) {
    const selected = resolveStoryStageSettings(settings, stage);
    engines.set(selected.engineId, selected.config || {});
  }
  if (quality?.enabled)
    for (const role of ["outline", "prose", "cheap"]) {
      const selected = resolveQualityStageSettings(settings, role, quality);
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
/**
 * Toast a missing text key with a button to the parent settings field; true
 * on a miss (nothing started, the job unchanged). A job passes its own frozen
 * text settings and story-quality input, as its runner preflight reads them.
 */
async function stopForTextKey(ctx, job = null) {
  const engine = job
    ? await missingTextKey(
        ctx.getState(),
        job.textSettings || getTextGenerationSettings(ctx.getState()),
        job.input?.storyQuality,
      )
    : await missingTextKey(ctx.getState());
  if (!engine) return false;
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
  return true;
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
/**
 * Release or resume a job through the shared runner; errors are kept on the
 * job. `redraw` names the pages the parent chose to redraw in this run.
 */
async function runJob(ctx, jobId, stopBefore, kind, { redraw = [] } = {}) {
  liveRun = { jobId, kind };
  lastProgress = null;
  ctx.render();
  let job = null;
  try {
    job = await runFullAutoJob(
      jobId,
      stopBefore === undefined
        ? { navigate: false, onProgress: onRunProgress, redraw }
        : { stopBefore, navigate: false, onProgress: onRunProgress, redraw },
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
  // The first ④ gets an entry of its own, so Back returns to ③.
  if (ownsHistory(ctx)) writeStepEntry(w, 4, true);
  ctx.render();
  globalThis.scrollTo?.(0, 0);
  focusActiveStep();
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
  if (!demo && (await stopForTextKey(ctx))) return;
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
    if (HELD.includes(done.status) && done.book) return arriveAtReview(ctx, done);
  }
  ctx.render();
}
/**
 * A text run of the open story finished: the first arrival at ④ when the
 * parent is still waiting on ③; anywhere else the parent stays put.
 */
function arriveAtReview(ctx, job) {
  if (ctx.getWizard()?.simpleStep === 3) return enterReview(ctx, job);
  ctx.render();
  ctx.toast(TEXT_READY_ELSEWHERE);
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
/**
 * {due, usd}: whether the book's story-connection check is out of date (a
 * non-demo plotContract book whose text changed since), so drawing a picture
 * or saving the book buys one check from the text engine first; usd is that
 * one check's reference cost (0 when no estimate is available).
 */
export function coherenceCheckDue(state, book) {
  const due =
    !!book?.outline?.plotContract &&
    !book.textDemo &&
    !isCoherenceCurrent(book.pageCoherence, {
      outline: book.outline,
      prose: book.prose,
      pagination: currentBookPagination(book),
      stage: "pages",
    });
  if (!due) return { due: false, usd: 0 };
  let cost = 0;
  try {
    const row = estimateStoryTextCost({
      settings: book.textGenerationSettings || getTextGenerationSettings(state),
      pageCount: book.pages?.length || 12,
      // R12: an openings book is sized from its frozen specs and printed pages.
      ...textEstimateArgs(book),
    }).stages?.find((stage) => stage.stage === "coherence");
    cost = row?.requestCount > 0 ? row.costUsd / row.requestCount : 0;
  } catch {
    cost = 0;
  }
  return { due: true, usd: Number.isFinite(cost) && cost > 0 ? cost : 0 };
}
const checkFee = (check) =>
  `글 엔진 요금${check.usd > 0 ? ` 약 ${usd(check.usd)}` : ""}`;
function imageNote(state, book) {
  const check = coherenceCheckDue(state, book);
  return check.due
    ? `<br>글이 바뀐 뒤라 그림 전에 이야기 연결 검사(${checkFee(check)})가 한 번 더 들 수 있어요.`
    : "";
}
/** The same check, worded for saving: keeping every picture does not skip it. */
function saveCheckNote(check) {
  return check.due
    ? `<br>글이 바뀐 뒤라 그림을 만들거나 저장할 때 이야기 연결 검사(${checkFee(check)})가 한 번 들 수 있어요. 그림을 그대로 두고 저장해도 이 검사는 해요.`
    : "";
}
const OTHER_BOOK_OPEN =
  "다른 책을 보고 있어 저장하지 않았어요. 이 책을 다시 열어 저장해 주세요.";
const INTERRUPTED_FIRST =
  "멈춘 그림 만들기를 먼저 ‘이어서 만들기’로 잇거나 중지해 주세요.";
const STOPPED_PAGE = "중지해서 이 쪽 그림은 만들지 않았어요.";
/** Options for one page picture; a test context may supply ctx.generateScene for the image pipeline. */
const pageImageOptions = (ctx, extra) =>
  typeof ctx.generateScene === "function"
    ? { ...extra, generate: ctx.generateScene }
    : extra;
/**
 * Draw one page of `book` at final quality; a book still in text review first
 * prepares sheets. Every step after a wait acts on the job's own book, never on
 * whatever draft happens to be open by then.
 */
async function drawPage(
  ctx,
  book,
  index,
  { redraw = false, confirmed = false } = {},
) {
  const state = ctx.getState(),
    job = jobOfBook(state, book);
  if (!book || !job) return ctx.toast("이 책의 자동 작업을 찾지 못했어요.");
  // A stop asked for after this click (here, in the library or another tab) wins.
  const stops = stopMark(state, job.id);
  if (runInterrupted(job)) return ctx.toast(INTERRUPTED_FIRST);
  if (await stopForImageKey(ctx, book)) return;
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
  if (prepare) await runJob(ctx, job.id, "pages", "pages");
  // The parent may have opened another book while the sheets were prepared, or
  // pressed 중지: a run that finds every sheet ready can still reach the hold
  // after a stop, and that must not buy this page.
  const after = getFullAutoJob(job.id),
    target = after?.book,
    stopped = stopMark(state, job.id) !== stops;
  if (
    stopped ||
    (prepare && after?.status !== "pages-ready") ||
    !target?.generationSnapshot ||
    target.id !== book.id
  ) {
    ctx.render();
    return ctx.toast(
      stopped || (prepare && after?.status === "paused")
        ? STOPPED_PAGE
        : after?.error ||
            "그림 준비가 끝나지 않아 이 쪽 그림은 만들지 않았어요.",
    );
  }
  const controller = new AbortController();
  pageOp = { kind: "image", index, controller, bookId: target.id };
  ctx.render();
  try {
    await generateBookPageImage(
      state,
      target,
      index,
      pageImageOptions(ctx, {
        signal: controller.signal,
        changeComposition: redraw,
        save: ctx.save,
      }),
    );
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
/**
 * After a text change on `book`: the picture is kept (durably, see
 * keepEditedPictures) until the parent asks for a redraw that succeeds; the
 * question is never asked for a book the parent has left.
 */
async function askRedraw(ctx, book, index) {
  const state = ctx.getState(),
    page = book?.pages?.[index];
  if (!page) return;
  if (keepEditedPictures(book, [index])) ctx.save();
  if (
    !isPictureKeptAfterEdit(page) ||
    !book.generationSnapshot ||
    ctx.getDraft() !== book
  )
    return;
  const unit = estimateSimpleCosts(state, book).imageUnitUsd;
  const ok = await confirmModal(
    ctx,
    `이 쪽 그림도 다시 만들까요? (약 ${usd(unit)})`,
    `글이 바뀌었어요. 지금 그림을 그대로 둘 수도 있어요.${imageNote(state, book)}`,
    "그림 다시 만들기",
  );
  if (ok) await drawPage(ctx, book, index, { confirmed: true });
}
/**
 * After a text change that could not be saved: if the page carries the
 * runner's stale mark (the new text is on the open book), the parent decides
 * as after a saved edit; the picture is kept first, whatever the answer.
 */
async function askRedrawIfMarked(ctx, book, index) {
  if (isPageImageStale(book?.pages?.[index]))
    await askRedraw(ctx, book, index);
}
/** One page's text in both languages, to tell whether an operation changed it. */
const pageText = (book, index) => {
  const page = book?.pages?.[index] || {};
  return JSON.stringify([
    page.ko ?? page.textKo ?? "",
    page.en ?? page.textEn ?? "",
  ]);
};
async function saveText(ctx) {
  const state = ctx.getState(),
    book = ctx.getDraft(),
    w = ctx.getWizard(),
    index = ctx.getEditPage();
  if (!book) return;
  const ko = document.querySelector("#page-ko")?.value,
    en = document.querySelector("#page-en")?.value;
  let result = null;
  try {
    result = await applyPageText(state, book, index, {
      ko,
      en,
      save: ctx.save,
    });
  } catch (error) {
    // The page tool writes the text and the runner's stale mark before its
    // save, so a failed save leaves both on the open book. Say what failed,
    // then the picture is kept unless the parent chooses to redraw it. A
    // refusal before anything was written (a run owns the book) keeps the
    // editor open instead.
    const page = book.pages?.[index],
      landed =
        !!page &&
        (ko === undefined || (page.ko ?? page.textKo ?? "") === ko) &&
        (en === undefined || (page.en ?? page.textEn ?? "") === en);
    if (w && landed) w.simpleEditing = false;
    ctx.render();
    ctx.toast(error);
    if (landed) await askRedrawIfMarked(ctx, book, index);
    return;
  }
  if (w) w.simpleEditing = false;
  ctx.render();
  if (!result.changed) return ctx.toast("바뀐 글이 없어요.");
  ctx.toast(`${index + 1}쪽 글을 저장했어요.`);
  if (result.imageStale) await askRedraw(ctx, book, index);
  void refreshReading(ctx);
}
async function rewriteText(ctx) {
  const state = ctx.getState(),
    book = ctx.getDraft(),
    index = ctx.getEditPage();
  if (!book) return;
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
  pageOp = { kind: "rewrite", index, controller, bookId: book.id };
  ctx.render();
  const textBefore = pageText(book, index);
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
  // New text may be on the page with the runner's mark although its save
  // failed: as after a failed 저장, keep the picture unless the parent redraws.
  if (!result) {
    if (pageText(book, index) !== textBefore)
      await askRedrawIfMarked(ctx, book, index);
    return;
  }
  ctx.toast(
    result.changed
      ? `${index + 1}쪽 글을 새로 썼어요.`
      : "새 글이 지금 글과 같아요.",
  );
  if (result.imageStale) await askRedraw(ctx, book, index);
  void refreshReading(ctx);
}
/**
 * A book whose pages and cover are all final but whose run never recorded the
 * finish (stopped or interrupted after the last picture, or finished in the
 * pro editor). Nothing is left to buy, so the finish is recorded here the way
 * the run's last step does: the runner would first ask for keys and check the
 * World, which a purchase-free finish does not need. Returns the job, or null
 * when only a run can finish this book.
 */
function finishWithoutDrawing(ctx, jobId) {
  const job = getFullAutoJob(jobId),
    book = job?.book;
  if (
    !book?.generationSnapshot ||
    job.status === "running" ||
    imageWork(book).missing.length ||
    !book.cover?.imageAssetId
  )
    return null;
  const draft = ctx.getState()?.storyDrafts?.[job.storyDraftId],
    before = {
      stage: book.stage,
      approved: book.approved,
      autoGenerationComplete: book.autoGenerationComplete,
      job: {
        status: job.status,
        phase: job.phase,
        currentStep: job.currentStep,
        stopBefore: job.stopBefore,
        error: job.error,
        updatedAt: job.updatedAt,
      },
      draftStage: draft?.stage,
    };
  book.stage = "illustrated";
  book.approved = false;
  book.autoGenerationComplete = true;
  Object.assign(job, {
    status: "review",
    phase: "완성 초안 · 부모 검토",
    currentStep: null,
    stopBefore: null,
    error: null,
    updatedAt: new Date().toISOString(),
  });
  if (draft) draft.stage = "illustrated";
  if (ctx.save() === false) {
    book.stage = before.stage;
    book.approved = before.approved;
    if (before.autoGenerationComplete === undefined)
      delete book.autoGenerationComplete;
    else book.autoGenerationComplete = before.autoGenerationComplete;
    Object.assign(job, before.job);
    if (draft) draft.stage = before.draftStage;
    ctx.toast("변경을 저장하지 못했어요. 저장 공간을 확인해 주세요.");
    return null;
  }
  return job;
}
/**
 * Release the book's hold to the end: sheets, missing pages and the cover.
 * Pages whose text changed after drawing are redrawn only when the parent
 * includes them, and only by this run; otherwise the parent keeps those
 * pictures for good (keepEditedPictures), so no later run (a resume, the
 * library card, the pro editor) buys them again. The image key is asked for
 * only when something will be drawn. Returns the job after the run, or null
 * when nothing ran.
 */
async function drawAll(
  ctx,
  {
    book,
    job,
    finishing = false,
    resuming = false,
    includeStale,
    confirmed = false,
  } = {},
) {
  const state = ctx.getState();
  job ||= jobOfBook(state, book);
  if (!book || !job) {
    ctx.toast("이 책의 자동 작업을 찾지 못했어요.");
    return null;
  }
  const work = imageWork(book);
  // A run a closed tab left 'running' still needs recording even when nothing
  // is left to draw: it goes on below, to the run lock, with no question.
  if (
    !work.needsRun &&
    !(includeStale !== false && work.stale.length) &&
    !runInterrupted(job)
  ) {
    if (!finishing) ctx.toast("모든 쪽과 표지 그림이 이미 있어요.");
    return job;
  }
  const estimate = estimateSimpleCosts(state, book),
    unit = estimate.imageUnitUsd,
    sheets = estimate.sheetsUpperUsd,
    paid = unit > 0 || sheets > 0,
    cost = (value) => (paid ? ` (약 ${usd(value)})` : ""),
    newCount = work.missing.length + (work.coverMissing ? 1 : 0),
    newUsd = newCount * unit,
    staleUsd = work.stale.length * unit,
    offerStale = work.stale.length > 0 && includeStale !== false,
    // Missing pictures, a missing cover or sheets still to prepare: the run draws.
    drawsNew = newCount > 0 || sheets > 0 || !book.generationSnapshot;
  let withStale = includeStale === true;
  if (drawsNew && (await stopForImageKey(ctx, book))) return null;
  // Finishing a book whose pictures are all there buys nothing: no question.
  const drawsNothing = !drawsNew && !offerStale;
  if (!confirmed && !drawsNothing) {
    const lines = [];
    if (newCount)
      lines.push(
        `새로 만들 그림: 본문 ${work.missing.length}쪽${work.coverMissing ? " + 표지" : ""}${paid ? ` · 약 ${usd(newUsd)}` : ""}`,
      );
    if (sheets > 0)
      lines.push(`캐릭터·배경 시트가 필요하면 최대 ${usd(sheets)}`);
    if (offerStale)
      lines.push(
        `글을 고친 쪽: ${pageList(work.stale)} · 지금 그림이 있어요. 다시 만들면 ${work.stale.length}장${paid ? ` 약 ${usd(staleUsd)}` : ""}이 더 들어요.`,
      );
    if (!paid) lines.push("무료 샘플 엔진이라 요금이 없어요.");
    lines.push(
      offerStale
        ? "글을 고친 쪽 말고 다른 쪽의 최종 그림은 다시 만들지 않아요."
        : "이미 만든 최종 그림은 다시 만들지 않아요.",
    );
    const choices = [];
    // Resuming a cut-off run (even a chosen redraw on a finished book) can
    // always keep the edited pages' pictures and just finish.
    if (work.needsRun || resuming)
      choices.push({
        value: "missing",
        label: offerStale
          ? newCount
            ? `빈 그림만 만들기${cost(newUsd)}`
            : "고친 쪽 그림 그대로 두고 마무리"
          : finishing
            ? "그림 마저 만들기"
            : resuming
              ? "이어서 만들기"
              : "모든 쪽 그림 만들기",
      });
    if (offerStale)
      choices.push({
        value: "all",
        label: newCount
          ? `고친 ${work.stale.length}쪽도 다시 만들기${cost(newUsd + staleUsd)}`
          : `고친 ${work.stale.length}쪽 그림 다시 만들기${cost(staleUsd)}`,
      });
    const choice = await choiceModal(
      ctx,
      resuming
        ? "멈춘 그림 만들기를 이어 갈까요?"
        : finishing
          ? work.needsRun
            ? "남은 그림을 만들고 저장할까요?"
            : "고친 쪽 그림을 다시 만들고 저장할까요?"
          : newCount
            ? "모든 쪽 그림을 만들까요?"
            : "고친 쪽 그림을 다시 만들까요?",
      lines.join("<br>") +
        (finishing
          ? saveCheckNote(coherenceCheckDue(state, book))
          : imageNote(state, book)),
      choices,
    );
    if (!choice) return null;
    withStale = choice === "all";
  }
  // Redrawing pages whose text changed is drawing too: it needs the key.
  if (withStale && !drawsNew && (await stopForImageKey(ctx, book))) return null;
  // Work on this job's own book, never on whatever draft is open by now.
  const target = getFullAutoJob(job.id)?.book || book;
  let chosen = [];
  if (withStale) chosen = markChosenRedraws(target, imageWork(target).stale);
  else if (keepEditedPictures(target)) ctx.save();
  // Nothing to draw: record the finish here. A run another tab may still own
  // ('running') goes through the runner, which checks the run lock.
  if (
    !drawsNew &&
    !chosen.length &&
    getFullAutoJob(job.id)?.status !== "running"
  ) {
    const done = finishWithoutDrawing(ctx, job.id);
    if (done && !finishing)
      ctx.toast("그림과 표지까지 완성됐어요. 마지막으로 확인해 주세요.");
    return done;
  }
  try {
    // A run left 'running' by a closed tab is recovered inside the run lock;
    // when it has nothing left to buy it is finished there without the runner
    // (no image key), and while another tab holds the run the runner refuses.
    return await runJob(ctx, job.id, null, "images", { redraw: chosen });
  } finally {
    // The chosen redraw belongs to this run: a page it did not reach (stopped,
    // failed) is kept again, so a later resume never buys it without asking.
    const after = getFullAutoJob(job.id)?.book || target;
    if (chosen.length && keepEditedPictures(after, chosen)) ctx.save();
  }
}
/** '이어서 만들기' for a run a closed tab left marked running: completed work is skipped. */
async function resumeRun(ctx, book, job) {
  const hold = job.stopBefore ?? null;
  if (hold === null) return drawAll(ctx, { book, job, resuming: true });
  if (hold === "pages" && !book.generationSnapshot) {
    if (await stopForImageKey(ctx, book)) return null;
    const sheets = estimateSimpleCosts(ctx.getState(), book).sheetsUpperUsd;
    if (
      sheets > 0 &&
      !(await confirmModal(
        ctx,
        "그림 준비를 이어 할까요?",
        `캐릭터·배경 시트를 마저 준비해요(필요한 만큼, 최대 약 ${usd(sheets)}). 이미 만든 시트는 다시 만들지 않아요.`,
        "이어서 준비하기",
      ))
    )
      return null;
  }
  return runJob(ctx, job.id, undefined, "images");
}
async function restartStory(ctx) {
  const state = ctx.getState(),
    book = ctx.getDraft(),
    old = jobOfBook(state, book) || jobOfWizard(state, ctx.getWizard());
  if (!old) return ctx.toast("이 책의 자동 작업을 찾지 못했어요.");
  // The new story's page count (R12: an old 8/24-page K2 job → 12/16), priced as such.
  const pages = heldPageCount(wizardFromJob(old, 3)),
    priced =
      pages === old.wizard?.pageCount
        ? old.wizard || {}
        : { ...old.wizard, pageCount: pages };
  const demo = !!old.demo,
    cost = demo
      ? 0
      : estimateFullAutoCost(state, priced, {
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
  const next = holdPageCount(wizardFromJob(old, 3));
  next.simpleJobId = null;
  // A new seed offset keeps cached responses from being replayed as the "new" story.
  next.qualitySeedOffset = Math.min(
    999,
    (Number(old.wizard?.qualitySeedOffset) || 0) + 1,
  );
  if (ctx.getWizard()?.simpleForced) next.simpleForced = true;
  next.simpleStoryKey = newStoryKey();
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
/**
 * '이 주제로 새로 만들기' on a frozen ①/②: a new, unbound story from the
 * job's own topic, format and picks. The old job is left exactly as it is
 * (still listed, still resumable); nothing is bought until ③ 글 만들기.
 */
async function forkStory(ctx) {
  const state = ctx.getState(),
    w = ctx.getWizard(),
    old = jobOfWizard(state, w);
  if (!old || w.simpleEditing) return;
  if (runIsLive(old) || workBusy()) return ctx.toast(FORK_BUSY);
  const next = forkWizard(state, old, w);
  let cost = 0;
  try {
    // The amount ③ will show for the new story (see renderGenerateStep).
    cost = estimateFullAutoCost(state, next, {
      planMode: next.allowNew !== false ? "auto" : "selection",
    }).textUsd;
  } catch {
    cost = 0;
  }
  const title = String(
      old.book?.title || old.wizard?.topic || old.input?.topic || "이야기",
    ).trim(),
    ok = await confirmModal(
      ctx,
      "이 주제로 새 이야기를 만들까요?",
      `지금 이야기 ‘${esc(title)}’의 글과 그림은 그대로 남아요. ‘이어서 만들기’에서 언제든 다시 열 수 있어요.<br>새 이야기의 글은 ③에서 ‘글 만들기’를 누를 때 만들어요 · 글 엔진 요금 약 ${usd(cost)} (데모는 무료). 그림은 ④에서 따로 물어요.`,
      "새 이야기로 고치기",
    );
  if (!ok || ctx.getWizard() !== w) return;
  if (runIsLive(old) || workBusy()) return ctx.toast(FORK_BUSY);
  ctx.setWizard(next);
  ctx.setDraft(null);
  ctx.setEditPage(0);
  ctx.render();
  globalThis.scrollTo?.(0, 0);
  ctx.toast(
    "새 이야기로 시작해요. 주제와 재료를 고친 뒤 ③에서 글을 만들어요. 지금 이야기는 그대로 남아요.",
  );
}
/**
 * The unbound wizard '이 주제로 새로 만들기' starts: the job's topic, format
 * and the parent's own picks (still active), a new seed and a new story key.
 */
function forkWizard(state, old, w) {
  const next = wizardFromJob(old, w.simpleStep === 2 ? 2 : 1),
    planned = (list) => new Set((list || []).map((item) => item?.id)),
    autoCharacters = planned(old.plan?.newCharacters),
    autoPlaces = planned(old.plan?.newBackgrounds),
    characters = new Set(activeCharacters(state).map((c) => c.id)),
    places = new Set(activeBackgrounds(state).map((b) => b.id));
  delete next.simpleJobId;
  // Materials the run added on its own are not carried over: the new story
  // plans its own (or the parent picks them in ②).
  next.characterIds = (next.characterIds || [])
    .filter((id) => characters.has(id) && !autoCharacters.has(id))
    .slice(0, 1 + MAX_FRIENDS);
  next.backgroundIds = (next.backgroundIds || [])
    .filter((id) => places.has(id) && !autoPlaces.has(id))
    .slice(0, MAX_PLACES);
  // A new seed offset keeps cached responses from being replayed as the new story.
  next.qualitySeedOffset = Math.min(
    999,
    (Number(old.wizard?.qualitySeedOffset) || 0) + 1,
  );
  // A new story for the browser's Back/Forward: the old story's entries are passed over.
  next.simpleStoryKey = newStoryKey();
  if (w.simpleForced) next.simpleForced = true;
  // R12: the new story gets today's layout; a page job's 8 or 24 pages become the
  // nearest openings count (12/16) instead of failing at ③. Pages keep their count.
  return holdPageCount(next);
}
/**
 * 책장에 저장. Missing pictures (or an unfinished run) must be drawn first;
 * pictures whose text changed are the parent's choice: keep them or redraw
 * those pages. Approval happens only while this job's book is still open.
 */
async function saveBook(ctx) {
  const state = ctx.getState(),
    book = ctx.getDraft();
  if (!book) return;
  const job = jobOfBook(state, book);
  if (job) {
    if (runInterrupted(job)) return ctx.toast(INTERRUPTED_FIRST);
    const work = imageWork(book);
    let finished = null;
    if (work.needsRun) {
      finished = await drawAll(ctx, { book, job, finishing: true });
      if (!finished) return;
    } else if (work.stale.length) {
      // Keeping every picture still saves through the story-connection check
      // when the text changed since it last passed: say so, with its fee.
      const unit = estimateSimpleCosts(state, book).imageUnitUsd,
        check = coherenceCheckDue(state, book),
        choice = await choiceModal(
          ctx,
          "글을 고친 쪽 그림을 어떻게 할까요?",
          `${pageList(work.stale)}은 글을 고친 뒤에도 예전 그림이 그대로 있어요.<br>그림을 그대로 두고 저장하거나, 고친 쪽 그림만 다시 만들고 저장할 수 있어요. 다른 쪽 그림은 다시 만들지 않아요.${saveCheckNote(check)}`,
          [
            {
              value: "keep",
              label: `그림 그대로 저장${check.due ? ` · 이야기 연결 검사${check.usd > 0 ? ` 약 ${usd(check.usd)}` : " 글 엔진 요금"}` : ""}`,
            },
            {
              value: "redraw",
              label: `고친 ${work.stale.length}쪽 그림 다시 만들고 저장${unit > 0 ? ` (약 ${usd(work.stale.length * unit)})` : ""}`,
            },
          ],
        );
      if (!choice) return;
      if (choice === "redraw") {
        finished = await drawAll(ctx, {
          book,
          job,
          finishing: true,
          includeStale: true,
          confirmed: true,
        });
        if (!finished) return;
      } else {
        if (ctx.getDraft() !== book) return ctx.toast(OTHER_BOOK_OPEN);
        // The parent keeps these pictures for good, saved or not in the end.
        if (keepEditedPictures(book)) ctx.save();
      }
    }
    if (finished) {
      const current = getFullAutoJob(job.id)?.book;
      if (!current || ctx.getDraft() !== current) {
        ctx.render();
        return ctx.toast(OTHER_BOOK_OPEN);
      }
      if (finished.status !== "review" || imageWork(current).needsRun) {
        ctx.render();
        return ctx.toast(
          finished.error ||
            "아직 모든 그림이 준비되지 않았어요. 그림을 마저 만든 뒤 저장해 주세요.",
        );
      }
    }
  }
  await ctx.approveBook();
}
/** Why a story cannot be opened while this screen is making something. */
function reopenBusyMessage(job) {
  const bookId = job?.book?.id;
  if (pageOp && bookId && pageOp.bookId === bookId)
    return pageOp.kind === "rewrite" ? REOPEN_TEXT_BUSY : REOPEN_PICTURE_BUSY;
  if (liveRun?.jobId === job?.id)
    return liveRun.kind === "text" ? REOPEN_TEXT_BUSY : REOPEN_PICTURE_BUSY;
  if (bookId && isPageOperationBusy(bookId)) return REOPEN_PICTURE_BUSY;
  return REOPEN_OTHER_BUSY;
}
/**
 * Open a simple job at ③ or ④ (job cards, resume cards, pro '쪽마다 검수').
 * Refused while a simple action runs: its later steps belong to the open book.
 */
export async function openSimpleJob(ctx, jobId) {
  const state = ctx.getState(),
    job = state.fullAutoJobs?.[jobId];
  if (!job) throw Error("자동 작업을 찾지 못했어요.");
  if (isSimpleBusy()) {
    const open = ctx.getWizard?.();
    // The story being made is already the open one: just show it again.
    if (open?.simpleJobId === job.id) {
      if (!ctx.isSimpleMode()) open.simpleForced = true;
      ctx.setView("create");
      ctx.render();
      globalThis.scrollTo?.(0, 0);
      return true;
    }
    ctx.toast(reopenBusyMessage(job));
    return false;
  }
  let changed = false;
  if (job.simpleAbandoned) {
    // Opened again on purpose: it is a simple story to resume once more.
    delete job.simpleAbandoned;
    changed = true;
  }
  // A runner stale mark left on an idle book (an older copy of this screen, or
  // a chosen redraw cut off by a closed tab) becomes the kept-picture marker:
  // pictures are redrawn only on the parent's choice made here.
  if (
    job.book &&
    job.status !== "running" &&
    !runIsLive(job) &&
    keepEditedPictures(job.book)
  )
    changed = true;
  if (changed) ctx.save();
  const step = simpleStepForJob(job),
    w = wizardFromJob(job, step);
  if (!ctx.isSimpleMode()) w.simpleForced = true;
  ctx.setWizard(w);
  ctx.setDraft(step >= 4 ? job.book : null);
  // Back to the page the parent last looked at in ④ (this tab only).
  ctx.setEditPage(step >= 4 ? rememberedPage(job) : 0);
  ctx.setView("create");
  ctx.render();
  globalThis.scrollTo?.(0, 0);
  if (step >= 4) void refreshReading(ctx);
  return true;
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
/**
 * The one way between the five steps (step bar, 이전/다음, 검수로 가기,
 * 동화책 만들기, browser Back/Forward). Screen only: nothing starts, resumes
 * or is bought, and the open draft is kept while the parent browses ①–③ so
 * a run or page operation in flight still finds its own book. Returns true
 * when the step changed.
 */
function gotoStep(ctx, w, target, { fromHistory = false, entry = null } = {}) {
  const state = ctx.getState(),
    step = Number(target);
  if (!w || !Number.isInteger(step) || step < 1 || step > 5) return false;
  const refuse = (reason, redraw = true) => {
    ctx.toast(reason);
    // Back/Forward that cannot go there returns to the entry the parent was
    // on; the popped entry is left as it was (rewriting it would use it up).
    if (fromHistory) returnToEntry(entry);
    if (redraw) ctx.render();
    return false;
  };
  // No redraw: it would put the saved text back over the parent's edit.
  if (w.simpleEditing) return refuse(STEP_EDITING, false);
  const job = jobOfWizard(state, w);
  if (!job) {
    if (w.simpleStep === 1) {
      const field = globalThis.document?.querySelector?.("#topic");
      if (field) w.topic = field.value;
    }
    if (step >= 2 && safeTopic(w.topic).ok) preselectMaterials(state, w);
  }
  const row = simpleStepAccess(state, w, { busy: finishBusy(state, w) })[
    step - 1
  ];
  if (!row.reachable) return refuse(row.reason);
  if (step >= 4) {
    const book = job?.book;
    if (!book) return refuse(STEP_NO_TEXT);
    const draft = ctx.getDraft();
    // Coming back to ④ lands on the same page unless another book was open.
    if (!draft || (draft !== book && !isSimpleBusy())) {
      ctx.setDraft(book);
      ctx.setEditPage(rememberedPage(job, book));
    }
  }
  w.simpleBadgeOpen = false;
  w.simpleStep = step;
  if (fromHistory) {
    if (Number.isInteger(entry)) historyIndex = browserIndex = entry;
  } else if (ownsHistory(ctx)) writeStepEntry(w, step, true);
  ctx.render();
  globalThis.scrollTo?.(0, 0);
  focusActiveStep();
  if (step >= 4) void refreshReading(ctx);
  return true;
}
async function handle(ctx, action, el) {
  const state = ctx.getState(),
    w = ctx.getWizard();
  if (!w) return;
  // ①/② of a story that has a job are its frozen copy: changes go only
  // through '이 주제로 새로 만들기'.
  const bound = !!jobOfWizard(state, w);
  if (
    bound &&
    ["topic", "idea", "format", "friend", "place"].includes(action)
  )
    return;
  if (action === "goto-step") return gotoStep(ctx, w, el.dataset.step);
  if (action === "fork") return forkStory(ctx);
  if (action === "topic") {
    w.topic = el.dataset.topic;
    delete w.simpleIdeaNote;
    const field = document.querySelector("#topic"),
      status = document.querySelector("#simple-idea-status");
    if (field) field.value = w.topic;
    if (status) status.textContent = "";
    document
      .querySelectorAll('[data-simple-action="topic"]')
      .forEach((chip) =>
        chip.classList.toggle("selected", chip.dataset.topic === w.topic),
      );
    return;
  }
  if (action === "idea") {
    const idea = ideaState(state),
      field = document.querySelector("#topic"),
      current = String(field ? field.value : w.topic || "").trim();
    let topic = "";
    if (idea.world)
      try {
        const suggestion = await storyWorldTopic(idea.worldId, {
          offset: Number(w.simpleIdeaOffset) || 0,
          season: idea.quality.season,
          timeOfDay: idea.quality.timeOfDay,
        });
        w.simpleIdeaOffset = (Number(w.simpleIdeaOffset) || 0) + 1;
        topic = String(suggestion?.topic || "").trim();
      } catch {
        /* The built-in list below still gives an idea. */
      }
    // The parent moved on while the world idea loaded: leave the topic alone.
    if (ctx.getWizard() !== w || w.simpleStep !== 1 || w.simpleJobId) return;
    if (!topic || topic === current) topic = pickIdeaTopic(current);
    w.topic = topic;
    // Kept on the screen state, so a later redraw of ① still shows it.
    w.simpleIdeaNote = topic;
    const input = document.querySelector("#topic"),
      status = document.querySelector("#simple-idea-status");
    if (input) input.value = topic;
    document
      .querySelectorAll?.('[data-simple-action="topic"]')
      ?.forEach((chip) =>
        chip.classList.toggle("selected", chip.dataset.topic === topic),
      );
    if (status) status.textContent = IDEA_NOTE;
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
  if (action === "next") return gotoStep(ctx, w, w.simpleStep + 1);
  if (action === "back") return gotoStep(ctx, w, w.simpleStep - 1);
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
    // Like 글 만들기: a missing text key is named with a 키 입력 button
    // before the runner's preflight would mark the job failed.
    if (!job.demo && (await stopForTextKey(ctx, job))) return;
    // ③ only ever buys text: a job without its book (also a pro job that was
    // never held, opened here) stops at the text, and its pictures go through
    // ④ and their cost confirm, as ③ says.
    const stopBefore = job.book ? undefined : "text";
    // A run not held at the text also needs the image key.
    if (
      stopBefore !== "text" &&
      (job.stopBefore ?? null) !== "text" &&
      (await stopForImageKey(ctx, {
        generationSnapshot: { imageEngine: job.imageEngine },
      }))
    )
      return;
    const done = await runJob(ctx, job.id, stopBefore, "text");
    if (
      done &&
      HELD.includes(done.status) &&
      done.book &&
      ctx.isSimpleView() &&
      ctx.getWizard()?.simpleJobId === done.id
    )
      return arriveAtReview(ctx, done);
    ctx.render();
    return;
  }
  if (action === "abandon") {
    // ③ escape hatch: keep the stopped story in the pro job list, start over with the same picks.
    const job = jobOfWizard(state, w);
    if (w.simpleStep !== 3 || !canAbandon(job)) return ctx.render();
    job.simpleAbandoned = true;
    job.updatedAt = new Date().toISOString();
    if (ctx.save() === false) {
      delete job.simpleAbandoned;
      return ctx.toast("변경을 저장하지 못했어요. 저장 공간을 확인해 주세요.");
    }
    delete w.simpleJobId;
    // R12: the start over is a new story, so it gets today's layout (see forkWizard).
    holdPageCount(w);
    w.simpleStep = 1;
    if (lastProgress?.jobId === job.id) lastProgress = null;
    ctx.render();
    globalThis.scrollTo?.(0, 0);
    ctx.toast(
      "멈춘 이야기는 ‘제작 중인 이야기’에 두었어요. 주제·재료·엔진을 바꿔 다시 만들 수 있어요.",
    );
    return;
  }
  if (action === "resume-run") {
    const book = ctx.getDraft(),
      job = jobOfBook(state, book);
    if (book && runInterrupted(job)) await resumeRun(ctx, book, job);
    ctx.render();
    return;
  }
  if (action === "open-review") return gotoStep(ctx, w, 4);
  if (action === "stop") {
    if (pageOp) {
      pageOp.controller.abort();
      return;
    }
    const job = jobOfBook(state, ctx.getDraft()) || jobOfWizard(state, w);
    if (job) {
      // Counted before any wait: a page draw waiting on this job's release sees it.
      stopClicks.set(job.id, (stopClicks.get(job.id) || 0) + 1);
      await stopFullAutoJob(job.id).catch((error) => ctx.toast(error));
    }
    ctx.render();
    return;
  }
  if (action === "page-prev" || action === "page-next") {
    const book = ctx.getDraft();
    if (!book || w.simpleEditing) return;
    const next = Math.max(
      0,
      Math.min(
        book.pages.length - 1,
        ctx.getEditPage() + (action === "page-next" ? 1 : -1),
      ),
    );
    ctx.setEditPage(next);
    const job = jobOfBook(state, book);
    if (job) reviewPages.set(job.id, next);
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
    const book = ctx.getDraft();
    if (
      workBusy() ||
      isPageOperationBusy(book?.id) ||
      runInterrupted(jobOfBook(state, book))
    )
      return;
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
    return drawPage(ctx, ctx.getDraft(), ctx.getEditPage(), {
      redraw: action === "redraw-page",
    });
  if (action === "like") {
    const book = ctx.getDraft(),
      index = ctx.getEditPage();
    if (!book?.pages?.[index]) return;
    await setPageReviewed(state, book, index, !book.pages[index].reviewed, {
      save: ctx.save,
    });
    ctx.render();
    return;
  }
  if (action === "draw-all") {
    await drawAll(ctx, { book: ctx.getDraft() });
    ctx.render();
    return;
  }
  if (action === "restart") return restartStory(ctx);
  // Refused while anything is being made, even from a button drawn before.
  if (action === "to-finish") return gotoStep(ctx, w, 5);
  if (action === "save-book") return saveBook(ctx);
}
/* Screen-only actions, and stop/resume, never wait behind a running action. */
const QUIET = new Set([
  "topic",
  // Screen-only too: it fills the topic field and its own status line, which a
  // redraw right after the click would wipe before it is read.
  "idea",
  "format",
  "badge",
  "page-prev",
  "page-next",
  "edit-text",
  "cancel-text",
  "back",
  "next",
  "goto-step",
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
/**
 * R12: a language or level change that moves the wizard between page and openings
 * layouts snaps the page count (16 기본 until the parent picks one) and swaps the
 * choices. Within one layout nothing changes, so with openings off this is a no-op.
 */
function snapFormatPageCount(w, before) {
  const after = layoutFor(w);
  if (before === after) return;
  w.pageCount = snapPageCount(after, w.pageCount, {
    touched: !!w.pageCountTouched,
    defaultPages: api.getState()?.settings?.defaultPages,
  });
  const select = document.querySelector("#simple-format-panel #pageCount");
  if (select)
    select.innerHTML = pageCountOptions(w)
      .map(
        ([value, label]) =>
          `<option value="${value}" ${String(value) === String(w.pageCount) ? "selected" : ""}>${label}</option>`,
      )
      .join("");
}
function onChange(event) {
  if (!api?.isSimpleView?.()) return;
  const target = event.target,
    w = api.getWizard();
  if (!w) return;
  // A story with a job keeps its frozen format and picks (see '이 주제로 새로 만들기').
  if (
    jobOfWizard(api.getState(), w) &&
    [
      "language",
      "pageCount",
      "koreanLevel",
      "englishLevel",
      "simple-allow-new",
    ].includes(target.id)
  )
    return;
  if (
    ["language", "pageCount", "koreanLevel", "englishLevel"].includes(target.id)
  ) {
    const before = layoutFor(w);
    w[target.id] =
      target.id === "pageCount" ? Number(target.value) : target.value;
    if (target.id === "pageCount") w.pageCountTouched = true;
    else snapFormatPageCount(w, before);
    const summary = document.querySelector("#simple-format-summary");
    if (summary) summary.textContent = formatSummary(w);
    return;
  }
  if (target.id === "simple-allow-new") {
    w.allowNew = target.checked;
    refreshStepBar(w);
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
/**
 * Redraw only the step bar when what is open changed without a redraw (the
 * topic being typed on ①, the 자동 추가 switch on ②), so a step the parent
 * can now reach is a button without waiting for the next full redraw.
 */
function refreshStepBar(w, probe = w) {
  if (typeof document === "undefined" || !api?.isSimpleView?.()) return;
  const bar = document.querySelector?.(".simple-create > .simple-steps"),
    state = api.getState();
  if (!bar || jobOfWizard(state, w)) return;
  const access = simpleStepAccess(state, probe, {
    busy: finishBusy(state, w),
  });
  if (bar.dataset?.open !== access.map((r) => (r.reachable ? 1 : 0)).join(""))
    bar.outerHTML = stepsBar(w.simpleStep, access);
}
function onInput(event) {
  if (event.target?.id !== "topic" || !api?.isSimpleView?.()) return;
  const w = api.getWizard();
  if (!w || w.simpleStep !== 1) return;
  refreshStepBar(w, { ...w, topic: event.target.value });
}
/** Wire the simple screen once; ctx exposes the app's wizard/draft/editPage through getters and setters. */
export function configureSimpleCreate(ctx) {
  api = ctx;
  if (configured || typeof document === "undefined") return;
  configured = true;
  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("input", onInput);
  // A no-op outside the simple create screen (see onSimplePopState).
  globalThis.window?.addEventListener?.("popstate", onSimplePopState);
}
