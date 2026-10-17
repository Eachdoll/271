/* Dictionary and pattern checks are editorial hints, not a grammatical parser.
 * This module is synchronous, deterministic, browser-safe, and never calls an API.
 * JSON seed files in ./vocab mirror these constants for export and future editing. */
export const RICHNESS_VOCAB = Object.freeze({
  onomatopoeia_ko: {
    rain: ["토독토독", "주룩주룩", "첨벙", "찰박찰박", "후두둑"],
    wind: ["휘잉", "살랑살랑", "휘리릭"],
    walking: ["사뿐사뿐", "터벅터벅", "살금살금", "폴짝"],
    eating: ["냠냠", "아삭", "꿀꺽"],
    sleep: ["쌔근쌔근", "새근새근"],
    animals: ["짹짹", "멍멍", "꿀꿀", "음메"],
    water: ["퐁당", "졸졸", "보글보글"],
    surprise: ["깜짝", "두근두근", "흠칫"],
    laugh: ["까르르", "킥킥", "헤헤"],
  },
  sensory_ko: {
    touch: ["미끌미끌", "보들보들", "까칠까칠", "폭신폭신", "축축한", "따뜻한"],
    smell: ["고소한", "풀 냄새", "젖은 흙냄새", "달콤한"],
    lightAndShape: ["반짝", "아른아른", "동글동글", "길쭉한"],
  },
  onomatopoeia_en: [
    "drip-drop",
    "splash",
    "pitter-patter",
    "whoosh",
    "tiptoe",
    "stomp",
    "munch",
    "zzz",
    "chirp",
    "giggle",
    "plop",
    "rustle",
  ],
  sensory_en: [
    "soft",
    "bumpy",
    "slippery",
    "fluffy",
    "warm",
    "wet",
    "shiny",
    "sweet-smelling",
  ],
  emotion_tell_ko: [
    "무서웠어요",
    "기뻤어요",
    "슬펐어요",
    "놀랐어요",
    "행복했어요",
    "신났어요",
    "즐거웠어요",
    "속상했어요",
  ],
});
const unique = (values) => [...new Set(values.filter(Boolean))];
const flatten = (value) =>
  Array.isArray(value) ? value : Object.values(value || {}).flat();
const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalized = (value) =>
  String(value || "")
    .normalize("NFC")
    .replace(/[’]/g, "'")
    .toLowerCase()
    .trim();
const textOf = (page, language) =>
  String(
    page?.[language === "ko" ? "textKo" : "textEn"] ?? page?.[language] ?? "",
  );
const words = (text) => normalized(text).match(/[a-z]+(?:['-][a-z]+)*/g) || [];
const KO_PARTICLES =
  "(?:들)?(?:에게서|한테서|께서는|께서|으로는|에서는|에게|한테|으로|에서|이랑|처럼|까지|부터|하고|보다|은|는|이|가|을|를|에|와|과|도|만|로|의)?";
const KO_NOUNS =
  "집 방 문 창문 바닥 지붕 벽 침대 베개 이불 의자 책상 책 컵 접시 숟가락 가방 우산 우비 장화 신발 모자 옷 주머니 단추 손 발 발끝 손가락 팔 다리 눈 귀 코 입 꼬리 날개 꽃 민들레 나무 나뭇잎 잎 가지 풀 풀잎 씨앗 열매 사과 빵 물 우유 밥 돌 바위 모래 흙 웅덩이 물웅덩이 연못 강 바다 시냇물 빗방울 비 눈송이 구름 해 달 별 무지개 바람 길 다리 울타리 계단 상자 통 바구니 공 풍선 연 비눗방울 리본 실 종 방울 피리 장난감 인형 자동차 배 자전거 새 참새 달팽이 개미 나비 벌 무당벌레 개 강아지 고양이 토끼 공룡 물고기 개구리 거북이 다람쥐 곰 아이 친구 엄마 아빠".split(
    " ",
  );
const EN_NOUNS =
  "house home room door window floor roof wall bed pillow blanket chair table desk book cup plate spoon bag umbrella raincoat boot shoe hat coat pocket button hand foot finger arm leg eye ear nose mouth tail wing flower dandelion tree leaf branch grass seed fruit apple bread water milk rice stone rock sand soil puddle pond river sea stream raindrop rain snow snowflake cloud sun moon star rainbow wind path bridge fence step box tin basket ball balloon kite bubble ribbon string bell flute toy doll car boat bicycle bird sparrow snail ant butterfly bee ladybird dog puppy cat rabbit dinosaur fish frog turtle squirrel bear child friend mother father".split(
    " ",
  );
const ABSTRACT = new Set([
  "기쁨",
  "용기",
  "행복",
  "슬픔",
  "사랑",
  "우정",
  "생각",
  "마음",
  "joy",
  "courage",
  "happiness",
  "sadness",
  "love",
  "friendship",
  "thought",
  "feeling",
]);
const KO_EMOTION =
  /무섭(?:다|고|게|지|네요|니|지만)?|무서(?:워|웠|운|움)|기쁘(?:다|고|게|지|네요|니|지만)?|기뻐|기뻤|기쁜|슬프(?:다|고|게|지|네요|니|지만)?|슬퍼|슬펐|슬픈|놀라(?:다|요|고|서|지|는|게|네요|니|지만)?|놀랐|놀란|행복(?:하|해|했|한)|신나(?:다|요|고|서|지|는|게|네요|니|지만)?|신났|신난|즐겁(?:다|고|게|지|네요|니|지만)?|즐거(?:워|웠|운|움)|속상(?:하|해|했|한)/gu;
const EN_EMOTION =
  /\b(?:(?:am|is|are|was|were|be|been|feel|feels|felt|feeling|seem|seems|seemed|became|become)\s+(?:(?:very|so|really|quite|a little|not|still)\s+)*(?:happy|sad|scared|afraid|frightened|surprised|excited|upset|joyful|delighted|worried|angry)|(?:happily|sadly|joyfully|fearfully))\b/gi;
const EN_PRONOUNS = new Set([
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "this",
  "that",
  "these",
  "those",
  "someone",
  "somebody",
  "everyone",
  "everybody",
  "nobody",
  "who",
  "what",
]);
const EN_VERBS = new Set(
  "am is are was were be can could will would should may might must do does did have has had see sees saw hear hears heard feel feels felt look looks looked walk walks walked run runs ran jump jumps jumped hop hops hopped lift lifts lifted point points pointed crouch crouches crouched blow blows blew hug hugs hugged hide hides hid listen listens listened splash splashes splashed climb climbs climbed carry carries carried wave waves waved hold holds held open opens opened close closes closed touch touches touched tap taps tapped say says said ask asks asked call calls called whisper whispers whispered shout shouts shouted smile smiles smiled laugh laughs laughed giggle giggles giggled sit sits sat stand stands stood sleep sleeps slept rest rests rested fall falls fell glow glows glowed shine shines shone move moves moved shake shakes shook rustle rustles rustled drip drips dripped make makes made find finds found go goes went come comes came stop stops stopped wait waits waited peek peeks peeked float floats floated land lands landed roll rolls rolled nod nods nodded turn turns turned want wants wanted need needs needed".split(
    " ",
  ),
);
const NOTES = [
  "사전·정규식으로 추정한 풍부도예요. 문법이나 문학적 품질을 확정하는 점수가 아니에요.",
  "주어는 이름·대명사·주격 조사·간단한 영어 문형으로 추정하며, 감탄사와 의성어만 있는 짧은 표현은 문장 검사에서 제외해요.",
  "새 사건이나 소품을 추가해 통과시키지 말고, 승인한 장면과 읽기 수준을 우선해 주세요.",
];

function englishForms(term) {
  if (!/^[a-z]+$/.test(term)) return [term];
  const irregular = {
    leaf: ["leaves"],
    foot: ["feet"],
    child: ["children"],
    mouse: ["mice"],
  };
  return unique([
    term,
    `${term}s`,
    `${term}es`,
    `${term}ed`,
    `${term}ing`,
    ...(term.endsWith("e") ? [`${term}d`, `${term.slice(0, -1)}ing`] : []),
    ...(term.endsWith("y")
      ? [`${term.slice(0, -1)}ies`, `${term.slice(0, -1)}ied`]
      : []),
    ...(irregular[term] || []),
  ]);
}
const termPatterns = new Map();
function termPattern(value, language) {
  const key = language + "\u0000" + value;
  let pattern = termPatterns.get(key);
  if (!pattern) {
    pattern =
      language === "ko"
        ? new RegExp(
            `(?:^|[^가-힣a-z])${escape(value)}${KO_PARTICLES}(?=$|[^가-힣a-z])`,
            "u",
          )
        : new RegExp(
            `(?:^|[^a-z])(?:${englishForms(value).map(escape).join("|")})(?=$|[^a-z])`,
            "i",
          );
    termPatterns.set(key, pattern);
  }
  return pattern;
}
function contains(text, term, language) {
  const value = normalized(term);
  if (!value) return false;
  return termPattern(value, language).test(normalized(text));
}
function sensoryMatches(text, language, brief) {
  const lexicon = [
    ...flatten(RICHNESS_VOCAB[`onomatopoeia_${language}`]),
    ...flatten(RICHNESS_VOCAB[`sensory_${language}`]),
  ];
  const extra = [
    ...(brief?.sounds || []).map((s) => s?.[language]),
    brief?.smellOrTouch?.[language],
  ].filter(Boolean);
  // Korean sensory adjectives commonly conjugate. Add known, unambiguous stems.
  const matches = unique([...lexicon, ...extra]).filter((term) =>
    contains(text, term, language),
  );
  if (language === "ko")
    for (const [stem, term] of [
      ["미끌미끌", "미끌미끌"],
      ["보들보들", "보들보들"],
      ["까칠까칠", "까칠까칠"],
      ["폭신폭신", "폭신폭신"],
      ["축축", "축축한"],
      ["따뜻", "따뜻한"],
      ["고소", "고소한"],
      ["달콤", "달콤한"],
      ["반짝", "반짝"],
    ])
      if (
        new RegExp(`${stem}(?:하|한|해|했|이|인|여|였|거리|거려|반짝)`).test(
          text,
        )
      )
        matches.push(term);
  return unique(matches);
}
function concreteMatches(text, language, brief, page) {
  const basics = language === "ko" ? KO_NOUNS : EN_NOUNS;
  const detail = [
    ...(brief?.props || []).map((p) =>
      typeof p === "string" ? p : p?.[language],
    ),
    typeof brief?.creature === "string"
      ? brief.creature
      : brief?.creature?.[language],
    ...(page?.scene?.props || []),
  ].filter(Boolean);
  const matched = new Set(
    basics.filter((noun) => contains(text, noun, language)),
  );
  for (const phrase of detail) {
    const value = normalized(phrase);
    if (ABSTRACT.has(value)) continue;
    if (
      language === "ko"
        ? !/[가-힣]/.test(value)
        : !/[a-z]/.test(value) || /[가-힣]/.test(value)
    )
      continue;
    const head =
      language === "ko" ? value.split(/\s+/).at(-1) : words(value).at(-1);
    if (!head || ABSTRACT.has(head)) continue;
    if (contains(text, value, language) || contains(text, head, language)) {
      const existing = basics.find(
        (noun) => englishForms(noun).includes(head) && matched.has(noun),
      );
      matched.add(existing || head);
    }
  }
  return [...matched];
}
function sentences(text) {
  return (String(text || "").match(/[^.!?。！？\n]+(?:[.!?。！？]+|$)/gu) || [])
    .map((s) => s.trim().replace(/^[”’"']\s*/u, ""))
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}
function sentenceCore(text) {
  return normalized(text).replace(/^[“”‘’"'\s]+|[.!?。！？“”‘’"'\s]+$/gu, "");
}
function standaloneSound(text, language) {
  const core = sentenceCore(text),
    sound = flatten(RICHNESS_VOCAB[`onomatopoeia_${language}`]);
  const interjections =
    language === "ko"
      ? [
          "와",
          "와아",
          "어",
          "아",
          "오",
          "앗",
          "어머",
          "야호",
          "우와",
          "응",
          "네",
          "아니",
        ]
      : ["wow", "oh", "ah", "hey", "hooray", "yes", "no", "oops"];
  return [...sound, ...interjections].some((word) => normalized(word) === core);
}
function characterNames(input, language) {
  return unique(
    (input.characters || []).flatMap((c) =>
      language === "ko"
        ? [c.name, c.nameKo]
        : [
            c.nameEn,
            c.englishName,
            ...(/[A-Za-z]/.test(c.name || "") ? [c.name] : []),
          ],
    ),
  ).map(normalized);
}
function hasSubject(sentence, language, names) {
  const core = sentenceCore(sentence);
  if (!core || standaloneSound(sentence, language)) return true;
  if (language === "ko") {
    // A mentioned object (유하를) is not a subject; any explicit noun subject is.
    if (
      names.some((name) =>
        new RegExp(
          `(?:^|[^가-힣])${escape(name)}(?:은|는|이|가|께서)(?=$|[^가-힣])`,
          "u",
        ).test(core),
      )
    )
      return true;
    if (
      /(?:^|\s)(?:나는|내가|너는|네가|저는|제가|우리는|우리가|그는|그가|그녀는|그녀가|그들은|그들이|둘이|모두가|누가|무엇이)(?:\s|$)/u.test(
        core,
      )
    )
      return true;
    return core
      .split(/\s+/u)
      .some(
        (token) =>
          /^[가-힣]{1,24}(?:께서는|께서|은|는|이|가)$/u.test(token) &&
          !/(?:걷는|가는|오는|하는|있는|없는|보는|나는|되는|드는|먹는|웃는|들리는|보이는)$/u.test(
            token,
          ),
      );
  }
  const tokens = words(core);
  if (!tokens.length) return false;
  const pronounAt = (index) => EN_PRONOUNS.has(tokens[index]);
  const nameAt = (index) =>
    names.some((name) =>
      words(name).every((token, offset) => tokens[index + offset] === token),
    );
  // Drop a sentence-leading sound/adverb, never an imperative verb.
  let start = 0;
  if (
    /^(?:then|now|suddenly|softly|slowly|outside|inside|today|finally),?\s/i.test(
      core,
    )
  )
    start = 1;
  if (pronounAt(start) || nameAt(start)) return true;
  if (
    [
      "can",
      "could",
      "will",
      "would",
      "should",
      "may",
      "might",
      "do",
      "does",
      "did",
      "is",
      "are",
      "was",
      "were",
      "has",
      "have",
    ].includes(tokens[start])
  )
    return (
      pronounAt(start + 1) ||
      nameAt(start + 1) ||
      ["the", "a", "an", "my", "our", "your"].includes(tokens[start + 1])
    );
  if (
    ["where", "when", "why", "how"].includes(tokens[start]) &&
    EN_VERBS.has(tokens[start + 1])
  )
    return (
      pronounAt(start + 2) ||
      nameAt(start + 2) ||
      ["the", "a", "an", "my", "our", "your"].includes(tokens[start + 2])
    );
  if (
    ["here", "there"].includes(tokens[start]) &&
    ["is", "are", "was", "were"].includes(tokens[start + 1])
  )
    return true;
  const firstVerb = tokens.findIndex(
    (token, index) => index >= start && EN_VERBS.has(token),
  );
  if (firstVerb <= start) return false;
  const prefix = tokens.slice(start, firstVerb);
  return (
    [
      "the",
      "a",
      "an",
      "my",
      "our",
      "your",
      "his",
      "her",
      "its",
      "their",
      "this",
      "that",
      "these",
      "those",
    ].includes(prefix[0]) ||
    prefix.some((token) =>
      EN_NOUNS.some((noun) => englishForms(noun).includes(token)),
    ) ||
    names.some((name) => prefix.join(" ").includes(name))
  );
}
function dialogue(text) {
  // Apostrophes inside words (I'm) are not quotation marks.
  return (
    /[“「『][^”」』\n]+[”」』]/u.test(text) ||
    /"[^"\n]+"/u.test(text) ||
    /(?:^|\s)'[^'\n]+'(?:\s|[.,!?]|$)/u.test(text) ||
    /^[\p{L}\p{N} _-]{1,30}:\s*\S/mu.test(text)
  );
}
function ending(sentence, language) {
  if (standaloneSound(sentence, language)) return null;
  const raw = String(sentence).replace(/[“”‘’"'\s]+$/gu, "");
  if (/[?？]$/.test(raw)) return "?";
  if (/[!！]$/.test(raw)) return "!";
  const core = sentenceCore(raw);
  if (language === "en") return null; // Periods are not grammatical endings in English.
  for (const [regex, category] of [
    [/네요$/, "네요"],
    [/까요$/, "까요"],
    [/구나$/, "구나"],
    [/자$/, "자"],
    [/(?:어요|아요|해요|여요)$/, "어요"],
    [/요$/, "요"],
    [/다$/, "다"],
  ])
    if (regex.test(core)) return category;
  return null;
}
function emotionMatches(text, language) {
  return unique(
    [
      ...String(text || "").matchAll(
        language === "ko" ? new RegExp(KO_EMOTION) : new RegExp(EN_EMOTION),
      ),
    ].map((m) => m[0]),
  );
}
function levelId(input, pagination, language) {
  const key = language === "ko" ? "koreanLevel" : "englishLevel",
    snap = input.readingLevelSnapshot || pagination?.readingLevelSnapshot || {};
  return (
    input.specs?.[language]?.id ||
    snap.specs?.[language]?.id ||
    input[key] ||
    snap[key] ||
    (language === "ko" ? "K1" : "E0")
  );
}
function briefFor(sceneBriefs, beatIndex) {
  const list = Array.isArray(sceneBriefs)
    ? sceneBriefs
    : sceneBriefs?.briefs || sceneBriefs?.sceneBriefs || [];
  return (
    list.find((brief) => Number(brief?.beatIndex) === Number(beatIndex)) || {}
  );
}

/** Inspect text only. Inputs, frozen reading levels, prose and scene briefs are never mutated. */
export function checkRichness(
  pagination,
  input = {},
  outline = {},
  sceneBriefs = [],
) {
  const raw = Array.isArray(pagination) ? pagination : pagination?.pages || [],
    issues = [];
  const pages = raw
    .map((page, index) => ({
      pageNo: Number.isInteger(page?.pageNo) ? page.pageNo : index + 1,
      beatIndex: page?.beatIndex,
      valid: true,
      issues: [],
      metrics: {},
      source: page,
    }))
    .sort((a, b) => a.pageNo - b.pageNo);
  const add = (row, language, code, message, extra = {}) => {
    const issue = {
      type: "richness",
      kind: "page",
      pageNo: row.pageNo,
      language,
      code,
      message,
      heuristic: true,
      ...extra,
    };
    row.issues.push(issue);
    issues.push(issue);
  };
  const summary = {};
  for (const language of ["ko", "en"]) {
    const id = levelId(input, pagination, language),
      high = /^[KE][34]$/.test(id),
      minimumNouns = high ? 2 : 1,
      requiredDialoguePages = Math.ceil(pages.length * (high ? 0.5 : 1 / 3));
    const names = characterNames(input, language);
    let previousEnding = null,
      run = 0;
    for (const row of pages) {
      const text = textOf(row.source, language),
        brief = briefFor(sceneBriefs, row.beatIndex),
        parts = sentences(text);
      const nouns = concreteMatches(text, language, brief, row.source),
        sensory = sensoryMatches(text, language, brief),
        emotions = emotionMatches(text, language);
      const missing = parts.flatMap((sentence, index) =>
        hasSubject(sentence, language, names)
          ? []
          : [{ sentenceIndex: index, sentence }],
      );
      const metrics = {
        concreteNouns: nouns,
        concreteNounCount: nouns.length,
        sensoryWords: sensory,
        sensoryCount: sensory.length,
        dialogue: dialogue(text),
        directEmotionWords: emotions,
        missingSubjects: missing,
        sentenceCount: parts.length,
        exemptFragments: parts.filter((s) => standaloneSound(s, language))
          .length,
      };
      row.metrics[language] = metrics;
      if (!text.trim())
        add(
          row,
          language,
          "missing_text",
          "본문이 없어 풍부도를 검사할 수 없어요.",
        );
      if (nouns.length < minimumNouns)
        add(
          row,
          language,
          "concrete_nouns",
          `승인한 장면의 구체 명사를 ${minimumNouns}개 이상 사용해 주세요.`,
          { actual: nouns.length, expected: minimumNouns },
        );
      if (high && !sensory.length)
        add(
          row,
          language,
          "sensory",
          "이 쪽에 장면 브리프의 감각어 또는 의성어를 1개 이상 넣어 주세요.",
        );
      if (emotions.length)
        add(
          row,
          language,
          "direct_emotion",
          `감정 직설어(${emotions.join(", ")})를 승인한 몸짓·행동으로 바꿔 주세요.`,
          { words: emotions },
        );
      if (missing.length)
        add(
          row,
          language,
          "missing_subject",
          `${missing.map((m) => m.sentenceIndex + 1).join(", ")}번째 문장의 주어를 확인해 주세요. 이름·대명사·사물 주어를 명시해 주세요.`,
          { sentences: missing },
        );
      for (const sentence of parts) {
        const current = ending(sentence, language);
        if (current === null) continue;
        run = current === previousEnding ? run + 1 : 1;
        previousEnding = current;
        if (
          run >= 3 &&
          !row.issues.some(
            (issue) =>
              issue.language === language && issue.code === "repeated_ending",
          )
        )
          add(
            row,
            language,
            "repeated_ending",
            "같은 종결 방식이 세 문장 연속이에요. 수준에 맞는 질문·감탄·청유를 섞어 주세요.",
            { ending: current },
          );
      }
    }
    if (!high) {
      if (pages.length === 1 && !pages[0].metrics[language].sensoryCount)
        add(
          pages[0],
          language,
          "sensory_window",
          "장면 브리프의 감각어 또는 의성어를 1개 이상 넣어 주세요.",
        );
      for (let index = 1; index < pages.length; index++)
        if (
          !pages[index - 1].metrics[language].sensoryCount &&
          !pages[index].metrics[language].sensoryCount
        )
          add(
            pages[index],
            language,
            "sensory_window",
            `${pages[index - 1].pageNo}~${pages[index].pageNo}쪽 중 한 곳에 감각어 또는 의성어가 필요해요.`,
            { window: [pages[index - 1].pageNo, pages[index].pageNo] },
          );
    }
    const dialoguePages = pages
        .filter((row) => row.metrics[language].dialogue)
        .map((row) => row.pageNo),
      shortage = Math.max(0, requiredDialoguePages - dialoguePages.length);
    const candidates = pages
      .filter((row) => !row.metrics[language].dialogue)
      .sort(
        (a, b) =>
          Number(Boolean(briefFor(sceneBriefs, b.beatIndex).dialogueLine)) -
            Number(Boolean(briefFor(sceneBriefs, a.beatIndex).dialogueLine)) ||
          a.pageNo - b.pageNo,
      );
    for (const row of candidates.slice(0, shortage))
      add(
        row,
        language,
        "dialogue_pages",
        `대화가 있는 쪽이 ${dialoguePages.length}/${requiredDialoguePages}쪽이에요. 장면 브리프의 대사를 같은 사건 안에서 활용해 주세요.`,
        { actual: dialoguePages.length, expected: requiredDialoguePages },
      );
    summary[language] = {
      level: id,
      minimumConcreteNouns: minimumNouns,
      sensoryWindow: high ? 1 : 2,
      dialoguePages,
      requiredDialoguePages,
    };
  }
  for (const row of pages) {
    row.valid = row.issues.length === 0;
    row.passed = row.valid;
    row.violations = row.issues;
    delete row.source;
  }
  const failedPageNos = unique(issues.map((issue) => issue.pageNo)).sort(
      (a, b) => a - b,
    ),
    valid = pages.length > 0 && issues.length === 0;
  return {
    valid,
    passed: valid,
    heuristic: true,
    method: "dictionary-regex",
    pages,
    issues,
    violations: issues,
    failedPageNos,
    repairPageNos: failedPageNos,
    summary,
    notes: [...NOTES],
  };
}

/** Shared by paragraph enrichment and targeted page repairs. Level rules take priority. */
export function richnessPromptRules(language) {
  const common =
    "Enrich by replacing plain words, not by adding sentences or length. Keep the frozen levelSpec sentence/word bounds, allowed vocabulary and repetition frames unchanged. Preserve the approved events, speaker, character identity, location, props, and paragraph beat. Never invent a new action, object, structure or creature just to satisfy this checklist. Keep an explicit subject in every clause (character name, appropriate pronoun, or the actual object/weather subject). Convert direct emotion labels to visible actions already supported by the scene. Use at least one sensory detail from sceneBrief.sounds or smellOrTouch, one familiar sound word, and a concrete prop from sceneBrief. Mix endings; include one complete question, exclamation or invitation per paragraph when its grammar is allowed by levelSpec. A complete exclamation can preserve an E0/E1 repeating frame. Do not repeat the same grammatical ending three times. Let the final sentence connect to the next approved beat without inventing an event; the closing beat is exempt. Do not add unknown metaphors or increase the new-word budget.";
  const ko = `Korean: 감정 직설어(무섭다·기쁘다·슬프다·놀라다·행복하다·신나다·즐겁다·속상하다)를 몸짓으로 바꾸세요. 의성어 후보(사건과 수준에 맞는 것만): ${flatten(RICHNESS_VOCAB.onomatopoeia_ko).join(", ")}. 감각어 후보: ${flatten(RICHNESS_VOCAB.sensory_ko).join(", ")}.`;
  const en = `English: write independently in the selected level frames, not by translating Korean sentence structure. Show feelings through supported actions. Sound-word candidates (only if the event and level allow): ${RICHNESS_VOCAB.onomatopoeia_en.join(", ")}. Sensory candidates: ${RICHNESS_VOCAB.sensory_en.join(", ")}.`;
  return [
    common,
    ...(language === "ko" ? [ko] : language === "en" ? [en] : [ko, en]),
  ].join("\n");
}
export const richnessChecklist = richnessPromptRules;
export function richnessRepairRules(
  pageReport,
  { language, sceneBrief, nextBrief } = {},
) {
  const issues = (pageReport?.issues || pageReport?.violations || []).filter(
    (issue) => !language || issue.language === language,
  );
  return [
    richnessPromptRules(language),
    "Fix only the flagged text; preserve the other language, scene facts, page/beat number and staging.",
    ...issues.map((issue) => `- ${issue.code}: ${issue.message}`),
    sceneBrief ? `Approved scene brief: ${JSON.stringify(sceneBrief)}` : "",
    nextBrief ? `Next approved beat context: ${JSON.stringify(nextBrief)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
