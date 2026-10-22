import { splitSentences as sharedSplitSentences } from "./story-quality/dist/util.js";
import { VOCAB_DATA, ENGLISH_ONOMATOPOEIA } from "./reading-vocab.js";
import { unitKind, unitSpec } from "./book-layout.js";
import { rhythmBand, bookBudget } from "./page-rhythm.js";
import {
  hasShortSentences,
  splitAtEllipsis,
  rhythmSentenceIndices,
  shortSentenceViolations,
} from "./short-sentences.js";
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
  return sharedSplitSentences(text);
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
// R31d: a lean spec (spec.inflections) also folds the regular forms the list
// check missed — a doubled consonant (stopped, wagging, bigger), -es (boxes),
// -er/-est, a possessive with a curly apostrophe — and a base form whose past
// is in the list (hid → hide). Other specs keep the old variants exactly.
// Common picture-book verbs whose past form a reader list may carry instead of
// the base (hid but not hide), checked both ways on a lean spec.
const LEAN_PAST = {
  hide: "hid", run: "ran", sit: "sat", stand: "stood", sleep: "slept", hold: "held", throw: "threw",
  blow: "blew", sing: "sang", eat: "ate", drink: "drank", ride: "rode", swim: "swam", fly: "flew",
  wear: "wore", leave: "left", bend: "bent", catch: "caught", bring: "brought", buy: "bought",
  fall: "fell", begin: "began", break: "broke", wake: "woke", draw: "drew", shake: "shook", dig: "dug",
  hang: "hung", lose: "lost", meet: "met", win: "won", write: "wrote", forget: "forgot", swing: "swung",
  spin: "spun", creep: "crept", sweep: "swept", feed: "fed", lead: "led", light: "lit", bite: "bit",
  slide: "slid", stick: "stuck", tear: "tore", wake: "woke", ring: "rang", sink: "sank", shine: "shone",
};
const irregularBase = Object.fromEntries([
  ...Object.entries(irregular).map(([past, base]) => [base, past]),
  ...Object.entries(LEAN_PAST),
]);
const leanBase = Object.fromEntries(Object.entries(LEAN_PAST).map(([base, past]) => [past, base]));
function familiar(word, allowed, inflections = false) {
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
  if (inflections) {
    const plain = value.replace(/’s$/, "");
    variants.push(
      plain,
      plain.replace(/([b-df-hj-np-tv-z])\1(?:ed|ing|er|est)$/, "$1"),
      plain.replace(/es$/, ""),
      plain.replace(/er$/, ""),
      plain.replace(/est$/, ""),
      plain.replace(/ier$/, "y"),
      plain.replace(/iest$/, "y"),
      irregularBase[plain],
      leanBase[plain],
    );
  }
  return variants.some((variant) => variant && allowed.has(variant));
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
const KO_SOUND_WORDS = new Set([
  "톡",
  "딸꾹",
  "똑",
  "쿵",
  "쾅",
  "퐁",
  "쏙",
  "뚝",
  "휙",
  "후우",
  "후",
  "쉭",
  "딱",
  "짝",
  "딩동",
  "둥",
  "팡",
  "꼬르륵",
  "반짝",
  "살랑",
  "데굴",
  "두근",
  "아야",
  "와",
  "우와",
  "어",
  "앗",
  "응",
  "쉿",
  "오",
  "야",
  "아하",
]);
const EN_SOUND_WORDS = new Set([
  ...ENGLISH_ONOMATOPOEIA,
  "oh",
  "wow",
  "yay",
  "hooray",
  "hurray",
  "ah",
  "ooh",
  "oops",
  "ouch",
  "shh",
]);
/** A transparent sound-word/repeated-syllable heuristic, not morphological analysis. */
export function isSoundOnlySentence(text, levelId, language) {
  if (language === "ko") {
    if (!["K1", "K2"].includes(levelId)) return false;
    const words = String(text).match(/[가-힣]+/gu) || [];
    // Reject mixed English/numeric prose rather than ignoring its non-Korean content.
    return (
      words.length > 0 &&
      !/[A-Za-z0-9]/u.test(text) &&
      words.every(
        (word) =>
          KO_SOUND_WORDS.has(word) || /^(?:([가-힣]{1,3})\1{1,3})$/u.test(word),
      )
    );
  }
  const words = enWords(text);
  return (
    ["E0", "E1"].includes(levelId) &&
    words.length > 0 &&
    !/[가-힣0-9]/u.test(text) &&
    words.every((word) => EN_SOUND_WORDS.has(word))
  );
}
const PRESENT_NONPAST_WORDS = new Set([
  "reed",
  "weed",
  "seed",
  "need",
  "feed",
  "speed",
  "bed",
  "red",
  "sled",
  "shed",
  "hundred",
]);
const PARTICIPLE_ADJECTIVES = new Set([
  "tired",
  "scared",
  "excited",
  "closed",
  "stuck",
  "curled",
  "tangled",
  "surprised",
  "worried",
  "pleased",
  "amazed",
  "confused",
  "frightened",
  "relaxed",
  "interested",
  "delighted",
  "embarrassed",
]);
const COORDINATED_ADJECTIVES = new Set([
  "slow",
  "happy",
  "quiet",
  "safe",
  "warm",
  "cold",
  "soft",
  "sleepy",
  "hungry",
  "ready",
]);
const ADJECTIVE_CUES = new Set([
  "is",
  "are",
  "am",
  "looks",
  "feels",
  "seems",
  "gets",
  "so",
  "very",
  "too",
]);
/**
 * R12 openings, Korean only (a frozen v4 spec with unitTolerance, usually through
 * unitSpec(spec, kind)): sentence count, mean eojeol and long sentences are judged
 * per unit with tolerances; single off-range sentences become ONE advisory note.
 * Returns { blocking, note }. English and every pre-R12 spec never come here.
 */
function unitLengthRules(metrics, spec) {
  const tol = spec.unitTolerance,
    range = spec.sentencesPerPageRange,
    wps = spec.wordsPerSentence,
    unit = spec.unit || "page",
    n = metrics.sentenceCount,
    blocking = [];
  // Page rhythm: the wide per-unit band; the book total is judged elsewhere.
  const band = rhythmBand(spec) || {
    min: range.min - number(tol.countBelow, 1),
    max: range.max + number(tol.countAbove, 2),
  };
  if (n < band.min || n > band.max)
    blocking.push({
      code: "unit-sentence-count",
      language: "ko",
      unit,
      actual: n,
      expected: { min: range.min, max: range.max },
      band,
    });
  const exempt = new Set(metrics.minimumLengthExemptSentenceIndices),
    lengths = metrics.wordsPerSentence.filter((_, index) => !exempt.has(index)),
    mean = lengths.length
      ? round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length)
      : null,
    slack = number(tol.meanSlack, 0.5);
  if (mean != null && (mean < wps.min - slack || mean > wps.max + slack))
    blocking.push({
      code: "unit-mean-length",
      language: "ko",
      unit,
      actual: mean,
      expected: { min: wps.min - slack, max: wps.max + slack },
    });
  const long = lengths.filter((value) => value > wps.max).length,
    longest = lengths.length ? Math.max(...lengths) : 0,
    // ceil(n/3) long sentences are fine; the epsilon keeps 12 × (1/3) at 4.
    allowedLong = Math.ceil(n * number(tol.longShareCeil, 1 / 3) - 1e-9),
    hardLimit = wps.max + number(tol.longOver, 3);
  if (long > allowedLong || longest > hardLimit)
    blocking.push({
      code: "unit-long-sentences",
      language: "ko",
      unit,
      actual: long,
      max: allowedLong,
      longest,
      limit: wps.max,
      hardLimit,
    });
  const offSentences = lengths.filter(
      (value) => value < wps.min || value > wps.max,
    ).length,
    countOff = !rhythmBand(spec) && (n < range.min || n > range.max),
    chars = spec.advisoryCharsPerPage,
    charsOff =
      Array.isArray(chars) &&
      (metrics.characterCount < chars[0] || metrics.characterCount > chars[1]);
  const note =
    offSentences || countOff || charsOff
      ? {
          code: "unit-length-note",
          language: "ko",
          severity: "warning",
          advisory: true,
          unit,
          offSentences,
          mean,
          sentenceCount: n,
          expected: { min: range.min, max: range.max },
          ...(charsOff
            ? {
                characters: {
                  actual: metrics.characterCount,
                  min: chars[0],
                  max: chars[1],
                },
              }
            : {}),
        }
      : null;
  return { blocking, note };
}
const unitRulesApply = (spec, lang) =>
  lang === "ko" &&
  spec?.layout === "openings" &&
  !!spec.unitTolerance &&
  !!spec.sentencesPerPageRange;
function violations(metrics, spec, lang) {
  if (unitRulesApply(spec, lang)) return unitViolations(metrics, spec);
  const short = lang === "ko" && hasShortSentences(spec);
  const out = short ? shortSentenceViolations(metrics, spec) : [],
    // Page rhythm: a frozen rhythm spec judges each page by its wide band.
    expected =
      rhythmBand(spec) ||
      spec.sentencesPerPageRange ||
      (typeof spec.sentencesPerPage === "number"
        ? { min: spec.sentencesPerPage, max: spec.sentencesPerPage }
        : spec.sentencesPerPage);
  if (
    !short &&
    (metrics.sentenceCount < number(expected?.min, 1) ||
      metrics.sentenceCount > number(expected?.max, expected?.min))
  )
    out.push({
      code: "sentence-count",
      language: lang,
      actual: metrics.sentenceCount,
      expected,
    });
  if (!short) metrics.wordsPerSentence.forEach((count, index) => {
    if (
      (count < spec.wordsPerSentence.min &&
        !metrics.minimumLengthExemptSentenceIndices.includes(index)) ||
      count > spec.wordsPerSentence.max
    )
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
/** Openings Korean: unit length rules plus today's vocabulary and connective checks. */
function unitViolations(metrics, spec) {
  const out = [...unitLengthRules(metrics, spec).blocking];
  if (
    !metrics.vocabularySkipped &&
    metrics.outOfVocabRatio > number(spec.maxOutOfVocabRatio, 0.1)
  )
    out.push({
      code: "out-of-vocabulary",
      language: "ko",
      actual: metrics.outOfVocabRatio,
      max: spec.maxOutOfVocabRatio,
      words: metrics.outOfVocabWords,
    });
  metrics.connectiveEndingsPerSentence.forEach((count, index) => {
    if (count > number(spec.maxConnectiveEndingsPerSentence, 1))
      out.push({
        code: "connective-endings",
        language: "ko",
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
  // R31a: a K1 short-sentence spec also ends a sentence at an ellipsis.
  const shortPolicy = lang === "ko" && hasShortSentences(spec),
    sentences = shortPolicy
      ? splitAtEllipsis(splitSentences(text))
      : splitSentences(text),
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
          lang === "ko" ? !koAllowed(word, allowed) : !familiar(word, allowed, spec.inflections === true),
        ),
    lengths = sentences.map((sentence) => tokenize(sentence).length),
    count = words.length;
  const metrics = {
    sentenceCount: sentences.length,
    wordCount: count,
    characterCount: Array.from(String(text || "").normalize("NFC")).length,
    wordsPerSentence: lengths,
    minimumLengthExemptSentenceIndices: sentences.flatMap((sentence, index) =>
      isSoundOnlySentence(sentence, spec.id, lang) ? [index] : [],
    ),
    averageWordsPerSentence: round(count / Math.max(1, sentences.length)),
    ...(shortPolicy
      ? { rhythmSentenceIndices: rhythmSentenceIndices(sentences, lengths, spec) }
      : {}),
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
    const namesSet = new Set(names.flatMap(enWords));
    const past = sentences.flatMap((sentence) => {
      const tokens = enWords(sentence);
      return tokens.filter((word, index) => {
        if (
          /^(?:was|were|went|saw|said|had|did|gave|found|made|took|felt|came|grew|knew|got|kept|thought|stood|ate|ran|shouted|whispered)$/.test(
            word,
          )
        )
          return true;
        if (
          !word.endsWith("ed") ||
          PRESENT_NONPAST_WORDS.has(word) ||
          namesSet.has(word)
        )
          return false;
        const previous = tokens[index - 1];
        return !(
          PARTICIPLE_ADJECTIVES.has(word) &&
          (ADJECTIVE_CUES.has(previous) ||
            (previous === "not" && ADJECTIVE_CUES.has(tokens[index - 2])) ||
            (previous === "and" &&
              (COORDINATED_ADJECTIVES.has(tokens[index - 2]) ||
                PARTICIPLE_ADJECTIVES.has(tokens[index - 2]))))
        );
      });
    });
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
  if (unitRulesApply(spec, lang)) {
    const note = unitLengthRules(metrics, spec).note;
    if (note) warnings.push(note);
  }
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
    // R12: an openings spec is judged per unit (spread or page); others unchanged.
    const kind = unitKind(page),
      ko = analyzeEstimatedPage(pageText(page, "ko"), unitSpec(specs.ko, kind), {
        ...options,
        language: "ko",
      }),
      en = analyzeEstimatedPage(pageText(page, "en"), unitSpec(specs.en, kind), {
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
    const budget = bookBudget(specs[lang], pageList(book));
    if (budget) {
      const total = pages.reduce(
        (sum, page) => sum + page[lang].metrics.sentenceCount,
        0,
      );
      if (total < budget.min || total > budget.max)
        bookViolations.push({
          code: "book-sentence-total",
          language: lang,
          actual: total,
          expected: { min: budget.min, max: budget.max },
        });
    }
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
