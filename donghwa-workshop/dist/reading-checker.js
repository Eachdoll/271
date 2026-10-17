import { VOCAB_DATA, ENGLISH_ONOMATOPOEIA } from "./reading-vocab.js";
/* Browser-local FK, Revised Spache, Dale–Chall and Korean pattern estimates.
 * These are not certified AR, Lexile or KReaD scores. No Python dependency. */
const round = (n) => Math.round(n * 100) / 100;
const number = (n, fallback = 0) =>
  Number.isFinite(Number(n)) ? Number(n) : fallback;
const unique = (values) => [...new Set(values)];
const strip = (text) =>
  String(text || "")
    .normalize("NFC")
    .replace(/[“”‘’]/g, "'");
export function splitSentences(text) {
  return (strip(text).match(/[^.!?。！？\n]+(?:[.!?。！？]+|$)/gu) || [])
    .map((s) => s.trim())
    .filter(Boolean);
}
const enWords = (text) =>
  (strip(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).map((w) =>
    w.toLowerCase(),
  );
const koWords = (text) =>
  strip(text)
    .split(/\s+/u)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const core = w.replace(/(?:[^aeiou]es|(?<![td])ed)$/, "");
  const spoken =
    core.endsWith("e") && !/[^aeiou]le$/.test(core) ? core.slice(0, -1) : core;
  const groups = spoken.match(/[aeiouy]+/g);
  return Math.max(1, groups?.length || 1);
}
function validSpec(spec) {
  if (
    !spec ||
    !Array.isArray(spec.vocabList) ||
    !spec.wordsPerSentence ||
    !Array.isArray(spec.allowedGrammar)
  )
    throw new Error("읽기 단계 규칙이 없거나 올바르지 않아요.");
  return spec;
}
function allowedSet(spec, names = [], lang = "en") {
  const tokenize = lang === "en" ? enWords : koWords;
  return new Set([
    ...spec.vocabList.flatMap(tokenize),
    ...names.flatMap(tokenize),
  ]);
}
// This small suffix rule is NOT a morphological analyzer. Keep its limits visible.
function koAllowed(word, allowed) {
  if (allowed.has(word)) return true;
  const bare = word.replace(
    /(?:에게서|에게|에서는|에서|으로|이랑|하고|까지|부터|처럼|보다|은|는|이|가|을|를|에|와|과|도|만|로|의)$/u,
    "",
  );
  if (allowed.has(bare)) return true;
  const forms = [
    word.replace(/(?:해요|했어요|해서|한|하는|하게)$/u, "하다"),
    word.replace(/(?:아요|어요|었어요|았어요)$/u, "다"),
    word.replace(
      /(?:았|었)?(?:고|며|면서|지만|면|다가|려고|니|아서|어서|게|히|은|는)$/u,
      "다",
    ),
  ];
  return forms.some((f) => allowed.has(f));
}
function countConnectives(sentence) {
  return koWords(sentence).filter((w) =>
    /(?:[가-힣]+(?:고|며|면서|지만|는데|다가|려고|어서|아서|으면|면|으니|니))$/u.test(
      w,
    ),
  ).length;
}
const SPACHE_EASY = new Set(
    VOCAB_DATA.spache.map((word) => word.toLowerCase()),
  ),
  DALE_EASY = new Set(VOCAB_DATA.dale_chall.map((word) => word.toLowerCase()));
const irregular = {
  went: "go",
  saw: "see",
  seen: "see",
  said: "say",
  had: "have",
  did: "do",
  done: "do",
  gave: "give",
  given: "give",
  found: "find",
  made: "make",
  took: "take",
  taken: "take",
  felt: "feel",
  was: "be",
  were: "be",
  came: "come",
  grew: "grow",
  knew: "know",
  got: "get",
  kept: "keep",
  thought: "think",
  stood: "stand",
  ate: "eat",
  children: "child",
  feet: "foot",
  leaves: "leaf",
};
function familiar(word, allowed) {
  if (allowed.has(word)) return true;
  const value = word.replace(/'s$/, "");
  if (allowed.has(value) || allowed.has(irregular[value])) return true;
  const variants = [
    value.replace(/ies$/, "y"),
    value.replace(/s$/, ""),
    value.replace(/ed$/, ""),
    value.replace(/d$/, ""),
    value.replace(/ing$/, ""),
    value.replace(/ing$/, "e"),
  ];
  return variants.some((variant) => allowed.has(variant));
}
export function readabilityMetrics(text, names = []) {
  const sentences = splitSentences(text),
    words = enWords(text),
    count = words.length,
    nameSet = new Set(names.flatMap(enWords));
  if (!count)
    return {
      fkGrade: null,
      spache: null,
      daleChall: null,
      syllablesPerWord: null,
    };
  const mean = count / Math.max(1, sentences.length),
    syllablesPerWord =
      words.reduce((sum, word) => sum + syllables(word), 0) / count;
  const percent = (list) =>
      (words.filter((word) => !nameSet.has(word) && !familiar(word, list))
        .length /
        count) *
      100,
    spacheDifficult = percent(SPACHE_EASY),
    daleDifficult = percent(DALE_EASY);
  return {
    fkGrade: round(0.39 * mean + 11.8 * syllablesPerWord - 15.59),
    spache: round(0.121 * mean + 0.082 * spacheDifficult + 0.659),
    daleChall: round(
      0.1579 * daleDifficult + 0.0496 * mean + (daleDifficult > 5 ? 3.6365 : 0),
    ),
    syllablesPerWord: round(syllablesPerWord),
    spacheDifficultPercent: round(spacheDifficult),
    daleChallDifficultPercent: round(daleDifficult),
    spacheFormula: "revised-1974",
  };
}
function violations(metrics, spec, lang) {
  const out = [],
    expected =
      spec.sentencesPerPageRange ||
      (typeof spec.sentencesPerPage === "number"
        ? { min: spec.sentencesPerPage, max: spec.sentencesPerPage }
        : spec.sentencesPerPage);
  if (
    metrics.sentenceCount < number(expected?.min, 1) ||
    metrics.sentenceCount > number(expected?.max, expected?.min)
  )
    out.push({
      code: "sentence-count",
      language: lang,
      actual: metrics.sentenceCount,
      expected,
    });
  metrics.wordsPerSentence.forEach((count, index) => {
    if (count < spec.wordsPerSentence.min || count > spec.wordsPerSentence.max)
      out.push({
        code: "sentence-length",
        language: lang,
        sentenceIndex: index,
        actual: count,
        expected: spec.wordsPerSentence,
      });
  });
  if (
    !metrics.vocabularySkipped &&
    metrics.outOfVocabRatio > number(spec.maxOutOfVocabRatio, 0.1)
  )
    out.push({
      code: "out-of-vocabulary",
      language: lang,
      actual: metrics.outOfVocabRatio,
      max: spec.maxOutOfVocabRatio,
      words: metrics.outOfVocabWords,
    });
  const pageRange = lang === "en" ? spec.wordsPerPage : spec.charsPerPage,
    pageValue = lang === "en" ? metrics.wordCount : metrics.characterCount;
  if (
    Array.isArray(pageRange) &&
    (pageValue < pageRange[0] || pageValue > pageRange[1])
  )
    out.push({
      code: lang === "en" ? "page-words" : "page-characters",
      language: lang,
      actual: pageValue,
      expected: { min: pageRange[0], max: pageRange[1] },
    });
  if (lang === "ko")
    metrics.connectiveEndingsPerSentence.forEach((count, index) => {
      if (count > number(spec.maxConnectiveEndingsPerSentence, 1))
        out.push({
          code: "connective-endings",
          language: lang,
          sentenceIndex: index,
          actual: count,
          max: spec.maxConnectiveEndingsPerSentence,
        });
    });
  return out;
}
export function analyzeEstimatedPage(text, levelSpec, options = {}) {
  const original = validSpec(levelSpec),
    lang = options.language === "ko" ? "ko" : "en",
    names = options.allowedNames || options.properNames || [],
    spec = { ...original };
  if (lang === "ko" && Array.isArray(options.koVocabulary)) {
    spec.vocabList = options.koVocabulary;
    spec.vocabularyAvailable = options.koVocabulary.length > 0;
  }
  const sentences = splitSentences(text),
    tokenize = lang === "en" ? enWords : koWords,
    words = sentences.flatMap(tokenize),
    allowed = allowedSet(
      spec,
      [
        ...names,
        ...(lang === "en" && spec.storyWordsAllowed
          ? options.storyWords || []
          : []),
        ...(lang === "en" && spec.allowOnomatopoeia
          ? ENGLISH_ONOMATOPOEIA
          : []),
      ],
      lang,
    ),
    vocabularySkipped =
      lang === "ko" &&
      (spec.vocabularyAvailable === false || spec.vocabList.length === 0);
  const outside = vocabularySkipped
      ? []
      : words.filter((word) =>
          lang === "ko" ? !koAllowed(word, allowed) : !familiar(word, allowed),
        ),
    lengths = sentences.map((sentence) => tokenize(sentence).length),
    count = words.length;
  const metrics = {
    sentenceCount: sentences.length,
    wordCount: count,
    characterCount: Array.from(String(text || "").normalize("NFC")).length,
    wordsPerSentence: lengths,
    averageWordsPerSentence: round(count / Math.max(1, sentences.length)),
    averageSyllablesPerEojeol:
      lang === "ko"
        ? round(
            words.reduce(
              (sum, word) => sum + (word.match(/[가-힣]/g) || []).length,
              0,
            ) / Math.max(1, count),
          )
        : null,
    outOfVocabCount: outside.length,
    outOfVocabRatio: vocabularySkipped
      ? null
      : outside.length / Math.max(1, count),
    outOfVocabWords: unique(outside),
    vocabularySkipped,
    connectiveEndingsPerSentence:
      lang === "ko" ? sentences.map(countConnectives) : [],
    connectiveEndings:
      lang === "ko"
        ? sentences.reduce(
            (sum, sentence) => sum + countConnectives(sentence),
            0,
          )
        : null,
    ...(lang === "en"
      ? readabilityMetrics(text, names)
      : { fkGrade: null, spache: null, daleChall: null }),
    fkEstimated: lang === "en",
  };
  let issues = violations(metrics, spec, lang);
  // Conservative present-tense detector: transparent heuristic, not a full grammar parser.
  if (
    lang === "en" &&
    spec.ruleVersion >= 3 &&
    spec.allowedGrammar.some((rule) => /present tense/i.test(rule))
  ) {
    const past = words.filter(
      (word) =>
        /^(?:was|were|went|saw|said|had|did|gave|found|made|took|felt|came|grew|knew|got|kept|thought|stood|ate|ran|shouted|whispered)$/.test(
          word,
        ) ||
        (word.endsWith("ed") &&
          !/^(?:red|bed|seed|need|feed|speed|hundred)$/.test(word) &&
          !names.flatMap(enWords).includes(word)),
    );
    if (past.length)
      issues.push({
        code: "grammar",
        language: lang,
        actual: unique(past).join(", "),
        expected: "현재형",
      });
  }
  const warnings =
    spec.vocabularyPolicy === "warning"
      ? issues
          .filter((issue) => issue.code === "out-of-vocabulary")
          .map((issue) => ({ ...issue, severity: "warning" }))
      : [];
  issues = issues.filter(
    (issue) => !warnings.some((warning) => warning.code === issue.code),
  );
  return {
    language: lang,
    passed: issues.length === 0,
    violations: issues,
    warnings,
    metrics,
    mode: "local",
    engine:
      lang === "ko"
        ? "korean-pattern-checker"
        : "javascript-readability-formulas",
    estimated: true,
    notes:
      lang === "ko"
        ? [
            vocabularySkipped
              ? "한글 등급 어휘 목록이 없어 어휘 검사를 생략했습니다."
              : "부모가 제공한 등급 목록으로 어휘를 검사했습니다.",
            "문장당 어절·음절·연결어미는 공백과 패턴 기준입니다.",
          ]
        : [
            "음절 휴리스틱 FK, Revised Spache 친숙 어휘와 Dale–Chall 어휘 기준으로 직접 계산한 추정입니다. 공식 점수가 아닙니다.",
          ],
  };
}
function pageList(book) {
  return Array.isArray(book)
    ? book
    : Array.isArray(book?.pages)
      ? book.pages
      : [];
}
function pageText(page, lang) {
  if (typeof page === "string") return lang === "en" ? page : "";
  const value =
    page?.[lang] ??
    page?.text?.[lang] ??
    page?.[lang === "en" ? "english" : "korean"] ??
    "";
  return typeof value === "string"
    ? value
    : typeof value?.text === "string"
      ? value.text
      : "";
}
/** A transparent complexity heuristic, not a conversion to official AR/Lexile. */
export function estimateReadingScore(book) {
  const text = pageList(book)
      .map((page) => pageText(page, "en"))
      .join(" "),
    sentences = splitSentences(text),
    words = enWords(text);
  if (!words.length || !sentences.length)
    return {
      approxAR: null,
      approxLexile: null,
      official: false,
      estimated: true,
      method: "text-complexity-heuristic",
      notes: ["영어 본문이 없어 추정하지 않았어요."],
    };
  const mean = words.length / sentences.length,
    syll = words.reduce((n, w) => n + syllables(w), 0) / words.length;
  const fk = 0.39 * mean + 11.8 * syll - 15.59;
  const approxAR =
    Math.round(Math.min(12, Math.max(0.5, (fk + 1.2) * 0.7)) * 10) / 10;
  const approxLexile =
    Math.round(
      Math.min(1600, Math.max(0, mean * 35 + (syll - 1) * 500 - 100)) / 10,
    ) * 10;
  return {
    approxAR,
    approxLexile,
    official: false,
    estimated: true,
    method: "text-complexity-heuristic",
    wordCount: words.length,
    sentenceCount: sentences.length,
    notes: [
      "본문 길이와 추정 음절 난도를 이용한 앱 내부 추정이며 공식 AR·Lexile 점수가 아니에요.",
    ],
  };
}
function bookResult(book, specs, options) {
  const pages = pageList(book).map((page, index) => {
    const ko = analyzeEstimatedPage(pageText(page, "ko"), specs.ko, {
        ...options,
        language: "ko",
      }),
      en = analyzeEstimatedPage(pageText(page, "en"), specs.en, {
        ...options,
        language: "en",
      });
    return { index, pageIndex: index, passed: ko.passed && en.passed, ko, en };
  });
  const bookViolations = pages.flatMap((page) =>
    [...page.ko.violations, ...page.en.violations].map((v) => ({
      ...v,
      pageIndex: page.index,
    })),
  );
  const warnings = pages.flatMap((page) =>
    [...page.ko.warnings, ...page.en.warnings].map((warning) => ({
      ...warning,
      pageIndex: page.index,
    })),
  );
  const metrics = {};
  for (const lang of ["ko", "en"]) {
    const outside = unique(
      pages.flatMap((p) => p[lang].metrics.outOfVocabWords),
    );
    const vocabularySkipped = pages.every(
      (page) => page[lang].metrics.vocabularySkipped,
    );
    metrics[lang] = {
      vocabularySkipped,
      newWords: outside,
      newWordCount: outside.length,
      outOfVocabRatio: vocabularySkipped
        ? null
        : round(
            pages.reduce((n, p) => n + p[lang].metrics.outOfVocabCount, 0) /
              Math.max(
                1,
                pages.reduce((n, p) => n + p[lang].metrics.wordCount, 0),
              ),
          ),
    };
    if (
      specs[lang].newWordsPerBook != null &&
      outside.length > specs[lang].newWordsPerBook
    )
      (specs[lang].vocabularyPolicy === "warning"
        ? warnings
        : bookViolations
      ).push({
        code: "new-word-budget",
        language: lang,
        actual: outside.length,
        max: specs[lang].newWordsPerBook,
        words: outside,
      });
  }
  return {
    passed: pages.length > 0 && bookViolations.length === 0,
    pages,
    score: estimateReadingScore(book),
    mode: "local",
    engine: {
      en: "javascript-readability-formulas",
      ko: "korean-pattern-checker",
    },
    estimated: true,
    metrics,
    violations: bookViolations,
    warnings,
    notes: [
      "이 기기에서 JS 공식과 어휘·문장 패턴으로 검사한 추정입니다. 공식 AR·Lexile·KReaD 점수가 아닙니다.",
    ],
  };
}
export async function analyzeBook(book, specs, options = {}) {
  specs = book?.readingLevelSnapshot?.specs || specs;
  validSpec(specs?.ko);
  validSpec(specs?.en);
  if (options.signal?.aborted)
    throw new DOMException("검사를 중단했어요.", "AbortError");
  return bookResult(book, specs, options);
}
export async function analyzePage(text, spec, options = {}) {
  if (options.signal?.aborted)
    throw new DOMException("검사를 중단했어요.", "AbortError");
  return analyzeEstimatedPage(text, spec, options);
}
