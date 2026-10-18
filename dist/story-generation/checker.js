import { describeReadingViolation } from "../reading-messages.js";
import { analyzeEstimatedPage, splitSentences } from "../reading-checker.js";
import { getLevelSpec } from "../reading-levels.js";
import {
  catchphraseRepeats,
  countCatchphrase,
  uniqueCatchphrases,
} from "../story-quality/dist/catchphrase.js";

/* Story checks complement the sentence-level estimates. They never change a
 * book or its frozen reading rules and never make a network request. */
const RULES = [
  ["duplicate_pages", "중복 쪽"],
  ["repeated_suffix", "꼬리말 반복"],
  ["beat_mapping", "비트 누락·순서"],
  ["refrain", "후렴 횟수·위치"],
  ["level", "읽기 수준 범위"],
  ["drawable_scene", "그릴 수 있는 장면"],
  ["moral_tail", "교훈 꼬리말"],
];
const CATCHPHRASE_FIELDS = ["catchphrase", "speechHabit", "vocalHabit"];
/** The catchphrase prompts use for a character (catchphrase, else speech habit). */
export function characterCatchphrase(character) {
  return String(character?.catchphrase || character?.speechHabit || "").trim();
}
/**
 * Every catchphrase that should appear at most once in this story: the cast's,
 * plus phrases a frozen rotation policy removed from the prompt.
 */
export function storyCatchphrases(input = {}) {
  const phrases = input?.catchphrasePolicy?.phrases;
  return uniqueCatchphrases([
    ...(Array.isArray(input?.characters) ? input.characters : []).map(
      characterCatchphrase,
    ),
    ...(phrases && typeof phrases === "object" ? Object.values(phrases) : []),
  ]);
}
function bookPageTextKo(book) {
  const pages = Array.isArray(book?.pages) ? book.pages : [];
  const text = pages
    .map((page) => String(page?.ko ?? page?.textKo ?? ""))
    .join("\n");
  return text.trim() ? text : String(book?.prose?.ko || "");
}
/**
 * R9 rotation, decided once when a draft is created and frozen in its input.
 * Looks at the `recentBooks` most recent approved books whose protagonist
 * (characterIds[0]) is this story's protagonist. A cast catchphrase that
 * appears in those books' Korean page text is omitted from this book.
 */
export function catchphrasePolicyFor(
  books,
  characters,
  { recentBooks = 2 } = {},
) {
  const cast = Array.isArray(characters) ? characters : [];
  const protagonistId = cast[0]?.id;
  const recent = (Array.isArray(books) ? books : [])
    .filter(
      (book) =>
        book?.approved === true &&
        !!protagonistId &&
        Array.isArray(book.characterIds) &&
        book.characterIds[0] === protagonistId,
    )
    .sort((a, b) =>
      String(b.approvedAt || b.createdAt || "").localeCompare(
        String(a.approvedAt || a.createdAt || ""),
      ),
    )
    .slice(0, Math.max(0, recentBooks));
  const texts = recent.map(bookPageTextKo);
  const phrases = {};
  for (const character of cast) {
    const phrase = characterCatchphrase(character);
    if (character?.id && phrase) phrases[character.id] = phrase.slice(0, 500);
  }
  const omit = Object.entries(phrases)
    .filter(([, phrase]) =>
      texts.some((text) => countCatchphrase(text, phrase) > 0),
    )
    .map(([id]) => id);
  return {
    version: 1,
    limit: 1,
    omit,
    phrases,
    recentBookIds: recent.map((book) => String(book.id || "")),
  };
}
/** Remove catchphrase fields from the characters a policy omits (returns copies). */
export function omitCatchphrases(characters, policy) {
  const omit = new Set(Array.isArray(policy?.omit) ? policy.omit : []);
  return (Array.isArray(characters) ? characters : []).map((character) => {
    if (!omit.has(character?.id)) return character;
    const copy = { ...character };
    for (const key of CATCHPHRASE_FIELDS) delete copy[key];
    return copy;
  });
}
const canonical = (text) =>
  String(text || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
const words = (text) => canonical(text).split(" ").filter(Boolean);
const englishWords = (text) =>
  String(text || "").match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
const textOf = (page, language) =>
  String(
    page?.[language === "ko" ? "textKo" : "textEn"] ?? page?.[language] ?? "",
  );
const pageNoOf = (page, index) =>
  Number.isInteger(page?.pageNo) && page.pageNo > 0 ? page.pageNo : index + 1;
const indexOf = (value) =>
  value == null || value === ""
    ? null
    : Number.isInteger(Number(value))
      ? Number(value)
      : null;
const unique = (values) => [...new Set(values)];
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  const union = new Set([...a, ...b]);
  return [...a].filter((word) => b.has(word)).length / union.size;
};
const sameSentence = (a, b) => canonical(a) === canonical(b);
const plannedRefrain = (sentence, outline) =>
  !!outline?.refrain?.text && sameSentence(sentence, outline.refrain.text);
const withoutRefrain = (text, outline) =>
  splitSentences(text)
    .filter((sentence) => !plannedRefrain(sentence, outline))
    .join(" ");

// At E0, recurring picture-book frames are intentional. Compare their content,
// not "I see a ... here". Exact repeated content still fails; a different noun
// passes even when short sentences share most of their frame words.
const EN_FRAME =
  /^(?:i can see|we can see|can you see|i see|we see|i hear|we hear|i feel|look at|here is|here are|this is|that is|there is|there are)\b\s*/i;
const EN_FRAME_WORDS = new Set(["a", "an", "the", "here", "there", "now"]);
function englishContent(text, early) {
  const tokens = words(early ? canonical(text).replace(EN_FRAME, "") : text);
  return early ? tokens.filter((word) => !EN_FRAME_WORDS.has(word)) : tokens;
}
const DRAWABLE_VERBS = new Set(
  (
    "walk run jump hop climb crawl sit stand lie sleep rest hold carry lift pull push drag " +
    "open close turn swing wave point look watch see peek peer bend kneel crouch reach " +
    "touch tap knock hit kick throw toss catch roll bounce pick gather collect stack build " +
    "place put set bring give take share offer hug embrace pat stroke help follow lead " +
    "cross enter leave return ride sail paddle swim float dive slide fly dance spin twirl " +
    "blow sing whistle shout speak say call whisper laugh smile grin giggle cry sneeze " +
    "listen sniff smell taste eat drink bite chew sip pour fill spill splash wash wipe " +
    "dry brush paint draw write trace cut fold tie untie wrap unwrap dress wear button " +
    "zip plant water dig rake sweep sweep search find hide seek explore discover " +
    "balance lean stretch spread flap wag shake nod raise lower tuck cover uncover " +
    "stomp skip step stamp drop scatter arrange unpack pack fit make tie ring chirp"
  ).split(/\s+/),
);
const IRREGULAR_VERBS = {
  ran: "run",
  sat: "sit",
  stood: "stand",
  lay: "lie",
  slept: "sleep",
  held: "hold",
  took: "take",
  gave: "give",
  brought: "bring",
  caught: "catch",
  threw: "throw",
  blew: "blow",
  sang: "sing",
  ate: "eat",
  drank: "drink",
  rode: "ride",
  swam: "swim",
  flew: "fly",
  found: "find",
  hid: "hide",
  made: "make",
  saw: "see",
  wore: "wear",
  left: "leave",
  bent: "bend",
};
function drawableVerb(word) {
  const value = word.toLowerCase();
  if (DRAWABLE_VERBS.has(value) || DRAWABLE_VERBS.has(IRREGULAR_VERBS[value]))
    return true;
  const roots = [
    value.replace(/ies$/, "y"),
    value.replace(/s$/, ""),
    value.replace(/es$/, ""),
    value.replace(/ed$/, ""),
    value.replace(/d$/, ""),
    value.replace(/ing$/, ""),
    value.replace(/ing$/, "e"),
  ];
  if (/([b-df-hj-np-tv-z])\1(?:ed|ing)$/.test(value))
    roots.push(value.replace(/([b-df-hj-np-tv-z])\1(?:ed|ing)$/, "$1"));
  return roots.some((root) => DRAWABLE_VERBS.has(root));
}
function resolvedSpecs(pagination, supplied) {
  const snapshot =
    pagination?.readingLevelSnapshot || pagination?.readingLevels || {};
  const source =
    snapshot.specs || supplied?.specs || supplied || pagination?.specs || {};
  return {
    ko:
      source.ko ||
      getLevelSpec(snapshot.koreanLevel || pagination?.koreanLevel || "K1"),
    en:
      source.en ||
      getLevelSpec(snapshot.englishLevel || pagination?.englishLevel || "E0"),
  };
}
function levelMessage(language, violation) {
  return describeReadingViolation({ ...violation, language });
}

/** Return all seven checks and targeted repair instructions, without mutation.
 * Catchphrase repetition is advisory: it is reported in `warnings` only, so it
 * never fails a check or asks for a (paid) page rewrite. Pass `catchphrases`,
 * or the frozen `storyInput` to check storyCatchphrases(storyInput). */
export function checkStory(
  outline,
  pagination,
  {
    specs,
    allowedNames = [],
    storyWords = [],
    storyInput = null,
    catchphrases = storyInput ? storyCatchphrases(storyInput) : [],
  } = {},
) {
  const rawPages = Array.isArray(pagination)
    ? pagination
    : pagination?.pages || [];
  const pages = rawPages
    .map((page, index) => ({ page, pageNo: pageNoOf(page, index), index }))
    .sort((a, b) => a.pageNo - b.pageNo);
  const checks = RULES.map(([id, label]) => ({
    id,
    label,
    passed: true,
    violations: [],
  }));
  const byId = new Map(checks.map((check) => [check.id, check]));
  const add = (type, kind, message, pageNo, language) => {
    const violation = {
      type,
      kind,
      ...(pageNo != null ? { pageNo } : {}),
      ...(language ? { language } : {}),
      message,
    };
    byId.get(type).passed = false;
    byId.get(type).violations.push(violation);
  };
  const readingSpecs = resolvedSpecs(
    Array.isArray(pagination) ? {} : pagination,
    specs,
  );
  const earlyEnglish =
    readingSpecs.en?.id === "E0" ||
    (readingSpecs.en?.allowedGrammar || []).some((rule) =>
      /repeating frame/i.test(rule),
    );

  for (let i = 0; i < pages.length; i++)
    for (let j = i + 1; j < pages.length; j++) {
      const earlier = pages[i],
        later = pages[j];
      const koA = new Set(
        words(withoutRefrain(textOf(earlier.page, "ko"), outline)),
      );
      const koB = new Set(
        words(withoutRefrain(textOf(later.page, "ko"), outline)),
      );
      if (jaccard(koA, koB) >= 0.6)
        add(
          "duplicate_pages",
          "page",
          `${earlier.pageNo}쪽과 어절 유사도가 0.6 이상이에요. 뒤쪽에 새 사건을 써 주세요.`,
          later.pageNo,
          "ko",
        );
      const enA = englishContent(
        withoutRefrain(textOf(earlier.page, "en"), outline),
        earlyEnglish,
      );
      const enB = englishContent(
        withoutRefrain(textOf(later.page, "en"), outline),
        earlyEnglish,
      );
      const repeats = earlyEnglish
        ? enA.length > 0 && enA.join(" ") === enB.join(" ")
        : jaccard(new Set(enA), new Set(enB)) >= 0.6;
      if (repeats)
        add(
          "duplicate_pages",
          "page",
          `${earlier.pageNo}쪽과 영어 내용이 반복돼요. E0 반복 문형은 유지하면서 사건·내용을 바꿔 주세요.`,
          later.pageNo,
          "en",
        );
    }

  const suffixes = new Map();
  for (const { page, pageNo } of pages)
    for (const sentence of splitSentences(textOf(page, "ko"))) {
      if (plannedRefrain(sentence, outline)) continue;
      const tokens = words(sentence);
      if (tokens.length < 6) continue;
      const key = tokens.slice(-6).join(" "),
        affected = suffixes.get(key) || new Set();
      affected.add(pageNo);
      suffixes.set(key, affected);
    }
  for (const [suffix, affected] of suffixes)
    if (affected.size >= 3) {
      for (const pageNo of affected)
        add(
          "repeated_suffix",
          "page",
          `문장 끝 “${suffix}”가 ${affected.size}쪽에서 반복돼요.`,
          pageNo,
          "ko",
        );
    }

  const beats = Array.isArray(outline?.beats) ? outline.beats : [];
  const beatIds = beats.map((beat) => indexOf(beat.index));
  if (!pages.length || !beats.length)
    add(
      "beat_mapping",
      "pagination",
      "줄거리 비트와 쪽이 모두 있어야 해요. 쪽을 다시 나눠 주세요.",
    );
  if (
    beatIds.some((index) => index == null) ||
    new Set(beatIds).size !== beatIds.length
  )
    add("beat_mapping", "pagination", "줄거리 비트 번호가 없거나 중복돼요.");
  for (let i = 0; i < pages.length; i++) {
    const { page, pageNo } = pages[i];
    if (!Number.isInteger(page?.pageNo) || page.pageNo !== i + 1)
      add(
        "beat_mapping",
        "pagination",
        "쪽 번호는 1부터 빠짐없이 이어져야 해요.",
        pageNo,
      );
    if (!beatIds.includes(indexOf(page?.beatIndex)))
      add(
        "beat_mapping",
        "pagination",
        "줄거리에 없는 비트가 쪽에 연결돼 있어요.",
        pageNo,
      );
    if (
      i > 0 &&
      beatIds.indexOf(indexOf(page?.beatIndex)) <
        beatIds.indexOf(indexOf(pages[i - 1].page?.beatIndex))
    )
      add(
        "beat_mapping",
        "pagination",
        "비트 순서가 거꾸로 이어져요. 전문을 유지하고 쪽을 다시 나눠 주세요.",
        pageNo,
      );
  }
  for (const beat of beats)
    if (
      !pages.some(
        ({ page }) => indexOf(page?.beatIndex) === indexOf(beat.index),
      )
    )
      add(
        "beat_mapping",
        "pagination",
        `${beat.index}번 비트가 본문에서 빠졌어요. 쪽을 다시 나눠 주세요.`,
      );
  const turn = beats.find((beat) => beat.type === "turn");
  if (turn && pages.length) {
    const firstTurn = pages.find(
      ({ page }) => indexOf(page?.beatIndex) === indexOf(turn.index),
    );
    const low = Math.max(1, Math.floor((pages.length * 2) / 3)),
      high = Math.min(pages.length, low + 1);
    if (firstTurn && (firstTurn.pageNo < low || firstTurn.pageNo > high))
      add(
        "beat_mapping",
        "pagination",
        `반전은 ${low}~${high}쪽에서 시작해야 해요.`,
        firstTurn.pageNo,
      );
  }
  if (pages.length && beats.length) {
    const lastBeat = beats.find(
      (beat) => indexOf(beat.index) === indexOf(pages.at(-1).page?.beatIndex),
    );
    if (lastBeat?.type !== "close")
      add(
        "beat_mapping",
        "pagination",
        "마지막 쪽은 차분한 마무리(close) 비트여야 해요.",
        pages.at(-1).pageNo,
      );
  }

  if (outline?.refrain?.text) {
    const refrain = canonical(outline.refrain.text),
      planned = (outline.refrain.usedAtBeats || []).map(indexOf);
    let count = 0;
    for (const { page, pageNo } of pages)
      for (const language of ["ko", "en"]) {
        const text = canonical(textOf(page, language));
        if (!refrain) continue;
        // Compare word spans so adjacent repeated refrains are counted too.
        const textTokens = words(text),
          refrainTokens = words(refrain);
        let occurrences = 0;
        for (
          let start = 0;
          start <= textTokens.length - refrainTokens.length;
          start++
        )
          if (
            refrainTokens.every(
              (word, offset) => textTokens[start + offset] === word,
            )
          )
            occurrences++;
        for (let i = 0; i < occurrences; i++) {
          count++;
          if (!planned.includes(indexOf(page?.beatIndex)))
            add(
              "refrain",
              "page",
              "계획에 없는 비트에 후렴이 있어요.",
              pageNo,
              language,
            );
          if (count > 3)
            add(
              "refrain",
              "page",
              "후렴은 한 책에 최대 세 번만 쓸 수 있어요.",
              pageNo,
              language,
            );
        }
      }
  }

  const warnings = [];
  const levelResults = { ko: [], en: [] };
  for (const { page, pageNo } of pages)
    for (const language of ["ko", "en"]) {
      try {
        const result = analyzeEstimatedPage(
          textOf(page, language),
          readingSpecs[language],
          { language, allowedNames, storyWords },
        );
        levelResults[language].push({ pageNo, result });
        warnings.push(
          ...result.warnings.map((warning) => ({ ...warning, pageNo })),
        );
        for (const violation of result.violations)
          add(
            "level",
            "page",
            levelMessage(language, violation),
            pageNo,
            language,
          );
      } catch (error) {
        add(
          "level",
          "page",
          `${language === "ko" ? "한글" : "영어"} 읽기 규칙을 검사할 수 없어요: ${error.message}`,
          pageNo,
          language,
        );
      }
    }
  for (const language of ["ko", "en"]) {
    const results = levelResults[language],
      outside = unique(
        results.flatMap(({ result }) => result.metrics.outOfVocabWords),
      );
    const budget = readingSpecs[language]?.newWordsPerBook;
    const max = Array.isArray(budget) ? budget.at(-1) : budget;
    if (
      readingSpecs[language]?.vocabularyPolicy !== "warning" &&
      max != null &&
      outside.length > max
    )
      for (const { pageNo, result } of results) {
        if (result.metrics.outOfVocabWords.length)
          add(
            "level",
            "page",
            `${language === "ko" ? "한글" : "영어"} 책 전체 새 단어 ${outside.length}개가 허용 ${max}개를 넘었어요.`,
            pageNo,
            language,
          );
      }
  }

  for (const { page, pageNo } of pages) {
    const action = String(page?.scene?.action || ""),
      tokens = englishWords(action);
    if (tokens.length < 8 || tokens.length > 30)
      add(
        "drawable_scene",
        "scene",
        `장면 설명은 영어 8~30단어여야 해요. 현재 ${tokens.length}단어예요.`,
        pageNo,
      );
    if (!tokens.some(drawableVerb))
      add(
        "drawable_scene",
        "scene",
        "장면에 그릴 수 있는 동작이 없어요. 동작·위치·소품을 써 주세요.",
        pageNo,
      );
  }

  const moralPages = [];
  const MORAL =
    /(?:마음(?:이|은)?\s*(?:(?:참|정말|너무|아주)\s*)?따뜻(?:해요|했어요|해졌어요|했답니다)|(?:(?:참|정말|너무|아주)\s*)좋았어요|행복(?:했어요|해졌어요|했답니다)|(?:(?:참|정말|너무|아주)\s*)즐거웠어요)\s*[.!?。！？'"”’]*$/u;
  for (const { page, pageNo } of pages) {
    const sentences = splitSentences(textOf(page, "ko")).filter(
      (sentence) => !plannedRefrain(sentence, outline),
    );
    if (sentences.length && MORAL.test(sentences.at(-1)))
      moralPages.push(pageNo);
  }
  if (moralPages.length >= 2)
    for (const pageNo of moralPages)
      add(
        "moral_tail",
        "page",
        "감상·교훈 꼬리말이 두 쪽 이상 반복돼요. 인물의 행동으로 마무리해 주세요.",
        pageNo,
        "ko",
      );

  for (const language of ["ko", "en"])
    for (const hit of catchphraseRepeats(
      pages.map(({ page }) => textOf(page, language)),
      Array.isArray(catchphrases) ? catchphrases : [],
    )) {
      const pageNos = hit.at.map((index) => pages[index].pageNo);
      warnings.push({
        type: "catchphrase",
        code: "catchphrase-repeat",
        severity: "warning",
        advisory: true,
        language,
        pageNo: pageNos[1] ?? pageNos[0],
        pages: pageNos,
        phrase: hit.phrase,
        count: hit.count,
        message: `${language === "ko" ? "한글" : "영어"} 말버릇 "${hit.phrase}"이(가) ${hit.count}번 나와요(${pageNos.join("·")}쪽). 책 전체에서 한 번 이하로 줄이면 좋아요.`,
      });
    }

  const violations = checks.flatMap((check) => check.violations);
  return {
    passed: checks.every((check) => check.passed),
    checks,
    warnings,
    violations,
    failedPageNos: unique(
      violations.filter((v) => v.pageNo != null).map((v) => v.pageNo),
    ).sort((a, b) => a - b),
    needsRepagination: violations.some(
      (violation) => violation.kind === "pagination",
    ),
  };
}
