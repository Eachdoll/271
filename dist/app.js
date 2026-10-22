import { storageStatusView } from "./ui-controls.js";
import { buildStoryWords } from "./story-reading-context.js";
import { credentialToastAction } from "./credential-errors.js";
import { renderChecksPanel } from "./checks-panel.js";
import {
  showSimilarPagesReview,
  selectSimilarPages,
} from "./image-generation/settings-ui.js";
import {
  finalizeBookRecords,
  cleanupOldWorkRecords,
  estimateLibraryStorage,
} from "./finalize-cleanup.js";
import {
  ensureBookStoryCoherence,
  currentBookPagination,
} from "./story-generation/book-coherence.js";
import { isCoherenceCurrent } from "./story-generation/coherence.js";
import { loadStoryQualityData } from "./story-generation/quality-adapter.js";
import {
  configureStoryQualityUI,
  renderStoryQualitySettings,
  renderQualityPatternSelector,
  renderQualityWorldSelectors,
  checkDueQualityCoach,
  cleanupStoryQualityUI,
} from "./story-generation/quality-settings.js";
import { createTextEngine } from "./text-generation/providers.js";
import { recordApprovedElements } from "./story-generation/quality-gates.js";
import {
  configureFullAutoUI,
  renderFullAutoLauncher,
  renderFullAutoJobs,
  cleanupFullAuto,
  isFullAutoRunning,
  openFullAutoReview,
  keepEditedPictures,
} from "./full-auto-ui.js";
import {
  readUiMode,
  writeUiMode,
  nextUiMode,
  renderSimpleCreate,
  configureSimpleCreate,
  openSimpleJob,
  missingPageText,
  pageTextProblemMessage,
  carryFullAutoFields,
  isSimpleBusy,
  simpleDrawingInFlight,
  approvalImageWork,
} from "./simple-create.js";
import { isPageOperationBusy } from "./story-generation/page-tools.js";
import {
  bookPricingUnknown,
  estimatedCostText,
  canAlignEnglish,
  estimateAlignEnglish,
  requestPageEnglish,
  recordPageTextUsage,
} from "./story-generation/page-tools.js";
import {
  createCloudSync,
  isSeedOnlyLibrary,
  pushBookCountWarning,
} from "./cloud-sync.js";
import {
  configureFamilyAuthUI,
  openFamilyAuth,
  openFamilyPassword,
  openFamilyDelete,
  familyLogoutAction,
  followChatGptLink,
  accountLine,
  signedOutNote,
  renderSignedOutChoices,
  renderCloudAccountControls,
  renderSimpleAccountRow,
  renderLocalOnlyEscape,
} from "./family-auth-ui.js";
import {
  downloadLibraryTransfer,
  readLibraryBackupFile,
  backupSummary,
} from "./device-transfer.js";
import {
  createLibraryBackup,
  clearDirectBlobCache,
  downloadFile,
} from "./output.js";
import {
  readStoredLibrary,
  validateStoredLibrary,
  writeStoredLibrary,
  keepRecoveryPoint,
  latestRecoveryPoint,
  decodeStoredLibrary,
  readSpilledLibrary,
  spillStoredLibrary,
  libraryTextOf,
  isSpilledLibrary,
} from "./library-storage.js";
import {
  seedState,
  generateBook,
  sceneSVG,
  characterSVG,
  safeTopic,
} from "./engine.js";
import {
  migratePrintSettings,
  printBook,
  exportLibrary,
  validateImport,
  restoreLibraryImages,
  recommendedPrintLayout,
  OPENING_BOOKLET_NOTE,
} from "./output.js";
import {
  migrateWorldState,
  getActiveWorld,
  getCharacterSheet,
  markCharacterSheetConfirmed,
  captureBookGenerationSnapshot,
  getWorldBackgroundSnapshot,
} from "./image-generation/world.js";
import {
  getStylePreset,
  setCustomStylePresets,
} from "./image-generation/styles.js";
import {
  configureStyleStudioUI,
  cleanupStyleStudio,
  renderStyleStudioSettings,
} from "./style-studio.js";
import {
  configureWardrobeUI,
  cleanupWardrobeFlow,
  renderWardrobeCardActions,
  renderBookVariantSelectors,
  renderPageVariantRanges,
  syncWardrobeSelections,
  copyWardrobeSelections,
  validateWardrobeSelections,
  recommendWardrobe,
} from "./wardrobe.js";
import {
  configureAudioUI,
  cleanupAudioOperation,
  playback,
  stopPlayback,
  audioStatus,
  wordsWithOffsets,
  renderAudioPreparationControls,
  prepareBookAudio,
  estimateBookAudio,
} from "./audio-playback.js";
import {
  estimateBookCost,
  estimateImageCost,
  frozenImageConfig,
} from "./image-generation/models.js";
import {
  generateAllScenes,
  generateScene,
  generateCover,
} from "./image-generation/pipeline.js";
import { hydrateImageAssets, getImageURL } from "./image-generation/assets.js";
import {
  configureManagementUI,
  activeCharacters,
  activeBackgrounds,
} from "./management.js";
import { configurePhotoUI, cleanupPhotoFlow } from "./photo-materials.js";
import {
  PLACE_TYPE_CHOICES,
  readPlaceType,
  placeTypeCustomField,
  placeEmoji,
} from "./place-types.js";
import { configureCompanionUI, cleanupCompanionFlow } from "./companions.js";
import {
  unlockVault,
  resetVault,
  lockVault,
  setVaultPin,
  getCredential,
} from "./image-generation/vault.js";
import { normalizeReadingLevels } from "./reading-levels.js";
import {
  configureTextSettingsUI,
  renderTextSettings,
  renderTextEngineQuick,
  getTextGenerationSettings,
  newStoryTextEstimate,
} from "./text-generation/settings-ui.js";
import {
  configureStoryUI,
  startStoryWorkflow,
  cleanupStoryWorkflow,
  renderStoryDrafts,
  resumeStoryDraft,
  syncStoryDraft,
  renderStoryCoherence,
  fullAutoJobOfDraft,
} from "./story-generation/ui.js";
import { toLegacyPages, summarizeStory } from "./story-generation/pipeline.js";
import {
  heldPageCount,
  layoutFor,
  layoutOf,
  openingHeading,
  openingsSummary,
  printedPagesOf,
  pageCountOptions,
  snapPageCount,
  unitImageSize,
  unitLabel,
} from "./book-layout.js";
import { checkStory } from "./story-generation/checker.js";
import { checkRichness } from "./story-generation/richness.js";
import {
  configureBackgroundSheets,
  cleanupBackgroundSheets,
  renderBackgroundSheetActions,
} from "./background-sheets.js";
import {
  renderWorldVariations,
  configureWorldVariations,
  syncActiveWorldTextSettings,
} from "./world-variations.js";
import {
  applySeriesContinuity,
  bindSeriesBackgrounds,
} from "./story-generation/continuity.js";
import {
  estimateStoryTextCost,
  resolveStoryStageSettings,
  resolveQualityStageSettings,
  getTextModelInfo,
  freezeReviewTier,
} from "./text-generation/models.js";
import {
  configureReadingUI,
  renderFeedbackActions,
  renderReadingSuggestion,
  renderReadingSelectors,
  renderReadingSettings,
  renderReadingBadge,
  renderReadingCheck,
  readReadingSettings,
  migrateReadingSettings,
  cleanupReadingOperation,
  prepareLeveledBook,
  checkBookAtLevel,
} from "./reading-ui.js";
import {
  configureImageUI,
  renderImageSettings,
  renderImageEngineQuick,
  renderGenerationControls,
  renderCharacterImageControls,
  previewNewCharacter,
  cleanupImageUI,
} from "./image-generation/settings-ui.js";

if (typeof crypto !== "undefined" && !crypto.randomUUID) {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return (
      h.slice(0, 8) +
      "-" +
      h.slice(8, 12) +
      "-" +
      h.slice(12, 16) +
      "-" +
      h.slice(16, 20) +
      "-" +
      h.slice(20)
    );
  };
}
const groupBy = (list, keyOf) => {
  const groups = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
};
const KEY = "donghwa-workshop-v1";
const defaults = {
  style: "수채화 그림책풍",
  defaultLanguage: "dual",
  defaultPages: 12,
  defaultLayout: "single",
  dailyLimit: 3,
  rate: 0.85,
};
// R27: a library kept in the big store (IndexedDB) is read before anything else.
const bootLibrary = await readSpilledLibrary(localStorage, KEY);
const initialLibrary = readStoredLibrary(bootLibrary.storage, KEY, {
  validate: validateStoredLibrary,
  seed: seedState,
});
if (bootLibrary.error) {
  initialLibrary.kind = "blocked";
  initialLibrary.error = bootLibrary.error;
}
let state = initialLibrary.state,
  storageBlocked = initialLibrary.kind === "blocked",
  deviceTransferBusy = false,
  cloudSync = null,
  cloudStatus = { phase: "checking", busy: true, authenticated: false },
  applyingCloud = false,
  cloudPrivacyLocked = (() => {
    try {
      return !!JSON.parse(
        localStorage.getItem("donghwa-cloud-sync-v1") || "null",
      )?.accountId;
    } catch {
      return false;
    }
  })();
state.settings = { ...defaults, ...state.settings };
migratePrintSettings(state.settings);
migrateReadingSettings(state.settings);
state.daily = state.daily || {};
state.backgrounds = state.backgrounds || [];
state.settings.style =
  {
    watercolor: "수채화 그림책풍",
    crayon: "파스텔 크레용",
    flat: "플랫 일러스트",
    cartoon: "만화풍",
  }[state.settings.style] || state.settings.style;
const typedBackground = (b) => ({
  ...b,
  type:
    b.type ||
    {
      home: "home",
      forest: "forest",
      moon: "space",
      garden: "forest",
      beach: "sea",
    }[b.id] ||
    "forest",
});
state.backgrounds = state.backgrounds.map(typedBackground);
// The built-in samples as this load path normalizes them, for the cloud
// "nothing of the family's here yet" check. Built once, never mutated.
let sampleLibrary = null;
const onlySamples = () => {
  if (!sampleLibrary) {
    sampleLibrary = seedState();
    sampleLibrary.backgrounds = sampleLibrary.backgrounds.map(typedBackground);
  }
  return isSeedOnlyLibrary(state, sampleLibrary);
};
setCustomStylePresets(state);
migrateWorldState(state);
syncActiveWorldTextSettings(state, { load: true });
state.settings.style = getStylePreset(getActiveWorld(state).stylePresetId).name;
let view = "library",
  childMode = false,
  parentUnlocked = false,
  tab = "all",
  sort = "recent",
  query = "",
  activeBook = null;
let vaultSessionPin = null,
  finalizeController = null;
// R9: per-device screen mode ('simple' by default); never stored in state.
let uiMode = readUiMode(),
  lastProSettingsTab = "home";
let wizard = null,
  draft = null,
  editPage = 0,
  reader = null,
  studio = null,
  pinCallback = null,
  modalFocus = null,
  textSettingsReturn = null;
const root = document.querySelector("#app"),
  modalRoot = document.querySelector("#modal-root");
const paths = {
  book: "M3 5q5-2 9 1q4-3 9-1v15q-5-2-9 1q-4-3-9-1z M12 6v15",
  spark:
    "m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7z M21 2v4 M19 4h4",
  home: "m3 11 9-8 9 8 M5 10v11h14V10 M9 21v-8h6v8",
  heart:
    "M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6z",
  characters:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.8 M13 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0",
  plus: "M12 5v14 M5 12h14",
  settings:
    "M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  child:
    "M15 5a3 3 0 1 1-6 0a3 3 0 0 1 6 0 M5 10l7 3 7-3 M12 13v5 M8 22l4-4 4 4",
  arrow: "M5 12h14 m-5-5 5 5-5 5",
  chevron: "m9 5 7 7-7 7",
  back: "m14 5-7 7 7 7",
  calendar: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16",
  search: "M16 10a6 6 0 1 1-12 0a6 6 0 0 1 12 0 m-2 4 6 6",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  print: "M6 9V3h12v6 M6 17H3V9h18v8h-3 M6 14h12v7H6z M17 12h1",
  leaf: "M20 3C9 2 2 8 5 17s17 1 15-14 M5 20l11-12",
  check: "m5 12 4 4 10-10",
  close: "m6 6 12 12 M18 6 6 18",
  play: "m8 4 13 8-13 8z",
  pause: "M8 4v16 M16 4v16",
  headphones: "M3 14v-3a9 9 0 0 1 18 0v3 M3 13h4v8H3z M17 13h4v8h-4z",
  volume: "M3 9h4l5-4v14l-5-4H3z M16 8q5 4 0 8 M19 5q7 7 0 14",
  refresh: "M20 8a8 8 0 1 0 0 8 M20 3v5h-5",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  upload: "M12 16V3 m-5 5 5-5 5 5 M4 16v5h16v-5",
  globe:
    "M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0 M3 12h18 M12 3q-8 9 0 18q8-9 0-18",
  clock: "M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0 M12 7v5l3 2",
  edit: "m15 4 5 5-11 11-5 1 1-5z M13 6l5 5",
  trash: "M3 6h18 M6 6l1 15h10l1-15 M9 6V3h6v3",
  info: "M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0 M12 11v6 M12 7v1",
  folder: "M3 5h7l2 3h9v13H3z",
};
const icon = (name, extra = "") =>
  `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.book}"/></svg>`;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const btn = (label, action, kind = "outline", ic = "", data = "") =>
  `<button type="button" class="btn btn-${kind}" data-action="${action}" ${data}>${ic ? icon(ic) : ""}${label}</button>`;
const date = (v) =>
  new Date(v)
    .toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })
    .replace(/\.\s*$/, "");
const localDay = () => new Date().toLocaleDateString("en-CA");
const char = (id) =>
  state.characters.find((c) => c.id === id) || state.characters[0];
const bookById = (id) => state.books.find((b) => b.id === id);
const languageLabel = (l) =>
  ({ dual: "한·영", bilingual: "한영", ko: "한글", en: "영어" })[l] || "한·영";
const appearance = (c) => ({ ...c, color: c.color || "#efc954" });
// R27: when even the compressed library does not fit, it moves to the big
// store in the background; saves made meanwhile run the spill again with the
// latest state, so the pointer always ends on the newest library.
let spillRunning = false,
  spillWanted = false;
function queueSpill() {
  spillWanted = true;
  if (spillRunning) return;
  spillRunning = true;
  (async () => {
    try {
      while (spillWanted) {
        spillWanted = false;
        await spillStoredLibrary(localStorage, KEY, state, {
          invalidRecords: initialLibrary.invalidRecords || [],
        });
      }
      initialLibrary.kind = "ready";
    } catch (error) {
      toast(
        `책장이 이 기기의 저장 한도를 넘었고 큰 보관함에도 저장하지 못했어요. 지금 화면의 변경은 아직 저장되지 않았어요. 백업 후 오래된 작업 기록을 정리해 주세요. (${error?.message || error})`,
      );
    } finally {
      spillRunning = false;
    }
  })();
}
/** Cloud pull and file import: the same write, spilling when it does not fit. */
async function writeLibraryOrSpill(target) {
  try {
    writeStoredLibrary(localStorage, KEY, target);
  } catch (error) {
    if (error?.code !== "QUOTA") throw error;
    await spillStoredLibrary(localStorage, KEY, target);
  }
}
function save() {
  try {
    writeStoredLibrary(localStorage, KEY, state, {
      blocked: storageBlocked,
      invalidRecords: initialLibrary.invalidRecords || [],
    });
    if (spillRunning) spillWanted = true;
    initialLibrary.kind = "ready";
    if (!applyingCloud) cloudSync?.changed();
    return true;
  } catch (error) {
    if (error?.code === "QUOTA" && !storageBlocked) {
      queueSpill();
      if (!applyingCloud) cloudSync?.changed();
      return true;
    }
    toast(
      storageBlocked || error?.code === "QUOTA"
        ? error.message
        : "저장 공간이 부족하거나 저장 권한이 없어요. 백업 후 다시 시도해 주세요.",
    );
    return false;
  }
}
let toastTimer;
function openCredentialSettings(kind, engine) {
  const text = kind === "text";
  const link = document.querySelector(
    '[data-story-action="open-text-settings"]',
  );
  if (uiMode === "simple")
    protectedAction(() => {
      closeModal();
      rememberSimpleReturn();
      view = "settings";
      settingsTab = "simple";
      history.replaceState(null, "", "#settings=simple");
      render();
    });
  else if (text && link) link.click();
  else if (text) openStoryTextSettings(draft?.storyDraftId || null);
  else
    protectedAction(() => {
      closeModal();
      view = "settings";
      settingsTab = "image";
      history.replaceState(null, "", "#settings=image");
      render();
    });
  requestAnimationFrame(() => {
    const selector = document.querySelector(text ? "#tg-engine" : "#ig-engine");
    if (
      selector &&
      selector.value !== engine &&
      [...selector.options].some((option) => option.value === engine)
    ) {
      selector.value = engine;
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document
      .querySelector(text ? '[data-text-field="apiKey"]' : "#ig-api-key")
      ?.focus();
  });
}
function toast(message, { action } = {}) {
  if (message && typeof message === "object") {
    action ||= credentialToastAction(message, openCredentialSettings);
    message = message.message || "요청을 완료하지 못했어요.";
  }
  const t = document.querySelector("#toast");
  t.textContent = message;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.onclick = () => {
      t.classList.remove("visible");
      action.run();
    };
    t.append(button);
  }
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => t.classList.remove("visible"),
    action ? 6000 : 3800,
  );
}
function illustration(book, i = 0) {
  const pages = Array.isArray(book.pages) ? book.pages : [];
  if (!pages.length)
    return '<div class="image-missing">아직 그림이 없는 책이에요.</div>';
  const p = pages[Math.max(0, Math.min(i, pages.length - 1))];
  const url = p.imageAssetId
    ? getImageURL(p.imageAssetId)
    : p.imageUrl && !p.imageUrl.startsWith("asset:")
      ? p.imageUrl
      : null;
  if (p.imageAssetId && !url)
    return `<div class="asset-skeleton" data-image-asset="${esc(p.imageAssetId)}" role="status" aria-label="그림 불러오는 중"></div>`;
  if (url)
    return `<img class="generated-illustration" src="${esc(url)}" alt="${esc(book.title)} · ${i + 1}쪽 생성 그림">`;
  const cast = (book.characterIds || []).map((id) =>
    appearance(
      book.generationSnapshot?.characterSheets?.find(
        (sheet) => sheet.characterId === id,
      )?.characterSnapshot ||
        book.characterSnapshots?.find((c) => c.id === id) ||
        char(id),
    ),
  );
  return sceneSVG(
    p.scene,
    cast.length ? cast : [state.characters[0]],
    p.artVariant || 0,
  );
}
function cover(book) {
  const theme = book.theme || book.pages?.[0]?.scene?.theme || "default",
    coverUrl = book.cover?.imageAssetId
      ? getImageURL(book.cover.imageAssetId)
      : book.cover?.imageUrl;
  return `<div class="book-cover cover-${esc(theme)}"><div class="cover-art">${book.cover?.imageAssetId && !coverUrl ? `<div class="asset-skeleton" data-image-asset="${esc(book.cover.imageAssetId)}" role="status" aria-label="표지 불러오는 중"></div>` : coverUrl ? `<img class="generated-illustration" src="${esc(coverUrl)}" alt="${esc(book.title)} 표지">` : illustration(book, Math.min(2, (book.pages?.length || 1) - 1))}</div><div class="cover-kicker">우리 아이의 작은 모험 · ${esc(book.episode || 1)}번째 이야기</div><div class="cover-title">${esc(book.title)}<span class="cover-subtitle">${esc(book.titleEn || "A little story, a big adventure")}</span></div><div class="cover-footer">DONGHWA WORKSHOP</div></div>`;
}
function refreshHydratedImages() {
  document.querySelectorAll("[data-image-asset]").forEach((node) => {
    const url = getImageURL(node.dataset.imageAsset);
    if (url) {
      const img = document.createElement("img");
      img.className = "generated-illustration";
      img.src = url;
      img.alt = "보관된 이야기 그림";
      node.replaceWith(img);
    } else {
      node.classList.remove("asset-skeleton");
      node.classList.add("image-missing");
      node.textContent =
        "그림 원본을 찾을 수 없어요. 클라우드 또는 백업에서 복원해 주세요.";
    }
  });
}
function bookCard(book) {
  return `<article class="book-card">${!childMode ? `<button class="book-favorite ${book.favorite ? "is-favorite" : ""}" data-action="favorite" data-id="${esc(book.id)}" aria-label="${book.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}">${icon("heart")}</button>` : ""}<button class="book-cover-button" data-action="open-book" data-id="${esc(book.id)}" aria-label="${esc(book.title)} 열기" style="display:block;width:100%;padding:0">${cover(book)}</button><div class="book-info"><button class="book-name" data-action="${childMode ? "read-book" : "open-book"}" data-id="${esc(book.id)}">${childMode ? icon("play") + "읽어줘" : esc(book.title)}</button><p class="book-series">${esc(book.series)} · ${book.episode || 1}편</p>${!childMode ? renderReadingBadge(book, { compact: true }) : ""}${!childMode && (book.textDemo || (!book.prose && book.localSample)) ? '<span class="style-changed-badge">데모 이야기</span>' : ""}<div class="book-meta"><span class="lang-tag">${languageLabel(book.language)}</span><span>${layoutOf(book) === "openings" ? printedPagesOf(book) : book.pages?.length || 0}쪽</span><span>·</span><span>${date(book.createdAt)}</span></div></div></article>`;
}
function protectedAction(fn) {
  if (cloudPrivacyLocked) {
    showCloudPanel();
    return;
  }
  if (storageBlocked) {
    showDeviceTransfer();
    return;
  }
  if (parentUnlocked && !childMode) return fn();
  pinCallback = () => {
    childMode = false;
    parentUnlocked = true;
    fn();
  };
  openPin();
}
async function hashPin(pin) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pin),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function showModal(content, cls = "") {
  modalFocus = document.activeElement;
  modalRoot.innerHTML = `<div class="modal-overlay"><section class="modal sheet ${cls}" role="dialog" aria-modal="true" aria-label="${cls.includes("pin") ? "부모 PIN" : "대화상자"}"><div class="sheet-handle" aria-hidden="true"></div>${content}</section></div>`;
  if (initialHydrationDone) refreshHydratedImages();
  requestAnimationFrame(() =>
    modalRoot.querySelector("input,button,select")?.focus(),
  );
}
function closeModal() {
  document.dispatchEvent(new Event("donghwa:modal-closed"));
  const storyOpen = !!modalRoot.querySelector(".story-workspace");
  cleanupFullAuto(true);
  cleanupStoryWorkflow();
  cleanupBackgroundSheets();
  finalizeController?.abort();
  finalizeController = null;
  cleanupPhotoFlow();
  cleanupImageUI();
  cleanupCompanionFlow();
  cleanupReadingOperation();
  cleanupStyleStudio();
  cleanupWardrobeFlow();
  cleanupAudioOperation();
  if (reader) {
    stopSpeech();
    reader = null;
  }
  modalRoot.innerHTML = "";
  if (cloudSync?.getStatus().dirty)
    queueMicrotask(() => void cloudSync.refresh());
  modalFocus?.focus();
  pinCallback = null;
  if (storyOpen && view === "create") render();
}
function modalHeader(title) {
  return `<div class="modal-header"><h3>${title}</h3><button class="close-btn" data-action="close-modal" aria-label="닫기">${icon("close")}</button></div>`;
}
function openPin() {
  const setup = !state.settings.pinHash;
  showModal(
    `${icon("lock")}<h3>${setup ? "우리 가족의 부모 PIN" : "부모 모드로 들어가기"}</h3><p class="modal-intro">${setup ? "만들기와 설정을 보호할 숫자 4자리를 정해 주세요.<br>이 브라우저에 저장되며, 아이에게는 읽기만 열립니다." : "숫자 4자리를 입력하면 만들기와 설정이 열립니다."}</p><form id="pin-form"><label class="pin-field-label" for="pin">${setup ? "새 PIN · 숫자 4자리" : "부모 PIN"}</label><input class="pin-input" id="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" required autocomplete="off" aria-label="부모 PIN 4자리" placeholder="····">${setup ? '<label class="pin-field-label" for="pin-confirm">같은 PIN 한 번 더</label><input class="pin-input" id="pin-confirm" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" required autocomplete="off" aria-label="부모 PIN 확인" placeholder="····">' : ""}<p class="pin-error" id="pin-error"></p><button class="btn btn-green" type="submit">${setup ? "PIN 설정하고 시작" : "부모 모드 열기"}${icon("arrow")}</button></form><button class="btn btn-plain btn-small" data-action="close-modal">취소</button>`,
    "pin-modal",
  );
}
const cloudPhaseLabel = () =>
  ({
    checking: "클라우드 연결 확인 중",
    paused: "편집 중 · 클라우드 변경 대기",
    syncing: "클라우드 동기화 중",
    ready: cloudStatus.dirty ? "클라우드 저장 대기" : "클라우드 저장됨",
    choice: "클라우드에 자료 연결하기",
    conflict: "두 기기의 변경 사항 확인 필요",
    "account-changed": "로그인 계정 변경 확인",
    "signed-out": "클라우드로 PC·모바일 이어쓰기",
    unavailable: "클라우드 연결 대기",
    error:
      cloudStatus.reason === "quota"
        ? "가족 클라우드 공간이 가득 찼어요"
        : "클라우드 연결 확인 필요",
    stopped: "클라우드 연결 중지",
  })[cloudStatus.phase] || "클라우드 저장";
function cloudStatusSummary() {
  if (storageBlocked) return "기존 데이터 보호 중";
  return cloudStatus.connected
    ? cloudStatus.dirty
      ? cloudStatus.reason === "quota"
        ? "이 기기에 보관 · 클라우드 공간 가득 참"
        : "이 기기에 보관 · 클라우드 저장 대기"
      : "클라우드에 저장됨"
    : `이 기기에 보관 · ${cloudPhaseLabel()}`;
}
function storageChipContent() {
  const status = storageStatusView(cloudStatus, storageBlocked || cloudPrivacyLocked);
  return `<span aria-hidden="true">${status.state === "attention" ? "!" : status.state === "saved" ? "●" : "○"}</span><span>${esc(status.label)}</span>${status.time ? `<span class="storage-chip-time">${esc(status.time)}</span>` : ""}`;
}
function renderStatusStrip() {
  if (childMode) return "";
  const exceptional =
    storageBlocked ||
    ["conflict", "account-changed"].includes(cloudStatus.phase);
  if (
    !exceptional &&
    !(
      view === "library" &&
      (!cloudStatus.authenticated ||
        ["error", "unavailable"].includes(cloudStatus.phase))
    )
  )
    return "";
  // R24: the ordinary library case (signed out, or the cloud unreachable) is
  // one strip; conflicts, account changes and blocked storage keep the cards.
  if (!exceptional) return `<div id="cloud-status-slot">${libraryStorageStrip()}</div>`;
  return `<div id="cloud-status-slot">${cloudStatusCard()}</div>${storageBlocked || view === "library" ? deviceStorageNotice() : ""}`;
}
function libraryStorageStrip() {
  if (childMode) return "";
  const c = cloudStatus,
    note = c.authenticated
      ? `${cloudPhaseLabel()}${c.error ? " · " + c.error : ""}`
      : c.reason === "family-session-expired"
        ? signedOutNote(c)
        : "이 기기에 보관 중 · 로그인하면 다른 기기와 이어져요";
  return `<aside class="library-storage-strip" role="status"><span>${esc(note)}</span><span class="library-storage-actions">${c.authenticated ? btn("클라우드 관리", "cloud-open", "outline", "settings") : `<button type="button" class="btn btn-green btn-small" data-action="family-login">가족 아이디로 로그인</button><button type="button" class="btn btn-plain btn-small" data-action="cloud-open">다른 로그인</button>`}<button type="button" class="btn btn-plain btn-small" data-action="device-transfer">기기 이동 · 복구</button></span></aside>`;
}
function cloudStatusCard() {
  if (childMode) return "";
  const c = cloudStatus,
    user =
      c.user?.kind === "family"
        ? accountLine(c.user)
        : c.user?.displayName || c.user?.email || "";
  return `<aside class="cloud-status-card ${c.phase === "conflict" ? "cloud-conflict" : ""}" role="status"><div><strong>${esc(cloudPhaseLabel())}</strong><p>${c.authenticated ? `${esc(user)} · ${c.updatedAt ? "마지막 저장 " + esc(new Date(c.updatedAt).toLocaleString("ko-KR")) : "계정별 비공개 책장"}` : esc(signedOutNote(c))}${c.error ? "<br>" + esc(c.error) : ""}</p></div>${c.authenticated ? (c.user?.kind === "family" ? `<div class="family-signin-buttons">${btn("클라우드 관리", "cloud-open", "outline", "settings")}<button type="button" class="btn btn-outline" data-action="family-logout">로그아웃</button></div>` : btn("클라우드 관리", "cloud-open", "outline", "settings")) : renderSignedOutChoices(c)}</aside>`;
}
function updateCloudStatus(next) {
  const before = cloudPrivacyLocked;
  if (next.phase === "account-changed") cloudPrivacyLocked = true;
  else if (next.phase === "signed-out") {
    try {
      cloudPrivacyLocked = !!JSON.parse(
        localStorage.getItem("donghwa-cloud-sync-v1") || "null",
      )?.accountId;
    } catch {}
  } else if (
    next.authenticated &&
    (["ready", "choice", "paused"].includes(next.phase) ||
      (next.phase === "syncing" && next.connected))
  )
    cloudPrivacyLocked = false;
  cloudStatus = next;
  if (before !== cloudPrivacyLocked) {
    if (cloudPrivacyLocked) {
      cleanupFullAuto();
      cleanupStoryQualityUI();
      clearDirectBlobCache();
      lockVault();
      vaultSessionPin = null;
      settingsValues.clear();
      settingsDirty.clear();
      settingsDirtyPanels.clear();
      parentUnlocked = false;
      textSettingsReturn = null;
      // An in-page unlock (a family login from the lock panel or another tab)
      // then shows the library, as the child-mode switch does, never a parent
      // screen with parent mode off. The wizard stays with its job.
      view = "library";
      activeBook = null;
      closeModal();
    }
    render();
  }
  const slot = document.querySelector("#status-strip");
  if (slot) slot.innerHTML = renderStatusStrip();
  const chip = document.querySelector(".status-chip");
  if (chip) {
    chip.innerHTML = storageChipContent();
    chip.dataset.storageState = storageStatusView(cloudStatus, storageBlocked || cloudPrivacyLocked).state;
    chip.setAttribute("aria-label", cloudStatusSummary() + " · 보관 관리 열기");
    chip.title = cloudStatusSummary();
  }
  const panel = document.querySelector("#cloud-panel-status");
  if (panel)
    panel.textContent =
      cloudPhaseLabel() + (next.error ? " · " + next.error : "");
  const accountRow = document.querySelector("#simple-account-row");
  if (accountRow) accountRow.outerHTML = renderSimpleAccountRow(next);
}
/** Parent mode for account changes, except on a locked device whose library is already hidden. */
function accountAction(fn) {
  if (cloudPrivacyLocked || (parentUnlocked && !childMode)) return fn();
  pinCallback = () => {
    childMode = false;
    parentUnlocked = true;
    fn();
  };
  openPin();
}
/**
 * Locked device escape: after this device's parent PIN (the usual PIN form),
 * forget the cloud baseline and keep using the books stored here.
 */
function continueLocalOnlyWithPin() {
  if (!cloudSync) return;
  if (!state.settings.pinHash) {
    toast(
      "이 기기에는 부모 PIN이 없어서 이 방법을 쓸 수 없어요. 이전 계정으로 다시 로그인해 주세요.",
    );
    return;
  }
  pinCallback = async () => {
    const result = await cloudSync.continueLocalOnly();
    if (!result.ok) {
      // The PIN opened parent mode only for this step.
      lockVault();
      vaultSessionPin = null;
      parentUnlocked = false;
      render();
      toast(result.message);
      return;
    }
    toast("클라우드와 연결을 끊었어요. 이 기기의 책을 그대로 써요.");
  };
  openPin();
}
function showCloudPanel() {
  const c = cloudStatus,
    local = backupSummary(state),
    remote = c.remoteSummary || {},
    escape = cloudPrivacyLocked ? renderLocalOnlyEscape() : "";
  showModal(
    `${modalHeader("클라우드 저장 · 기기 동기화")}<p id="cloud-panel-status" class="modal-intro" role="status">${esc(cloudPhaseLabel())}${c.error ? " · " + esc(c.error) : ""}</p>${c.authenticated ? `<p class="small-label">${esc(accountLine(c.user))}<br>이 계정의 자료만 서버에서 읽고 저장합니다.</p><div class="cloud-library-compare"><div><strong>이 기기</strong><p>책 ${local.bookCount}권 · 캐릭터 ${local.characterCount}명 · 배경 ${local.backgroundCount}곳</p></div><div><strong>클라우드</strong><p>${c.remoteExists ? `책 ${remote.bookCount || 0}권 · 캐릭터 ${remote.characterCount || 0}명 · 배경 ${remote.backgroundCount || 0}곳` : "아직 저장된 자료가 없어요."}</p></div></div><div class="notice">처음 한 번 연결하면 이후 변경 사항을 자동 저장합니다. PC와 모바일은 같은 가족 아이디나 ChatGPT 계정으로 로그인해 주세요. 두 기기에서 동시에 수정한 경우 자료를 덮어쓰지 않고 선택을 기다립니다. API 키·부모 PIN은 기기에 유지합니다.</div><div class="modal-actions">${btn("연결 새로 확인", "cloud-refresh", "outline", "refresh")}<button type="button" class="btn btn-outline" data-action="cloud-pull" ${!c.remoteExists || c.busy ? "disabled" : ""}>클라우드 자료 불러오기</button><button type="button" class="btn btn-primary" data-action="cloud-push" ${c.busy || c.phase === "account-changed" || storageBlocked ? "disabled" : ""}>이 기기 자료 클라우드에 저장</button></div><p class="small-label">${c.phase === "account-changed" ? "이 기기는 다른 계정의 자료를 보관하고 있어요. 현재 계정의 클라우드 자료를 먼저 불러오거나 이전 계정으로 로그인해 주세요." : "불러오기 전 현재 자료는 복구용 보관함에 남깁니다."}</p>${escape}${renderCloudAccountControls(c)}` : `<p class="modal-intro">${c.reason === "family-session-expired" ? esc(signedOutNote(c)) + "<br>" : ""}로그인하면 이 계정의 책장과 재료를 클라우드에 보관합니다. 가족 아이디나 ChatGPT 계정 중 하나로 로그인해 주세요. 처음에는 기존 자료가 있는 기기에서 로그인하고 올려 주세요.</p>${renderSignedOutChoices(c)}${escape}`}`,
    "wide cloud-panel",
  );
}
function confirmCloudChange(kind) {
  if (kind === "pull" && draft && (view === "edit" || simpleDraftOpen())) {
    // Leave the editor or the simple step first: cancelling the pull confirm
    // then shows the live library, never a screen whose wizard is gone.
    discardDraft(() => {
      view = "library";
      activeBook = null;
      render();
      confirmCloudChange(kind);
    });
    return;
  }
  const c = cloudStatus,
    local = backupSummary(state),
    remote = c.remoteSummary || {},
    // A device with fewer books than the cloud would shrink the family shelf.
    shrink =
      kind === "push" && c.remoteExists
        ? pushBookCountWarning(local.bookCount, remote.bookCount)
        : "";
  showModal(
    `${modalHeader(kind === "push" ? "클라우드에 저장할 자료 확인" : "이 기기로 불러올 자료 확인")}<p class="modal-intro">${kind === "push" ? `이 기기의 책 ${local.bookCount}권·캐릭터 ${local.characterCount}명·배경 ${local.backgroundCount}곳을 로그인한 계정에 저장합니다.` : `클라우드의 책 ${remote.bookCount || 0}권·캐릭터 ${remote.characterCount || 0}명·배경 ${remote.backgroundCount || 0}곳을 이 기기로 불러옵니다.`}</p>${shrink ? '<div class="notice cloud-conflict" role="alert">' : '<div class="notice">'}${shrink ? `<strong>${esc(shrink)}</strong><br>클라우드의 최신 변경을 먼저 확인해 주세요.` : kind === "push" && c.remoteExists ? "현재 클라우드 자료가 이 기기의 내용으로 바뀝니다. 클라우드의 최신 변경을 먼저 확인해 주세요." : kind === "pull" ? "현재 이 기기의 자료는 복구용 보관함에 남긴 뒤 클라우드 내용으로 바뀝니다." : "재료·책·그림·음원을 이 계정의 저장소에 보관합니다."}</div><p id="cloud-action-error" class="text-error"></p><div class="modal-actions">${btn("취소", "close-modal", "outline")}<button type="button" class="btn btn-primary" id="cloud-action-confirm">${kind === "push" ? "이 내용으로 클라우드 저장" : "보관본을 남기고 불러오기"}</button></div>`,
    "cloud-confirm",
  );
  document.querySelector("#cloud-action-confirm").onclick = async () => {
    const button = document.querySelector("#cloud-action-confirm"),
      field = document.querySelector("#cloud-action-error");
    button.disabled = true;
    try {
      if (kind === "pull") {
        if (draft) {
          syncDraft();
          if (draft.storyDraftId) syncStoryDraft(draft, state);
        }
        wizard = null;
        draft = null;
        reader = null;
        view = "library";
      }
      await (kind === "push"
        ? cloudSync.push({ force: true })
        : cloudSync.pull());
      closeModal();
      render();
      toast(
        kind === "push"
          ? "클라우드에 저장했어요. 다른 기기에서도 같은 가족 아이디나 ChatGPT 계정으로 로그인해 주세요."
          : "클라우드 자료를 불러왔어요.",
      );
    } catch (error) {
      if (field.isConnected) field.textContent = error.message;
      if (button.isConnected) button.disabled = false;
    }
  };
}
async function applyCloudLibrary(candidate, meta) {
  const prior = state,
    blocked = storageBlocked,
    raw = localStorage.getItem(KEY);
  let recovery = null,
    incomingApplied = false;
  applyingCloud = true;
  const ensureUnchanged = () => {
    if (state !== prior || localStorage.getItem(KEY) !== raw)
      throw new Error(
        "불러오는 동안 이 기기의 자료가 바뀌었어요. 최신 수정을 유지했으니 다시 확인해 주세요.",
      );
  };
  try {
    if (meta.signal?.aborted)
      throw new DOMException("불러오기를 중지했어요.", "AbortError");
    if (raw) {
      recovery = await libraryTextOf(raw);
      await keepRecoveryPoint(recovery, {
        reason: "before-cloud-pull",
        mediaDeferred: true,
      });
    }
    if (meta.signal?.aborted)
      throw new DOMException("불러오기를 중지했어요.", "AbortError");
    ensureUnchanged();
    await restoreLibraryImages(candidate);
    ensureUnchanged();
    incomingApplied = true;
    state = {
      ...candidate,
      settings: {
        ...defaults,
        ...candidate.settings,
        pinHash: prior.settings.pinHash,
      },
      daily: candidate.daily || {},
    };
    setCustomStylePresets(state);
    migrateWorldState(state);
    syncActiveWorldTextSettings(state, { load: true });
    migratePrintSettings(state.settings);
    migrateReadingSettings(state.settings);
    await writeLibraryOrSpill(state);
    storageBlocked = false;
    clearDirectBlobCache();
    initialLibrary.invalidRecords = [];
    initialLibrary.kind = "ready";
    wizard = null;
    draft = null;
    view = "library";
    activeBook = null;
    render();
    return true;
  } catch (error) {
    if (incomingApplied) {
      state = prior;
      storageBlocked = blocked;
      setCustomStylePresets(state);
    }
    if (recovery && !blocked) {
      try {
        const old = validateImport(decodeStoredLibrary(recovery), { allowStoredAssets: true });
        await restoreLibraryImages(old);
      } catch {}
    }
    throw error;
  } finally {
    applyingCloud = false;
  }
}
function deviceStorageNotice() {
  if (childMode) return "";
  return `<aside class="device-storage-notice ${storageBlocked ? "storage-error" : ""}"><div><strong>${storageBlocked ? "기존 데이터 보호 중" : "이 기기의 보관본과 파일 이동"}</strong><p>${storageBlocked ? "저장된 데이터를 읽지 못해 원본 덮어쓰기를 막았습니다. 아래에서 원본을 보관하거나 백업을 가져와 주세요." : "클라우드 로그인 전 자료와 파일 백업도 이 기기에 보관됩니다. 다른 기기의 이전 자료는 클라우드에 올리거나 파일로 가져올 수 있어요."}</p></div>${btn("기기 이동 · 복구", "device-transfer", "outline", "upload")}</aside>`;
}
function showDeviceTransfer() {
  const summary = backupSummary(state);
  showModal(
    `${modalHeader("다른 기기에서 이어쓰기")}<p class="modal-intro">가족 아이디나 ChatGPT 계정으로 로그인하면 같은 계정의 기기 동기화를 사용할 수 있습니다. 여기서는 별도로 파일을 내보내거나 가져옵니다. 파일 이동은 서버에 업로드하지 않아요.</p>${storageBlocked ? `<div class="notice">기존 원본을 보호 중입니다. 샘플 재료가 보여도 기존 데이터에 덮어쓰지 않습니다.<p>${esc(initialLibrary.error || "저장 데이터 읽기 실패")}</p>${initialLibrary.raw ? btn("읽지 못한 원본 파일 보관", "download-original", "outline", "download") : ""}</div>` : `<p class="small-label">이 기기: 캐릭터 ${summary.characterCount}명 · 배경 ${summary.backgroundCount}곳 · 책 ${summary.bookCount}권 · World ${summary.worldCount}개</p><button type="button" class="btn btn-green" data-action="transfer-export">그림·재료 포함 이동용 JSON 저장</button>`}<ol class="device-transfer-steps"><li>원래 기기에서 ‘이동용 JSON 저장’을 눌러 주세요.</li><li>저장한 파일을 모바일로 보내 주세요.</li><li>아래에서 JSON 또는 기존 ZIP을 선택하고 내용을 확인한 뒤 가져오세요.</li></ol><label class="btn btn-primary device-file-label" for="device-transfer-file">이 기기로 백업 파일 가져오기</label><input id="device-transfer-file" type="file" accept="application/json,application/zip,.json,.zip" hidden><p id="device-transfer-status" class="small-label" role="status"></p><p class="small-label">캐릭터·배경·확정 시트·책·그림·음원·World·초안을 함께 옮깁니다. API 키와 PIN은 파일에 넣지 않으며 이 기기의 기존 키·PIN은 유지됩니다.</p><button type="button" class="btn btn-outline" data-action="download-recovery">가져오기 전 복구용 보관본 내려받기</button>`,
    "wide",
  );
}
async function showLibraryImport(file) {
  if (!storageBlocked && !parentUnlocked)
    return protectedAction(() => showLibraryImport(file));
  try {
    const imported = await readLibraryBackupFile(file),
      summary = backupSummary(imported);
    showModal(
      `${modalHeader("가져올 자료 확인")}<p class="modal-intro">${esc(file.name)}<br>캐릭터 ${summary.characterCount}명 · 배경 ${summary.backgroundCount}곳 · 책 ${summary.bookCount}권 · World ${summary.worldCount}개 · 초안 ${summary.draftCount}개</p><div class="notice">파일을 가져오면 이 기기의 현재 라이브러리를 파일 내용으로 바꿉니다. 먼저 현재 자료를 복구용 보관함에 남깁니다. 이 기기의 부모 PIN과 API 키는 유지해요.</div><p id="restore-error" class="text-error" role="status"></p><div class="modal-actions">${btn("취소", "close-modal", "outline")}<button type="button" class="btn btn-primary" id="restore-confirm">보관본을 만들고 가져오기</button></div>`,
    );
    document.querySelector("#restore-confirm").onclick = async () => {
      if (deviceTransferBusy) return;
      deviceTransferBusy = true;
      const button = document.querySelector("#restore-confirm"),
        field = document.querySelector("#restore-error");
      button.disabled = true;
      const previousState = state,
        previousBlocked = storageBlocked;
      let recoveryText = null;
      try {
        field.textContent = "현재 자료를 복구용 보관함에 남기고 있어요.";
        const raw = localStorage.getItem(KEY);
        if (raw) {
          recoveryText = await libraryTextOf(raw);
          await keepRecoveryPoint(recoveryText, {
            mediaDeferred: true,
            reason: storageBlocked
              ? "unreadable-original"
              : "before-device-import",
          });
        }
        field.textContent = "그림·시트와 자료를 가져오고 있어요.";
        const candidate = await readLibraryBackupFile(file);
        await restoreLibraryImages(candidate);
        state = {
          ...candidate,
          settings: {
            ...defaults,
            ...candidate.settings,
            pinHash: previousState.settings.pinHash,
          },
          daily: candidate.daily || {},
        };
        setCustomStylePresets(state);
        migrateWorldState(state);
        syncActiveWorldTextSettings(state, { load: true });
        migratePrintSettings(state.settings);
        migrateReadingSettings(state.settings);
        await writeLibraryOrSpill(state);
        storageBlocked = false;
        clearDirectBlobCache();
        initialLibrary.invalidRecords = [];
        initialLibrary.kind = "ready";
        closeModal();
        view = "library";
        tab = "all";
        query = "";
        wizard = null;
        draft = null;
        render();
        toast("이 기기로 책과 재료를 가져왔어요.");
      } catch (error) {
        state = previousState;
        storageBlocked = previousBlocked;
        setCustomStylePresets(state);
        if (recoveryText && !previousBlocked) {
          try {
            const rollback = validateImport(decodeStoredLibrary(recoveryText), {
              allowStoredAssets: true,
            });
            await restoreLibraryImages(rollback);
          } catch {}
        }
        if (field.isConnected)
          field.textContent = error.message + " 기존 자료는 유지됩니다.";
      } finally {
        deviceTransferBusy = false;
        if (button.isConnected) button.disabled = false;
      }
    };
  } catch (error) {
    toast(error);
  }
}
let checksTab = "reading";
let initialHydrationDone = false;
let lastRenderedView = null;
let settingsTab =
  new URLSearchParams(location.hash.replace(/^#/, "")).get("settings") ||
  "home";
if (!["home", "text", "image"].includes(settingsTab)) settingsTab = "home";
if (uiMode === "simple") {
  lastProSettingsTab = settingsTab;
  settingsTab = "simple";
}
let settingsSaving = false;
const settingsDirty = new Set();
const settingsValues = new Map();
const settingsDirtyPanels = new Map();
let restoringSettings = false;
function render() {
  if (settingsSaving) return;
  const active = document.activeElement;
  const focus =
    lastRenderedView === view &&
    root.contains(active) &&
    active.id &&
    /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)
      ? {
          id: active.id,
          value: active.value,
          checked: active.checked,
          start: active.selectionStart,
          end: active.selectionEnd,
        }
      : null;
  document.body.classList.toggle("child-mode", childMode);
  setCustomStylePresets(state);
  migrateWorldState(state);
  const nav = (id, label, ic) =>
    `<button class="nav ${view === id ? "active" : ""} ${id === "create" ? "create-nav" : ""}" data-action="nav" data-view="${id}">${icon(ic)}<span>${label}</span>${!parentUnlocked && id !== "library" ? icon("lock", "lock") : ""}</button>`;
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><svg class="brand-mark" viewBox="0 0 40 44" aria-hidden="true"><path d="M4 16q9-4 16 1q7-5 16-1v23q-9-4-16 1q-7-5-16-1z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M20 18v22 M20 9q5-7 13-5q-2 10-13 9 M20 14l8-7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><div><h1>동화공방</h1><small>DONGHWA WORKSHOP</small></div></div><div class="family"><div class="family-avatar">${!cloudPrivacyLocked && state.characters[0] ? characterSVG(state.characters[0]) : ""}</div><div><strong>${cloudPrivacyLocked ? "개인 클라우드 책장" : esc(state.characters[0]?.name || "우리 아이") + "네 이야기 공방"}</strong><small>작은 이야기가 자라는 곳</small></div></div><nav><div class="nav-group">우리 가족의 공간</div>${nav("library", "우리 책장", "book")}${!childMode ? nav("materials", "이야기 재료", "characters") + nav("create", "이야기 만들기", "spark") : ""}${childMode ? `<button class="nav ${tab === "favorites" ? "active" : ""}" data-action="child-favorites">${icon("heart")}<span>좋아하는 책</span></button>` : ""}${!childMode ? `<div class="nav-group" style="margin-top:29px">공방 관리</div>${nav("settings", "부모 설정", "settings")}` : ""}</nav><div class="sidebar-bottom"><div class="sidebar-note">${icon("leaf")}화면보다 종이로,<br>우리 아이의 속도로 읽어요.</div><div class="sidebar-footer"><span>작은 이야기, 큰 상상</span><span>v0.1</span></div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">${icon("home")}<span>우리 가족의 공간</span>${icon("chevron")}<span>${{ library: "우리 책장", materials: "이야기 재료", create: "이야기 만들기", settings: "부모 설정", detail: "책 이야기", edit: "이야기 다듬기" }[view] || "우리 책장"}</span></div><div class="mobile-brand">${icon("book")}동화공방</div><div class="top-actions"><button class="status-chip" data-storage-state="${storageStatusView(cloudStatus, storageBlocked || cloudPrivacyLocked).state}" data-action="cloud-open" aria-label="${esc(cloudStatusSummary())} · 보관 관리 열기" title="${esc(cloudStatusSummary())}">${storageChipContent()}</button>${!childMode ? uiModeButton("mode-btn ui-mode-btn") : ""}<button class="mode-btn" data-action="toggle-mode">${icon(childMode ? "lock" : "child")}${childMode ? "부모 모드" : "아이 모드"}</button><div class="top-avatar">부모</div></div></header><div id="page-content"><div id="status-strip" class="status-strip">${renderStatusStrip()}</div>${pageContent()}</div><footer class="page-footer"><span>${icon("leaf")}우리 가족만의 이야기가, 아이의 세상을 넓혀요.</span><span>글·그림 엔진 별도 선택 · 로그인하면 계정별 클라우드 저장</span></footer></main></div>`;
  if (view === "settings" && !childMode && !cloudPrivacyLocked)
    renderSettingsJump();
  if (view === "settings") restoreSettingsInputs();
  if (focus) {
    const field = document.getElementById(focus.id);
    if (field) {
      field.value = focus.value;
      if (field.type === "checkbox") field.checked = focus.checked;
      field.focus({ preventScroll: true });
      if (field.setSelectionRange && focus.start !== null)
        try {
          field.setSelectionRange(focus.start, focus.end);
        } catch {}
    }
  }
  lastRenderedView = view;
  if (initialHydrationDone) refreshHydratedImages();
  if (cloudSync?.getStatus().phase === "paused")
    queueMicrotask(() => void cloudSync.refresh());
}
function settingsFieldSelector(field) {
  if (field.id) return "#" + CSS.escape(field.id);
  const form = field.closest("form[id]");
  const provider = field.closest("[data-text-provider]");
  const attributes = [...field.attributes]
    .filter((attr) => attr.name.startsWith("data-") || attr.name === "name")
    .map((attr) => `[${attr.name}="${CSS.escape(attr.value)}"]`)
    .join("");
  if (!attributes) return null;
  return (
    (form ? "#" + CSS.escape(form.id) + " " : "") +
    (provider
      ? `[data-text-provider="${CSS.escape(provider.dataset.textProvider)}"] `
      : "") +
    field.tagName.toLowerCase() +
    attributes +
    (field.type === "checkbox" || field.type === "radio"
      ? `[value="${CSS.escape(field.value)}"]`
      : "")
  );
}
const settingsFormIds = new Set([
  "settings-form",
  "text-engine-form",
  "story-quality-form",
  "ig-world-form",
]);
function isTrackedSettingsField(field) {
  return (
    settingsFormIds.has(field.closest("form")?.id) &&
    !field.closest('[data-settings-form="own"]')
  );
}
function snapshotSettingsInputs(tab = settingsTab) {
  if (view !== "settings" || tab !== settingsTab) return;
  const values = new Map();
  document
    .querySelectorAll(
      ".settings-tab-content input,.settings-tab-content select,.settings-tab-content textarea",
    )
    .forEach((field) => {
      if (!isTrackedSettingsField(field) && field.id !== "sr-lexile") return;
      const selector = settingsFieldSelector(field);
      if (selector && !["password", "file"].includes(field.type))
        values.set(selector, { value: field.value, checked: field.checked });
    });
  settingsValues.set(tab, values);
}
function restoreSettingsInputs() {
  const values = settingsValues.get(settingsTab);
  restoringSettings = true;
  try {
    if (values) {
      const order = (selector) =>
        /^(#tg-engine|#tg-final-engine|#ig-engine|#tg-hybrid)$/.test(selector)
          ? 0
          : selector.includes("data-quality-role-engine")
            ? 1
            : 2;
      for (const [selector, saved] of [...values].sort(
        (a, b) => order(a[0]) - order(b[0]),
      )) {
        const field = document.querySelector(selector);
        if (!field) continue;
        const changed =
          field.value !== saved.value ||
          ((field.type === "checkbox" || field.type === "radio") &&
            field.checked !== saved.checked);
        field.value = saved.value;
        if (field.type === "checkbox" || field.type === "radio")
          field.checked = saved.checked;
        if (changed && order(selector) < 2)
          field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  } finally {
    restoringSettings = false;
  }
  for (const id of settingsDirtyPanels.get(settingsTab) || []) {
    const panel = document.getElementById(id);
    if (panel && !panel.querySelector(":scope>.panel-dirty")) {
      const dot = document.createElement("small");
      dot.className = "panel-dirty";
      dot.textContent = "저장 안 됨";
      panel.prepend(dot);
    }
  }
}
function rememberSettingsInputs(event) {
  if (
    restoringSettings ||
    view !== "settings" ||
    !event.target.closest(".settings-tab-content") ||
    !/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) ||
    !isTrackedSettingsField(event.target)
  )
    return;
  const tab = settingsTab;
  settingsDirty.add(tab);
  const panel = event.target.closest(".panel");
  if (panel) {
    const panels = settingsDirtyPanels.get(tab) || new Set();
    panels.add(panel.id);
    settingsDirtyPanels.set(tab, panels);
    if (!panel.querySelector(":scope>.panel-dirty")) {
      const dot = document.createElement("small");
      dot.className = "panel-dirty";
      dot.textContent = "저장 안 됨";
      panel.prepend(dot);
    }
  }
  queueMicrotask(() => {
    if (!restoringSettings) snapshotSettingsInputs(tab);
  });
  document
    .querySelector('.settings-tabs [aria-selected="true"] .settings-dirty-dot')
    ?.removeAttribute("hidden");
  const status = document.getElementById("settings-save-status");
  if (status) status.textContent = "저장하지 않은 변경이 있어요.";
}
document.addEventListener("input", rememberSettingsInputs);
document.addEventListener("change", rememberSettingsInputs);
async function saveSettingsTab() {
  if (settingsSaving) return;
  const forms = [
    ...document.querySelectorAll(".settings-tab-content form"),
  ].filter((form) =>
    [
      "settings-form",
      "text-engine-form",
      "story-quality-form",
      "ig-world-form",
    ].includes(form.id),
  );
  for (const form of forms) if (!form.reportValidity()) return;
  settingsSaving = true;
  const button = document.querySelector('[data-action="save-settings-tab"]');
  if (button) button.disabled = true;
  try {
    for (const form of forms) {
      form
        .querySelectorAll(".pin-error,.story-error")
        .forEach((field) => (field.textContent = ""));
      const event = new Event("submit", { bubbles: true, cancelable: true });
      form.dispatchEvent(event);
      const result = await event.settingsCompletion;
      if (
        result === false ||
        event.settingsFailed ||
        [...form.querySelectorAll(".pin-error,.story-error")].some((field) =>
          field.textContent.trim(),
        )
      )
        throw new Error(
          "입력 항목과 오류 안내를 확인한 뒤 다시 저장해 주세요.",
        );
    }
    settingsDirty.delete(settingsTab);
    settingsValues.delete(settingsTab);
    settingsDirtyPanels.delete(settingsTab);
    settingsSaving = false;
    render();
    toast(
      settingsTab === "simple"
        ? "설정을 모두 저장했어요."
        : "현재 탭의 설정을 모두 저장했어요.",
    );
  } catch (error) {
    toast(error);
  } finally {
    settingsSaving = false;
    if (button?.isConnected) button.disabled = false;
  }
}
window.addEventListener("hashchange", () => {
  const tab = new URLSearchParams(location.hash.replace(/^#/, "")).get(
    "settings",
  );
  // The simple settings page is one page; its tabs exist only in pro mode.
  if (
    uiMode !== "simple" &&
    ["home", "text", "image"].includes(tab) &&
    tab !== settingsTab
  ) {
    settingsTab = tab;
    if (view === "settings") render();
  }
});
function renderSettingsJump() {
  const content = document.querySelector("#page-content");
  if (!content) return;
  const headings = [
    ...content.querySelectorAll(
      ".panel>h3:first-child, .panel>form>h3:first-child, section.panel>div>h3:first-child",
    ),
  ].filter((h) => h.textContent.trim());
  if (!headings.length) return;
  const links = headings.map((h, i) => {
    const section = h.closest("section.panel") || h;
    const id =
      section.id ||
      (section.classList.contains("reading-settings")
        ? "settings-reading"
        : `settings-${settingsTab}-${i + 1}`);
    section.id = id;
    section.classList.add("settings-anchor");
    h.classList.add("settings-anchor");
    const label = h.textContent.replace(/\s+/g, " ").trim().slice(0, 22);
    return `<a href="#settings=${settingsTab}" data-action="settings-jump" data-target="${id}">${esc(label)}</a>`;
  });
  const nav = document.createElement("nav");
  nav.className = "settings-jump";
  nav.setAttribute("aria-label", "설정 항목 바로가기");
  nav.innerHTML = links.join("");
  const heading =
    content.querySelector(".settings-tabs") ||
    content.querySelector(".simple-mode-bar");
  (heading || content).insertAdjacentElement(
    heading ? "afterend" : "afterbegin",
    nav,
  );
}
function heading(title, sub, action = "") {
  return `<div class="page-heading"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>`;
}
/** Simple create is shown in simple mode, or for one job opened from a pro job card. */
function simpleCreateActive() {
  return uiMode === "simple" || wizard?.simpleForced === true;
}
/**
 * A book under review in the simple steps (kept in the job; the guards still
 * ask): on ④/⑤, or on ①–③ of the same story the parent went back to.
 */
function simpleDraftOpen() {
  return (
    view === "create" &&
    simpleCreateActive() &&
    !!draft &&
    (Number(wizard?.simpleStep) >= 4 || !!wizard?.simpleJobId)
  );
}
function uiModeButton(cls = "btn btn-outline btn-small") {
  return `<button type="button" class="${cls}" data-action="toggle-ui-mode" aria-pressed="${uiMode === "pro"}" aria-label="${uiMode === "pro" ? "쉬운 모드로 바꾸기" : "프로 모드로 바꾸기"}" title="${uiMode === "pro" ? "쉬운 만들기 화면으로 바꿔요" : "모든 세부 설정이 있는 프로페셔널 모드로 바꿔요"}"><span class="ui-mode-long">${uiMode === "pro" ? "쉬운 모드로" : "프로 모드로"}</span><span class="ui-mode-short">${uiMode === "pro" ? "쉬운" : "프로"}</span></button>`;
}
function uiModeBar() {
  return `<div class="simple-mode-bar"><span><strong>${uiMode === "pro" ? "프로페셔널 모드" : "쉬운 모드"}</strong> · ${uiMode === "pro" ? "모든 세부 설정을 보여요." : "자주 쓰는 설정만 보여요. 세부 설정은 프로페셔널 모드에 그대로 있어요."}</span>${uiModeButton()}</div>`;
}
function rememberSimpleReturn() {
  if (view === "create" && wizard && !textSettingsReturn)
    textSettingsReturn = {
      draftId: null,
      view: "create",
      wizard: structuredClone(wizard),
    };
}
function defaultWizard() {
  const w = {
    step: 1,
    characterIds: [activeCharacters(state)[0]?.id].filter(Boolean),
    backgroundIds: [],
    topic: "",
    language: state.settings.defaultLanguage,
    pageCount: state.settings.defaultPages,
    koreanLevel: state.settings.defaultKoreanLevel,
    englishLevel: state.settings.defaultEnglishLevel,
    value: "none",
    valueCustom: "",
    ending: "home",
    endingCustom: "",
    direction: "",
    worldMemo: getActiveWorld(state).memo || "",
    series: "",
    previousBookId: null,
    outline: null,
  };
  // R12: an openings wizard starts at 16 (기본); page books keep the settings default.
  w.pageCount = snapPageCount(layoutFor(w), w.pageCount, {
    defaultPages: state.settings.defaultPages,
  });
  return w;
}
function pageContent() {
  if (cloudPrivacyLocked)
    return `<section class="panel cloud-lock-panel"><h3>로그인 계정의 책장을 확인해 주세요</h3><p>기존 기기의 보관본은 유지됩니다. 같은 가족 아이디나 ChatGPT 계정으로 로그인하거나 현재 계정의 클라우드 자료를 불러올 수 있어요.${cloudStatus.reason === "family-session-expired" ? "<br>" + esc(signedOutNote(cloudStatus)) : ""}</p>${cloudStatus.authenticated || (view === "library" && !childMode) ? "" : renderSignedOutChoices(cloudStatus)}${btn("클라우드 연결 확인", "cloud-open", cloudStatus.authenticated ? "green" : "outline", "lock")}${renderLocalOnlyEscape()}</section>`;
  if (view === "materials") return materialsPage();
  if (view === "create") return createPage();
  if (view === "settings") return settingsPage();
  if (view === "detail") return detailPage();
  if (view === "edit") return editorPage();
  return libraryPage();
}
function filteredBooks() {
  let b = state.books.filter((x) => x.approved !== false);
  if (tab === "favorites") b = b.filter((x) => x.favorite);
  if (tab === "unprinted") b = b.filter((x) => !x.printedAt);
  if (query) {
    const q = query.toLocaleLowerCase();
    b = b.filter((x) =>
      [
        x.title,
        x.titleEn,
        x.series,
        x.topic,
        x.theme,
        ...(x.characterIds || []).map((id) => char(id)?.name),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(q),
    );
  }
  return b.sort((a, b) =>
    sort === "popular"
      ? (b.reads || 0) - (a.reads || 0)
      : new Date(b.createdAt) - new Date(a.createdAt),
  );
}
function updateBookResults() {
  if (!document.querySelector("#books-grid")) return;
  const books = filteredBooks();
  document.querySelector("#books-grid").innerHTML =
    tab === "series"
      ? [...groupBy(books, (b) => b.series || "")]
          .map(
            ([s, list]) =>
              `<section class="series-group"><h3>${esc(s)} <span class="count">${list.length}권</span></h3><div class="books-grid">${list
                .sort((a, b) => (a.episode || 0) - (b.episode || 0))
                .map(bookCard)
                .join("")}</div></section>`,
          )
          .join("")
      : books.map(bookCard).join("") ||
        '<div class="empty">찾는 이야기가 아직 없어요. 다른 검색어로 찾아보세요.</div>';
  document.querySelector(".shelf-title .count").textContent =
    books.length + "권의 이야기";
}
function libraryPage() {
  const books = filteredBooks(),
    // Simple mode: stories being made come first, in simple words (R11);
    // pro runs with no book stay on the pro list below the books.
    simpleJobs = !childMode && uiMode === "simple";
  let cards = books.map(bookCard).join("");
  if (tab === "series") {
    const groups = groupBy(books, (b) => b.series || "");
    cards = [...groups]
      .map(
        ([series, list]) =>
          `<section class="series-group"><h3>${esc(series)} <span class="count">${list.length}권</span></h3><div class="books-grid">${list
            .sort((a, b) => a.episode - b.episode)
            .map(bookCard)
            .join("")}</div></section>`,
      )
      .join("");
  }
  return `${initialLibrary.invalidRecords?.length ? `<div class="notice">읽지 못한 항목 ${initialLibrary.invalidRecords.length}개 · <button class="btn btn-small btn-outline" data-action="show-invalid-records">보기</button></div>` : ""}${heading(childMode ? "우리 아이의 책장" : "우리 책장", childMode ? "좋아하는 책을 골라, 함께 듣고 읽어요." : "한 권 한 권, 우리 아이의 이야기가 쌓이는 곳.", `<div class="date-pill">${icon("calendar")}${new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}</div>`)}${simpleJobs ? renderFullAutoJobs(state, { simple: true }) : ""}${
    !childMode
      ? `<section class="hero"><div class="hero-content"><div class="eyebrow">${icon("spark")}A LITTLE STORY, A BIG ADVENTURE</div><h3>아이의 오늘이,<br>한 권의 동화로.</h3><p>익숙한 얼굴, 좋아하는 세상.<br>우리 아이가 주인공인 이야기를 만들어 보세요.</p>${btn("새 이야기 만들기", "new-story", "primary", "plus")}</div></section><div class="materials-strip"><span class="strip-label">${icon("characters")}우리 집 이야기 친구들</span><div class="strip-divider"></div><div class="strip-characters">${activeCharacters(
          state,
        )
          .slice(0, 4)
          .map(
            (c) =>
              `<span class="mini-char"><span class="mini-portrait">${characterSVG(c)}</span>${esc(c.name)}</span>`,
          )
          .join(
            "",
          )}</div><button class="strip-link" data-action="nav" data-view="materials">재료 둘러보기${icon("arrow")}</button></div>`
      : state.settings.dailyLimit > 0 &&
          (state.daily[localDay()] || 0) >= state.settings.dailyLimit
        ? '<aside class="notice paper-book-notice"><h3>이제 종이책으로 읽자</h3><p>오늘은 화면으로 충분히 만났어요. 종이책에서 다음 모험을 이어가요.</p></aside>'
        : ""
  }<section><div class="shelf-header"><div class="shelf-title">${childMode ? "읽고 싶은 이야기" : "나의 작은 책장"}<span class="count">${books.length}권의 이야기</span></div>${!childMode ? `<div class="shelf-options"><select id="sort" aria-label="책 정렬"><option value="recent" ${sort === "recent" ? "selected" : ""}>최근 만든 순</option><option value="popular" ${sort === "popular" ? "selected" : ""}>많이 읽은 순</option></select><span class="view-icon">${icon("grid")}</span></div>` : ""}</div>${!childMode ? `<div class="shelf-toolbar"><div class="tabs">${[["all", "전체", "book"], ["favorites", "즐겨찾기", "heart"], ["series", "시리즈", "folder"], ...(!childMode ? [["unprinted", "인쇄 전", "print"]] : [])].map(([id, label, ic]) => `<button class="tab ${tab === id ? "active" : ""}" data-action="tab" data-tab="${id}">${icon(ic)}${label}${id === "all" ? `<small>${state.books.filter((b) => b.approved !== false).length}</small>` : ""}</button>`).join("")}</div><label class="search">${icon("search")}<input id="search-books" placeholder="제목, 주제, 등장인물 검색" value="${esc(query)}" aria-label="책 검색"></label></div>` : ""}<div class="books-grid" id="books-grid">${cards || `<div class="empty"><h3>${query ? "찾는 이야기가 아직 없어요" : "이곳에 이야기를 쌓아 볼까요?"}</h3><p>${query ? "다른 검색어로 찾아보세요." : "한 번 만든 이야기는 언제든 다시 꺼내 읽을 수 있어요."}</p>${!childMode ? btn("새 이야기 만들기", "new-story", "soft", "plus") : ""}</div>`}</div></section>${!childMode ? renderFullAutoJobs(state, { rest: simpleJobs }) : ""}${!childMode ? `<section class="panel storage-panel"><h3>보관 공간</h3><p>이 기기의 글·설정 약 ${(estimateLibraryStorage(localStorage, KEY, state) / 1024 / 1024).toFixed(2)} MB${localStorage.getItem(KEY) === null ? " (저장 전 추정)" : isSpilledLibrary(localStorage.getItem(KEY)) ? " · 큰 보관함(IndexedDB) 사용 중" : ""} · 그림·음원은 별도 보관</p>${btn("오래된 작업 기록 정리", "cleanup-work-records", "outline")}</section>` : ""}`;
}
const managementButton = (label, action, id, kind = "outline") =>
  `<button type="button" class="btn btn-${kind} btn-small" data-management-action="${action}" data-id="${esc(id)}">${label}</button>`;
const photoButton = (label, action) =>
  `<button type="button" class="btn btn-outline btn-small" data-photo-action="${action}">${label}</button>`;
function materialPortrait(c) {
  const sheet = getCharacterSheet(state, c.id) || c.characterSheets?.at(-1);
  const url = sheet?.imageAssetId ? getImageURL(sheet.imageAssetId) : null;
  return url
    ? `<img class="material-generated" src="${esc(url)}" alt="${esc(c.name)}의 캐릭터 시트">`
    : characterSVG(c, c.variant || 0);
}
function materialsPage() {
  const characters = activeCharacters(state),
    backgrounds = activeBackgrounds(state),
    deletedCharacters = state.characters.filter((c) => c.archivedAt),
    deletedBackgrounds = state.backgrounds.filter((b) => b.archivedAt);
  return `${heading("이야기 재료", "한 번 만든 친구와 장소를, 다음 이야기에도 그대로.", btn("설정으로 만들기", "new-character", "primary", "plus"))}<div class="material-add-actions"><button type="button" class="btn btn-outline btn-small" data-companion-action="open">조연 자동생성하여 추가하기</button>${photoButton("사진으로 캐릭터 만들기", "new-character")}${photoButton("완성된 캐릭터 그림 가져오기 · 무료", "import-character")}</div><div class="style-banner"><div><strong>${icon("leaf")} 우리 집 세계 · ${esc(state.settings.style)}</strong><small>${getActiveWorld(state).imageEngine === "sample" ? "무료 샘플은 고정 그림 템플릿이에요. 커버의 수채화는 AI 엔진 또는 완성 그림 가져오기를 사용해요." : "캐릭터의 외모는 유지하고, 그림의 질감은 선택한 실제 화풍 참조를 따라요."}</small></div>${btn("화풍 · 엔진 설정", "nav", "outline", "settings", 'data-view="settings"')}</div>${getActiveWorld(state).styleUpgradeNotice ? `<div class="notice" style="margin-top:15px">${esc(getActiveWorld(state).styleUpgradeNotice)}</div>` : ""}<div class="section-header"><h3>등장인물 서랍 <span class="count">${characters.length}명</span></h3><span class="small-label">설정 수정 · 삭제 · 시트 다시 생성</span></div><div class="character-grid">${characters.map((c) => `<article class="character-card"><div class="character-picture">${materialPortrait(c)}</div><span class="role-tag">${esc(c.role)}</span><h4>${esc(c.name)} <span class="count">${esc(c.nameEn)}</span></h4>${c.autoReviewPending ? '<span class="style-changed-badge">자동 생성 · 검토 필요</span>' : ""}<p>${state.books.filter((b) => b.characterIds?.includes(c.id)).length}권에 등장 · ${esc(c.description || "우리 집 이야기 친구")}</p>${btn("캐릭터 시트 보기", "character-sheet", "outline", "characters", `data-id="${esc(c.id)}"`)}${renderCharacterImageControls(c, state)}${renderWardrobeCardActions(c)}<div class="material-card-actions">${managementButton("설정 수정", "edit-character", c.id)}${managementButton("삭제", "delete-character", c.id)}</div></article>`).join("") || `<div class="empty-state"><h3>이야기 친구를 만나볼까요?</h3><p>한 번 만든 친구는 다음 책에도 함께해요.</p>${btn("친구 만들기", "new-character", "green")}</div>`}</div><div class="section-header"><h3>배경 서랍 <span class="count">${backgrounds.length}곳</span></h3>${btn("설정으로 추가", "new-background", "outline", "plus")}</div><div class="material-add-actions">${photoButton("사진으로 배경 시트 만들기", "new-background")}${photoButton("완성된 배경 그림 가져오기 · 무료", "import-background")}</div><div class="background-grid">${backgrounds
    .map((raw) => {
      const b = getWorldBackgroundSnapshot(state, raw);
      return `<article class="background-card">${b.imageAssetId && getImageURL(b.imageAssetId) ? `<img class="background-generated" src="${esc(getImageURL(b.imageAssetId))}" alt="${esc(b.name)} 배경">` : `<div class="background-emoji">${placeEmoji(b.type)}</div>`}<h4>${esc(b.name)}</h4>${raw.autoReviewPending ? '<span class="style-changed-badge">자동 생성 · 검토 필요</span>' : ""}<p>${esc(b.description || b.features || "이야기가 시작되는 작은 장소")}</p><div class="material-card-actions">${managementButton("수정", "edit-background", b.id)}${managementButton("삭제", "delete-background", b.id)}</div>${renderBackgroundSheetActions(raw, state)}</article>`;
    })
    .join(
      "",
    )}</div>${deletedCharacters.length || deletedBackgrounds.length ? `<details class="deleted-materials"><summary>삭제한 재료 ${deletedCharacters.length + deletedBackgrounds.length}개 · 복원</summary>${deletedCharacters.map((c) => `<div><span>${esc(c.name)} · 캐릭터</span>${managementButton("복원", "restore-character", c.id)}</div>`).join("")}${deletedBackgrounds.map((b) => `<div><span>${esc(b.name)} · 배경</span>${managementButton("복원", "restore-background", b.id)}</div>`).join("")}</details>` : ""}`;
}

function renderWizardTextSummary() {
  const settings = getTextGenerationSettings(state),
    outline = settings.storyQuality?.enabled
      ? resolveQualityStageSettings(settings, "outline", settings.storyQuality)
      : resolveStoryStageSettings(settings, "outline"),
    prose = settings.storyQuality?.enabled
      ? resolveQualityStageSettings(settings, "prose", settings.storyQuality)
      : resolveStoryStageSettings(settings, "prose"),
    pagination = resolveStoryStageSettings(settings, "pagination");
  const label = (selection) =>
    selection.engineId === "local"
      ? selection.config.model || "로컬"
      : getTextModelInfo(
          selection.engineId,
          selection.config.model,
          selection.config,
        ).name;
  const same =
      outline.engineId === pagination.engineId &&
      outline.config.model === pagination.config.model,
    summary = same
      ? `줄거리·쪽 나누기 ${label(outline)} · 전문 ${label(prose)}`
      : `줄거리 ${label(outline)} · 전문 ${label(prose)} · 쪽 나누기 ${label(pagination)}`;
  return `<div class="story-engine-summary wizard-engine-summary"><span title="${esc(summary)}">${esc(summary)}</span><button type="button" class="btn btn-plain btn-small" data-action="open-story-text-settings">변경</button></div>`;
}

function openStoryTextSettings(draftId = null) {
  if (!draftId) syncWizard();
  textSettingsReturn = {
    draftId,
    view,
    wizard: wizard ? structuredClone(wizard) : null,
  };
  view = "settings";
  settingsTab = uiMode === "simple" ? "simple" : "text";
  history.replaceState(null, "", "#settings=" + settingsTab);
  render();
  requestAnimationFrame(() =>
    document
      .querySelector(
        uiMode === "simple" ? "#text-engine-form" : "#text-engine-settings",
      )
      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
}
function startStory(previous = null) {
  wizard = {
    step: 1,
    characterIds: previous
      ? previous.characterIds.filter((id) =>
          activeCharacters(state).some((c) => c.id === id),
        )
      : [activeCharacters(state)[0]?.id].filter(Boolean),
    backgroundIds: previous?.backgroundIds || [],
    topic: "",
    language: previous?.language || state.settings.defaultLanguage,
    pageCount: previous?.pageCount || state.settings.defaultPages,
    koreanLevel: previous?.koreanLevel || state.settings.defaultKoreanLevel,
    englishLevel: /^E[0-4]$/.test(previous?.englishLevel || "")
      ? previous.englishLevel
      : state.settings.defaultEnglishLevel,
    value: "none",
    valueCustom: "",
    ending: "home",
    endingCustom: "",
    direction: "",
    worldMemo: previous?.worldMemo || getActiveWorld(state).memo || "",
    series: previous?.series || "",
    previousBookId: previous?.id || null,
    outline: null,
  };
  // R12: the next book keeps the previous book's printed pages, snapped to what its
  // own layout offers (an openings book of 13 entries is 16 printed pages).
  const previousPages =
    previous && layoutOf(previous) === "openings"
      ? printedPagesOf(previous)
      : previous?.pageCount;
  wizard.pageCount = snapPageCount(
    layoutFor(wizard),
    previousPages || state.settings.defaultPages,
    { touched: !!previousPages, defaultPages: state.settings.defaultPages },
  );
  view = "create";
  render();
  window.scrollTo(0, 0);
}
function renderTopicWardrobe(w) {
  const choices = recommendWardrobe(w?.topic),
    id = w?.characterIds?.[0];
  if (!choices.length || !id) return "";
  return `<div class="notice" style="margin:16px 0"><strong>이야기에 어울리는 옷장 모습</strong><p class="small-label">필요한 모습만 골라 만들고, 부모가 확인하면 옷장에 저장해요.</p><div class="material-add-actions">${choices.map((choice) => `<button type="button" class="btn btn-outline btn-small" data-wardrobe-action="open" data-character-id="${esc(id)}" data-recommendation="${esc(choice.id)}">${esc(choice.name)} 추천 · 만들어 보기</button>`).join("")}</div></div>`;
}
function createPage() {
  if (!wizard) wizard = defaultWizard();
  if (simpleCreateActive()) return renderSimpleCreate(simpleCtx);
  const w = wizard;
  const steps = ["재료 고르기", "주제와 분위기", "읽기와 형식", "만들기"];
  let inner = "";
  if (w.step === 1)
    inner = `<h3>누구와 함께 떠날까요?</h3><p class="section-sub">첫 번째로 고른 친구가 주인공이에요. 조연은 최대 6명까지 함께할 수 있고, 고른 친구는 모두 이야기에 나와요.</p><div class="material-add-actions"><button type="button" class="btn btn-outline" data-companion-action="open">조연 자동생성하여 추가하기</button></div><div class="selection-grid">${activeCharacters(
      state,
    )
      .map(
        (c) =>
          `<button class="selection ${w.characterIds.includes(c.id) ? "selected" : ""}" data-action="select-character" data-id="${esc(c.id)}">${materialPortrait(c)}<strong>${esc(c.name)}</strong><small>${w.characterIds[0] === c.id ? "이번 이야기의 주인공" : esc(c.role)}</small></button>`,
      )
      .join(
        "",
      )}</div>${renderBookVariantSelectors(state, w)}<label class="form-label">이야기가 펼쳐질 장소 <span class="count">선호 장소 최대 5곳(집 포함) · 집과 다른 장소 2곳 이상 사용</span></label><div class="chips">${activeBackgrounds(
      state,
    )
      .map(
        (b) =>
          `<button class="chip ${w.backgroundIds.includes(b.id) ? "selected" : ""}" data-action="select-background" data-id="${esc(b.id)}">${esc(b.name)}</button>`,
      )
      .join(
        "",
      )}</div>${w.previousBookId ? `<div class="notice" style="margin-top:24px">지난 이야기에서 이어집니다.<br>${esc(bookById(w.previousBookId)?.summary || bookById(w.previousBookId)?.title)}</div>` : ""}`;
  if (w.step === 2)
    inner = `<h3>오늘은 어떤 이야기를 만들까요?</h3><p class="section-sub">아이가 좋아하는 것, 오늘 있었던 일을 들려주세요.</p><div class="field"><label for="topic">이야기 주제</label><textarea id="topic" maxlength="400" placeholder="예: 유하가 공룡 친구와 함께 길을 잃은 별을 찾아주는 이야기">${esc(w.topic)}</textarea></div><div class="chips">${["공룡 친구와 소풍", "달에 놀러 간 날", "비 오는 날의 모험", "바닷속 보물 찾기", "처음 유치원에 간 날", "친구의 생일 파티"].map((t) => `<button class="chip" data-action="topic-chip" data-topic="${t}">${t}</button>`).join("")}<button class="chip" data-action="child-pick">${icon("child")}아이가 고르기</button></div><div id="wardrobe-topic-suggestions">${renderTopicWardrobe(w)}</div><div class="material-add-actions"><button type="button" class="btn btn-outline" data-companion-action="open">이 주제로 조연 자동생성</button></div>${renderQualityWorldSelectors(w, { state })}`;
  // R12 safety net: step 3's select never shows a page count the wizard does not
  // hold (a wizard carried over from a pre-R12 8/24-page job becomes 12/16).
  if (w.step === 3 && heldPageCount(w) !== w.pageCount)
    w.pageCount = heldPageCount(w);
  if (w.step === 3)
    inner = `<h3>읽기와 형식을 정해요</h3><p class="section-sub">한글과 영어 수준은 따로 적용해요.</p><div class="form-grid" style="margin-top:26px">${selectField(
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
      "이야기 길이",
      pageCountOptions(w),
      w.pageCount,
    )}${renderReadingSelectors(w)}${selectField(
      "value",
      "함께 생각할 가치",
      [
        ["none", "없음 · 즐거운 이야기"],
        ["sharing", "나눔"],
        ["courage", "용기"],
        ["kindness", "친절"],
        ["brushing", "양치하기"],
        ["custom", "직접 입력"],
      ],
      w.value,
    )}<div class="field" id="value-custom-field" ${w.value === "custom" ? "" : "hidden"}><label for="valueCustom">직접 적는 가치</label><input id="valueCustom" maxlength="500" value="${esc(w.valueCustom || "")}" placeholder="이야기 속 행동으로 보여 줄 가치를 적어 주세요"></div>${selectField(
      "ending",
      "이야기의 끝",
      [
        ["home", "집에 돌아와 잠들어요"],
        ["open", "다음 모험을 기다려요"],
        ["custom", "직접 입력"],
      ],
      w.ending,
    )}<div class="field" id="ending-custom-field" ${w.ending === "custom" ? "" : "hidden"}><label for="endingCustom">직접 적는 이야기의 끝</label><textarea id="endingCustom" maxlength="1000" placeholder="이야기가 어디서 어떤 행동과 말로 끝날까요? 예: 바닷가에서 친구들과 조개를 나눠 들고 노래하며 끝나요 (집으로 돌아오지 않아도 돼요)">${esc(w.endingCustom || "")}</textarea></div><details class="wizard-direction" ${w.direction ? "open" : ""}><summary>이 책의 방향 <span class="count">선택 · 기획 회의가 따를 한 줄</span></summary><div class="field"><input id="direction" maxlength="200" value="${esc(w.direction || "")}" placeholder="예: 절정에서 아이가 아기 여우의 두려움에 공감하게" aria-label="이 책의 방향"></div></details><div class="field"><label for="series">시리즈 이름 <span class="count">비워두면 새 시리즈</span></label><input id="series" maxlength="60" value="${esc(w.series)}" placeholder="예: 유하의 작은 모험" ${w.previousBookId ? "readonly" : ""}></div></div>`;
  if (w.step === 4)
    inner = `<h3>어떤 방식으로 만들까요?</h3><details class="story-start-options"><summary>구성 패턴 · 세계관 메모</summary><div class="field" style="margin-top:20px"><label for="worldMemo">세계관 메모 · 함께 지킬 설정</label><textarea id="worldMemo" maxlength="2000" placeholder="친구들의 관계, 장소의 특징, 다음 편에도 유지할 설정">${esc(w.worldMemo || "")}</textarea></div>${renderQualityPatternSelector(w, { state, id: "storyQualityPatternId" })}</details>${renderWizardTextSummary()}${renderFullAutoLauncher(state, w)}`;

  return `${heading(w.previousBookId ? "다음 이야기 이어 만들기" : "이야기 만들기", "익숙한 친구들과, 세상에 하나뿐인 새 이야기.", `<span class="role-tag">${esc(getActiveWorld(state).name)}</span>`)}<div class="wizard"><div class="steps">${steps.map((s, i) => `<div class="step ${i + 1 === w.step ? "active" : i + 1 < w.step ? "done" : ""}"><b>${i + 1 < w.step ? "✓" : i + 1}</b>${s}</div>`).join("")}</div><section class="panel">${w.step < 3 ? renderReadingSuggestion(state.settings) : ""}${inner}</section><div class="wizard-actions">${btn(w.step === 1 ? "책장으로" : "이전 단계", w.step === 1 ? "library" : "wizard-back", "outline", "back")}<span class="wizard-hint">${icon("lock")}부모가 확인하고 아이에게 전해요.</span>${w.step < 4 ? btn("다음 단계", "wizard-next", "green", "arrow") : ""}</div></div>${renderStoryDrafts(state)}${renderFullAutoJobs(state)}`;
}
function selectField(id, label, options, value) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${options.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${t}</option>`).join("")}</select></div>`;
}
function syncWizard() {
  if (wizard) syncWardrobeSelections(wizard);
  if (wizard?.step >= 2) {
    for (const k of [
      "topic",
      "language",
      "pageCount",
      "koreanLevel",
      "englishLevel",
      "value",
      "valueCustom",
      "ending",
      "endingCustom",
      "direction",
      "series",
      "worldMemo",
      "storyQualityPatternId",
      "storyWorldId",
      "storySeason",
      "storyTimeOfDay",
    ])
      wizard[k] = document.getElementById(k)?.value ?? wizard[k];
    wizard.pageCount = Number(wizard.pageCount);
  }
  if (wizard?.step === 3)
    document
      .querySelectorAll("[data-outline]")
      .forEach((e) => (wizard.outline[Number(e.dataset.outline)].ko = e.value));
}
function editorPage() {
  if (!draft) {
    view = "library";
    return libraryPage();
  }
  const p = draft.pages[editPage];
  return `${heading("이야기 다듬기", "한 쪽씩 살펴보고, 우리 아이에게 어울리는 말로 바꿔 주세요.", `<span class="small-label">부모 미확정 · 초안</span>`)}${renderGenerationControls(draft)}${renderChecksPanel(draft, { tab: checksTab, details: { reading: renderReadingCheck(draft), events: renderStoryQuality(draft), richness: renderRichnessQuality(draft), coherence: renderStoryCoherence(draft.pageCoherence, { dirty: !isCoherenceCurrent(draft.pageCoherence, { outline: draft.outline, prose: draft.prose, pagination: currentBookPagination(draft), stage: "pages" }) }) } })}<div class="editor-title"><input id="book-title" maxlength="80" aria-label="책 제목" value="${esc(draft.title)}"></div><div class="editor-layout"><div class="page-rail">${draft.pages.map((p, i) => `<button class="page-thumb ${i === editPage ? "active" : ""}" data-action="edit-page" data-page="${i}" aria-label="${esc(unitLabel(draft, i))} 편집">${illustration(draft, i)}<span>${esc(unitLabel(draft, i))}</span></button>`).join("")}</div><section class="panel"><div class="editor-main"><div class="editor-art"><div class="editor-picturebook text-below">${illustration(draft, editPage)}<div class="page-typeset-preview" aria-label="그림 아래 본문 미리보기">${draft.language !== "en" ? `<p lang="ko" data-typeset="ko">${esc(p.ko ?? p.textKo ?? "")}</p>` : ""}${draft.language !== "ko" ? `<p lang="en" data-typeset="en">${esc(p.en ?? p.textEn ?? "")}</p>` : ""}</div></div><div class="editor-tools">${btn("샘플 그림 변형", "regenerate-art", "outline", "refresh")}${btn("글 포함 인쇄 미리보기", "preview-draft-print", "outline", "print")}</div></div><div class="editor-text"><div class="field"><label for="page-ko">${esc(unitLabel(draft, editPage))} · 한글</label><textarea id="page-ko">${esc(p.ko)}</textarea></div><div class="field"><label for="page-en">English · ${editPage + 1}</label><textarea id="page-en">${esc(p.en)}</textarea></div>${btn("이야기 글 다시 다듬기", "regenerate-text", "outline", "refresh")}${canAlignEnglish(draft) ? btn(`영어를 한글에 맞추기 · ${estimatedCostText(estimateAlignEnglish(state, draft).usd, estimateAlignEnglish(state, draft).pricingUnknown)}`, "align-english", "outline", "refresh") : ""}<span class="small-label">${p.imageAssetId ? "World 엔진으로 만든 그림입니다." : "현재 그림은 SVG 샘플입니다. 커버 화풍은 World 엔진으로 장면을 생성해 주세요."}</span></div></div><div class="editor-bottom"><span>${icon("check")}그림 아래에 본문이 인쇄됩니다. 확정 전에도 인쇄 미리보기를 볼 수 있어요.</span><label class="audio-cache-check"><input type="checkbox" id="cache-audio-approval" checked>확정 시 쪽별 음원 저장 · OpenAI 키가 있을 때만 · 예상 $${estimateBookAudio(draft).costUsd.toFixed(3)}</label>${btn("확정하고 책장에 저장", "approve-book", "primary", "check")}</div></section></div>`;
}
function buildStoryResultBook(result) {
  const same =
      draft?.storyDraftId === result.id
        ? draft
        : state.storyDrafts?.[result.id]?.pictureBook || null,
    options = {
      ...result.wizard,
      pageCount: result.pagination.pages.length,
      koreanLevel: result.readingLevels.koreanLevel,
      englishLevel: result.readingLevels.englishLevel,
    };
  const pages = toLegacyPages(result.pagination);
  const book = generateBook(options, pages, state.characters, state.books);
  if (result.bookId) book.id = result.bookId;
  if (same) {
    book.id = same.id;
    book.createdAt = same.createdAt;
    book.imageHistory = same.imageHistory;
    book.cover = same.cover;
    book.coverHistory = same.coverHistory;
    book.generationSnapshot = same.generationSnapshot;
    book.imageCosts = same.imageCosts;
  }
  book.pages = pages.map((page, index) => {
    const prior = same?.pages[index];
    if (
      prior &&
      JSON.stringify(prior.scene) === JSON.stringify(page.scene) &&
      JSON.stringify(prior.staging || {}) ===
        JSON.stringify(page.staging || {}) &&
      JSON.stringify(
        same.sceneBriefs?.find((b) => b.beatIndex === page.beatIndex) || {},
      ) ===
        JSON.stringify(
          result.sceneBriefs?.find((b) => b.beatIndex === page.beatIndex) || {},
        ) &&
      JSON.stringify(prior.variantByCharacter || {}) ===
        JSON.stringify(page.variantByCharacter || {}) &&
      // R12: a picture stays only on the same entry of the same kind.
      prior.entryId === page.entryId &&
      prior.kind === page.kind
    )
      return { ...prior, ...page };
    if (prior?.imageAssetId)
      return {
        ...page,
        imageHistory: [
          ...(prior.imageHistory || []),
          {
            imageAssetId: prior.imageAssetId,
            imageUrl: prior.imageUrl,
            imageMeta: prior.imageMeta,
            archivedAt: new Date().toISOString(),
          },
        ],
      };
    return page;
  });
  book.title =
    result.pagination.cover?.title ||
    result.input.title ||
    result.outline.titleCandidates[0];
  book.titleEn = "";
  book.summary = result.outline.logline;
  Object.assign(book, {
    outline: result.outline,
    storyQuality: result.outline.quality || null,
    proseCoherence: result.proseCoherence || null,
    pageCoherence: result.pageCoherence || null,
    childGate: result.childGate || null,
    sceneBriefs: result.sceneBriefs || [],
    richnessCheck:
      result.richnessCheck || result.pagination.richnessCheck || null,
    prose: result.prose,
    pagination: result.pagination,
    stage: "paged",
    storyInput: result.input,
    storyDraftId: result.id,
    textEngineId: result.textEngineId,
    textModelId: result.textModelId,
    textGenerationSettings: result.textSettings,
    textDemo: result.demo,
    localSample: result.demo,
    summaryForNext: result.summaryForNext,
    storyCheck: result.storyCheck,
    readingLevelSnapshot: result.readingLevels,
    levelSpec: result.readingLevels.specs,
    koreanLevel: result.readingLevels.koreanLevel,
    englishLevel: result.readingLevels.englishLevel,
    worldMemo: result.input.worldNotes || options.worldMemo || "",
    textUsage: result.usage,
    worldId: result.worldId,
    worldSettingsSnapshot: structuredClone(result.worldSnapshot),
    backgroundIds: [
      ...new Set([
        ...(result.outline.settings || [])
          .map((setting) => setting.backgroundId)
          .filter(Boolean),
        ...(options.backgroundIds || []),
      ]),
    ],
    style: state.settings.style,
    approved: false,
  });
  // R12 openings: the parent's wardrobe ranges are in printed pages (an entry
  // takes the range containing its first printed page); the book's rebuilt
  // ranges below are per entry, like every index-keyed picture tool.
  copyWardrobeSelections(
    result.input?.layoutPolicy?.kind === "openings"
      ? { ...options, pageCount: printedPagesOf(result.pagination.pages) }
      : options,
    book,
    state,
  );
  for (const id of book.characterIds) {
    const ranges = [];
    for (const page of result.pagination.pages) {
      const variantId = page.variantByCharacter?.[id] ?? null,
        last = ranges.at(-1);
      if (last && last.variantId === variantId) last.to = page.pageNo;
      else ranges.push({ from: page.pageNo, to: page.pageNo, variantId });
    }
    book.variantPageRanges[id] = ranges;
  }
  const previous = state.books.find(
    (item) => item.id === options.previousBookId,
  );
  if (previous)
    applySeriesContinuity(state, book, previous, {
      ...options,
      characterVariants: book.characterVariants,
      variantPageRanges: book.variantPageRanges,
    });
  if (!previous && !book.generationSnapshot) {
    try {
      captureBookGenerationSnapshot(state, book);
      book.generationSnapshot.backgroundReferenceByPage = bindSeriesBackgrounds(
        book,
        book.generationSnapshot.backgrounds,
      );
    } catch (error) {
      book.sheetSetupNotice = error.message;
    }
  }
  if (book.generationSnapshot)
    book.generationSnapshot.backgroundReferenceByPage = bindSeriesBackgrounds(
      book,
      book.generationSnapshot.backgrounds || [],
    );
  const calls = result.usage?.calls || [];
  book.textCosts = {
    requestCount: calls.reduce(
      (n, c) => n + (c.demo ? 0 : Number(c.requests) || 1),
      0,
    ),
    estimatedUsd: calls.reduce(
      (n, c) =>
        n + (Number(c.costUsdEstimated ?? c.usage?.costUsdEstimated) || 0),
      0,
    ),
    actualUsd:
      calls.length &&
      calls.every((c) => Number.isFinite(c.costUsd ?? c.usage?.costUsd))
        ? calls.reduce((n, c) => n + (c.costUsd ?? c.usage.costUsd), 0)
        : null,
    actualAvailable:
      calls.length > 0 &&
      calls.every((c) => Number.isFinite(c.costUsd ?? c.usage?.costUsd)),
  };
  // A rebuilt FULL AUTO book keeps its job link, and the job points at it.
  carryFullAutoFields(state, book, same);
  return book;
}
const FULL_AUTO_NOT_REBUILT =
  "FULL AUTO로 만든 책은 이미 만든 그림을 지키려고 이야기에서 다시 엮지 않아요. 쪽 글은 검수 화면에서 고쳐 주세요.";
/** The FULL AUTO job that owns the story draft `draftId` (it built and keeps the book), or null. */
function fullAutoJobOfStory(draftId) {
  return draftId
    ? fullAutoJobOfDraft(state, state.storyDrafts?.[draftId] || { id: draftId })
    : null;
}
/**
 * '검수 열기' on a FULL AUTO story draft: the job's own review (simple ④ in
 * simple mode, the library card's route in pro mode), never a rebuild.
 * Refused while a simple action or a page operation owns the book.
 */
async function openAutoJobReview(jobId) {
  const job = state.fullAutoJobs?.[jobId];
  if (!job) return toast("자동 작업을 찾지 못했어요.");
  if (
    isSimpleBusy() ||
    isPageOperationBusy(job.book?.id) ||
    isPageOperationBusy(job.bookId)
  ) {
    toast("진행 중인 작업이 끝난 뒤 열어 주세요.");
    return;
  }
  try {
    if (uiMode === "simple") {
      closeModal();
      await openSimpleJob(simpleCtx, job.id);
      return;
    }
    await openFullAutoReview(job.id);
  } catch (error) {
    toast(error);
  }
}
async function acceptStoryResult(result) {
  // Never rebuild a book a FULL AUTO job owns: the rebuilt pages would drop
  // the pictures the job bought (and a draw in flight would land on the old
  // object). The workflow shows this and keeps its draft.
  if (fullAutoJobOfStory(result.id)) throw Error(FULL_AUTO_NOT_REBUILT);
  const book = buildStoryResultBook(result);
  closeModal();
  draft = book;
  editPage = 0;
  view = "edit";
  await checkBookAtLevel(book, { rewrite: false });
  render();
  window.scrollTo(0, 0);
}
function renderStoryQuality(book) {
  if (!book.storyCheck?.checks) return "";
  return `<details class="reading-check ${book.storyCheck.passed ? "" : "reading-warning"}"><summary>사건·쪽 검사 ${book.storyCheck.passed ? "통과" : "경고 · 부모 확인 필요"}</summary><div>${book.storyCheck.checks.map((check) => `<p>${check.passed ? "✓" : "⚠"} ${esc(check.label)}${check.passed ? "" : ": " + esc(check.violations?.[0]?.message || "직접 다듬거나 해당 단계를 다시 생성해 주세요.")}</p>`).join("")}</div></details>`;
}
function renderRichnessQuality(book) {
  const report = book.richnessCheck;
  if (!report) return "";
  const issues = report.issues || report.violations || [];
  return `<details class="reading-check ${report.valid ? "" : "reading-warning"}"><summary>글 풍부함 ${report.valid ? "검사 통과" : "확인할 표현 " + issues.length + "개"}</summary><p class="small-label">어휘 사전·문장 패턴으로 추정한 검사입니다. 문맥과 주어는 부모가 함께 확인해 주세요.</p>${issues
    .slice(0, 24)
    .map(
      (issue) =>
        `<p>${issue.pageNo ? esc(issue.pageNo) + "쪽 · " : ""}${issue.language === "en" ? "영어" : issue.language === "ko" ? "한글" : ""} ${esc(issue.message)}</p>`,
    )
    .join(
      "",
    )}${issues.length > 24 ? `<p>나머지 ${issues.length - 24}개는 쪽 나누기 검토에서 확인해 주세요.</p>` : ""}</details>`;
}
function syncDraft() {
  if (draft) {
    const current = draft.pages[editPage];
    if (
      (document.getElementById("page-ko") &&
        document.getElementById("page-ko").value !== current.ko) ||
      (document.getElementById("page-en") &&
        document.getElementById("page-en").value !== current.en)
    )
      draft.readingCheck = null;
    draft.title =
      document.getElementById("book-title")?.value.trim() || draft.title;
    const p = draft.pages[editPage];
    p.ko = document.getElementById("page-ko")?.value ?? p.ko;
    p.en = document.getElementById("page-en")?.value ?? p.en;
    if (draft.pagination) {
      p.textKo = p.ko;
      p.textEn = p.en;
      const page = draft.pagination.pages[editPage];
      page.textKo = p.ko;
      page.textEn = p.en;
      page.scene = structuredClone(p.scene);
      if (p.staging) page.staging = structuredClone(p.staging);
      draft.storyCheck = checkStory(draft.outline, draft.pagination, {
        storyInput: draft.storyInput,
        specs: draft.readingLevelSnapshot.specs,
        storyWords: buildStoryWords(draft, draft.outline, [], { briefs: draft.sceneBriefs || [], lean: draft.storyInput?.promptDiet?.version === 1 }),
        allowedNames: draft.storyInput.characters.flatMap((c) => [
          c.name,
          c.nameEn,
        ]),
      });
      if (
        draft.sceneBriefs?.length &&
        draft.textGenerationSettings?.storyEnrichment !== false
      ) {
        draft.richnessCheck = checkRichness(
          draft.pagination,
          draft.storyInput,
          draft.outline,
          draft.sceneBriefs,
        );
        draft.pagination.richnessCheck = draft.richnessCheck;
      }
      syncStoryDraft(draft, state);
    }
  }
}
function detailPage() {
  const b = activeBook;
  if (!b) {
    view = "library";
    return libraryPage();
  }
  return `${heading("우리 가족의 이야기", "종이로 읽고, 익숙한 목소리로 함께 들어요.", btn("책장으로", "library", "outline", "back"))}${b.justCreated ? '<div class="success-note">' + icon("check") + "새 동화책이 완성됐어요! 종이책으로 첫 모험을 시작해 볼까요?</div>" : ""}<div class="detail-layout"><div class="detail-cover">${cover(b)}</div><section class="detail-info"><span class="role-tag">${esc(b.series)} · ${b.episode || 1}편</span><h2>${esc(b.title)}</h2>${b.styleChanged ? '<span class="style-changed-badge">그림체 변경됨</span>' : ""}<p>${esc(b.titleEn)}</p>${renderReadingBadge(b)}<div class="metadata"><span><b>${openingsSummary(b) ? esc(openingsSummary(b)) : `${b.pages.length}쪽`}</b>이야기 길이</span><span><b>${languageLabel(b.language)}</b>읽는 언어</span><span><b>${b.reads || 0}번</b>함께 읽었어요</span></div><p>${esc(b.summary || b.pages[0]?.ko)}</p><div class="detail-actions">${!childMode ? btn("인쇄 · PDF로 저장", "print-options", "primary", "print", `data-id="${esc(b.id)}"`) : ""}${btn("책 읽고 듣기", "read-book", "green", "play", `data-id="${esc(b.id)}"`)}${!childMode ? btn("복사본으로 그림·글 수정", "revise-book-copy", "outline", "edit", `data-id="${esc(b.id)}"`) : ""}${!childMode ? `<button type="button" class="btn btn-outline" data-reading-action="feedback" data-id="${esc(b.id)}">읽은 뒤 난이도 알려주기</button>` : ""}${!childMode ? btn("다음 편 만들기", "continue-book", "outline", "spark", `data-id="${esc(b.id)}"`) : ""}</div>${!childMode ? renderAudioPreparationControls(b) : ""}${!childMode ? `<div class="detail-secondary"><button data-action="favorite" data-id="${esc(b.id)}">${icon("heart")}${b.favorite ? "즐겨찾기 해제" : "즐겨찾기"}</button><button data-action="paper-read" data-id="${esc(b.id)}">${icon("check")}오늘 종이로 읽음</button><button data-action="branch-book" data-id="${esc(b.id)}">${icon("plus")}새 시리즈</button>${managementButton("책 삭제", "delete-book", b.id)}</div><div class="book-details-note">${b.imageCosts ? `그림 비용 ${b.imageCosts.actualAvailable ? "실제 $" + b.imageCosts.actualUsd.toFixed(3) : estimatedCostText(b.imageCosts.estimatedUsd, bookPricingUnknown(b).images) + " · 실제 청구액은 공급자 사용 내역을 확인해 주세요."}<br>` : ""}${b.textDemo ? "글 생성: 무료 데모<br>" : b.textCosts ? `글 비용 ${b.textCosts.actualAvailable ? "실제 $" + b.textCosts.actualUsd.toFixed(3) : estimatedCostText(b.textCosts.estimatedUsd, bookPricingUnknown(b).text)} · ${esc(b.textModelId || b.textEngineId)}<br>` : ""}${b.continuity?.reason ? esc(b.continuity.reason) + "<br>" : ""}${b.audioCacheStatus?.message ? esc(b.audioCacheStatus.message) + "<br>" : ""}등장인물: ${(b.characterIds || []).map((id) => esc(char(id)?.name)).join(", ")}<br>${b.printedAt ? "마지막 인쇄 창 열기: " + new Date(b.printedAt).toLocaleDateString("ko-KR") : "아직 인쇄 기록이 없어요."}${b.paperReadAt ? "<br>종이로 읽은 날: " + new Date(b.paperReadAt).toLocaleDateString("ko-KR") : ""}</div>` : ""}</section></div>`;
}
/** Simple mode: one page, four groups. Reuses the existing forms, ids and handlers. */
function simpleSettingsPage() {
  const s = state.settings,
    child = activeCharacters(state)[0] || state.characters[0];
  return `${heading("부모 설정", "우리 아이와 엔진, 잠금과 보관만 한곳에 모았어요.")}${uiModeBar()}${textSettingsReturn ? `<aside class="notice">이야기 입력과 초안은 보관되어 있어요. ${btn("저장한 설정으로 이야기 돌아가기", "return-story-settings", "outline")}</aside>` : ""}<div class="settings-tab-content simple-settings" role="region" aria-label="부모 설정"><section class="panel" id="simple-settings-child"><h3>우리 아이</h3><div class="simple-child-row"><span class="small-label">주인공</span><strong>${esc(child?.name || "우리 아이")}</strong>${child ? managementButton("이름·모습 바꾸기", "edit-character", child.id) : ""}</div><form id="settings-form" class="settings"><div class="form-grid">${selectField(
    "defaultLanguage",
    "책 언어",
    [
      ["dual", "한글판 · 영어판 두 권"],
      ["bilingual", "한 쪽에 두 언어"],
      ["ko", "한글만"],
      ["en", "영어만"],
    ],
    s.defaultLanguage,
  )}${selectField(
    "defaultPages",
    "쪽 수",
    [
      [8, "8쪽"],
      [12, "12쪽"],
      [16, "16쪽"],
      [24, "24쪽"],
    ],
    s.defaultPages,
  )}${renderReadingSelectors({ koreanLevel: s.defaultKoreanLevel, englishLevel: s.defaultEnglishLevel }, "default-")}${selectField(
    "defaultLayout",
    "인쇄 배열",
    [
      ["single", "일반 · 한 면에 한 쪽"],
      ["two", "일반 · 두 쪽씩 읽는 순서"],
      ["booklet", "제본용 · 쪽 재배치·빈 쪽 포함"],
    ],
    s.defaultLayout,
  )}</div><input type="hidden" id="dailyLimit" value="${esc(s.dailyLimit)}"><input type="hidden" id="rate" value="${esc(s.rate)}"><input type="hidden" id="sr-lexile" value="${esc(s.srLexile ?? "")}"></form></section><section class="panel" id="simple-settings-engines"><h3>엔진과 키</h3><p class="section-sub">글 엔진 하나, 그림 엔진 하나와 각 키예요. 키는 PIN으로 이 기기에만 암호화해 보관해요.</p>${renderTextEngineQuick(state)}${renderImageEngineQuick(state)}</section><section class="panel" id="simple-settings-lock"><h3>잠금</h3><p class="section-sub">새로고침하면 만들기·설정이 다시 잠겨요.</p>${btn(s.pinHash ? "부모 PIN 바꾸기" : "부모 PIN 설정", "change-pin", "outline", "lock")}</section><section class="panel" id="simple-settings-backup"><h3>보관</h3><p class="section-sub">다른 기기로 옮기거나 백업해 두세요. API 키와 PIN은 파일에 넣지 않아요.</p>${renderSimpleAccountRow(cloudStatus)}<div class="simple-backup-actions">${btn("다른 기기로 옮기기 · 가져오기", "device-transfer", "green", "upload")}${btn("전체 라이브러리 ZIP 백업", "export-library", "outline", "download")}${btn("JSON · ZIP 백업 가져오기", "import-library", "outline", "upload")}</div><input type="file" id="import-file" accept="application/json,application/zip,.json,.zip" hidden></section></div><div class="settings-save-bar"><span id="settings-save-status" role="status">${settingsDirty.has(settingsTab) ? "저장하지 않은 변경이 있어요." : "저장된 설정을 보고 있어요."}</span><button class="btn btn-green" data-action="save-settings-tab">설정 모두 저장</button></div>`;
}
function settingsPage() {
  if (uiMode === "simple") {
    settingsTab = "simple";
    return simpleSettingsPage();
  }
  if (settingsTab === "simple") settingsTab = lastProSettingsTab || "home";
  const s = state.settings;
  const home = `<form id="settings-form" class="settings"><div class="settings-layout"><div class="settings-stack"><section class="panel"><h3>우리 집 이야기 기본값</h3><div class="form-grid">${selectField(
    "defaultLanguage",
    "기본 언어",
    [
      ["dual", "한글판 · 영어판 두 권"],
      ["bilingual", "한 쪽에 두 언어"],
      ["ko", "한글만"],
      ["en", "영어만"],
    ],
    s.defaultLanguage,
  )}${selectField(
    "defaultPages",
    "기본 쪽수",
    [
      [8, "8쪽"],
      [12, "12쪽"],
      [16, "16쪽"],
      [24, "24쪽"],
    ],
    s.defaultPages,
  )}${selectField(
    "defaultLayout",
    "인쇄 레이아웃",
    [
      ["single", "일반 · 한 면에 한 쪽"],
      ["two", "일반 · 두 쪽씩 읽는 순서"],
      ["booklet", "제본용 · 쪽 재배치·빈 쪽 포함"],
    ],
    s.defaultLayout,
  )}</div><p class="small-label" style="margin-top:15px">화풍과 이미지 엔진은 아래 World 설정에서 함께 관리해요.</p></section>${renderReadingSettings(s)}<section class="panel"><h3>아이 모드 · 화면의 속도</h3><p class="section-sub">아이 모드에는 확정된 책과 읽기·듣기만 보여요.</p><div class="form-grid">${selectField(
    "dailyLimit",
    "하루에 앱으로 읽을 책",
    [
      [1, "1권"],
      [2, "2권"],
      [3, "3권"],
      [5, "5권"],
      [0, "제한 없음"],
    ],
    s.dailyLimit,
  )}${selectField(
    "rate",
    "기본 읽기 속도",
    [
      [0.65, "천천히"],
      [0.85, "보통"],
      [1.05, "조금 빠르게"],
    ],
    s.rate,
  )}</div><div class="notice" style="margin-top:17px">오늘 앱으로 ${state.daily[localDay()] || 0}권을 열었어요. 제한에 도달하면 종이책을 권해요. 읽어주기 목소리는 기기에 설치된 음성에 따라 달라집니다.</div></section></div><div class="settings-stack"><section class="panel"><h3>부모 잠금</h3><p class="section-sub">새로고침하면 만들기·설정이 다시 잠깁니다.</p>${btn(state.settings.pinHash ? "부모 PIN 바꾸기" : "부모 PIN 설정", "change-pin", "outline", "lock")}<p class="small-label" style="margin-top:17px">PIN은 이 브라우저의 화면 잠금입니다. 기기와 브라우저에 접근할 수 있는 사용자를 서버에서 인증하는 기능은 아닙니다.</p></section><section class="panel"><h3>이야기 보관과 백업</h3><p class="section-sub">책과 캐릭터는 이 브라우저에 보관됩니다. 가끔 백업해 우리 가족의 이야기를 남겨 주세요.</p>${btn("다른 기기로 옮기기 · 가져오기", "device-transfer", "green", "upload")}<div style="margin-top:13px">${btn("전체 라이브러리 ZIP 백업", "export-library", "outline", "download")}</div><div style="margin-top:13px">${btn("JSON · ZIP 백업 가져오기", "import-library", "outline", "upload")}</div><input type="file" id="import-file" accept="application/json,application/zip,.json,.zip" hidden><p class="small-label" style="margin-top:17px">같은 가족 아이디나 ChatGPT 계정으로 클라우드에 연결하면 PC·모바일이 동기화됩니다. 이동용 JSON 또는 ZIP으로 이전 자료를 가져올 수도 있어요. API 키는 새 기기에서 다시 등록합니다.</p></section><section class="panel"><h3>현재 공방의 기능</h3><p class="small-label">장면 디테일·글 풍부화 · 별도 글·이미지 엔진 · 한영 음성 합성 · A4 인쇄 · 시리즈 · 기기 저장<br><br>이미지 생성은 아래 World 엔진과 API 키로 연결합니다. 글은 아래 글 엔진에서 별도로 선택합니다. 사진 변환과 완성 그림 가져오기는 이야기 재료에서 사용할 수 있습니다.</p></section></div></div><div class="settings-save"><button type="button" class="btn btn-outline" data-management-action="reset-parent-preferences">기본 설정 초기화</button><button type="submit" class="btn btn-primary">${icon("check")}설정 저장</button></div></form>`;
  const content =
    settingsTab === "text"
      ? renderTextSettings(state) + renderStoryQualitySettings(state)
      : settingsTab === "image"
        ? renderWorldVariations(state) +
          renderImageSettings(state) +
          renderStyleStudioSettings(state)
        : home;
  return `${heading("부모 설정", "우리 가족의 읽기와 만들기를 한곳에서 정해요.")}${uiModeBar()}${textSettingsReturn ? `<aside class="notice">이야기 입력과 초안은 보관되어 있어요. ${btn("저장한 설정으로 이야기 돌아가기", "return-story-settings", "outline")}</aside>` : ""}<nav class="settings-tabs" role="tablist" aria-label="부모 설정">${[
    ["home", "우리 집·읽기·잠금"],
    ["text", "글 엔진·이야기 품질"],
    ["image", "그림 World·화풍"],
  ]
    .map(
      ([id, label]) =>
        `<button role="tab" aria-selected="${id === settingsTab}" class="${id === settingsTab ? "active" : ""}" data-action="settings-tab" data-tab="${id}">${label}<span class="settings-dirty-dot" ${settingsDirty.has(id) ? "" : "hidden"}> · 저장 안 됨</span></button>`,
    )
    .join(
      "",
    )}</nav><div class="settings-tab-content" role="tabpanel">${content}</div><div class="settings-save-bar"><span id="settings-save-status" role="status">${settingsDirty.has(settingsTab) ? "저장하지 않은 변경이 있어요." : "저장된 설정을 보고 있어요."}</span><button class="btn btn-green" data-action="save-settings-tab">현재 탭 설정 모두 저장</button></div>`;
}
function openStudio() {
  studio = {
    name: "",
    nameEn: "",
    role: "주인공",
    kind: "child",
    gender: "",
    age: 4,
    color: "#efc954",
    hairColor: "#3c3027",
    skinColor: "#f1cfad",
    description: "짧은 검은 머리, 노란 티셔츠",
    traits: "호기심 많음, 씩씩함, 다정함",
    variant: 0,
  };
  showStudioForm();
}
function showStudioForm() {
  showModal(
    `${modalHeader("우리 집 이야기 친구 만들기")}<p class="modal-intro">World의 엔진과 화풍으로 캐릭터 시트를 만들어요. 무료 샘플 엔진에서는 종류·색상에 따른 고정 템플릿을 보여줍니다.</p><form id="character-form"><div class="form-grid"><div class="field"><label for="c-name">이름 · 한글</label><input id="c-name" required maxlength="30" placeholder="예: 유하" value="${esc(studio.name)}"></div><div class="field"><label for="c-nameEn">이름 · 영어</label><input id="c-nameEn" required maxlength="40" placeholder="예: Yuha" value="${esc(studio.nameEn)}"></div>${selectField(
      "c-role",
      "역할",
      [
        ["주인공", "주인공"],
        ["가족", "가족"],
        ["친구", "친구"],
        ["동물", "동물"],
        ["상상 친구", "상상 친구"],
      ],
      studio.role,
    )}${selectField(
      "c-kind",
      "캐릭터 모습",
      [
        ["child", "아이"],
        ["adult", "어른"],
        ["dinosaur", "공룡"],
        ["rabbit", "토끼"],
      ],
      studio.kind,
    )}${selectField(
      "c-gender",
      "성별 · 그림에 그대로 유지",
      [
        ["", "표시 안 함"],
        ["남자아이", "남자아이"],
        ["여자아이", "여자아이"],
      ],
      studio.gender || "",
    )}<div class="field"><label for="c-age">나이</label><input id="c-age" type="number" min="1" max="99" value="${studio.age}" required></div><div class="field"><label for="c-color">옷 · 몸 색상</label><input id="c-color" type="color" value="${studio.color}" style="height:45px"></div><div class="field"><label for="c-hair">머리 색상</label><input id="c-hair" type="color" value="${studio.hairColor}" style="height:45px"></div><div class="field"><label for="c-skin">피부 색상</label><input id="c-skin" type="color" value="${studio.skinColor}" style="height:45px"></div><div class="field field-wide"><label for="c-description">외모 · 늘 입는 옷 · 고정 특징</label><textarea id="c-description" maxlength="200">${esc(studio.description)}</textarea><small>샘플 캐릭터에서 반영되는 모습은 종류와 색상입니다. 세부 외모는 시트 메모로 저장돼요.</small></div><div class="field field-wide"><label for="c-traits">성격 · 좋아하는 것</label><input id="c-traits" maxlength="120" value="${esc(studio.traits)}"></div><div class="field field-wide"><label for="c-catchphrase">말버릇 · 자주 하는 말</label><input id="c-catchphrase" maxlength="500" value="${esc(studio.catchphrase)}" placeholder="어디서 나는 소리지?"></div><div class="field field-wide"><label for="c-relationships">친구·가족과의 관계</label><input id="c-relationships" maxlength="1000" value="${esc(studio.relationships)}" placeholder="초록이와 함께 소풍하는 친구"></div></div><div class="modal-actions"><button type="submit" class="btn btn-green">${getActiveWorld(state).imageEngine === "sample" ? "무료 샘플 모습 살펴보기" : "선택한 화풍으로 시트 생성"}${icon("arrow")}</button></div></form>`,
  );
}
function showCandidates() {
  showModal(
    `${modalHeader("우리 친구의 모습을 골라요")}<p class="modal-intro">이 모습과 색상을 캐릭터 시트로 고정해요. 미소와 몸짓을 비교해 보세요.</p><div class="candidates">${[0, 1, 2, 3].map((i) => `<button class="candidate ${studio.variant === i ? "selected" : ""}" data-action="candidate" data-variant="${i}">${characterSVG(studio, i)}<span>모습 ${i + 1}</span></button>`).join("")}</div><div class="modal-actions">${btn("설정 수정", "studio-back", "outline", "back")}${btn("시험 장면 확인", "studio-test", "green", "arrow")}</div>`,
    "wide",
  );
}
function showStudioTest() {
  showModal(
    `${modalHeader("세 장면에서 같은 친구인가요?")}<p class="modal-intro">${esc(studio.name)}의 얼굴과 옷 색상이 같은지 살펴봐요. 확정하면 이야기 재료에 저장됩니다.</p><div class="test-scenes">${["dinosaur", "moon", "rain"].map((theme, i) => `<div>${sceneSVG({ theme, beat: "explore", index: i }, studio, studio.variant)}<p>${["숲속에서", "달빛 아래에서", "비 오는 날"][i]}</p></div>`).join("")}</div><div class="modal-actions">${btn("다시 고르기", "studio-candidates", "outline", "back")}${btn("이 모습으로 확정", "save-character", "primary", "check")}</div>`,
    "wide",
  );
}
function showCharacter(c) {
  const world = getActiveWorld(state);
  const sheet =
    getCharacterSheet(state, c.id, world) || c.characterSheets?.at(-1);
  const url = sheet?.imageAssetId ? getImageURL(sheet.imageAssetId) : null;
  if (sheet?.imageAssetId) {
    showModal(
      `${modalHeader(esc(c.name) + "의 확정 캐릭터 시트")}${url ? `<img class="ig-sheet-preview" src="${esc(url)}" alt="${esc(c.name)}의 확정 캐릭터 시트">` : '<div class="image-missing">저장된 시트 그림을 찾을 수 없어요. 백업에서 복원해 주세요.</div>'}<p class="modal-intro">World v${sheet.worldRevision} · ${esc(sheet.imageEngine)} · ${esc(getStylePreset(sheet.stylePresetId).name)}<br>요청 시드 ${sheet.requestedSeed ?? sheet.meta?.requestedSeed ?? "—"} · 결과 시드 ${sheet.seed ?? "미지원"}${!getCharacterSheet(state, c.id, world) ? "<br><strong>현재 World의 시트 다시 생성 필요</strong>" : ""}</p><div class="modal-actions">${btn("닫기", "close-modal", "green")}</div>`,
      "wide",
    );
    return;
  }
  showModal(
    `${modalHeader(esc(c.name) + "의 캐릭터 시트")}<div class="form-grid"><div class="character-picture" style="height:240px">${characterSVG(c, c.variant || 0)}</div><div><span class="role-tag">${esc(c.role)} · v${c.version || 1}</span><h3 style="font-family:var(--serif)">${esc(c.name)} / ${esc(c.nameEn)}</h3><p class="small-label">${esc(c.description)}</p><p class="small-label">${esc(Array.isArray(c.traits) ? c.traits.join(", ") : c.traits)}</p><p class="small-label">고정 색상: ${esc(c.color)}<br>무료 샘플 모습입니다. AI 화풍을 반영하려면 엔진으로 시트를 생성하고 확정해 주세요.</p></div></div><div class="test-scenes">${[0, 1, 2].map((i) => `<div>${characterSVG(c, i)}<p>${["기쁨", "호기심", "놀람"][i]}</p></div>`).join("")}</div><div class="modal-actions">${btn("새 버전 만들기", "version-character", "outline", "plus", `data-id="${esc(c.id)}"`)}${btn("닫기", "close-modal", "green")}</div>`,
    "wide",
  );
}
function showBackgroundForm() {
  showModal(
    `${modalHeader("이야기가 머무는 장소")}<form id="background-form"><div class="form-grid"><div class="field"><label for="b-name">장소 이름</label><input id="b-name" required maxlength="50" placeholder="예: 유하네 놀이터"></div>${selectField(
      "b-type",
      "장소 종류",
      PLACE_TYPE_CHOICES,
      "forest",
    )}${placeTypeCustomField("b-type-custom")}<div class="field field-wide"><label for="b-description">특징과 분위기</label><textarea id="b-description" maxlength="250" placeholder="큰 나무 아래 노란 미끄럼틀이 있는 아늑한 놀이터" required></textarea><small>장소 설정을 이야기 맥락으로 저장합니다. 사진으로 배경 추가는 이야기 재료의 ‘사진으로 배경 시트 만들기’에서 사용할 수 있어요.</small></div><div class="field field-wide"><label for="b-layout">고정 배치 · 문·창·가구·소품</label><textarea id="b-layout" maxlength="3000" placeholder="왼쪽 벽에 창문, 오른쪽 벽에 침대, 문 옆 노란 책장"></textarea></div></div><div class="modal-actions"><button type="submit" class="btn btn-green">${icon("check")}배경에 저장</button></div></form>`,
  );
}
/**
 * R12 openings: the print dialog offers 'A4 가로 한 장에 펼침 하나' and 크게 읽기,
 * preselects the recommended one when the stored default is the factory one,
 * counts the range in openings and always sets the text below the picture.
 */
function showOpeningsPrintOptions(b) {
  const language =
      b.language === "en" ? "en" : b.language === "bilingual" ? "bilingual" : "ko",
    stored = state.settings.defaultLayout,
    booklet = stored === "booklet",
    layout = !stored || stored === "single" ? recommendedPrintLayout(b, language) : booklet ? "single" : stored === "two" ? "two" : "single";
  showModal(
    `${modalHeader("종이책으로 만나기")}<p class="modal-intro">${esc(b.title)} · ${esc(openingsSummary(b) || "")} · 본문은 그림 아래에 인쇄해요. A4 인쇄 창에서 프린터 또는 ‘PDF로 저장’을 선택해 주세요.</p>${booklet ? `<div class="notice">${OPENING_BOOKLET_NOTE}. 일반 출력으로 골라 두었어요.</div>` : ""}<form id="print-form" data-id="${esc(b.id)}"><div class="form-grid">${selectField(
      "p-layout",
      "레이아웃",
      [
        ["single", "A4 가로 한 장에 펼침 하나"],
        ["two", "크게 읽기 · A4 세로 한 장에 한 쪽"],
      ],
      layout,
    )}${selectField(
      "p-language",
      "출력 언어",
      [
        ["ko", "한글판"],
        ["en", "영어판"],
        ["bilingual", "한 면에 영어 + 한글"],
      ],
      language,
    )}<div class="field"><label for="p-pages">출력 펼침</label><input id="p-pages" value="all" placeholder="all / cover / 2-4"><small>all: 전체 · cover: 표지만 · 펼침 범위(예: 2-4) 또는 쉼표 구분</small></div>${selectField(
      "p-color",
      "색상",
      [
        ["color", "컬러"],
        ["grayscale", "흑백"],
      ],
      "color",
    )}<input type="hidden" id="p-textPosition" value="below"><input type="hidden" id="p-fontSize" value="large"><input type="hidden" id="p-margin" value="standard"></div><div class="notice" style="margin-top:20px">책 전체를 한 가지 글자 크기로 맞추고, 글이 길면 그 펼침의 그림만 조금 줄여요(펼침면은 낱쪽 그림보다 작아지지 않아요).<br>글이 넘치면 인쇄 창에서 알려 드려요. 그때는 ‘크게 읽기’를 골라 주세요.</div><div class="modal-actions"><button type="submit" class="btn btn-primary">${icon("print")}그림 + 글 인쇄 미리보기</button></div></form>`,
  );
}
function showPrintOptions(b) {
  if (layoutOf(b) === "openings") return showOpeningsPrintOptions(b);
  showModal(
    `${modalHeader("종이책으로 만나기")}<p class="modal-intro">${esc(b.title)} · 그림을 가리지 않도록 본문을 그림 아래에 따로 배치합니다. A4 인쇄 창에서 프린터 또는 ‘PDF로 저장’을 선택해 주세요.</p><form id="print-form" data-id="${esc(b.id)}"><div class="form-grid">${selectField(
      "p-layout",
      "레이아웃",
      [
        ["single", "일반 · 한 면에 한 쪽 (빈 쪽 없음)"],
        ["two", "일반 · 1·2쪽씩 순서대로"],
        ["booklet", "제본용 · 쪽 재배치·빈 쪽 포함"],
      ],
      state.settings.defaultLayout,
    )}${selectField(
      "p-language",
      "출력 언어",
      [
        ["ko", "한글판"],
        ["en", "영어판"],
        ["bilingual", "한 면에 영어 + 한글"],
      ],
      b.language === "en"
        ? "en"
        : b.language === "bilingual"
          ? "bilingual"
          : "ko",
    )}<div class="field"><label for="p-pages">출력 쪽</label><input id="p-pages" value="all" placeholder="all / cover / 3-8 / 2,4,6"><small>all: 전체 · cover: 표지만 · 범위 또는 쉼표 구분</small></div>${selectField(
      "p-textPosition",
      "글 배치",
      [
        ["below", "그림 아래 · 기본"],
        ["staged", "장면별 글 위치 · 선택한 구도 활용"],
        ["bottom", "그림 안 · 하단"],
        ["top", "그림 안 · 상단"],
      ],
      "below",
    )}${selectField(
      "p-color",
      "색상",
      [
        ["color", "컬러"],
        ["grayscale", "흑백"],
      ],
      "color",
    )}${selectField(
      "p-fontSize",
      "글자 크기",
      [
        ["large", "크게"],
        ["normal", "보통"],
      ],
      "large",
    )}${selectField(
      "p-margin",
      "여백",
      [
        ["standard", "표준 · 10mm"],
        ["binding", "제본용 · 안쪽 여백 넓게"],
      ],
      "standard",
    )}</div><div class="notice" style="margin-top:20px">일반 인쇄는 빈 쪽을 끼우지 않고 읽는 순서대로 출력합니다. ‘두 쪽씩’은 본문 1·2쪽을 같은 면에 둡니다.<br>제본용 소책자는 4의 배수를 맞추는 빈 쪽과 쪽 재배치가 필요합니다. A4 가로 · 양면 · 짧은 쪽 뒤집기로 먼저 한 장 시험 인쇄해 주세요.<br>권장 종이: 120–160g · 반 접어 스테이플러 또는 링으로 묶어요.</div><div class="modal-actions"><button type="submit" class="btn btn-primary">${icon("print")}그림 + 글 인쇄 미리보기</button></div></form>`,
  );
}
function startReading(b) {
  if (!b || b.approved === false) return;
  const count = state.daily[localDay()] || 0;
  if (
    childMode &&
    state.settings.dailyLimit > 0 &&
    count >= state.settings.dailyLimit
  ) {
    showModal(
      `${icon("leaf")}<h3 style="font-family:var(--serif);font-size:25px">이제 종이책으로 읽자</h3><p class="modal-intro">오늘은 화면으로 충분히 만났어요.<br>책장 밖에서도 이야기는 계속될 거예요.</p>${btn("책장으로", "close-modal", "green")}`,
      "pin-modal",
    );
    return;
  }
  state.daily[localDay()] = count + 1;
  b.reads = (b.reads || 0) + 1;
  b.lastReadAt = new Date().toISOString();
  save();
  reader = {
    book: b,
    page: 0,
    rate: Number(state.settings.rate),
    continuous: false,
    audioOnly: false,
    speaking: false,
    lastLanguage: b.language === "en" ? "en" : "ko",
  };
  renderReader();
}
let readerFontSize = (() => {
  try {
    return Math.min(
      2,
      Math.max(
        0,
        Number(localStorage.getItem("donghwa-reader-font-size")) || 0,
      ),
    );
  } catch {
    return 0;
  }
})();
function renderReader() {
  const r = reader;
  if (!r) return;
  const b = r.book,
    p = b.pages[r.page],
    // R12 openings: '펼침 k / O · printed pages' and a stacked 21:9 spread.
    openings = layoutOf(b) === "openings",
    spread = openings && p?.kind === "spread";
  showModal(
    `<div class="reader-top"><strong>${esc(b.title)}</strong><small>${openings ? esc(openingHeading(b, r.page)) : `${r.page + 1} / ${b.pages.length}쪽`}</small><button class="close-btn" data-action="close-modal" aria-label="읽기 닫기">${icon("close")}</button></div>${spread ? `<div class="reader-page reader-spread"><div class="reader-picture">${illustration(b, r.page)}</div><p class="reader-turn-hint">폰을 가로로 돌리면 그림이 커져요</p>` : `<div class="reader-page"><div class="reader-picture">${illustration(b, r.page)}</div>`}<div class="reader-body"><div class="audio-indicator">${icon("headphones")}종이책을 보며 들어요</div>${b.language !== "en" ? `<div class="ko">${readerWords(p.ko, "ko")}</div>` : ""}${b.language !== "ko" ? `<div class="en">${readerWords(p.en, "en")}</div>` : ""}</div></div><div class="reader-pagination"><button class="btn btn-outline" data-action="reader-prev" ${r.page === 0 ? "disabled" : ""} aria-label="이전 쪽">${icon("back")}</button><button class="btn btn-green" data-action="reader-toggle-play">${r.speaking ? "읽기 멈춤" : "읽어주기"}</button><span>${r.page + 1} / ${b.pages.length}</span><button class="btn btn-outline" data-action="reader-next" ${r.page === b.pages.length - 1 ? "disabled" : ""} aria-label="다음 쪽">${icon("chevron")}</button></div><details class="reader-play-options"><summary>재생 설정 · 글자 크기</summary><div class="reader-lang-actions">${b.language !== "en" ? btn("한글", "speak-ko", "soft", "volume") : ""}${b.language !== "ko" ? btn("English", "speak-en", "outline", "volume") : ""}${btn("다시 듣기", "replay-speech", "outline", "refresh")}${btn("멈춤", "stop-speech", "outline", "pause")}</div><div class="reader-size-controls" role="group" aria-label="글자 크기">${["기본", "크게", "아주 크게"].map((label, index) => `<button class="btn btn-outline" data-action="reader-font" data-size="${index}" aria-pressed="${readerFontSize === index}">${label}</button>`).join("")}</div><div class="reader-options"><label>속도 <select id="reader-rate"><option value="0.65" ${r.rate === 0.65 ? "selected" : ""}>천천히</option><option value="0.85" ${r.rate === 0.85 ? "selected" : ""}>보통</option><option value="1.05" ${r.rate === 1.05 ? "selected" : ""}>조금 빠르게</option></select></label><label><input type="checkbox" id="reader-continuous" ${r.continuous ? "checked" : ""}>이어 듣기</label><button data-action="audio-only">${r.audioOnly ? "그림과 글 보기" : "듣기 전용"}</button></div></details><div class="reader-status" id="reader-status">재생 버튼을 누르면 이 쪽을 읽어줘요.</div>${r.page === b.pages.length - 1 ? `<div class="reader-feedback"><button type="button" class="btn btn-green" data-reading-action="feedback" data-id="${esc(b.id)}">다 읽었어요 · 쉬움 / 딱 맞음 / 어려움</button></div>` : ""}`,
    `reader reader-font-${readerFontSize} ` +
      // R12 openings: a sticky bar and word follow (page books unchanged).
      (openings ? "reader-openings " : "") +
      (r.audioOnly ? "audio-only" : ""),
  );
}
function readerWords(text, language) {
  let end = 0;
  return (
    wordsWithOffsets(text)
      .map((word) => {
        const part =
          esc(text.slice(end, word.startChar)) +
          `<span data-reader-word="${language}" data-word-index="${word.index}">${esc(word.word)}</span>`;
        end = word.endChar;
        return part;
      })
      .join("") + esc(text.slice(end))
  );
}
let speechToken = 0;
function stopSpeech() {
  speechToken++;
  stopPlayback();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (reader) reader.speaking = false;
  const playButton = document.querySelector(
    '[data-action="reader-toggle-play"]',
  );
  if (playButton) playButton.textContent = "읽어주기";
  document
    .querySelectorAll("[data-reader-word].is-speaking")
    .forEach((el) => el.classList.remove("is-speaking"));
  const s = document.querySelector("#reader-status");
  if (s) s.textContent = "재생 버튼을 누르면 이 쪽을 읽어줘요.";
}
/** Scroll a spoken word into view only when it is above the top or behind the bar. */
function followReaderWord(el) {
  const modal = el.closest(".modal");
  if (!modal || typeof el.getBoundingClientRect !== "function") return;
  const rect = el.getBoundingClientRect(),
    top = modal.getBoundingClientRect().top,
    bar = modal.querySelector(".reader-pagination"),
    bottom = bar
      ? bar.getBoundingClientRect().top
      : modal.getBoundingClientRect().bottom;
  if (rect.top < top || rect.bottom > bottom)
    el.scrollIntoView({ block: "nearest" });
}
async function speak(language) {
  if (!reader) return;
  stopSpeech();
  const token = speechToken,
    r = reader;
  r.lastLanguage = language;
  r.speaking = true;
  const playButton = document.querySelector(
    '[data-action="reader-toggle-play"]',
  );
  if (playButton) playButton.textContent = "읽기 멈춤";
  const status = document.querySelector("#reader-status"),
    info = audioStatus(r.book, r.page, language);
  if (status)
    status.textContent =
      (language === "ko" ? "한글을 읽고 있어요 · " : "Listening · ") +
      info.label;
  try {
    await playback(r.book, r.page, language, {
      rate: r.rate,
      onWord: (word) => {
        if (token !== speechToken || reader !== r) return;
        document
          .querySelectorAll("[data-reader-word].is-speaking")
          .forEach((el) => el.classList.remove("is-speaking"));
        if (word) {
          const el = document.querySelector(
            `[data-reader-word="${language}"][data-word-index="${word.index}"]`,
          );
          el?.classList.add("is-speaking");
          // R12 openings: keep the spoken word in view above the sticky bar.
          if (el && layoutOf(r.book) === "openings") followReaderWord(el);
        }
      },
      onError: (error) => {
        if (token !== speechToken || reader !== r) return;
        stopSpeech();
        const failed = document.querySelector("#reader-status");
        if (failed)
          failed.textContent =
            "재생하지 못했어요. 다시 재생 버튼을 눌러 주세요.";
        toast(error.message || "읽어주기를 완료하지 못했어요.");
      },
      onEnd: () => {
        if (token !== speechToken || reader !== r) return;
        r.speaking = false;
        if (r.continuous && r.page < r.book.pages.length - 1) {
          r.page++;
          renderReader();
          speak(language);
        } else {
          document
            .querySelectorAll("[data-reader-word].is-speaking")
            .forEach((el) => el.classList.remove("is-speaking"));
          const status = document.querySelector("#reader-status");
          if (status)
            status.textContent =
              r.page === r.book.pages.length - 1
                ? "이야기가 끝났어요. 잘 자, 작은 모험가."
                : "다시 듣거나 다음 쪽으로 넘겨보세요.";
        }
      },
    });
  } catch (error) {
    if (token === speechToken && error.name !== "AbortError") {
      r.speaking = false;
      toast(error);
    }
  }
}
/**
 * Approve `book` into the shelf. With finalizeImages, only `pages` (indexes
 * without a current final picture, from approvalImageWork) and the cover when
 * `cover` is set are drawn at final quality; every other picture is kept.
 */
async function finalizeBook(
  book,
  {
    finalizeImages = false,
    pages = null,
    cover = true,
    cacheAudio = false,
  } = {},
) {
  if (finalizeController) return;
  const originalState = state,
    controller = new AbortController();
  finalizeController = controller;
  const ensure = () => {
    if (
      controller.signal.aborted ||
      state !== originalState ||
      !parentUnlocked ||
      childMode
    )
      throw new DOMException("확정을 취소했어요.", "AbortError");
  };
  showModal(
    `${modalHeader("우리 가족의 책을 엮고 있어요")}<p class="modal-intro" id="book-final-progress">최종 그림과 책을 저장합니다.</p><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">작업 중지</button></div>`,
  );
  try {
    ensure();
    await ensureBookStoryCoherence(state, book, { signal: controller.signal });
    ensure();
    if (finalizeImages) {
      const redraw = pages || book.pages.map((_, index) => index),
        progressText = (done) => {
          const field = document.querySelector("#book-final-progress");
          if (field)
            field.textContent = `최종 본문 그림 ${done} / ${redraw.length}쪽`;
        };
      if (redraw.length === book.pages.length)
        await generateAllScenes(state, book, {
          quality: "final",
          signal: controller.signal,
          onProgress: (progress) => {
            progressText(progress.completed);
            if (progress.status === "complete") {
              syncStoryDraft(book, state);
              save();
            }
          },
        });
      else if (redraw.length) {
        // Pages that already have a current final picture are never bought
        // again: draw only the rest, in page order, saving after each.
        delete book.similarityReviewDismissed;
        for (const [done, index] of redraw.entries()) {
          progressText(done);
          await generateScene(state, book, index, {
            quality: "final",
            signal: controller.signal,
          });
          syncStoryDraft(book, state);
          save();
          ensure();
        }
        progressText(redraw.length);
        if (book.prose) book.stage = "illustrated";
      }
      ensure();
      if (cover) {
        const field = document.querySelector("#book-final-progress");
        if (field) field.textContent = "표지 그림을 만들고 있어요.";
        await generateCover(state, book, {
          quality: "final",
          signal: controller.signal,
        });
      }
    }
    const retryPages = await selectSimilarPages(book, {
      quality: "final",
      signal: controller.signal,
    });
    ensure();
    if (retryPages.length) {
      showModal(
        `${modalHeader("선택한 쪽의 그림을 만들고 있어요")}<p id="book-final-progress" role="status"></p>${btn("작업 중지", "close-modal", "outline")}`,
      );
      for (const index of retryPages) {
        await generateScene(state, book, index, {
          quality: "final",
          changeComposition: true,
          signal: controller.signal,
        });
        syncStoryDraft(book, state);
        save();
        ensure();
      }
    }
    ensure();
    const prior = state.books
        .filter((other) => other.series === book.series)
        .sort((a, b) => (b.episode || 0) - (a.episode || 0))[0],
      snapshot = book.generationSnapshot,
      world = getActiveWorld(state);
    book.styleChanged = Boolean(
      prior &&
        ((prior.imageEngine ||
          prior.generationSnapshot?.imageEngine ||
          "sample") !== (snapshot?.imageEngine || world.imageEngine) ||
          (prior.stylePresetId ||
            prior.generationSnapshot?.stylePresetId ||
            "watercolor") !==
            (snapshot?.stylePresetId || world.stylePresetId) ||
          JSON.stringify(prior.generationSnapshot?.styleReferences || []) !==
            JSON.stringify(snapshot?.styleReferences || [])),
    );
    const entries = [
      ...book.pages.flatMap((page) => [
        page.imageMeta,
        ...(page.imageHistory || []).map((image) => image.imageMeta),
      ]),
      book.cover?.meta,
      ...(book.coverHistory || []).map((image) => image.meta),
    ].filter(Boolean);
    book.imageCosts = {
      requestCount: entries.length,
      estimatedUsd: entries.reduce(
        (sum, entry) => sum + (Number(entry.costUsdEstimated) || 0),
        0,
      ),
      actualUsd:
        entries.length &&
        entries.every((entry) => Number.isFinite(entry.costUsd))
          ? entries.reduce((sum, entry) => sum + entry.costUsd, 0)
          : null,
      actualAvailable:
        entries.length > 0 &&
        entries.every((entry) => Number.isFinite(entry.costUsd)),
      note: "실제 청구액은 공급자가 반환한 경우에만 기록하며 나머지는 단가 기반 추정입니다.",
    };
    if (book.outline)
      book.summaryForNext = summarizeStory(book.outline, {
        ...book.storyInput,
        title: book.title,
        prose: book.prose,
        pagination: book.pagination,
      });
    book.characterSnapshots =
      book.generationSnapshot?.characterSheets?.map((sheet) =>
        structuredClone(sheet.characterSnapshot),
      ) ||
      (book.characterSnapshots?.length
        ? book.characterSnapshots
        : (book.characterIds || []).map((id) => structuredClone(char(id))));
    const priorQuality = state.settings.storyQuality
        ? structuredClone(state.settings.storyQuality)
        : null,
      priorUsedElements = book.usedElements,
      priorApprovedAt = book.approvedAt;
    book.approved = true;
    recordApprovedElements(state, book);
    book.stage = "final";
    book.justCreated = true;
    book.autoReviewPending = false;
    state.books.unshift(book);
    if (!save()) {
      state.books.shift();
      book.approved = false;
      if (priorQuality) state.settings.storyQuality = priorQuality;
      else delete state.settings.storyQuality;
      if (priorUsedElements === undefined) delete book.usedElements;
      else book.usedElements = priorUsedElements;
      if (priorApprovedAt === undefined) delete book.approvedAt;
      else book.approvedAt = priorApprovedAt;
      throw new Error(
        "책을 저장하지 못했어요. 저장 공간을 확보한 뒤 다시 확정해 주세요.",
      );
    }
    const autoPlan = state.fullAutoJobs?.[book.fullAutoRunId]?.plan;
    for (const id of autoPlan?.characterIds || []) {
      const c = char(id);
      if (c) c.autoReviewPending = false;
    }
    for (const id of autoPlan?.backgroundIds || []) {
      const b = state.backgrounds.find((b) => b.id === id);
      if (b) b.autoReviewPending = false;
    }
    finalizeBookRecords(state, book);
    save();
    activeBook = book;
    draft = null;
    wizard = null;
    view = "detail";
    if (cacheAudio) {
      const field = document.querySelector("#book-final-progress");
      if (field) field.textContent = "쪽별 음원을 저장하고 있어요.";
      try {
        book.audioCacheStatus = await prepareBookAudio(book, {
          approved: true,
          signal: controller.signal,
          onProgress: (progress) => {
            const field = document.querySelector("#book-final-progress");
            if (field)
              field.textContent = `음원 ${progress.cached}개 저장 · ${progress.failed}개 실패`;
          },
        });
      } catch (error) {
        book.audioCacheStatus = {
          uncached: true,
          message:
            error.name === "AbortError"
              ? "음원 저장을 중지했어요. 완성된 책은 책장에 보관합니다."
              : error.message,
        };
      }
      save();
    }
    finalizeController = null;
    closeModal();
    render();
    window.scrollTo(0, 0);
    toast("우리 가족의 새 이야기를 책장에 담았어요. 인쇄해서 읽어 보세요.");
  } catch (error) {
    if (finalizeController === controller) {
      finalizeController = null;
      closeModal();
    }
    render();
    toast(
      error.name === "AbortError"
        ? "작업을 중지했어요. 완료된 그림은 초안에 남아 있어요."
        : error.message,
    );
  }
}
/** Approve the open draft (pro editor or simple step ⑤) through one path. */
async function approveDraft() {
  syncDraft();
  if (!draft) return;
  // Only the languages the book is printed in need text (ko-only / en-only books).
  if (!String(draft.title || "").trim() || missingPageText(draft).length) {
    toast(pageTextProblemMessage(draft));
    return;
  }
  const book = draft,
    cacheAudio = document.querySelector("#cache-audio-approval")?.checked;
  try {
    await checkBookAtLevel(book, { rewrite: false, showProgress: true });
  } catch (error) {
    if (error.name === "AbortError") return;
    toast("읽기 검사: " + error.message);
  }
  // Only pages without a current final picture and a missing cover are drawn
  // (and priced): pictures already bought are never bought again, also for a
  // FULL AUTO book whose run never recorded its finish.
  const world = getActiveWorld(state),
    engine = book.generationSnapshot?.imageEngine || world.imageEngine,
    work = approvalImageWork(book, engine),
    finalizeImages = work.finalize && (work.pages.length > 0 || work.cover);
  if (finalizeImages) {
    // R13: the book's frozen picture model; R12: every size priced with it.
    const config = frozenImageConfig(
        world.providerConfig?.[engine],
        book.generationSnapshot,
      ),
      pageEstimate = estimateBookCost({
        engine,
        pageCount: work.pages.length,
        includeCover: work.cover,
        size: "1536x1024",
        quality: "final",
        config,
      }),
      // R12 openings: spreads to draw are priced at their own size (2048x880).
      spreadsToDraw =
        layoutOf(book) === "openings"
          ? work.pages.filter((i) => book.pages[i]?.kind === "spread").length
          : 0,
      spreadDelta = spreadsToDraw
        ? estimateBookCost({
            engine,
            pageCount: spreadsToDraw,
            includeCover: false,
            size: unitImageSize(book, { kind: "spread" }),
            quality: "final",
            config,
          }).costUsd -
          estimateBookCost({
            engine,
            pageCount: spreadsToDraw,
            includeCover: false,
            size: "1536x1024",
            quality: "final",
            config,
          }).costUsd
        : 0,
      estimate = spreadsToDraw
        ? { ...pageEstimate, costUsd: pageEstimate.costUsd + spreadDelta }
        : pageEstimate,
      kept = book.pages.length - work.pages.length,
      what = [
        work.cover ? "표지 1장" : "",
        work.pages.length
          ? `본문 ${work.pages.length}쪽${work.pages.length === book.pages.length ? "" : `(${pageList(work.pages)})`}`
          : "",
      ]
        .filter(Boolean)
        .join("과 ");
    showModal(
      `${modalHeader("최종 그림을 만들고 책을 확정할까요?")}<p class="modal-intro">${what}을 최종 품질로 생성합니다.${kept ? ` 이미 최종 그림이 있는 ${kept}쪽은 다시 만들지 않아요.` : ""}${work.stale.length ? ` 글을 고친 ${pageList(work.stale)}도 새로 그려요.` : ""} 확정한 캐릭터·옷장·스타일과 장소 참조를 사용하며, 앞쪽 그림을 이어 참조하도록 한 쪽씩 순서대로 만듭니다.</p><div class="notice">${estimate.pricingUnknown ? `예상 이미지 API 비용 · 요금 정보 없음 (목록에 없는 모델 · ${estimate.imageCount}장)` : `예상 이미지 API 비용 약 $${estimate.costUsd.toFixed(2)} (${estimate.imageCount}장)`} · 입력 참조·재시도 비용 별도${cacheAudio ? `<br>음원 예상 약 $${estimateBookAudio(book).costUsd.toFixed(3)} · OpenAI 키가 있을 때` : ""}</div><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">더 다듬기</button><button type="button" class="btn btn-primary" id="book-final-confirm">비용 확인 · 최종 생성하고 확정</button></div>`,
    );
    document.querySelector("#book-final-confirm").onclick = () =>
      finalizeBook(book, {
        finalizeImages,
        pages: work.pages,
        cover: work.cover,
        cacheAudio,
      });
  } else await finalizeBook(book, { cacheAudio });
}
/** "3·5쪽" for page indexes. */
function pageList(indexes) {
  return indexes.map((i) => i + 1).join("·") + "쪽";
}
/** Leave the open draft through its guard; onCancel runs when the parent stays (simple screen). */
function discardDraft(next, { onCancel = null } = {}) {
  // A dialog that must stay (the one-time recovery code, a pending sign-in) is
  // never replaced by this one: the parent stays where they are.
  if (modalRoot.querySelector("[data-modal-lock]")) {
    onCancel?.();
    return;
  }
  if (simpleDraftOpen()) {
    const editing = !!wizard?.simpleEditing,
      // A page or run drawing for this story goes on after the parent leaves.
      drawing = simpleDrawingInFlight();
    showModal(
      `${modalHeader("검수 중인 이야기는 보관돼요")}<p class="modal-intro">만든 글과 그림은 ‘제작 중인 이야기’에 남아 있어요. 다시 ‘이야기 만들기’에서 이어서 검수할 수 있어요.${drawing ? "<br>지금 그리는 그림은 나가도 계속 만들어 이 이야기에 보관해요." : ""}${editing ? "<br><strong>고치던 이 쪽 글은 저장되지 않아요.</strong>" : ""}</p><div class="modal-actions">${btn("계속 검수하기", "close-modal", "outline")}<button class="btn btn-primary" id="discard-confirm">나가기</button></div>`,
    );
    let leaving = false;
    if (onCancel)
      document.addEventListener(
        "donghwa:modal-closed",
        () => {
          if (!leaving) onCancel();
        },
        { once: true },
      );
    document.querySelector("#discard-confirm").onclick = () => {
      leaving = true;
      draft = null;
      wizard = null;
      closeModal();
      next();
    };
    return;
  }
  if (draft && view === "edit") {
    syncDraft();
    showModal(
      `${modalHeader("아직 확정하지 않은 이야기예요")}<p class="modal-intro">확정 전 초안은 책장에 저장되지 않습니다. 책장을 나가면 이번 초안을 잃게 돼요.</p><div class="modal-actions">${btn("계속 다듬기", "close-modal", "outline")}<button class="btn btn-primary" id="discard-confirm">초안 버리고 이동</button></div>`,
    );
    document.querySelector("#discard-confirm").onclick = () => {
      draft = null;
      closeModal();
      next();
    };
  } else next();
}
let readerTouch = null;
modalRoot.addEventListener("pointerdown", (event) => {
  if (reader && event.target.closest(".reader-page"))
    readerTouch = { x: event.clientX, y: event.clientY };
});
modalRoot.addEventListener("pointerup", (event) => {
  if (!readerTouch || !reader) return;
  const dx = event.clientX - readerTouch.x,
    dy = event.clientY - readerTouch.y;
  readerTouch = null;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 55)
    modalRoot
      .querySelector(
        `[data-action="${dx < 0 ? "reader-next" : "reader-prev"}"]:not(:disabled)`,
      )
      ?.click();
});
root.addEventListener("click", onAction);
modalRoot.addEventListener("click", onAction);
async function onAction(e) {
  if (applyingCloud) return;
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action,
    id = el.dataset.id;
  if (a === "open-story-text-settings") {
    protectedAction(() => openStoryTextSettings());
    return;
  }
  if (a === "return-story-settings") {
    protectedAction(() => {
      const back = textSettingsReturn;
      textSettingsReturn = null;
      if (!back) return;
      view = back.view;
      if (back.wizard) wizard = back.wizard;
      render();
      if (back.draftId)
        resumeStoryDraft(back.draftId, { useCurrentTextSettings: true });
    });
    return;
  }
  if (a === "cloud-open") {
    showCloudPanel();
    return;
  }
  // Family ID accounts. The ChatGPT links are checked first (FULL AUTO, stored family session).
  if (a === "chatgpt-signin" || a === "chatgpt-signout") {
    await followChatGptLink(e, el);
    return;
  }
  if (a === "family-login" || a === "family-signup") {
    openFamilyAuth(a === "family-login" ? "login" : "signup");
    return;
  }
  if (a === "family-migrate") {
    openFamilyAuth("signup", {
      notice:
        "ChatGPT 계정의 클라우드 책장은 그대로 남아요. 가족 아이디로 로그인한 뒤 이 기기의 책을 올릴지 고를 수 있어요. 이미 가족 아이디가 있으면 ‘로그인’을 눌러 주세요.",
    });
    return;
  }
  if (a === "family-logout") {
    accountAction(() => void familyLogoutAction());
    return;
  }
  if (a === "family-password") {
    accountAction(openFamilyPassword);
    return;
  }
  if (a === "family-delete") {
    accountAction(openFamilyDelete);
    return;
  }
  if (a === "cloud-continue-local") {
    continueLocalOnlyWithPin();
    return;
  }
  if (a === "settings-jump") {
    e.preventDefault();
    document
      .getElementById(el.dataset.target)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (a === "toggle-ui-mode") {
    protectedAction(() => {
      // Screen only: state, drafts, books and the in-memory wizard stay as they are.
      if (view === "create" && wizard && !simpleCreateActive()) syncWizard();
      if (wizard?.simpleForced) delete wizard.simpleForced;
      uiMode = writeUiMode(nextUiMode(uiMode));
      if (uiMode === "simple") {
        if (settingsTab !== "simple") lastProSettingsTab = settingsTab;
        settingsTab = "simple";
      } else if (settingsTab === "simple")
        settingsTab = lastProSettingsTab || "home";
      if (view === "settings")
        history.replaceState(null, "", "#settings=" + settingsTab);
      render();
      toast(
        uiMode === "simple"
          ? "쉬운 모드예요. 세부 설정은 프로페셔널 모드에 그대로 있어요."
          : "프로페셔널 모드예요. 모든 세부 설정을 볼 수 있어요.",
      );
    });
    return;
  }
  if (a === "settings-tab") {
    if (uiMode === "simple") return;
    settingsTab = el.dataset.tab;
    lastProSettingsTab = settingsTab;
    history.replaceState(null, "", "#settings=" + settingsTab);
    render();
    return;
  }
  if (a === "save-settings-tab") {
    await saveSettingsTab();
    return;
  }
  if (a === "cloud-refresh") {
    await cloudSync?.refresh();
    showCloudPanel();
    return;
  }
  if (a === "cloud-push") {
    protectedAction(() => confirmCloudChange("push"));
    return;
  }
  if (a === "cloud-pull") {
    if (storageBlocked || cloudPrivacyLocked) confirmCloudChange("pull");
    else protectedAction(() => confirmCloudChange("pull"));
    return;
  }
  if (a === "device-transfer") {
    if (storageBlocked) showDeviceTransfer();
    else protectedAction(showDeviceTransfer);
    return;
  }
  if (a === "cleanup-work-records") {
    protectedAction(() => {
      const cleaned = cleanupOldWorkRecords(state);
      if (save()) {
        render();
        toast(`작업 기록 ${cleaned}건을 정리했어요. 완성된 책과 진행 중인 작업은 그대로예요.`);
      }
    });
    return;
  }
  if (a === "show-invalid-records") {
    showModal(
      `${modalHeader("읽지 못한 항목")}<p>나머지 책과 재료는 계속 사용할 수 있어요. 아래 항목의 원본도 이 기기에 보존합니다.</p><ul>${(initialLibrary.invalidRecords || []).map((item) => `<li>${esc(item.record?.title || item.record?.name || item.record?.id || item.collection)} · ${esc(item.error)}</li>`).join("")}</ul>${btn("원본 파일 보관", "download-original", "outline", "download")}`,
    );
    return;
  }
  if (a === "download-original") {
    if (initialLibrary.raw)
      downloadFile(
        decodeStoredLibrary(initialLibrary.raw),
        "donghwa-workshop-original.json",
        "application/json",
      );
    return;
  }
  if (a === "download-recovery") {
    try {
      const point = await latestRecoveryPoint();
      if (!point) return toast("보관된 복구 파일이 아직 없어요.");
      downloadFile(
        point.mediaDeferred
          ? (await createLibraryBackup(JSON.parse(decodeStoredLibrary(point.text)))).text
          : decodeStoredLibrary(point.text),
        "donghwa-workshop-recovery.json",
        "application/json",
      );
    } catch (error) {
      toast(error);
    }
    return;
  }
  if (a === "transfer-export") {
    if (!parentUnlocked || deviceTransferBusy) return;
    deviceTransferBusy = true;
    const field = document.getElementById("device-transfer-status");
    if (field) field.textContent = "그림과 시트를 파일에 담고 있어요.";
    try {
      const result = await downloadLibraryTransfer(state);
      if (field)
        field.textContent = `${result.filename} 저장 완료 · 모바일로 파일을 보내 가져와 주세요.`;
    } catch (error) {
      if (field) field.textContent = error.message;
    } finally {
      deviceTransferBusy = false;
    }
    return;
  }
  if (a === "close-modal") {
    closeModal();
    return;
  }
  if (a === "toggle-mode") {
    if (childMode)
      protectedAction(() => {
        view = "library";
        tab = "all";
        render();
      });
    else
      discardDraft(() => {
        cleanupFullAuto();
        cleanupStoryQualityUI();
        closeModal();
        clearDirectBlobCache();
        lockVault();
        vaultSessionPin = null;
        childMode = true;
        query = "";
        settingsValues.clear();
        settingsDirty.clear();
        settingsDirtyPanels.clear();
        parentUnlocked = false;
        view = "library";
        tab = "all";
        render();
        toast("아이 모드에서는 읽기와 듣기만 열려요.");
      });
    return;
  }
  if (a === "nav") {
    const go = () =>
      discardDraft(() => {
        view = el.dataset.view;
        if (view === "create" && !wizard) startStory();
        else render();
        window.scrollTo(0, 0);
      });
    if (el.dataset.view === "library") go();
    else protectedAction(go);
    return;
  }
  if (a === "library") {
    discardDraft(() => {
      view = "library";
      activeBook = null;
      render();
    });
    return;
  }
  if (a === "child-favorites") {
    view = "library";
    tab = "favorites";
    render();
    return;
  }
  if (a === "tab") {
    tab = el.dataset.tab;
    updateBookResults();
    document
      .querySelectorAll(".tab[data-tab]")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.tab === tab),
      );
    return;
  }
  if (a === "revise-book-copy") {
    protectedAction(() => {
      const source = bookById(id);
      if (!source) return;
      draft = structuredClone(source);
      draft.id = "book-" + crypto.randomUUID();
      draft.sourceBookId = source.id;
      draft.title = source.title + " (수정본)";
      draft.approved = false;
      draft.stage = "paged";
      draft.createdAt = new Date().toISOString();
      draft.reads = 0;
      delete draft.printedAt;
      delete draft.paperReadAt;
      delete draft.justCreated;
      draft.pages.forEach((page) => {
        page.ko ??= page.textKo || "";
        page.en ??= page.textEn || "";
      });
      if (source.storyDraftId && state.storyDrafts?.[source.storyDraftId]) {
        const previous = state.storyDrafts[source.storyDraftId],
          copy = structuredClone(previous);
        copy.id = "story-" + crypto.randomUUID();
        copy.bookId = draft.id;
        copy.selectedTitle = draft.title;
        copy.stage = "paged";
        copy.updatedAt = new Date().toISOString();
        state.storyDrafts[copy.id] = copy;
        draft.storyDraftId = copy.id;
        syncStoryDraft(draft, state);
        save();
      } else delete draft.storyDraftId;
      editPage = 0;
      view = "edit";
      render();
      window.scrollTo(0, 0);
      toast("원본은 보존됩니다. 수정본에서 그림과 글을 확인해 주세요.");
    });
    return;
  }
  if (a === "open-book") {
    activeBook = bookById(id);
    if (!activeBook) {
      toast("책을 찾을 수 없어요. 책장을 새로 불러옵니다.");
      view = "library";
      render();
      return;
    }
    if (childMode) {
      startReading(activeBook);
      return;
    }
    view = "detail";
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (a === "favorite") {
    protectedAction(() => {
      const b = bookById(id);
      if (!b) return;
      b.favorite = !b.favorite;
      if (!save()) return;
      const card = el.closest(".book-card");
      if (card) {
        if (tab === "favorites" && !b.favorite) card.remove();
        else card.outerHTML = bookCard(b);
      } else {
        el.innerHTML =
          icon("heart") + (b.favorite ? "즐겨찾기 해제" : "즐겨찾기");
      }
      const count = document.querySelector(".shelf-title .count");
      if (count) count.textContent = filteredBooks().length + "권의 이야기";
      toast(b.favorite ? "좋아하는 책에 담았어요." : "즐겨찾기에서 꺼냈어요.");
    });
    return;
  }
  if (a === "new-story") {
    protectedAction(() => startStory());
    return;
  }
  if (a === "continue-book" || a === "branch-book") {
    protectedAction(() => {
      startStory(bookById(id));
      if (a === "branch-book") {
        wizard.previousBookId = null;
        wizard.series = "";
        render();
      }
    });
    return;
  }
  if (a === "select-character") {
    if (!wizard) return;
    const ids = wizard.characterIds;
    if (ids.includes(id)) wizard.characterIds = ids.filter((v) => v !== id);
    else if (ids.length < 7) ids.push(id);
    else toast("주인공과 조연을 합해 최대 7명이에요.");
    render();
    return;
  }
  if (a === "select-background") {
    if (!wizard) return;
    const ids = wizard.backgroundIds;
    if (ids.includes(id)) wizard.backgroundIds = ids.filter((v) => v !== id);
    else if (ids.length < 5) ids.push(id);
    else toast("배경은 집을 포함해 최대 5곳을 고를 수 있어요.");
    render();
    return;
  }
  if (a === "wizard-back") {
    if (!wizard) return;
    syncWizard();
    wizard.step = Math.max(1, wizard.step - 1);
    render();
    return;
  }
  if (a === "wizard-next") {
    if (!wizard) return;
    syncWizard();
    if (wizard.step === 1 && !wizard.characterIds.length) {
      toast("주인공을 한 명 골라 주세요.");
      return;
    }
    if (wizard.step === 2) {
      const check = safeTopic(wizard.topic);
      if (!check.ok) {
        toast(check.message || "이야기 주제를 입력해 주세요.");
        return;
      }
    }
    if (wizard.step >= 3) {
      if (wizard.value === "custom" && !wizard.valueCustom?.trim()) {
        toast("함께 생각할 가치를 직접 적어 주세요.");
        return;
      }
      if (wizard.ending === "custom" && !wizard.endingCustom?.trim()) {
        toast("이야기의 끝을 직접 적어 주세요.");
        return;
      }
      const check = safeTopic(wizard.topic);
      if (!check.ok) {
        toast(check.message || "이야기 주제를 입력해 주세요.");
        return;
      }
      try {
        validateWardrobeSelections(state, wizard);
      } catch (error) {
        toast(error);
        return;
      }
      if (wizard.step === 4) {
        startStoryWorkflow(wizard);
        return;
      }
    }
    wizard.step++;
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (a === "topic-chip") {
    document.getElementById("topic").value = el.dataset.topic;
    wizard.topic = el.dataset.topic;
    document.querySelector("#wardrobe-topic-suggestions").innerHTML =
      renderTopicWardrobe(wizard);
    return;
  }
  if (a === "child-pick") {
    syncWizard();
    showModal(
      `${modalHeader("어떤 모험이 좋아?")}<p class="modal-intro">그림 하나를 손가락으로 골라 주세요.</p><div class="theme-cards">${[
        ["🦕", "공룡", "공룡 친구와 소풍"],
        ["🌙", "달", "달에 놀러 간 날"],
        ["🐳", "바다", "바닷속 보물 찾기"],
      ]
        .map(
          ([emoji, label, topic]) =>
            `<button class="theme-card" data-action="pick-topic" data-topic="${topic}"><span>${emoji}</span><strong>${label}</strong></button>`,
        )
        .join("")}</div>`,
    );
    return;
  }
  if (a === "pick-topic") {
    wizard.topic = el.dataset.topic;
    closeModal();
    render();
    return;
  }
  if (a === "generate") {
    syncWizard();
    startStoryWorkflow(wizard);
    return;
  }
  if (a === "check-tab") {
    syncDraft();
    checksTab = el.dataset.tab;
    render();
    return;
  }
  if (a === "edit-page") {
    syncDraft();
    editPage = Number(el.dataset.page);
    render();
    document.querySelector("#page-ko")?.focus();
    return;
  }
  if (a === "regenerate-art") {
    syncDraft();
    if (draft.pages[editPage].imageAssetId) {
      toast("생성한 그림은 ‘이 쪽 그림 생성’으로 다시 만들 수 있어요.");
      return;
    }
    draft.pages[editPage].artVariant =
      (draft.pages[editPage].artVariant || 0) + 1;
    render();
    toast("이 쪽의 그림 구도를 바꿨어요.");
    return;
  }
  if (a === "align-english") {
    // R30.1 영어 맞추기: this page's English rewritten to match its Korean (the price is on the button).
    syncDraft();
    const target = draft,
      index = editPage;
    if (!canAlignEnglish(target)) {
      toast("이 책은 영어 맞추기를 할 수 없어요. 영어 칸을 직접 고쳐 주세요.");
      return;
    }
    el.disabled = true;
    toast("영어를 한글에 맞추고 있어요…");
    try {
      const result = await requestPageEnglish(state, target, index);
      recordPageTextUsage(state, target, result.row);
      const page = target.pages[index];
      page.en = result.en;
      if (target.pagination) {
        page.textEn = result.en;
        if (target.pagination.pages[index]) target.pagination.pages[index].textEn = result.en;
      }
      target.readingCheck = null;
      save();
      render();
      toast(
        result.warnings?.length
          ? `영어를 맞췄어요 · 참고: ${result.warnings[0]}`
          : "영어를 한글에 맞췄어요.",
      );
    } catch (error) {
      if (error?.usageRow) {
        recordPageTextUsage(state, target, error.usageRow);
        save();
      }
      el.disabled = false;
      toast(error?.message || String(error));
    }
    return;
  }
  if (a === "regenerate-text") {
    syncDraft();
    // The story workflow would rebuild the book; a FULL AUTO job's book is never rebuilt.
    if (fullAutoJobOfStory(draft.storyDraftId)) {
      toast(FULL_AUTO_NOT_REBUILT);
      return;
    }
    if (draft.storyDraftId) {
      syncStoryDraft(draft, state);
      resumeStoryDraft(draft.storyDraftId);
    } else toast("새 이야기의 줄거리·전문 단계를 사용해 주세요.");
    return;
  }
  if (a === "approve-book") {
    await approveDraft();
    return;
  }
  if (a === "new-character") {
    protectedAction(openStudio);
    return;
  }
  if (a === "candidate") {
    studio.variant = Number(el.dataset.variant);
    showCandidates();
    return;
  }
  if (a === "studio-back") {
    showStudioForm();
    return;
  }
  if (a === "studio-candidates") {
    showCandidates();
    return;
  }
  if (a === "studio-test") {
    showStudioTest();
    return;
  }
  if (a === "save-character") {
    const c = {
      ...studio,
      id: "char-" + crypto.randomUUID(),
      traits: studio.traits.split(",").map((t) => t.trim()),
      version: (studio.version || 0) + 1,
      characterSheets: [],
      wardrobe: [],
      createdAt: new Date().toISOString(),
    };
    state.characters.push(c);
    markCharacterSheetConfirmed(state, c.id, {
      imageUrl:
        "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent(characterSVG(c, c.variant || 0)),
      seed: null,
      meta: {
        source: "local-svg",
        requestedSeed:
          crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff,
      },
    });
    if (!save()) {
      state.characters.pop();
      return;
    }
    closeModal();
    view = "materials";
    render();
    toast(c.name + "의 모습을 이야기 재료에 저장했어요.");
    return;
  }
  if (a === "character-sheet") {
    protectedAction(() => showCharacter(char(id)));
    return;
  }
  if (a === "version-character") {
    studio = {
      ...char(id),
      traits: Array.isArray(char(id).traits)
        ? char(id).traits.join(", ")
        : char(id).traits,
      name: char(id).name + " (새 버전)",
    };
    showStudioForm();
    return;
  }
  if (a === "new-background") {
    protectedAction(showBackgroundForm);
    return;
  }
  if (a === "preview-draft-print") {
    syncDraft();
    if (draft) showPrintOptions(draft);
    return;
  }
  if (a === "print-options") {
    protectedAction(() => showPrintOptions(bookById(id)));
    return;
  }
  if (a === "read-book") {
    const book = bookById(id);
    startReading(book);
    if (childMode && reader?.book === book) void speak(reader.lastLanguage);
    return;
  }
  if (a === "paper-read") {
    protectedAction(() => {
      const b = bookById(id);
      if (!b) return;
      b.paperReads = (b.paperReads || 0) + 1;
      b.paperReadAt = new Date().toISOString();
      save();
      el.textContent = `오늘 종이로 읽음 · ${b.paperReads}회`;
      toast("오늘 종이책으로 읽은 날을 기록했어요.");
    });
    return;
  }
  if (a === "reader-font") {
    readerFontSize = Number(el.dataset.size);
    try {
      localStorage.setItem("donghwa-reader-font-size", String(readerFontSize));
    } catch {}
    const modal = modalRoot.querySelector(".reader");
    if (modal) {
      modal.classList.remove("reader-font-0", "reader-font-1", "reader-font-2");
      modal.classList.add("reader-font-" + readerFontSize);
    }
    document
      .querySelectorAll('[data-action="reader-font"]')
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(Number(button.dataset.size) === readerFontSize),
        ),
      );
    return;
  }
  if (a === "reader-toggle-play") {
    if (reader?.speaking) {
      stopSpeech();
      el.textContent = "읽어주기";
    } else if (reader) {
      el.textContent = "읽기 멈춤";
      void speak(reader.lastLanguage);
    }
    return;
  }
  if (a === "speak-ko" || a === "speak-en") {
    speak(a === "speak-ko" ? "ko" : "en");
    return;
  }
  if (a === "stop-speech") {
    stopSpeech();
    return;
  }
  if (a === "replay-speech") {
    speak(
      reader?.lastLanguage || (reader?.book.language === "en" ? "en" : "ko"),
    );
    return;
  }
  if (a === "reader-next" || a === "reader-prev") {
    if (!reader) return;
    stopSpeech();
    reader.page += a === "reader-next" ? 1 : -1;
    reader.page = Math.max(
      0,
      Math.min(reader.book.pages.length - 1, reader.page),
    );
    renderReader();
    return;
  }
  if (a === "audio-only") {
    if (!reader) return;
    reader.audioOnly = !reader.audioOnly;
    modalRoot
      .querySelector(".reader")
      ?.classList.toggle("audio-only", reader.audioOnly);
    el.textContent = reader.audioOnly ? "그림과 글 보기" : "듣기 전용";
    return;
  }
  if (a === "change-pin") {
    showModal(
      `${modalHeader("부모 PIN 바꾸기")}<p class="modal-intro">새로 사용할 숫자 4자리를 두 번 입력해 주세요.</p><form id="change-pin-form"><div class="form-grid"><div class="field"><label for="new-pin">새 PIN</label><input id="new-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required autocomplete="off"></div><div class="field"><label for="confirm-pin">새 PIN 확인</label><input id="confirm-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required autocomplete="off"></div></div><p class="text-error" id="change-pin-error"></p><div class="modal-actions"><button class="btn btn-green" type="submit">PIN 저장</button></div></form>`,
    );
    return;
  }
  if (a === "export-library") {
    protectedAction(async () => {
      try {
        const r = await exportLibrary(state);
        toast(r.bookCount + "권과 이야기 재료를 ZIP으로 백업했어요.");
      } catch (err) {
        toast(err);
      }
    });
    return;
  }
  if (a === "import-library") {
    protectedAction(() => document.querySelector("#import-file").click());
    return;
  }
}
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "pin-form") {
    const pin = document.querySelector("#pin").value;
    const error = document.querySelector("#pin-error");
    if (!/^\d{4}$/.test(pin)) {
      error.textContent = "숫자 4자리를 입력해 주세요.";
      return;
    }
    if (
      !state.settings.pinHash &&
      pin !== document.querySelector("#pin-confirm").value
    ) {
      error.textContent = "두 PIN이 달라요. 다시 확인해 주세요.";
      return;
    }
    const h = await hashPin(pin);
    if (state.settings.pinHash && state.settings.pinHash !== h) {
      error.textContent = "PIN이 맞지 않아요.";
      document.querySelector("#pin").value = "";
      return;
    }
    const submitButton = f.querySelector("button[type=submit]");
    submitButton.disabled = true;
    let vaultWarning = "";
    try {
      await unlockVault(pin);
    } catch (problem) {
      if (!state.settings.pinHash) {
        error.textContent = problem.message;
        submitButton.disabled = false;
        return;
      }
      if (!f.dataset.allowLockedVault) {
        error.textContent =
          "부모 PIN은 맞지만 API 키 보관함을 열지 못했어요. 키를 초기화하면 공급자에서 다시 복사해 등록해야 해요.";
        submitButton.disabled = false;
        let recovery = f.querySelector(".vault-recovery");
        if (!recovery) {
          recovery = document.createElement("div");
          recovery.className = "vault-recovery";
          f.append(recovery);
        }
        recovery.innerHTML =
          '<button type="button" class="btn btn-outline" id="vault-reset">저장된 API 키 초기화 · 다시 등록</button><button type="button" class="btn btn-plain" id="vault-skip">키 없이 부모 모드 열기</button>';
        recovery.querySelector("#vault-reset").onclick = async (event) => {
          const resetButton = event.currentTarget;
          resetButton.disabled = true;
          try {
            await resetVault(pin);
            f.requestSubmit();
          } catch (problem) {
            error.textContent = problem.message;
            resetButton.disabled = false;
          }
        };
        recovery.querySelector("#vault-skip").onclick = () => {
          f.dataset.allowLockedVault = "1";
          f.requestSubmit();
        };
        return;
      }
      vaultWarning =
        problem.message +
        " 부모 모드는 열리지만 저장된 API 키는 다시 등록해야 할 수 있어요.";
    }
    if (!f.isConnected) {
      if (!state.settings.pinHash) {
        state.settings.pinHash = h;
        save();
      }
      clearDirectBlobCache();
      lockVault();
      return;
    }
    vaultSessionPin = pin;
    if (!state.settings.pinHash) {
      state.settings.pinHash = h;
      if (!save()) return;
    }
    const next = pinCallback;
    closeModal();
    parentUnlocked = true;
    childMode = false;
    checkDueQualityCoach?.();
    if (next) next();
    else render();
    if (vaultWarning) toast(vaultWarning);
    return;
  }
  if (f.id === "settings-form") {
    // Read everything first and apply all-or-nothing: a reduced form (simple
    // settings) or a missing field keeps the stored value instead of half-saving.
    const keys = [
        "defaultLanguage",
        "defaultPages",
        "defaultLayout",
        "dailyLimit",
        "rate",
      ],
      readingKeys = [
        "defaultKoreanLevel",
        "defaultEnglishLevel",
        "srLexile",
        "readingCheckerMode",
        "pendingReadingSuggestions",
      ],
      before = Object.fromEntries(
        [...keys, ...readingKeys].map((k) => [
          k,
          Object.hasOwn(state.settings, k)
            ? structuredClone(state.settings[k])
            : undefined,
        ]),
      ),
      restore = () => {
        for (const [k, value] of Object.entries(before))
          if (value === undefined) delete state.settings[k];
          else state.settings[k] = value;
      };
    try {
      const next = {};
      for (const k of keys)
        next[k] = f.querySelector("#" + k)?.value ?? state.settings[k];
      for (const k of ["defaultPages", "dailyLimit", "rate"]) {
        next[k] = Number(next[k]);
        if (!Number.isFinite(next[k]))
          throw new Error("설정 값을 확인해 주세요.");
      }
      if (document.getElementById("default-koreanLevel"))
        readReadingSettings(state.settings);
      Object.assign(state.settings, next);
    } catch (error) {
      restore();
      e.settingsFailed = true;
      toast(error);
      return;
    }
    if (save()) toast("우리 가족의 기본 설정을 저장했어요.");
    else {
      restore();
      e.settingsFailed = true;
    }
    return;
  }
  if (f.id === "change-pin-form") {
    const p = document.getElementById("new-pin").value;
    if (p !== document.getElementById("confirm-pin").value) {
      document.getElementById("change-pin-error").textContent =
        "두 PIN이 달라요.";
      return;
    }
    const previousHash = state.settings.pinHash,
      previousPin = vaultSessionPin;
    try {
      const nextHash = await hashPin(p);
      state.settings.pinHash = nextHash;
      if (!save()) {
        state.settings.pinHash = previousHash;
        throw new Error(
          "PIN을 저장하지 못했어요. 저장 공간을 확보한 뒤 다시 시도해 주세요.",
        );
      }
      try {
        await setVaultPin(previousPin, p);
      } catch (error) {
        state.settings.pinHash = previousHash;
        save();
        throw error;
      }
      vaultSessionPin = p;
      closeModal();
      toast("부모 PIN과 API 키 암호화를 바꿨어요.");
    } catch (error) {
      document.getElementById("change-pin-error").textContent = error.message;
    }
    return;
  }
  if (f.id === "character-form") {
    for (const [k, id] of [
      ["name", "c-name"],
      ["nameEn", "c-nameEn"],
      ["role", "c-role"],
      ["kind", "c-kind"],
      ["gender", "c-gender"],
      ["age", "c-age"],
      ["color", "c-color"],
      ["hairColor", "c-hair"],
      ["skinColor", "c-skin"],
      ["description", "c-description"],
      ["traits", "c-traits"],
      ["catchphrase", "c-catchphrase"],
      ["relationships", "c-relationships"],
    ])
      studio[k] = document.getElementById(id).value.trim();
    studio.age = Number(studio.age);
    if (!studio.name || !studio.nameEn) {
      toast("한글·영어 이름을 입력해 주세요.");
      return;
    }
    if (getActiveWorld(state).imageEngine !== "sample") {
      const c = {
        ...studio,
        id: "char-" + crypto.randomUUID(),
        traits: studio.traits.split(",").map((t) => t.trim()),
        version: 1,
        characterSheets: [],
        wardrobe: [],
        createdAt: new Date().toISOString(),
      };
      previewNewCharacter(c);
    } else showCandidates();
    return;
  }
  if (f.id === "background-form") {
    let type;
    try {
      type = readPlaceType(
        document.getElementById("b-type").value,
        document.getElementById("b-type-custom")?.value,
      );
    } catch (error) {
      toast(error.message);
      return;
    }
    state.backgrounds.push({
      id: "bg-" + crypto.randomUUID(),
      name: document.getElementById("b-name").value.trim(),
      type,
      description: document.getElementById("b-description").value.trim(),
      layout: document.getElementById("b-layout").value.trim(),
    });
    if (save()) {
      closeModal();
      render();
      toast("다음 이야기에도 꺼내 쓸 수 있는 장소가 생겼어요.");
    }
    return;
  }
  if (f.id === "print-form") {
    const b = draft?.id === f.dataset.id ? draft : bookById(f.dataset.id);
    const s = {};
    for (const k of [
      "layout",
      "language",
      "pages",
      "color",
      "fontSize",
      "margin",
      "textPosition",
    ])
      s[k] = document.getElementById("p-" + k).value;
    try {
      if (printBook(b, s, state.characters)) {
        b.printedAt = new Date().toISOString();
        save();
        closeModal();
        render();
        toast("인쇄 창에서 프린터 또는 PDF 저장을 선택해 주세요.");
      } else toast("팝업을 허용한 뒤 인쇄 창을 다시 열어 주세요.");
    } catch (err) {
      toast(err);
    }
    return;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "topic" && wizard) {
    wizard.topic = e.target.value;
    const panel = document.querySelector("#wardrobe-topic-suggestions");
    if (panel) panel.innerHTML = renderTopicWardrobe(wizard);
  }
  if (e.target.id === "search-books") {
    query = e.target.value;
    updateBookResults();
  }
});
/**
 * R12 page count of the pro wizard's step 3: a parent's pick is kept (touched);
 * a language or level change that moves the wizard between page and openings
 * layouts snaps the count and swaps the choices (12/16 for openings). Within one
 * layout nothing changes, so with openings off this never runs.
 */
function syncWizardPageCount(target) {
  if (target.id === "pageCount") {
    wizard.pageCountTouched = true;
    return;
  }
  const before = layoutFor(wizard);
  syncWizard();
  const after = layoutFor(wizard);
  if (before === after) return;
  wizard.pageCount = snapPageCount(after, wizard.pageCount, {
    touched: !!wizard.pageCountTouched,
    defaultPages: state.settings.defaultPages,
  });
  const select = document.getElementById("pageCount");
  if (select)
    select.innerHTML = pageCountOptions(wizard)
      .map(
        ([v, t]) =>
          `<option value="${v}" ${String(v) === String(wizard.pageCount) ? "selected" : ""}>${t}</option>`,
      )
      .join("");
}
document.addEventListener("change", async (e) => {
  if (
    view === "create" &&
    wizard?.step === 3 &&
    !simpleCreateActive() &&
    ["pageCount", "language", "koreanLevel", "englishLevel"].includes(
      e.target.id,
    )
  )
    syncWizardPageCount(e.target);
  if (
    view === "create" &&
    wizard?.step === 3 &&
    ["value", "ending"].includes(e.target.id)
  ) {
    syncWizard();
    document.querySelector("#value-custom-field").hidden =
      wizard.value !== "custom";
    document.querySelector("#ending-custom-field").hidden =
      wizard.ending !== "custom";
  }
  if (e.target.id === "sort") {
    sort = e.target.value;
    updateBookResults();
  }
  if (e.target.id === "reader-rate" && reader) {
    reader.rate = Number(e.target.value);
  }
  if (e.target.id === "reader-continuous" && reader) {
    reader.continuous = e.target.checked;
  }
  if (e.target.id === "import-file" || e.target.id === "device-transfer-file") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await showLibraryImport(file);
  }
});
document.addEventListener("keydown", (e) => {
  if (!modalRoot.firstChild) return;
  if (e.key === "Escape") {
    // A pending sign-in and the one-time recovery code must not vanish on Escape.
    if (modalRoot.querySelector("[data-modal-lock]")) return;
    closeModal();
    return;
  }
  if (e.key === "Tab") {
    const focus = [
      ...modalRoot.querySelectorAll(
        "button:not(:disabled),input:not([hidden]),textarea,select",
      ),
    ].filter((x) => x.offsetParent !== null);
    const first = focus[0],
      last = focus.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
  if (
    reader &&
    !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)
  ) {
    if (e.key === "ArrowRight" && reader.page < reader.book.pages.length - 1) {
      stopSpeech();
      reader.page++;
      renderReader();
    }
    if (e.key === "ArrowLeft" && reader.page > 0) {
      stopSpeech();
      reader.page--;
      renderReader();
    }
  }
});
configureWorldVariations({
  getState: () => state,
  save,
  render,
  toast,
  showModal,
  closeModal,
  modalHeader,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
  onSwitch: () => {
    wizard = null;
    draft = null;
    settingsValues.clear();
    settingsDirty.clear();
    settingsDirtyPanels.clear();
  },
});
configureBackgroundSheets({
  getState: () => state,
  save,
  render,
  toast,
  showModal,
  closeModal,
  modalHeader,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
});
configureFamilyAuthUI({
  getSync: () => cloudSync,
  getStatus: () => cloudStatus,
  showModal,
  closeModal,
  modalHeader,
  toast,
  // Show where the new account stands (source choice, lock or connected).
  onSignedIn: () => {
    if (!modalRoot.firstChild) showCloudPanel();
  },
});
configureTextSettingsUI({
  getState: () => state,
  save,
  render,
  toast,
  isParent: () => parentUnlocked && !childMode,
  protectedAction,
});
configureFullAutoUI({
  getState: () => state,
  save,
  render,
  toast,
  showModal,
  closeModal,
  modalHeader,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
  getCloudAccount: () =>
    cloudStatus.authenticated ? cloudStatus.user?.id : null,
  onStarted: () => {
    // The simple screen shows its own progress; never navigate away from it.
    if (view === "create" && simpleCreateActive()) {
      render();
      return;
    }
    closeModal();
    view = "library";
    wizard = null;
    render();
    window.scrollTo(0, 0);
  },
  getWizard: () => {
    syncWizard();
    return structuredClone(wizard);
  },
  buildBook: buildStoryResultBook,
  // A deleted in-progress story: leave any screen that still shows it.
  onJobDeleted: ({ jobId }) => {
    if (wizard?.simpleJobId === jobId || draft?.fullAutoRunId === jobId) {
      wizard = null;
      if (draft?.fullAutoRunId === jobId) draft = null;
      if (view === "create" || view === "edit") view = "library";
    }
  },
  // While a simple action is running, openSimpleJob refuses (and says why); keep the dialog open.
  openSimpleReview: async (jobId) => {
    if (!isSimpleBusy()) closeModal();
    await openSimpleJob(simpleCtx, jobId);
  },
  openReview: async (job) => {
    // A simple action or a page drawing/rewrite still in flight owns its book:
    // opening it here (in either mode) would let the pro editor buy the same
    // page again. Refuse before the dialog closes or the draft changes.
    if (isSimpleBusy() || isPageOperationBusy(job.book?.id)) {
      toast("진행 중인 작업이 끝난 뒤 열어 주세요.");
      return;
    }
    // Simple mode reviews a finished FULL AUTO book in step ④ as well.
    if (uiMode === "simple") {
      closeModal();
      await openSimpleJob(simpleCtx, job.id);
      return;
    }
    closeModal();
    // As in simple ④: a runner stale mark left on an idle book keeps its picture,
    // so approval redraws it only when the parent asks.
    if (
      job.book &&
      job.status !== "running" &&
      !isFullAutoRunning() &&
      keepEditedPictures(job.book)
    )
      save();
    draft = job.book;
    editPage = 0;
    view = "edit";
    await checkBookAtLevel(draft, { rewrite: false });
    render();
    showSimilarPagesReview(draft, { quality: "final" });
    window.scrollTo(0, 0);
  },
});
const simpleCtx = {
  getState: () => state,
  getWizard: () => wizard,
  setWizard: (next) => {
    wizard = next;
  },
  getDraft: () => draft,
  setDraft: (next) => {
    draft = next;
  },
  getEditPage: () => editPage,
  setEditPage: (next) => {
    editPage = next;
  },
  setView: (next) => {
    view = next;
  },
  isSimpleMode: () => uiMode === "simple",
  isSimpleView: () => view === "create" && simpleCreateActive(),
  isParent: () => parentUnlocked && !childMode,
  // Browser Back/Forward never acts under an open dialog (simple-create.js).
  isModalOpen: () => !!modalRoot.querySelector(".modal-overlay"),
  save,
  render,
  toast,
  showModal,
  closeModal,
  modalHeader,
  protectedAction,
  heading,
  materialPortrait,
  cover,
  illustration,
  checkBook: (book) => checkBookAtLevel(book, { rewrite: false }),
  approveBook: () => approveDraft(),
  // 에코 모드 (R32): the pasted story becomes a book the same way a run's does.
  buildBook: (payload) => buildStoryResultBook(payload),
  openCredentialSettings,
  // Browser Back past the simple screen's first entry: the same guarded way
  // as 책장으로 (the kept dialog while a book is under review). Leaving inside
  // the app keeps runs and drawings going; onStay runs if the parent stays.
  leaveToLibrary: (onStay) =>
    discardDraft(
      () => {
        view = "library";
        activeBook = null;
        render();
        window.scrollTo(0, 0);
      },
      { onCancel: onStay },
    ),
};
configureSimpleCreate(simpleCtx);
configureStoryUI({
  getState: () => state,
  save,
  render,
  toast,
  showModal,
  closeModal,
  modalHeader,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
  onReady: acceptStoryResult,
  openAutoReview: openAutoJobReview,
  estimateStoryTextCost,
  openTextSettings: openStoryTextSettings,
});
configureManagementUI({
  getState: () => state,
  save,
  toast,
  modalHeader,
  showModal,
  closeModal,
  render,
  protectedAction,
  onBookDeleted: (id) => {
    if (activeBook?.id === id) {
      activeBook = null;
      view = "library";
    }
  },
});
configureStyleStudioUI({
  getState: () => state,
  save,
  toast,
  modalHeader,
  showModal,
  closeModal,
  render,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
});
configureWardrobeUI({
  getState: () => state,
  getWizard: () => {
    syncWizard();
    return wizard;
  },
  save,
  toast,
  modalHeader,
  showModal,
  closeModal,
  render,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
});
configureAudioUI({
  getState: () => state,
  save,
  toast,
  modalHeader,
  showModal,
  closeModal,
  render,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
  onChanged: () => render(),
});
configureReadingUI({
  getWizard: () => {
    syncWizard();
    return wizard;
  },
  getState: () => state,
  save,
  toast,
  modalHeader,
  showModal,
  closeModal,
  render,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
  syncDraft,
  getDraft: () => draft,
});
configureCompanionUI({
  getState: () => state,
  save,
  toast,
  modalHeader,
  showModal,
  closeModal,
  render,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
  getStoryContext: () => {
    syncWizard();
    return view === "create" ? wizard : null;
  },
  onAdded: (ids) => {
    if (view === "create" && wizard)
      for (const id of ids)
        if (wizard.characterIds.length < 5 && !wizard.characterIds.includes(id))
          wizard.characterIds.push(id);
  },
});
configurePhotoUI({
  getState: () => state,
  save,
  toast,
  modalHeader,
  showModal,
  closeModal,
  render,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
});
configureImageUI({
  onNewCharacterFailure: showStudioForm,
  getState: () => state,
  save,
  toast,
  modalHeader,
  showModal,
  closeModal,
  render,
  protectedAction,
  syncDraft,
  getDraft: () => draft,
  getEditPage: () => editPage,
  isParent: () => parentUnlocked && !childMode,
});
window.addEventListener("beforeunload", (e) => {
  stopSpeech();
  if (draft) {
    e.preventDefault();
    e.returnValue = "";
  }
});
const qualityData = await loadStoryQualityData().catch((error) => {
  toast(error);
  return null;
});
configureStoryQualityUI({
  getState: () => state,
  save,
  render,
  toast,
  showModal,
  modalHeader,
  protectedAction,
  isParent: () => parentUnlocked && !childMode,
  isSettings: () => view === "settings",
  qualityData,
  setWizardTopic: (topic) => {
    if (!wizard || !parentUnlocked || childMode) return;
    wizard.topic = topic;
    const field = document.querySelector("#topic");
    if (field) {
      field.value = topic;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  },
  getEngine: async (role, qualitySettings) => {
    const selection = resolveQualityStageSettings(
        getTextGenerationSettings(state),
        role,
        qualitySettings,
      ),
      config = { ...selection.config };
    if (
      selection.engineId !== "local" &&
      !config.proxyEndpoint &&
      config.transport !== "proxy"
    ) {
      config.apiKey = await getCredential(selection.engineId);
      if (!config.apiKey)
        throw Error("부모 설정에서 해당 글 엔진의 API 키를 저장해 주세요.");
    }
    return createTextEngine({ engine: selection.engineId, config });
  },
});
render();
// R30: once per device after the 정성 모드 beat writer ships, say what changed
// and what a new story's text now costs (settings show the same estimate).
try {
  const settings = getTextGenerationSettings(state);
  if (
    settings.orchestration !== false &&
    !localStorage.getItem("donghwa-notice-r30")
  ) {
    localStorage.setItem("donghwa-notice-r30", "1");
    // R31a: the default reading level decides which writer a new story gets.
    const k1Book =
      normalizeReadingLevels({}, state.settings).koreanLevel === "K1",
      estimate = newStoryTextEstimate(freezeReviewTier(settings), { k1Book });
    toast(
      `${k1Book ? "K1 그림책이 새로워졌어요: 작가가 12쪽을 쪽마다 한 번에 쓰고(짧은 소리말·쪽 넘김), 끝은 주제가 가는 곳에서 맺어요." : "정성 모드가 새로워졌어요: 작가가 비트마다 한 장면씩 쓰고, 첫 장면은 두 안 중 더 좋은 쪽을 골라 책 전체의 목소리로 삼아요."} 새 이야기 12쪽 글 요금은 약 $${estimate.costUsd.toFixed(2)}${estimate.pricingUnknown ? "(일부 미확인)" : ""}로 바뀌어요.${k1Book ? "" : " 설정 › 글 엔진에서 끌 수 있어요."}`,
    );
  }
} catch {
  // Storage blocked: no notice.
}
hydrateImageAssets(state)
  .then((result) => {
    initialHydrationDone = true;
    refreshHydratedImages();
    if (result.missing.length)
      toast(
        "저장된 그림 " +
          result.missing.length +
          "장을 찾을 수 없어요. 클라우드 또는 백업에서 복원해 주세요.",
      );
  })
  .catch((error) => toast(error.message))
  .finally(() => {
    cloudSync = createCloudSync({
      getState: () => state,
      // Settings, the PIN and keys alone (the four sample books) are not
      // local data: a new phone takes the family cloud without a choice.
      hasLocalData: () =>
        initialLibrary.kind === "ready" &&
        !storageBlocked &&
        (initialLibrary.invalidRecords?.length > 0 || !onlySamples()),
      isParent: () => parentUnlocked && !childMode,
      canApplyRemote: () =>
        !isFullAutoRunning() &&
        !deviceTransferBusy &&
        !(
          view === "settings" &&
          (textSettingsReturn || settingsDirty.has(settingsTab))
        ) &&
        !(view === "create" && wizard) &&
        !(view === "edit" && draft) &&
        !simpleDraftOpen() &&
        !isSimpleBusy() &&
        !reader &&
        !finalizeController &&
        (!modalRoot.querySelector(".modal-overlay") ||
          !!modalRoot.querySelector(".cloud-panel,.cloud-confirm,.family-auth")),
      // Family sign-in/out waits for FULL AUTO in this tab (other tabs: Web Locks).
      isAutoRunning: () => isFullAutoRunning(),
      applyRemote: applyCloudLibrary,
      onChange: updateCloudStatus,
    });
    void cloudSync.start();
  });
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});

document.addEventListener("input", (event) => {
  const lang =
    event.target.id === "page-ko"
      ? "ko"
      : event.target.id === "page-en"
        ? "en"
        : null;
  if (lang) {
    const preview = document.querySelector("[data-typeset=" + lang + "]");
    if (preview) preview.textContent = event.target.value;
  }
});

function updateViewportHeight() {
  document.documentElement.style.setProperty(
    "--viewport-height",
    (window.visualViewport?.height || window.innerHeight) + "px",
  );
}
window.visualViewport?.addEventListener("resize", updateViewportHeight);
window.addEventListener("resize", updateViewportHeight);
updateViewportHeight();

document.addEventListener("submit", (event) => {
  const form = event.target,
    tab = settingsTab;
  if (
    settingsSaving ||
    ![
      "settings-form",
      "text-engine-form",
      "story-quality-form",
      "ig-world-form",
    ].includes(form.id)
  )
    return;
  const panelId = form.closest(".panel")?.id;
  const selectors = [...form.querySelectorAll("input,select,textarea")]
    .map(settingsFieldSelector)
    .filter(Boolean);
  queueMicrotask(async () => {
    const result = await event.settingsCompletion;
    if (
      result === false ||
      event.settingsFailed ||
      [...form.querySelectorAll(".pin-error,.story-error")].some((field) =>
        field.textContent.trim(),
      )
    )
      return;
    const panels = settingsDirtyPanels.get(tab);
    if (form.id === "settings-form") panels?.clear();
    else panels?.delete(panelId);
    if (!panels?.size) {
      settingsDirty.delete(tab);
      settingsValues.delete(tab);
      settingsDirtyPanels.delete(tab);
    } else
      for (const selector of selectors)
        settingsValues.get(tab)?.delete(selector);
    if (view === "settings" && tab === settingsTab) render();
  });
});
