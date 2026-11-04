import { compactUsageRow, compactStageMeta } from "../library-compact.js";
import { renderCheckboxSwitch } from "../ui-controls.js";
import { beatCountFor, hardOutlineViolations } from "./schemas.js";
import { describeReadingViolation } from "../reading-messages.js";
import { buildStoryWords } from "../story-reading-context.js";
import {
  generateOutline,
  rewriteBeat,
  generateProse,
  rewriteParagraph,
  alignProseParagraph,
  paginateStory,
  rewriteStoryPage,
  repairPagination,
  summarizeStory,
  inspectOutlineRules,
  preflightOutlineLocations,
  isHomeBackground,
  customEnding,
  paragraphBeatLabels,
  generateSceneBriefs,
  rewriteSceneBrief,
  enrichProse,
  ensurePlotContract,
  reviewStoryCoherence,
  finalizeStoryPagination,
} from "./pipeline.js";
import { BRIEF_TIMES, inspectSceneBriefs } from "./scene-briefs.js";
import { editorPolicy, revisionSummary } from "./book-revision.js";
import { craftPolicy } from "./craft-rules.js";
import { arcPolicy } from "./arc-rules.js";
import { promptPolicy } from "./prompt-policy.js";
import { hasOrchestrationPolicy, orchestrationPolicyFor } from "./orchestration.js";
import { councilRecentFor, councilPolicy, recordParentDecision, renderCouncilCard, isCouncilHold } from "./council.js";
import {
  renderCouncilRoom,
  liveCouncilRecord,
  reviewPending,
  renderCouncilReviewForm,
  readCouncilChoice,
  readCouncilDirection,
} from "./council-room.js";
import { withPageRhythm } from "../page-rhythm.js";
import { withShortSentences } from "../short-sentences.js";
import { k1Policy, isK1Draft } from "./k1-book.js";
import { topicEndingPolicy, topicEndingNote } from "./topic-ending.js";
import { storyChangePolicy, storyPlace, storyChangeSummary } from "./story-change.js";
import { storyDramaPolicy, storyDramaSummary, isTextOnlyPage } from "./story-drama.js";
import { textPocketPolicy } from "../text-pocket.js";
import { storyCastPolicy, castSummary } from "./story-cast.js";
import { englishMirrorPolicy } from "./english-mirror.js";
import { promptDiet, hasPromptDiet } from "./prompt-diet.js";
import { chooseStoryShape, storyShapeRef, recentShapeIds, storyShapeLabel, shapeById } from "./story-shapes.js";
import { stageFor, stageById } from "./stage-categories.js";
import { chooseVoice, recentVoiceIds, voiceSummary } from "./voice-deck.js";
import { chooseExpression, recentExpressionIds, expressionSummary } from "./expression-deck.js";
import { drawIdea, recentIdeaIds, storyIdeaRef, ideaSummary, withoutDevice, ideaInputFor } from "./idea-deck.js";
import { storyLogicPolicy } from "./story-logic.js";
import { mannersPolicy, recentHumorLines } from "./story-manners.js";
import { writersRoomFor } from "./writers-room.js";
import { formatFor, bookFormat, bookFormatLabel, withPictureLed } from "../book-format.js";
import { picturePlanNote } from "./picture-plan.js";
import {
  SPREAD_SHOTS,
  SHOTS,
  SHOT_LABELS,
  stagePagination,
  updatePageStaging,
} from "./staging.js";
import { buildBeatPagePlan, splitPaginationToCount } from "./pagination.js";
import {
  estimateCouncilCost,
  freezeReviewTier,
  listTextModels,
  getTextModelInfo,
  resolveTextModel,
  resolveStoryStageSettings,
  resolveQualityStageSettings,
  resolveBeatWriterSettings,
  registeredModelIds,
} from "../text-generation/models.js";
import {
  getTextGenerationSettings,
  normalizeStoryQualitySettings,
} from "../text-generation/settings-ui.js";
import { freezeReadingLevels, normalizeReadingLevels } from "../reading-levels.js";
import {
  OPENING_PAGE_COUNTS,
  OPENING_KOREAN_LEVELS,
  CUES,
  LAYOUT_FIELDS,
  openingsLayoutPolicy,
  openingsOf,
  printedPagesOf,
  layoutFor,
  unitLabel,
  validateOpenings,
} from "../book-layout.js";
import { getActiveWorld } from "../image-generation/world.js";
import {
  availableCharacterVariants,
  validateWardrobeSelections,
} from "../wardrobe.js";
import {
  checkStory,
  catchphrasePolicyFor,
  omitCatchphrases,
  storyCatchphrases,
} from "./checker.js";
import { checkRichness } from "./richness.js";
import { getStylePreset } from "../image-generation/styles.js";
import { buildSeriesStorySelections } from "./continuity.js";
import {
  STORY_STRUCTURE_PRESETS,
  resolveStructurePreset,
} from "./plot-contract.js";
import { isCoherenceCurrent, coherenceFingerprint } from "./coherence.js";
import {
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
let api,
  session,
  configured = false,
  saveTimer;

/* R55b: the old story workspace (its drafts, panels, session and handlers) is gone; the simple steps and FULL AUTO are the only way to make a story. */
export function renderStoryCoherence(report, { dirty = false } = {}) {
  if (!report) return "";
  const issues = report.issues || [],
    hard = issues.some((issue) => issue.severity === "error"),
    pending =
      report.pending === true || (report.passed === false && !issues.length),
    failed = !pending && (hard || report.passed === false);
  return `<details class="story-card story-coherence" ${failed && !dirty ? "open" : ""}><summary>플롯 일관성 검사 <span class="story-check-badge ${failed || dirty ? "fail" : ""}">${dirty ? "수정 후 재검사 필요" : pending ? "수정 내용 검사 이어가기" : failed ? "연결 수정 필요" : "검사 완료"}</span></summary><p class="story-note">목표·원인과 결과·인물과 소품의 상태·한영 사건 일치를 검사합니다.${dirty ? " 그림 생성 전에 최신 내용으로 다시 검사합니다." : hard ? " 오류가 해결되어야 그림 단계로 진행할 수 있어요." : ""}</p>${issues.length ? `<ol class="story-coherence-issues">${issues.map((issue) => `<li><strong>${issue.pageNo ? `${Number(issue.pageNo)}쪽 · ` : ""}${issue.beatIndex ? `비트 ${Number(issue.beatIndex)} · ` : ""}${issue.language ? `${esc({ ko: "한글", en: "English", both: "한영" }[issue.language] || issue.language)} · ` : ""}${esc({ goal_drift: "주인공 목표", causal_gap: "사건의 원인과 결과", unearned_solution: "해결 과정", prop_state: "소품 상태", state_conflict: "인물·소품 상태", unsupported_event: "승인한 사건 유지", text_scene_conflict: "글과 그림 장면 일치", character_state: "인물 상태", knowledge_state: "알게 된 정보", bilingual_mismatch: "한영 사건 일치", setup_payoff: "단서 심기와 회수", scene_mismatch: "글과 그림 장면 일치" }[issue.code] || "사건 연결 확인")}</strong>${issue.evidence ? `<blockquote>${esc(issue.evidence)}</blockquote>` : ""}${issue.suggestion ? `<p>${esc(issue.suggestion)}</p>` : ""}</li>`).join("")}</ol>` : pending ? '<p class="story-note">완료한 수정은 보관했어요. 최신 글의 검사를 이어서 진행해 주세요.</p>' : '<p class="story-note">발견된 플롯 연결 오류가 없습니다.</p>'}</details>`;
}

/** R33: the shape and stage an outline was written to (diet drafts). */
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

/**
 * The frozen input of a new draft or job. The layout is decided by the CALLER and
 * never re-derived here: only startStoryWorkflow and createFullAutoJob pass
 * layoutFor(wizard), and the FULL AUTO input step passes the layout its job.input
 * already holds. 'pages' (the default) is the pre-R12 input, byte for byte.
 * 'openings' adds layoutPolicy, v4 openings reading rules, one beat per opening
 * and the openings prose length policy; it accepts only 12 or 16 printed pages and
 * throws before any paid call otherwise (it never snaps silently).
 */
/**
 * R33: the story's shape (이야기 모양), chosen once for a new draft — the
 * parent's pick when it names a shape, else the topic's best fit skipping the
 * latest approved books' shapes — and frozen in the input.
 */
export function storyShapeFor(state, wizard = {}, { level = "K2" } = {}) {
  const defaults = normalizeStoryQualitySettings(state.settings?.storyQuality);
  return storyShapeRef(
    chooseStoryShape(wizard.topic, {
      pick: wizard.storyShapeId || wizard.storyQualityPatternId || defaults.patternId || "auto",
      level,
      recentIds: recentShapeIds(storyQualityBookRecords(state)),
      seed: `${String(wizard.topic || "").trim()}:${Number(wizard.qualitySeedOffset) || 0}`,
    }),
  );
}
/** R34: the book's voice cards (이 책의 목소리), chosen once from the topic's seed, skipping the latest books' cards, leaning to the shape. */
export function storyVoiceFor(state, wizard = {}, { level = "K2", shapeId = "" } = {}) {
  return chooseVoice({
    seed: `${String(wizard.topic || "").trim()}:${Number(wizard.qualitySeedOffset) || 0}`,
    level,
    recentIds: recentVoiceIds(storyQualityBookRecords(state)),
    shapeId,
  });
}
/** R37: a picture-led book's expression principles, chosen once from the topic's seed, skipping the latest books' cards. */
export function storyExpressionFor(state, wizard = {}) {
  return chooseExpression({
    seed: `${String(wizard.topic || "").trim()}:${Number(wizard.qualitySeedOffset) || 0}`,
    recentIds: recentExpressionIds(storyQualityBookRecords(state)),
  });
}
/**
 * R46: the book's idea cards. The parent's draw from ① (아이디어 뽑기) when it
 * is still for this topic (its spark only while the topic is the one it
 * filled in); otherwise cast, device and ending drawn from the topic's seed,
 * the latest books' cards left for last.
 */
export function storyIdeaFor(state, wizard = {}, { k1 = false, room = false } = {}) {
  const topic = String(wizard.topic || "").trim(),
    drawn = storyIdeaRef(wizard.storyIdea);
  if (drawn) {
    if (drawn.cards.spark && String(wizard.storyIdea.topic || "").trim() !== topic) delete drawn.cards.spark;
    return drawn;
  }
  const auto = drawIdea({ seed: `${topic}:${Number(wizard.qualitySeedOffset) || 0}`, recentIds: recentIdeaIds(storyQualityBookRecords(state)), k1, spark: false });
  // A draft whose writers' room weighs three candidates leaves the device to
  // the room: each candidate gets its own (roomDevices).
  return room ? withoutDevice(auto) : auto;
}
/** R33: the stage of a new draft — the parent's pick, else the chosen world card's category, else the topic's. */
export function draftStageFor(state, wizard = {}) {
  const defaults = normalizeStoryQualitySettings(state.settings?.storyQuality);
  return stageFor({
    pick: wizard.stageCategoryId || defaults.stageCategoryId || "auto",
    worldId: wizard.storyWorldId || defaults.worldId || "drawer",
    topic: wizard.topic,
  });
}
export function inputFromWizard(state, wizard, { layout: askedLayout = "pages" } = {}) {
  if (askedLayout !== "pages" && askedLayout !== "openings")
    throw new Error("책 구성은 pages 또는 openings여야 해요.");
  // R53 작가실: the writer sets the length. R54b: a room draft keeps the asked
  // layout — an openings book binds the room's pages into its fixed openings
  // (each one or two of the writer's pages), a page book takes the nearest count.
  const room = !isK1Draft({ koreanLevel: normalizeReadingLevels(wizard, state.settings).koreanLevel, language: wizard.language, layout: askedLayout }) && !!writersRoomFor(state),
    layout = askedLayout;
  const openings = layout === "openings";
  if (openings && !OPENING_PAGE_COUNTS.includes(Number(wizard.pageCount || 12)))
    throw new Error("펼침 구성 책은 12쪽이나 16쪽으로 골라 주세요.");
  const choices = validateWardrobeSelections(state, wizard),
    previous = state.books.find((book) => book.id === wizard.previousBookId),
    world = clone(getActiveWorld(state));
  const inherited = buildSeriesStorySelections(state, wizard, previous);
  if (!inherited.characters.length)
    throw new Error("이야기의 주인공을 먼저 골라 주세요.");
  // R9: decided once here and frozen in the draft/job input (never on resume).
  // A catchphrase used in the protagonist's 2 latest approved books is left out.
  const catchphrasePolicy = catchphrasePolicyFor(
      state.books,
      inherited.characters,
    ),
    characters = omitCatchphrases(inherited.characters, catchphrasePolicy);
  const readingLevels = freezeReadingLevels(
    {
      ...wizard,
      koVocabulary:
        state.settings.koVocabularies?.[
          Number(String(wizard.koreanLevel || "K1").slice(1))
        ]?.words || [],
    },
    state.settings,
    ...(openings ? [{ layout: "openings" }] : []),
  );
  if (
    openings &&
    (!OPENING_KOREAN_LEVELS.includes(readingLevels.koreanLevel) ||
      wizard.language === "en")
  )
    throw new Error("펼침 구성 책은 한글이 있는 K2~K4 책에서만 만들 수 있어요.");
  // Page rhythm: new drafts judge the book's sentence total (±20%) and let
  // each page vary; frozen here in the specs (and the job's readingLevels).
  readingLevels.specs = withPageRhythm(readingLevels.specs);
  // R31a: a new K1 draft's Korean spec judges short rhythm lines and page averages.
  readingLevels.specs = withShortSentences(readingLevels.specs);
  // R35 책 결: the default new book is picture-led (few sentences per opening,
  // the three-step composition); 글이 많은 책 keeps today's budgets.
  const formatId = formatFor(wizard);
  if (formatId === "pictureLed") readingLevels.specs = withPictureLed(readingLevels.specs, { layout });
  const k1 = isK1Draft({ koreanLevel: readingLevels.koreanLevel, language: wizard.language, layout }),
    // R31a: a simple-mode story (no ending choice there) ends where its topic goes.
    topicEnding = wizard.simpleFlow === true && wizard.ending !== "open" && wizard.ending !== "custom";
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
  // R33: the stage of this draft (the pick, the chosen world card's category, or the topic's).
  const stageCategory = draftStageFor(state, wizard),
    storyShape = storyShapeFor(state, wizard, { level: readingLevels.koreanLevel });
  return {
    input: {
      characters,
      backgrounds: drawerBackgrounds(state, inherited.backgrounds),
      preferredBackgroundIds: clone(wizard.backgroundIds || []),
      worldNotes: inherited.worldNotes,
      topic: String(wizard.topic || "").trim(),
      // R20: the parent's one-line direction for the writers' room, only when
      // written (an empty key would change a resumed legacy job's input bytes).
      ...(String(wizard.direction || "").trim()
        ? { direction: String(wizard.direction).trim().slice(0, 200) }
        : {}),
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
        // R33: the parent's stage pick (a chosen one only; auto adds no key).
        ...(wizard.stageCategoryId && wizard.stageCategoryId !== "auto"
          ? { stageCategoryId: String(wizard.stageCategoryId).slice(0, 40) }
          : {}),
        approvedBooks: storyQualityBookRecords(state),
      },
      qualitySeedOffset: Math.min(
        999,
        Math.max(0, Number(wizard.qualitySeedOffset) || 0),
      ),
      pageCount: Number(wizard.pageCount || 12),
      ...(openings ? { layoutPolicy: openingsLayoutPolicy() } : {}),
      outlineBeatCount: openings
        ? Number(wizard.pageCount || 12) / 2
        : beatCountFor(
            Number(wizard.pageCount || 12),
            readingLevels.koreanLevel,
          ),
      // 2026-10-20: a typed ending is its own ending type; the story may end
      // away from home. An empty typed ending still means home.
      endingType:
        wizard.ending === "open"
          ? "open"
          : (wizard.ending === "custom" && String(wizard.endingCustom || "").trim()) || topicEnding
            ? "custom"
            : "home_sleep",
      moral:
        wizard.value === "custom"
          ? String(wizard.valueCustom || "").trim()
          : wizard.value === "none"
            ? ""
            : wizard.value || "",
      endingNote:
        wizard.ending === "custom"
          ? String(wizard.endingCustom || "").trim()
          : topicEnding
            ? // R38: a placeless topic ends where it began, one thing changed — not at home by default.
              topicEndingNote(wizard.topic, { change: true })
            : "",
      ...(topicEnding ? { topicEndingPolicy: topicEndingPolicy() } : {}),
      previousSummary:
        previous?.summaryForNext || previous?.outline?.logline || "",
      previousStory: inherited.previousStory,
      prosePolicy: {
        version: 1,
        // Openings drafts allow the app length-fit pass in both languages.
        condenseOverBudget: {
          ko: openings || readingLevels.koreanLevel === "K1",
          en: openings || readingLevels.englishLevel === "E0",
        },
      },
      specs: readingLevels.specs,
      variants,
      variantByCharacter: choices.characterVariants,
      variantPageRanges: choices.variantPageRanges,
      catchphrasePolicy,
      // Editor round: frozen for new drafts only (read-through, current-book
      // context in rewrites, author-model content fixes).
      editorPolicy: editorPolicy(),
      // Picture-book craft rules (suspense, sound refrain, key props, camera).
      craftPolicy: craftPolicy(),
      // R31a: a K1 book takes the K1 arc and the one-call page writer instead
      // of the story spine and the writers' room.
      ...(k1 ? { k1Policy: k1Policy() } : { arcPolicy: arcPolicy() }),
      // The writers' room before the outline (pitches, verdicts, bible, decision log).
      ...(k1 ? {} : { councilPolicy: councilPolicy() }),
      // R25: the latest approved books' planted objects, frozen for the meeting.
      ...(k1 ? {} : { councilRecent: councilRecentFor(storyQualityBookRecords(state)) }),
      // R29 정성 모드: on unless the parent turned it off; the beat writer's tier frozen with it.
      ...(orchestrationPolicyFor(state) ? { orchestrationPolicy: orchestrationPolicyFor(state) } : {}),
      // R23: tidier requests (default rules back, bible over seed, lean canon).
      promptPolicy: promptPolicy(),
      // R31b: lean requests — no counters, no spec JSON, no plot formula.
      promptDiet: promptDiet(),
      // R38: the outline must say what is different at the end (and the picture rules read the same marker).
      storyChange: storyChangePolicy({ wordless: false }),
      // R39: tries of different kinds, a secret the child sees first, the companion's own want, plain and text-only pages, a cover of the story's cast.
      storyDrama: storyDramaPolicy(),
      // R40: the picture leaves a flat field where the words are typeset (never painted in).
      textPocket: textPocketPolicy(),
      // R41: four or five characters with different relations to the hero.
      storyCast: storyCastPolicy({ entrance: true }),
      // R42: the English of every beat is the short telling of its Korean (written after it, from it).
      englishMirror: englishMirrorPolicy(),
      // R38: the parent's opening place (쉬운 ① 어디서?), when it is a drawer place.
      ...(storyPlace(wizard.storyPlaceId, state.backgrounds) ? { storyPlace: storyPlace(wizard.storyPlaceId, state.backgrounds) } : {}),
      // R33: the story's shape and stage, chosen once here and frozen with the draft.
      storyShape,
      ...(stageCategory ? { stageCategory } : {}),
      // R34: the book's voice cards, chosen once here (never on resume).
      storyVoice: storyVoiceFor(state, wizard, { level: readingLevels.koreanLevel, shapeId: storyShape.id }),
      // R35: the book's format (책 결), decided once here and frozen with the specs above.
      bookFormat: bookFormat(formatId),
      // R37: a picture-led book's expression principles in place of R35's fixed plot template.
      ...(formatId === "pictureLed" ? { storyExpression: storyExpressionFor(state, wizard) } : {}),
      // R46: the book's idea cards (발상·인물 짜임·장치·끝), drawn once here (never on resume).
      storyIdea: storyIdeaFor(state, wizard, { k1, room: !k1 && !!orchestrationPolicyFor(state) }),
      // R47: cause and effect a child can follow; varied speech tags.
      storyLogic: storyLogicPolicy(),
      // R49: who speaks politely, laughs from what happens (not the recent books' ones), a secret only when there is one.
      storyManners: mannersPolicy(recentHumorLines(storyQualityBookRecords(state))),
      // R51: the writers' room (the parent's setting; off until R53) in place of the council, not for K1 yet.
      ...(!k1 && writersRoomFor(state) ? { writersRoom: writersRoomFor(state, storyQualityBookRecords(state)) } : {}),
    },
    readingLevels,
    world,
  };
}

export function rebuildStoryDraftFromBook(book, state, previous = {}) {
  const copy = (value) => (value == null ? value : clone(value));
  const input = copy(book.storyInput || previous.input);
  if (!input) throw new Error("이 책의 이야기 제작 정보를 찾지 못했어요.");
  const pagination = copy(book.pagination || previous.pagination || {});
  pagination.cover = { ...(pagination.cover || {}), title: book.title };
  pagination.pages ||= [];
  const readingLevels = copy(
    book.readingLevelSnapshot ||
      previous.readingLevels ||
      freezeReadingLevels(book, state.settings),
  );
  return {
    ...copy(previous),
    id: previous.id || `story-${crypto.randomUUID()}`,
    bookId: book.id,
    stage: "paged",
    reviewMode: "pages",
    input: { ...input, bookId: book.id },
    worldId: book.worldId || previous.worldId,
    worldSnapshot: copy(
      book.worldSettingsSnapshot ||
        previous.worldSnapshot ||
        getActiveWorld(state),
    ),
    textSettings: copy(
      book.textGenerationSettings ||
        previous.textSettings ||
        getTextGenerationSettings(state),
    ),
    readingLevels,
    demo: book.textDemo ?? previous.demo ?? false,
    titleIndex: previous.titleIndex || 0,
    selectedTitle: book.title,
    usage: copy(book.textUsage || previous.usage || { calls: [] }),
    pagination,
  };
}
/** Keep edits made in the existing picture editor when it reopens this workflow. */
export function syncStoryDraft(book, state) {
  const existing = drafts(state)[book.storyDraftId];
  if (!existing) return false;
  const d = rebuildStoryDraftFromBook(book, state, existing);
  drafts(state)[book.storyDraftId] = d;
  if (book.outline) d.outline = clone(book.outline);
  if (book.prose) d.prose = clone(book.prose);
  if (book.sceneBriefs) d.sceneBriefs = clone(book.sceneBriefs);
  if (book.richnessCheck) d.richnessCheck = clone(book.richnessCheck);
  for (const key of ["proseCoherence", "pageCoherence", "childGate"])
    if (book[key]) d[key] = clone(book[key]);
  d.bookId = book.id;
  d.pictureBook = clone(book);
  if (Array.isArray(book.pages))
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
      // R12 openings: an entry keeps its place (kind, side, opening, id, cue).
      ...Object.fromEntries(
        LAYOUT_FIELDS.filter((key) => page[key] !== undefined).map((key) => [
          key,
          clone(page[key]),
        ]),
      ),
    }));
  d.checksDirty = true;
  d.updatedAt = new Date().toISOString();
  return true;
}

/** R22: the parked meeting of a pro draft (its checkpoint record in phase "review"). */
