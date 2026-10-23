/*
 * K1 그림책 (2026-10-21, R31a). A golden K1 manuscript written page-first in
 * one pass ("유하와 해니, 노란 버스") read better than what the staged
 * pipeline made of the same request: its pages were designed as pages (a
 * page that ends waiting is answered by the next), one small warm conflict,
 * sound words where they belong, the lesson only in the last action.
 *
 * New K1 drafts with Korean in the book (page layout) freeze
 * input.k1Policy {version: 1}. For them:
 *  - no writers' room, no STORY SPINE (planted thing, three failures, low
 *    point, "seeing again" turn), no sound-refrain-at-three-beats: the
 *    outline takes the K1 arc below instead (app outline path);
 *  - the prose stage writes the WHOLE book in one call, page by page
 *    (Korean, English, the picture, the feeling) on the beat writer's model
 *    (writeK1Book); the checks then ask once more for the failing pages
 *    only, and keep the closest with notes — the book never stops here;
 *  - the pagination stage takes those pages as they are (no model call).
 * K2 and up keep the beat-by-beat writer. Every other draft is unchanged.
 */
import { ledger } from "./quality-adapter.js";
import { buildBeatPagePlan } from "./pagination.js";
import { analyzeEstimatedPage } from "../reading-checker.js";
import { describeReadingViolation } from "../reading-messages.js";
import { parseJsonLenient } from "./outline-normalize.js";
import { wardrobeFor } from "./demo.js";
import { StoryValidationError } from "./schemas.js";
import { leanLevelLine, hasPromptDiet } from "./prompt-diet.js";
import { voiceBlock, VOICE_PALETTE } from "./voice-deck.js";
import { styleReport } from "./style-report.js";

export const K1_POLICY_VERSION = 1;
export const k1Policy = () => ({ version: K1_POLICY_VERSION });
export const hasK1Policy = (input) => input?.k1Policy?.version === K1_POLICY_VERSION;
/** Whether a new draft is a K1 book: K1 Korean, Korean in the book, page layout. */
export const isK1Draft = ({ koreanLevel, language, layout = "pages" } = {}) =>
  koreanLevel === "K1" && language !== "en" && layout !== "openings";
export const K1_FIX_ATTEMPTS = 1;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 600) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const TIMES = ["morning", "day", "afternoon", "evening", "night"];

/** The K1 arc (outline stage). It overrides the generic structure lines before it. */
export function k1OutlineRules(input) {
  if (!hasK1Policy(input)) return "";
  return `K1 STORY (ages 3-4) — these lines take precedence over every structure line above:
- One small, warm want and ONE small obstacle a three-year-old knows (being shy, waiting, a tiny mishap). No villain, no danger, no sadness, tears, scolding, fear, getting hurt, losing or competing.
- No mystery, no hidden clue, no planted-object reveal. The "attempt" beats are small playful steps (meeting, a game, trying together), not failures; the "turn" beat is the small change of heart or the moment play begins; "twist" names that small change in one plain sentence (for example: shy at first, then holds hands).
- It is solved together or with a little help and ends in joy; the lesson shows only in the last action, never in words.
- Every action is safe and everyday (seat belts on, no standing on seats, a grown-up nearby when needed).
- Each beat is one or two picture moments a child can point at; summaries use concrete, simple events.`;
}
/** The K1 sound line replacing the sound-refrain-at-three-beats rule. */
export const K1_SOUND_RULE =
  "K1 SOUNDS: use at least five different sound or movement words across the book (for example 부릉부릉, 까르륵, 콩닥콩닥), spread over different pages where they happen, never piled on one page. No fixed refrain is required.";

const BOOK_SCHEMA = (pageCount) => ({
  type: "object",
  additionalProperties: false,
  required: ["pages", "cover"],
  properties: {
    cover: { type: "string", maxLength: 500 },
    pages: {
      type: "array",
      minItems: pageCount,
      maxItems: pageCount,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pageNo", "ko", "en", "picture", "feeling", "who", "timeOfDay", "props"],
        properties: {
          pageNo: { type: "integer" },
          ko: { type: "string", maxLength: 600 },
          en: { type: "string", maxLength: 800 },
          picture: { type: "string", maxLength: 500 },
          feeling: { type: "string", maxLength: 40 },
          who: { type: "array", items: { type: "string" }, maxItems: 5 },
          timeOfDay: { type: "string", enum: TIMES },
          props: { type: "array", items: { type: "string" }, maxItems: 6 },
        },
      },
    },
  },
});
const FIX_SCHEMA = (count) => {
  const schema = BOOK_SCHEMA(count);
  delete schema.properties.cover;
  schema.required = ["pages"];
  schema.properties.pages.minItems = 1;
  return schema;
};

/**
 * What a good K1 book feels like, in the writer's own terms (R31b: the
 * golden manuscript's devices as a feel, not as counters — no "five sound
 * words", no "one repetition"; the checks measure what can be measured).
 */
const CRAFT = [
  "한 쪽은 그림 한 장이에요. 그 쪽의 그림(picture)을 먼저 떠올리고, 글은 그 그림이 말하지 못하는 것만 짧게 써요.",
  "쪽을 넘기고 싶게 써요 — 기다리거나 궁금한 채로 끝난 쪽은 다음 쪽이 받아 줘요.",
  "소리가 나는 자리에서는 그 소리를 그대로 써요(부릉부릉, 까르륵). 억지로 넣지는 않아요.",
  "마음은 행동으로 보여 줘요(고개를 숙여요, 손을 내밀어요). 교훈은 말하지 않고 마지막 행동이 말하게 해요.",
  "아이가 따라 말하고 싶은 되풀이와 짧은 대사가 생기면 살려요. 누가 말했는지는 보이게.",
  "무서움·눈물·혼남·경쟁·다침은 없어요. 모두 안전하게.",
  "영어(en)는 같은 이야기를 그 단계의 영어로 새로 써요(번역이 아니에요). 이름은 영어 이름.",
];

function pageChecks(page, input, allowedNames) {
  const problems = [];
  for (const lang of ["ko", "en"]) {
    const spec = input.specs?.[lang];
    if (!spec) continue;
    let report;
    try {
      report = analyzeEstimatedPage(page[lang], spec, { language: lang, allowedNames });
    } catch {
      continue;
    }
    for (const violation of report.violations)
      if (/^sentence/u.test(violation.code)) problems.push(describeReadingViolation(violation));
  }
  if (!str(page.ko)) problems.push("한글 글이 비어 있어요.");
  if (!str(page.en)) problems.push("영어 글이 비어 있어요.");
  return problems;
}
function normalizePage(raw, plan, input) {
  const cast = new Set(list(input.characters).map((c) => c.id));
  return {
    pageNo: plan.pageNo,
    beatIndex: plan.beatIndex,
    ko: str(raw?.ko),
    en: str(raw?.en, 800),
    picture: str(raw?.picture, 500),
    feeling: /^[A-Za-z]+(?:-[A-Za-z]+)?$/u.test(str(raw?.feeling, 40)) ? str(raw.feeling, 40).toLowerCase() : "happy",
    who: list(raw?.who).filter((id) => cast.has(id)).slice(0, 5),
    timeOfDay: TIMES.includes(raw?.timeOfDay) ? raw.timeOfDay : "day",
    props: list(raw?.props).map((p) => str(p, 80)).filter(Boolean).slice(0, 6),
  };
}

/**
 * Write the whole K1 book in one call. Returns the prose stage's result: the
 * prose (a paragraph per beat) with `pages` attached for the pagination stage.
 */
export async function writeK1Book(outline, input, options = {}, services = {}) {
  const journal = ledger("k1Book", input, options, { outline, sceneBriefs: options.sceneBriefs || [] }, "writerCheckpoint"),
    beats = list(outline.beats),
    plan = buildBeatPagePlan(outline, input.pageCount),
    briefs = list(options.sceneBriefs?.briefs || options.sceneBriefs),
    allowedNames = list(input.characters).flatMap((c) => [c.name, c.nameEn].filter(Boolean)),
    cast = list(input.characters)
      .map((c) => `${c.id} = ${c.name}${c.nameEn ? ` / ${c.nameEn}` : ""}${c.description ? ` (${str(c.description, 120)})` : ""}`)
      .join("\n"),
    places = Object.fromEntries(list(input.backgrounds).map((b) => [b.id, b.name || b.id]));
  const map = beats
    .map((beat) => {
      const brief = briefs.find((row) => Number(row?.beatIndex) === Number(beat.index));
      return `${beat.index} ${beat.type} @${places[beat.settingKey] || beat.settingKey || "?"}: ${str(beat.summary, 300)}${brief ? ` / 장면: ${str(brief.action || brief.actionEn, 160)}` : ""}`;
    })
    .join("\n");
  const pagesLine = plan.map((row) => `${row.pageNo}쪽 → 비트 ${row.beatIndex}`).join(", ");
  // R31b: the level lines are sentences (leanLevelLine), never the spec JSON.
  // R34: a diet draft's own voice cards and the prose palette (a spark, never counted).
  const voiced = hasPromptDiet(input) && voiceBlock(input, "ko"),
    system = `너는 만 3~4세 아이에게 읽어 주는 그림책 작가예요. 이 책 ${input.pageCount}쪽을 한 번에, 쪽부터 설계해서 써요. 다정한 이야기꾼 말투('~요'). JSON으로만 답해요.\n${CRAFT.join("\n")}\n${leanLevelLine(input, "ko")}\n${leanLevelLine(input, "en")}${voiced ? `\n${VOICE_PALETTE}\n${voiced}\n${voiceBlock(input, "en")}` : ""}`;
  const user = [
    `[부모 요청] ${str(input.topic, 300)}`,
    `[줄거리 지도]\n${map}`,
    `[바람·걸림돌·작은 변화] ${str(outline.want, 200)} / ${str(outline.problem, 200)} / ${str(outline.twist, 200)}`,
    `[등장인물 — who에는 이 ID만]\n${cast}`,
    `[쪽 배치 — 그대로] ${pagesLine}`,
    `[출력] JSON만. {"cover":"표지 그림을 영어로","pages":[{"pageNo":1,"ko":"한글","en":"English","picture":"그 쪽 그림을 영어로","feeling":"one English word","who":["id"],"timeOfDay":"morning","props":["English prop"]}, …]}`,
  ].join("\n\n");
  const read = (response) => {
    const data = response?.json !== undefined ? response.json : parseJsonLenient(String(response?.text || ""));
    return object(data) ? data : {};
  };
  try {
    const first = read(
      await journal.call("beatWriter", { system, user, jsonSchema: BOOK_SCHEMA(input.pageCount), temperature: 0.8, maxTokens: 8000 }, services),
    );
    const rawPages = list(first.pages);
    if (rawPages.length !== input.pageCount) {
      throw new StoryValidationError("prose", [`K1 그림책 원고가 ${input.pageCount}쪽이 아니에요(받은 쪽 ${rawPages.length}개). 다시 시도해 주세요.`]);
    }
    let pages = plan.map((row, i) => normalizePage(rawPages.find((p) => Number(p?.pageNo) === row.pageNo) || rawPages[i], row, input));
    const failing = () => pages.map((page) => ({ page, problems: pageChecks(page, input, allowedNames) })).filter((row) => row.problems.length);
    let notes = failing();
    // One more call for the failing pages only (their neighbours as context).
    for (let attempt = 0; attempt < K1_FIX_ATTEMPTS && notes.length; attempt++) {
      const fixUser = [
        `[지금 원고 — 고칠 쪽만 같은 형식으로 다시]\n${pages.map((p) => `${p.pageNo}쪽: ${p.ko} | ${p.en}`).join("\n")}`,
        `[고칠 쪽]\n${notes.map((row) => `${row.page.pageNo}쪽: ${row.problems.join(" / ")}`).join("\n")}`,
        `[출력] JSON만. {"pages":[{"pageNo":…,"ko":"…","en":"…","picture":"…","feeling":"…","who":[…],"timeOfDay":"…","props":[…]}]} — 고칠 쪽만, 사건과 그림은 그대로.`,
      ].join("\n\n");
      const fixed = list(
        read(await journal.call("beatWriter", { system, user: `${user}\n\n${fixUser}`, jsonSchema: FIX_SCHEMA(input.pageCount), temperature: 0.5, maxTokens: 4000 }, services)).pages,
      );
      pages = pages.map((page) => {
        const raw = fixed.find((row) => Number(row?.pageNo) === page.pageNo);
        if (!raw) return page;
        const next = normalizePage({ ...page, ...raw, who: list(raw.who).length ? raw.who : page.who }, page, input);
        return pageChecks(next, input, allowedNames).length <= pageChecks(page, input, allowedNames).length ? next : page;
      });
      notes = failing();
    }
    const warnings = notes.map((row) => `${row.page.pageNo}쪽: ${row.problems.join(" / ")}`);
    const prose = { ko: "", en: "", usedRefrainAt: [], paragraphBeats: { ko: [], en: [] } };
    for (const lang of ["ko", "en"]) {
      const rows = beats.map((beat) => ({ beat: beat.index, text: pages.filter((p) => p.beatIndex === beat.index).map((p) => p[lang]).join(" ") }));
      prose[lang] = rows.map((row) => row.text || "…").join("\n\n");
      prose.paragraphBeats[lang] = rows.map((row) => row.beat);
    }
    prose.pages = pages;
    prose.cover = str(first.cover, 500);
    await journal.save();
    return {
      data: prose,
      usage: journal.usage(),
      meta: {
        ...journal.summary(),
        stage: "prose",
        k1Book: { pages: pages.length, fixed: journal.paid.length > 1, warnings },
        // R34: the free style numbers of the Korean pages (advisory).
        ...(hasPromptDiet(input) ? { style: styleReport(pages.map((p) => p.ko), { names: list(input.characters).map((c) => c?.name) }) } : {}),
        ...(warnings.length ? { softIssues: warnings } : {}),
      },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw journal.fail(error);
  }
}

/**
 * The pagination of a K1 book: its own pages, as written (no model call) —
 * only while the prose still is exactly those pages (a parent's prose edit
 * falls back to the usual pagination request).
 */
export function k1Pagination(prose, outline, input) {
  const pages = list(prose?.pages);
  if (pages.length !== Number(input.pageCount)) return null;
  for (const lang of ["ko", "en"]) {
    const expected = list(outline.beats)
      .map((beat) => pages.filter((p) => p.beatIndex === beat.index).map((p) => p[lang]).join(" ") || "…")
      .join("\n\n");
    if (String(prose[lang] || "").trim() !== expected.trim()) return null;
  }
  const settingOf = (beatIndex) => outline.beats.find((b) => b.index === beatIndex)?.settingKey || list(input.backgrounds)[0]?.id || "home",
    everyone = list(input.characters).map((c) => c.id).slice(0, 5);
  return {
    cover: {
      title: outline.titleCandidates?.[0] || input.title || "그림책",
      sceneAction: prose.cover || `${list(input.characters).map((c) => c.nameEn || c.name).join(" and ")} smile together in a warm, sunny picture-book scene.`,
    },
    pages: pages.map((page) => ({
      pageNo: page.pageNo,
      beatIndex: page.beatIndex,
      textKo: page.ko,
      textEn: page.en,
      scene: {
        who: page.who.length ? page.who : everyone,
        where: settingOf(page.beatIndex),
        action: page.picture || page.en,
        emotion: page.feeling,
        timeOfDay: page.timeOfDay,
        props: page.props,
      },
      variantByCharacter: wardrobeFor(input, page.pageNo),
      isRefrainPage: false,
    })),
  };
}
