import {
  KOREAN_LEVELS,
  ENGLISH_LEVELS,
  LEVEL_SPECS,
  normalizeReadingLevels,
  recommendEnglishLevel,
  applyReadingLevels,
  validateAndRewriteBook,
  applyReadingFeedback,
  acceptReadingSuggestion,
  OPENING_SEED,
} from "./reading-levels.js";
import { describeReadingViolation } from "./reading-messages.js";
export { describeReadingViolation };
import { analyzeBook, estimateReadingScore } from "./reading-checker.js";
import { pageReadingSpec } from "./story-generation/checker.js";
import { buildStoryWords } from "./story-reading-context.js";
import { layoutOf, openingsEnabled, unitLabel } from "./book-layout.js";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const labels = {
  K1: "K1 · 그림책 3~4세 · 쪽당 2~3문장",
  K2: "K2 · 그림책 5~6세",
  K3: "K3 · 저학년 동화",
  K4: "K4 · 중학년 이야기",
  E0: "E0 · 쪽당 1~2문장, 부모가 읽어 주는 단계",
  E1: "E1 · 해독",
  E2: "E2 · 리더스",
  E3: "E3 · 얼리 챕터",
  E4: "E4 · 챕터",
};
let api,
  currentOperation = null;
/** R12: with openings on, K2-K4 name their per-opening amount ('두 쪽에 10~15문장'). */
const levelLabel = (level) => {
  const unit = OPENING_SEED.ko[level]?.units?.opening;
  return openingsEnabled() && unit
    ? `${labels[level]} · 두 쪽에 ${unit.min}~${unit.max}문장`
    : labels[level];
};
const select = (id, label, levels, value) =>
  `<div class="field"><label for="${id}">${label}</label><select id="${id}">${levels.map((level) => `<option value="${level}" ${level === value ? "selected" : ""}>${levelLabel(level)}</option>`).join("")}</select></div>`;
export function migrateReadingSettings(settings) {
  settings.defaultKoreanLevel = normalizeReadingLevels({
    koreanLevel: settings.defaultKoreanLevel,
  }).koreanLevel;
  settings.defaultEnglishLevel = normalizeReadingLevels({
    englishLevel: settings.defaultEnglishLevel,
  }).englishLevel;
  settings.readingCheckerMode = "local";
  settings.readingFeedbackHistory = Array.isArray(
    settings.readingFeedbackHistory,
  )
    ? settings.readingFeedbackHistory
    : [];
  return settings;
}
export function renderReadingSelectors(values, prefix = "") {
  const levels = normalizeReadingLevels(values);
  return (
    select(
      prefix + "koreanLevel",
      "한글 읽기 단계",
      KOREAN_LEVELS,
      levels.koreanLevel,
    ) +
    select(
      prefix + "englishLevel",
      "영어 읽기 단계",
      ENGLISH_LEVELS,
      levels.englishLevel,
    )
  );
}
export function renderReadingSettings(settings) {
  const dictionaries = settings.koVocabularies || {};
  return `<section class="panel reading-settings"><h3>한글 · 영어 읽기 수준</h3><p class="section-sub">두 언어를 따로 정하고, 부모가 확인할 때만 바꿔요. 영어는 번역 없이 같은 장면을 단계별 문형으로 새로 씁니다.</p><div class="form-grid">${renderReadingSelectors({ koreanLevel: settings.defaultKoreanLevel, englishLevel: settings.defaultEnglishLevel }, "default-")}<div class="field field-wide" data-settings-form="own"><label for="sr-lexile">SR · 렉사일 점수 <span class="count">선택 · 숫자 L</span></label><input id="sr-lexile" type="number" min="0" max="2000" step="1" value="${escape(settings.srLexile ?? "")}" placeholder="예: 350"><small id="sr-level-note">미입력 E0 · 200L 미만 E1 · 200~449L E2 · 450~599L E3 · 600L 이상 E4. 추천을 확인한 뒤 적용해 주세요.</small><button type="button" class="btn btn-outline btn-small" data-reading-action="apply-sr">SR 추천 단계 적용</button></div><div class="field" data-settings-form="own"><label for="ko-vocab-grade">한글 어휘 CSV · 등급</label><select id="ko-vocab-grade">${[1, 2, 3, 4].map((grade) => `<option value="${grade}">${grade}등급${dictionaries[grade]?.words?.length ? " · " + dictionaries[grade].words.length + "개" : ""}</option>`).join("")}</select></div><div class="field" data-settings-form="own"><label for="ko-vocab-file">어휘 목록 넣기</label><input id="ko-vocab-file" type="file" accept=".csv,.txt,text/csv,text/plain"><button type="button" class="btn btn-plain btn-small" data-reading-action="remove-vocab">선택 등급 목록 삭제</button><small>한 줄에 한 어휘 또는 word/어휘 열의 CSV · 1MB 이하. 해당 등급의 목록이 없으면 한글 어휘 이탈률 검사를 건너뛰고 문장 길이와 연결어미를 검사해요.</small></div></div><p class="small-label" style="margin-top:16px">문장·어절, FK·Spache·Dale–Chall과 어휘를 기기에서 추정합니다. AR·렉사일·KReaD 공식 점수는 아닙니다. 읽은 뒤 같은 난이도 피드백이 두 번 쌓이면 다음 책에서 단계 변경을 제안해요.</p><details class="reading-specs"><summary>단계별 levelSpec JSON 보기</summary><pre>${escape(JSON.stringify(LEVEL_SPECS, null, 2))}</pre></details></section>`;
}
export function readReadingSettings(settings) {
  Object.assign(settings, {
    defaultKoreanLevel: document.querySelector("#default-koreanLevel").value,
    defaultEnglishLevel: document.querySelector("#default-englishLevel").value,
    srLexile:
      document.querySelector("#sr-lexile").value === ""
        ? null
        : Number(document.querySelector("#sr-lexile").value),
    readingCheckerMode: "local",
  });
  for (const [language, suggestion] of Object.entries(
    settings.pendingReadingSuggestions || {},
  ))
    if (
      suggestion.from !==
      settings[language === "ko" ? "defaultKoreanLevel" : "defaultEnglishLevel"]
    )
      delete settings.pendingReadingSuggestions[language];
}
export function parseKoreanVocabCSV(text) {
  if (typeof text !== "string" || text.length > 1024 * 1024)
    throw new Error("1MB 이하의 어휘 목록을 선택해 주세요.");
  const rows = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    words = [];
  let column = 0,
    header = false;
  if (rows.length) {
    const columns = rows[0]
      .split(/[,\t]/)
      .map((value) => value.trim().replace(/^"|"$/g, ""));
    const index = columns.findIndex((value) =>
      /^(word|vocab|어휘|단어)$/i.test(value),
    );
    if (index >= 0) {
      column = index;
      header = true;
    }
  }
  for (const row of rows.slice(header ? 1 : 0)) {
    const word = (row.match(/(?:"(?:[^"]|"")*"|[^,\t]+)/g) || [])[column]
      ?.trim()
      .replace(/^"|"$/g, "")
      .replace(/""/g, '"');
    if (word && /^[가-힣A-Za-z\s-]{1,80}$/.test(word))
      words.push(word.normalize("NFC"));
  }
  const result = [...new Set(words)];
  if (!result.length || result.length > 20000)
    throw new Error("한글 어휘가 포함된 2만 개 이하의 목록을 넣어 주세요.");
  return result;
}
export function renderFeedbackActions(book) {
  return `<div class="book-feedback-actions">${[
    ["easy", "쉬움"],
    ["just-right", "딱 맞음"],
    ["hard", "어려움"],
  ]
    .map(
      ([value, label]) =>
        `<button type="button" data-reading-action="feedback" data-id="${escape(book.id)}" data-feedback="${value}">${label}</button>`,
    )
    .join("")}</div>`;
}
export function renderReadingSuggestion(settings) {
  return Object.entries(settings.pendingReadingSuggestions || {})
    .map(
      ([language, suggestion]) =>
        `<div class="notice reading-suggestion"><strong>${language === "ko" ? "한글" : "영어"} ${escape(suggestion.to)}로 ${suggestion.feedback === "easy" ? "올려" : "낮춰"} 볼까요?</strong><p>같은 방향의 피드백이 두 번 쌓였어요. 부모가 적용할 때까지 현재 단계를 유지해요.</p><button type="button" class="btn btn-outline btn-small" data-reading-action="accept-suggestion" data-language="${language}">이 단계 적용</button><button type="button" class="btn btn-plain btn-small" data-reading-action="dismiss-suggestion" data-language="${language}">현재 단계 유지</button></div>`,
    )
    .join("");
}
export function renderReadingBadge(book, { compact = false } = {}) {
  const score = book.readingScore || estimateReadingScore(book),
    ar = Number(score?.approxAR),
    lexile = Number(score?.approxLexile);
  if (compact) {
    const levels = normalizeReadingLevels(book);
    return `<span class="reading-level-chip" title="${escape(Number.isFinite(ar) && Number.isFinite(lexile) ? `AR 약 ${ar.toFixed(1)} / 렉사일 약 ${Math.round(lexile)}L (추정) · 공식 점수 아님` : "본문 기반 추정 준비 중 · 공식 점수 아님")}">${escape(levels.koreanLevel)} · ${escape(levels.englishLevel)}</span>`;
  }
  return `<div class="reading-badge" title="공식 점수가 아닌 본문 기반 간이 추정입니다."><span>${Number.isFinite(ar) && Number.isFinite(lexile) ? `AR 약 ${ar.toFixed(1)} / 렉사일 약 ${Math.round(lexile)}L (추정)` : "AR · 렉사일 추정 준비 중"}</span><small>공식 점수 아님${book.koreanLevel || book.englishLevel ? ` · ${escape(book.koreanLevel || "")} / ${escape(book.englishLevel || "")}` : ""}</small></div>`;
}
export function renderReadingCheck(book) {
  const check = book.readingCheck,
    levels = normalizeReadingLevels(book);
  return `<div class="reading-check ${check?.passed === false ? "reading-warning" : ""}"><div><strong>${escape(levels.koreanLevel)} · ${escape(levels.englishLevel)} 읽기 규칙</strong><small>${check ? (check.error ? escape(check.error) : `${check.passed ? "선택 단계 검사 통과" : "선택 단계 범위 밖 · 직접 다듬어 주세요"} · 자동 재작성 ${check.rewrites ?? check.attempts ?? 0}회`) : "본문을 수정한 뒤 단계 검사를 실행해 주세요."}</small>${renderReadingBadge(book)}${
    check?.warnings?.length
      ? `<details class="reading-vocabulary-notes"><summary>들려주기 단계라 어휘는 참고 정보예요 · 쪽별 비율 보기</summary><ul class="check-issues">${check.warnings
          .filter((w) => w.code === "out-of-vocabulary")
          .map(
            (w) =>
              `<li class="check-advisory">${(w.pageIndex ?? 0) + 1}쪽 · ${escape(describeReadingViolation(w))}</li>`,
          )
          .join("")}</ul></details>`
      : ""
  }${check?.pages?.length ? `<details class="reading-check-details"><summary>쪽별 검사 보기</summary><div class="reading-check-table"><table><thead><tr><th>쪽</th><th>한글 어절 / 어미</th><th>영어 FK / Spache / DC</th><th>단계</th></tr></thead><tbody>${check.pages.map((page, index) => `<tr><td>${layoutOf(book) === "openings" ? escape(unitLabel(book, index)) : index + 1}</td><td>${page.ko?.metrics?.averageWordsPerSentence ?? "—"} / ${page.ko?.metrics?.connectiveEndings ?? "—"}${page.ko?.metrics?.vocabularySkipped ? " · 어휘 목록 없음" : ""}</td><td>${page.en?.metrics?.fkGrade ?? "—"} / ${page.en?.metrics?.spache ?? "—"} / ${page.en?.metrics?.daleChall ?? "—"}</td><td>${page.passed ? "범위 안" : "수준 범위 밖"}</td></tr>`).join("")}</tbody></table></div></details>` : ""}</div><button type="button" class="btn btn-outline btn-small" data-reading-action="check-draft">${book.prose ? "수준 검사 · 본문 유지" : "수준 검사 · 최대 2회 재작성"}</button></div>`;
}
export function cleanupReadingOperation() {
  currentOperation?.abort();
  currentOperation = null;
}
/**
 * The options the ④ reading check (checkBookAtLevel) gives analyzeBook for one
 * candidate. A book without the diet gets exactly the options it always had.
 */
export function bookReadingOptions(candidate, context, { characters = [], signal, lean = leanBook(candidate) } = {}) {
  return {
    allowedNames: context.allowedNames,
    storyWords: lean
      ? buildStoryWords(candidate, candidate.outline, characters, { briefs: candidate.sceneBriefs || [], lean: true })
      : context.storyWords,
    koVocabulary: context.specs.ko.vocabularyAvailable ? context.specs.ko.vocabList : null,
    signal,
    ...(lean ? { lean: true, pageSpec: (all, language, page) => pageReadingSpec(all, language, page, { lean: true }) } : {}),
  };
}
/** R35 hotfix: a book made from a diet draft (its frozen story input carries the policy). */
export const leanBook = (book) => (book?.storyInput || book?.input)?.promptDiet?.version === 1;
export async function checkBookAtLevel(
  book,
  { rewrite = true, showProgress = false } = {},
) {
  // LLM story text must be repaired through its causal story pipeline, never templates.
  if (book.prose) rewrite = false;
  const state = api.getState(),
    settings = state.settings,
    controller = new AbortController();
  currentOperation?.abort();
  currentOperation = controller;
  if (showProgress)
    api.showModal(
      `${api.modalHeader("읽기 수준을 확인하고 있어요")}<p class="modal-intro">문장 길이, 어휘와 문형을 검사합니다. 범위를 벗어난 쪽은 최대 2회 다시 씁니다.</p><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">검사 취소</button></div>`,
    );
  const specs = book.readingLevelSnapshot?.specs || book.levelSpecs;
  // R35 hotfix: a diet book (R31c~) is judged as its story check judged it —
  // the lean page spec (E2+ English unit tolerance, inflections, the story's own
  // words, out-of-list share as a note) and the book totals as notes.
  const lean = leanBook(book);
  try {
    const checked = await validateAndRewriteBook(book, {
      signal: controller.signal,
      maxRetries: rewrite ? 2 : 0,
      characters: state.characters,
      analyze: (candidate, context) =>
        analyzeBook(candidate, context.specs || specs, bookReadingOptions(candidate, context, {
          characters: state.characters,
          signal: controller.signal,
          lean,
        })),
    });
    if (
      controller.signal.aborted ||
      api.getState() !== state ||
      !api.isParent()
    )
      throw new DOMException("검사를 취소했어요.", "AbortError");
    Object.assign(book, checked);
    book.readingScore = book.readingCheck?.score || estimateReadingScore(book);
    currentOperation = null;
    if (showProgress) api.closeModal();
    return book;
  } catch (error) {
    if (currentOperation === controller) {
      currentOperation = null;
      if (showProgress) api.closeModal();
    }
    if (error.name !== "AbortError")
      book.readingCheck = {
        passed: false,
        error: error.message,
        mode: settings.readingCheckerMode,
        checkedAt: new Date().toISOString(),
      };
    throw error;
  }
}
export async function prepareLeveledBook(book, options) {
  const original = book.pages.map((page) => ({ ...page }));
  const settings = api.getState().settings,
    grade = Number(
      String(options.koreanLevel || settings.defaultKoreanLevel).slice(1),
    );
  Object.assign(
    book,
    applyReadingLevels(
      book,
      {
        ...options,
        koVocabulary: settings.koVocabularies?.[grade]?.words || null,
      },
      api.getState().characters,
    ),
  );
  if (options.preserveOutline) book.pages = original;
  return checkBookAtLevel(book, { showProgress: true });
}
function openFeedback(id) {
  const book = api.getState().books.find((item) => item.id === id);
  if (!book) return;
  api.showModal(
    `${api.modalHeader("읽어 보니 어땠나요?")}<p class="modal-intro">${escape(book.title)}<br>한글과 영어를 따로 알려 주세요. 같은 방향의 피드백이 두 번 쌓이면 다음 책에서 단계 변경을 제안합니다.</p><form id="reading-feedback-form" data-id="${escape(id)}"><div class="form-grid">${book.language !== "en" ? feedbackSelect("ko", "한글") : ""}${book.language !== "ko" ? feedbackSelect("en", "영어") : ""}</div><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">닫기</button><button class="btn btn-primary" type="submit">피드백 저장</button></div></form>`,
  );
}
const feedbackSelect = (language, label) =>
  `<div class="field"><label for="feedback-${language}">${label} 난이도</label><select id="feedback-${language}"><option value="">아직 선택하지 않음</option><option value="easy">쉬움</option><option value="just-right">딱 맞음</option><option value="hard">어려움</option></select></div>`;
export function configureReadingUI(context) {
  api = context;
  document.addEventListener("input", (event) => {
    if (event.target.id === "sr-lexile") {
      const recommendation = recommendEnglishLevel(event.target.value);
      document.querySelector("#sr-level-note").textContent =
        `추천: ${recommendation?.englishLevel || "E0"} · 추천 단계 적용 버튼을 누른 뒤 설정을 저장해 주세요.`;
    }
  });
  document.addEventListener("change", async (event) => {
    if (event.target.id !== "ko-vocab-file") return;
    const file = event.target.files[0];
    if (!file) return;
    api.protectedAction(async () => {
      try {
        if (file.size > 1024 * 1024)
          throw new Error("1MB 이하의 CSV를 선택해 주세요.");
        const words = parseKoreanVocabCSV(await file.text()),
          state = api.getState(),
          grade = document.querySelector("#ko-vocab-grade").value;
        state.settings.koVocabularies ||= {};
        state.settings.koVocabularies[grade] = {
          words,
          source: "부모 CSV",
          filename: file.name,
          uploadedAt: new Date().toISOString(),
        };
        if (api.save()) {
          api.render();
          api.toast(`${grade}등급 어휘 ${words.length}개를 저장했어요.`);
        }
      } catch (error) {
        api.toast(error.message);
      }
    });
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reading-action]");
    if (!button) return;
    event.preventDefault();
    api.protectedAction(async () => {
      try {
        if (button.dataset.readingAction === "remove-vocab") {
          const grade = document.querySelector("#ko-vocab-grade").value;
          delete api.getState().settings.koVocabularies?.[grade];
          if (api.save()) {
            api.render();
            api.toast(
              "선택한 등급의 어휘 목록을 지웠어요. 기존 책의 검사 규칙은 보관됩니다.",
            );
          }
        }
        if (button.dataset.readingAction === "apply-sr") {
          document.querySelector("#default-englishLevel").value =
            recommendEnglishLevel(document.querySelector("#sr-lexile").value)
              ?.englishLevel || "E0";
          document
            .querySelector("#default-englishLevel")
            .dispatchEvent(new Event("change", { bubbles: true }));
          api.toast("추천 단계를 선택했어요. 설정 저장을 눌러 확정해 주세요.");
        }
        if (button.dataset.readingAction === "accept-suggestion") {
          const state = api.getState();
          state.settings = acceptReadingSuggestion(
            state.settings,
            button.dataset.language,
          );
          const wizard = api.getWizard?.();
          if (wizard) {
            const language = button.dataset.language;
            wizard[language === "ko" ? "koreanLevel" : "englishLevel"] =
              state.settings[
                language === "ko" ? "defaultKoreanLevel" : "defaultEnglishLevel"
              ];
          }
          if (api.save()) api.render();
        }
        if (button.dataset.readingAction === "dismiss-suggestion") {
          delete api.getState().settings.pendingReadingSuggestions?.[
            button.dataset.language
          ];
          if (api.save()) api.render();
        }
        if (button.dataset.readingAction === "feedback") {
          api.closeModal();
          openFeedback(button.dataset.id);
          if (button.dataset.feedback)
            for (const lang of ["ko", "en"]) {
              const field = document.querySelector("#feedback-" + lang);
              if (field) field.value = button.dataset.feedback;
            }
        }
        if (button.dataset.readingAction === "check-draft") {
          api.syncDraft();
          const book = api.getDraft();
          if (!book) return;
          await checkBookAtLevel(book, { showProgress: true });
          api.render();
          api.toast(
            book.readingCheck?.passed
              ? "읽기 수준 검사를 마쳤어요."
              : "최대 재작성 후에도 범위 밖인 문장이 있어요. 직접 다듬어 주세요.",
          );
        }
      } catch (error) {
        if (error.name !== "AbortError") api.toast(error.message);
        api.render();
      }
    });
  });
  document.addEventListener("submit", (event) => {
    if (event.target.id !== "reading-feedback-form") return;
    event.preventDefault();
    api.protectedAction(() => {
      const state = api.getState(),
        book = state.books.find((item) => item.id === event.target.dataset.id),
        previousSettings = structuredClone(state.settings),
        previousFeedback = structuredClone(book?.readingFeedback || []),
        feedback = {};
      if (!book) return;
      for (const language of ["ko", "en"]) {
        const value = document.querySelector("#feedback-" + language)?.value;
        if (value) {
          feedback[language] = value;
          state.settings = applyReadingFeedback(state.settings, {
            language,
            feedback: value,
            bookId: book.id,
            bookLevel: language === "ko" ? book.koreanLevel : book.englishLevel,
          });
        }
      }
      if (!Object.keys(feedback).length) {
        api.toast("한글 또는 영어 난이도를 선택해 주세요.");
        return;
      }
      book.readingFeedback ||= [];
      book.readingFeedback.push({
        feedback,
        createdAt: new Date().toISOString(),
      });
      if (api.save() === false) {
        state.settings = previousSettings;
        book.readingFeedback = previousFeedback;
        return;
      }
      api.closeModal();
      api.render();
      api.toast("피드백을 저장했어요. 단계는 부모가 확인할 때만 바뀝니다.");
    });
  });
}
