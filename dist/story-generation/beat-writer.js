/*
 * 정성 모드 비트별 작가 (2026-10-21, R30 — ORCHESTRATION_REVIEW 3-3·7·9절,
 * 착수 체크리스트 5항목). Only drafts with input.orchestrationPolicy write
 * their prose here; every other draft keeps the whole-book prose stages.
 *
 * One call per beat per language, beat after beat (the two languages of one
 * beat in parallel), at the frozen target level (no rich-then-simplify pass).
 * Every call sees the map: all beats with their goal, conflict, tension and
 * result state, and the ending state (review item 1); the beat's own scene
 * brief; the text written so far in that language (or, past ~4,000 tokens,
 * the earlier beats as outline lines plus the last two beats in full); the
 * book's style anchor (beat 1 as chosen); the fixed refrain string when this
 * beat carries it. Model: the medium model unless the parent chose the upper
 * one (orchestrationPolicy.writerTier).
 *
 * Per-beat deterministic checks: sentence count against the beat's own
 * budget (pages × level range, scaled by its tension), sentence length and
 * the fixed refrain. Dialogue share is checked over the whole book per
 * language and only reported (never a per-beat retry). Sensory detail is left
 * to the editor rubric (r31). A failing beat is asked again with the failed
 * text, the reasons and an explicit delta, at most twice (three attempts);
 * after the third it keeps the attempt closest to its budget with a warning —
 * the book never fails here (checklist 4).
 *
 * The voice card (checklist 3): before beat 1 the refrain is fixed as one
 * exact line per language (the outline's line, plus one economy call for the
 * other language) with its count; the writer gets it verbatim on the planned
 * beats and the check looks for it there.
 *
 * Beat 1 is the style anchor (checklist 5): two drafts in parallel. When only
 * one passes the checks it is the anchor; when both pass one economy-model
 * sniff picks the better voice; when both fail the closer one goes on to the
 * retries.
 *
 * Every response is journalled (writerCheckpoint), so a resumed run never
 * buys a beat twice.
 */
import { ledger } from "./quality-adapter.js";
import { styleReport } from "./style-report.js";
import { buildBeatPagePlan } from "./pagination.js";
import { isOpeningsInput } from "./opening-prose.js";
import { analyzeEstimatedPage, splitSentences, mergeDialogueTags, leanEnglishLevel } from "../reading-checker.js";
import { parseJsonLenient } from "./outline-normalize.js";
import { tensionRange } from "./orchestration.js";
import { hasPromptDiet, writerBriefView } from "./prompt-diet.js";
import { pictureLedBudgetLine } from "../book-format.js";
import { planOf, picturePlanWriterLine } from "./picture-plan.js";
import { storyChangeWriterLine } from "./story-change.js";
import { storyDramaWriterLine } from "./story-drama.js";

export const BEAT_WRITER_ATTEMPTS = 3; // two retries
export const SUMMARY_SWITCH_TOKENS = 4000;
/** Calls the writing stage may spend per language: base × attempts + the beat-1 second draft and sniff. */
export const WRITER_BUDGET_PER_LANGUAGE = (beats) => beats * BEAT_WRITER_ATTEMPTS + 2;

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 400) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const TEXT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string", maxLength: 4000 } },
});
const PICK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["pick", "reason"],
  properties: { pick: { type: "integer", minimum: 1, maximum: 2 }, reason: { type: "string", maxLength: 200 } },
});
// Every book carries both languages (validateProse); each is written on its own.
const LANGUAGES = Object.freeze(["ko", "en"]);
const tokensOf = (text) => Math.ceil(String(text || "").length / 2);

/** Each beat's sentence budget per language (variable: pages and tension). */
export function beatBudgets(outline, input) {
  const beats = list(outline?.beats),
    openings = isOpeningsInput(input),
    plan = openings ? null : buildBeatPagePlan(outline, input.pageCount),
    range = tensionRange(input),
    tension = list(outline?.tension);
  return beats.map((beat, i) => {
    const pages = openings ? 1 : Math.max(1, plan.filter((page) => page.beatIndex === beat.index).length),
      t = Number.isFinite(Number(tension[i])) ? Number(tension[i]) : Math.round((range.min + range.max) / 2),
      scale = 0.8 + (0.4 * (t - range.min)) / Math.max(1, range.max - range.min),
      out = { beatIndex: beat.index, pages };
    for (const lang of ["ko", "en"]) {
      const spec = input.specs?.[lang] || {},
        unit = openings ? spec.units?.opening : null,
        per = spec.sentencesPerPageRange || { min: spec.sentencesPerPage || 2, max: spec.sentencesPerPage || 2 },
        lo = unit ? unit.min : pages * per.min,
        hi = unit ? unit.max : pages * per.max,
        // Openings keep the frozen unit range; pages get ±20% (the book-level rhythm band).
        min = unit ? lo : Math.max(1, Math.floor(lo * 0.8)),
        max = unit ? hi : Math.max(min + 1, Math.ceil(hi * 1.2)),
        // R35 그림책 결: a calm beat is a line or two, the big moment up to the top of the range.
        target =
          spec.pictureLed?.version === 1 && unit
            ? Math.min(max, Math.max(min, lo + Math.round((hi - lo) * ((t - range.min) / Math.max(1, range.max - range.min)) * 0.8)))
            : Math.min(max, Math.max(min, Math.round(((lo + hi) / 2) * scale)));
      out[lang] = { min, max, target };
    }
    return out;
  });
}
const maxWords = (spec) => {
  const range = spec?.eojeolPerSentence || (spec?.wordsPerSentence ? [spec.wordsPerSentence.min, spec.wordsPerSentence.max] : null);
  return Array.isArray(range) ? range[1] : 8;
};
// The refrain match ignores case, spacing and punctuation (quotes, commas, '!').
const matchable = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const hasRefrain = (text, refrain) => !!matchable(refrain) && ` ${matchable(text)} `.includes(` ${matchable(refrain)} `);
/*
 * R31e: on the diet an E2+ English beat is judged the way its page will be
 * (checkStory's lean unit rule): the count inside a band (−1/+2 around the
 * beat's range), the mean length not over the level's maximum, at most a
 * third of the sentences long and none far over, a speech tag counted with its
 * quote. The retry names the long sentences with their word counts, so the
 * writer knows what to split. The paid K2 book had five of six beats retried
 * nine times under the strict rule and still rewritten at pagination.
 */
function leanEnglishProblems(clean, metrics, budget, spec) {
  const out = [],
    n = metrics.sentenceCount,
    band = { min: Math.max(1, budget.min - 1), max: budget.max + 2 },
    wps = object(spec.wordsPerSentence) ? spec.wordsPerSentence : { min: 4, max: maxWords(spec) };
  if (n < band.min) out.push(`문장이 ${n}개로 적어요(이 비트는 ${budget.min}~${budget.max}문장, ${band.min}개부터 괜찮아요).`);
  if (n > band.max) out.push(`문장이 ${n}개로 많아요(이 비트는 ${budget.min}~${budget.max}문장, ${band.max}개까지 괜찮아요).`);
  const exempt = new Set(list(metrics.minimumLengthExemptSentenceIndices)),
    texts = mergeDialogueTags(splitSentences(clean)),
    rows = list(metrics.lengthsWithoutSoundRuns || metrics.wordsPerSentence)
      .map((count, index) => ({ count, index, text: str(texts[index], 70) }))
      .filter((row) => !exempt.has(row.index)),
    mean = rows.length ? rows.reduce((sum, row) => sum + row.count, 0) / rows.length : 0,
    long = rows.filter((row) => row.count > wps.max),
    allowedLong = Math.ceil(rows.length / 3 - 1e-9),
    hardLimit = wps.max + 3,
    quote = (list) => list.map((row) => `"${row.text}"(${row.count}단어)`).join(", "),
    // R35 그림책 결: the mean from a few sentences on, the length by its hard cap only (the page check reads the same).
    picture = spec.pictureLed?.version === 1,
    cap = wps.max + Number(spec.pictureLed?.longOver ?? 5);
  if (picture) {
    if (rows.length >= Number(spec.pictureLed.meanFromSentences ?? 3) && mean > wps.max + 0.5)
      out.push(`문장이 평균 ${Math.round(mean * 10) / 10}단어로 길어요(한 문장 ${wps.min}~${wps.max}단어). 긴 문장: ${quote(long)}`);
    else if (long.some((row) => row.count > cap))
      out.push(`너무 긴 문장이 있어요(한 문장 ${cap}단어까지). 긴 문장: ${quote(long.filter((row) => row.count > cap))}`);
    return out;
  }
  if (rows.length && mean > wps.max + 0.5)
    out.push(`문장이 평균 ${Math.round(mean * 10) / 10}단어로 길어요(한 문장 ${wps.min}~${wps.max}단어). 긴 문장: ${quote(long)}`);
  else if (long.length > allowedLong || long.some((row) => row.count > hardLimit))
    out.push(`긴 문장이 ${long.length}개예요(한 문장 ${wps.max}단어 안팎, ${hardLimit}단어를 넘는 문장은 안 돼요). 긴 문장: ${quote(long)}`);
  return out;
}
/**
 * R31f: the sentence-count band a beat is judged by. On the diet a Korean
 * openings beat takes its page's unit tolerance (count −1/+2) and an E2+
 * English beat the same band (checkStory judges the page that way, so what
 * passes here passes there); otherwise the beat's own range, as before.
 */
export function beatBand(lang, spec, budget, lean = false) {
  if (lean && lang === "en" && leanEnglishLevel(spec)) return { min: Math.max(1, budget.min - 1), max: budget.max + 2, lean: "en" };
  if (lean && lang === "ko" && object(spec?.unitTolerance)) {
    const below = Number(spec.unitTolerance.countBelow), above = Number(spec.unitTolerance.countAbove);
    return { min: Math.max(1, budget.min - (Number.isFinite(below) ? below : 1)), max: budget.max + (Number.isFinite(above) ? above : 2), lean: "ko" };
  }
  return { min: budget.min, max: budget.max, lean: "" };
}
/** The per-beat deterministic checks (count, length, the fixed refrain). */
export function checkBeatText(text, lang, budget, spec, { refrain = "", needsRefrain = false, lean = false } = {}) {
  const problems = [],
    clean = String(text || "").trim();
  if (!clean) return { problems: ["글이 비어 있어요."], sentences: 0, distance: Infinity };
  // R31e: the lean English rule (E2 and up on the diet); everything else as before.
  const leanEn = lean && lang === "en" && leanEnglishLevel(spec),
    band = beatBand(lang, spec, budget, lean);
  let metrics = null;
  try {
    metrics = analyzeEstimatedPage(clean, leanEn ? { ...spec, dialogueTags: true } : spec, { language: lang }).metrics;
  } catch {
    metrics = null;
  }
  // R35 그림책 결: a picture-led Korean beat is counted the way its page will be (pauses split, sound runs once).
  const picture = spec?.pictureLed?.version === 1,
    sentences = (leanEn || picture) && metrics ? metrics.sentenceCount : splitSentences(clean).length;
  if (leanEn && metrics) problems.push(...leanEnglishProblems(clean, metrics, budget, spec));
  else {
    // R31f: a lean Korean beat is told its band, not a target to hit exactly.
    if (sentences < band.min) problems.push(band.lean ? `문장이 ${sentences}개로 적어요(이 비트는 ${budget.min}~${budget.max}문장, ${band.min}개부터 괜찮아요).` : `문장이 ${sentences}개로 적어요(목표 ${budget.target}, 범위 ${budget.min}~${budget.max}).`);
    if (sentences > band.max) problems.push(band.lean ? `문장이 ${sentences}개로 많아요(이 비트는 ${budget.min}~${budget.max}문장, ${band.max}개까지 괜찮아요).` : `문장이 ${sentences}개로 많아요(목표 ${budget.target}, 범위 ${budget.min}~${budget.max}).`);
    const limit = maxWords(spec) + 1,
      long = list(metrics?.wordsPerSentence).filter((n) => n > limit).length;
    if (picture) {
      // R35 그림책 결: only a sentence past the hard cap is a problem; the share of long sentences is a book note.
      const cap = maxWords(spec) + Number(spec.pictureLed.longOver ?? 5),
        over = list(metrics?.lengthsWithoutSoundRuns || metrics?.wordsPerSentence).filter((n) => n > cap).length;
      if (over) problems.push(`너무 긴 문장이 ${over}개예요(한 문장 ${cap}${lang === "ko" ? "어절" : "단어"}까지).`);
    } else if (long > Math.max(1, Math.floor(sentences / 3)))
      problems.push(`긴 문장이 ${long}개예요(한 문장 ${limit - 1}${lang === "ko" ? "어절" : "단어"} 안팎).`);
  }
  if (needsRefrain && refrain && !hasRefrain(clean, refrain))
    problems.push(`되풀이 말 "${refrain}"이 이 비트에 그대로 있어야 해요.`);
  return { problems, sentences, distance: Math.abs(sentences - budget.target) + (problems.length ? 0.5 : 0), words: list(metrics?.wordsPerSentence) };
}
/** Book-level dialogue share per language (reported, never a per-beat retry). */
export function dialogueShare(texts) {
  const sentences = texts.flatMap((text) => splitSentences(String(text || "")));
  const quoted = sentences.filter((sentence) => /["“”「」'‘’]/u.test(sentence)).length;
  return sentences.length ? quoted / sentences.length : 0;
}
const DIALOGUE_MIN = (input) => (/^K[34]/u.test(String(input.specs?.ko?.id || "")) ? 0.3 : 0.25);

// R31d: on the diet the map carries events and results in words; the ledger's
// state JSON made the writer narrate states (a seat belt five times).
function mapLines(outline, briefs, lean = false) {
  const contract = list(outline.plotContract?.beats),
    tension = list(outline.tension);
  return list(outline.beats)
    .map((beat, i) => {
      const row = contract.find((c) => Number(c.beatIndex) === Number(beat.index)) || {},
        e = object(row.event) ? row.event : {},
        // R31d: a lean ledger keeps its result on the row itself.
        result = lean ? (e.result ?? row.result) : e.result;
      return `${beat.index} ${beat.type}${tension[i] !== undefined ? ` (긴장 ${tension[i]})` : ""}: ${str(beat.summary, 300)}${result ? ` → 결과: ${str(result, 160)}` : ""}${!lean && row.stateAfter ? ` / 상태: ${str(JSON.stringify(row.stateAfter), 200)}` : ""}`;
    })
    .join("\n");
}
function priorText(written, outline, index) {
  const done = written.slice(0, index);
  const full = done.map((row) => `[${row.beatIndex}] ${row.text}`).join("\n\n");
  if (tokensOf(full) <= SUMMARY_SWITCH_TOKENS) return { text: full, summarized: false };
  // Past the threshold: earlier beats as their outline lines, the last two in full.
  const lines = done.slice(0, -2).map((row) => `[${row.beatIndex}] (요약) ${str(list(outline.beats).find((b) => b.index === row.beatIndex)?.summary, 300)}`);
  return { text: [...lines, ...done.slice(-2).map((row) => `[${row.beatIndex}] ${row.text}`)].join("\n\n"), summarized: true };
}

/**
 * Write the whole prose beat by beat. Returns the prose stage's usual result
 * ({data: {ko, en, usedRefrainAt, paragraphBeats}, usage, meta}).
 */
export async function writeProseByBeat(outline, input, options = {}, services = {}) {
  const journal = ledger("beatWriter", input, options, { outline, sceneBriefs: options.sceneBriefs || [] }, "writerCheckpoint"),
    beats = list(outline.beats),
    budgets = beatBudgets(outline, input),
    languages = LANGUAGES,
    briefs = list(options.sceneBriefs?.briefs || options.sceneBriefs),
    refrainText = str(outline.refrain?.text, 150),
    refrainBeats = new Set(list(outline.refrain?.usedAtBeats).map(Number)),
    bible = object(outline.bible) ? outline.bible : null,
    lean = hasPromptDiet(input),
    map = mapLines(outline, briefs, lean),
    last = beats.at(-1),
    lastRow = list(outline.plotContract?.beats).find((c) => Number(c.beatIndex) === Number(last?.index)) || {},
    ending = `${str(last?.summary, 300)}${!lean && lastRow.stateAfter ? ` / 끝 상태: ${str(JSON.stringify(lastRow.stateAfter), 300)}` : ""}`,
    styleSamples = list(input.storyQuality?.styleSamples)
      .map((row) => str(typeof row === "string" ? row : row?.text || row?.ko, 600))
      .filter(Boolean)
      .slice(0, 2),
    rules = object(options.writerRules) ? options.writerRules : {},
    cast = list(input.characters)
      .map((c) => [c?.name, c?.nameEn].filter(Boolean).join(" / "))
      .filter(Boolean)
      .join(", "),
    budgetLimit = WRITER_BUDGET_PER_LANGUAGE(beats.length) * languages.length + 1; // + the voice card
  // R31e: on the diet every attempt is logged (sentences, words per sentence, problems), so a paid run shows why it retried.
  const report = { attempts: {}, warnings: [], anchor: {}, summarized: false, calls: 0, budget: budgetLimit, ...(lean ? { attemptLog: {} } : {}) };
  const spent = () => journal.paid.length;
  const write = async (lang, beat, i, { written, anchor, retry = null, draft = 0 }) => {
    const spec = input.specs?.[lang] || {},
      budget = budgets[i][lang],
      brief = briefs.find((row) => Number(row?.beatIndex) === Number(beat.index)),
      prior = priorText(written, outline, i),
      refrain = voice[lang],
      needsRefrain = refrainBeats.has(Number(beat.index)) && !!refrain;
    if (prior.summarized) report.summarized = true;
    const ko = lang === "ko";
    const system = `${
      ko
        ? `너는 ${spec.id || "어린이"} 단계 한국어 그림책 작가다. 다정한 이야기꾼의 말투로, 보이는 것·들리는 것·손으로 하는 일을 짧은 문장으로 쓴다. 이번에는 한 비트의 글만 쓴다. 비트 번호·제목·설명은 쓰지 않는다. JSON으로만 답한다.`
        : `You are a picture-book author writing original English at ${spec.id || "the frozen level"}. Write only this one beat's story text in short, concrete sentences a young child can follow; never a translation of Korean. No beat numbers, labels or notes. Reply in JSON only.`
    }${rules.common ? `\n${rules.common}` : ""}${rules[lang] ? `\n${rules[lang]}` : ""}`;
    const user = [
      `[전체 지도 — 모든 비트(목표·결과·긴장)]\n${map}`,
      `[결말 상태] ${ending}`,
      bible?.growth ? `[성장 설계] want ${bible.growth.want} → need ${bible.growth.need} (걸림돌 ${bible.growth.flaw}); 교훈은 말하지 않고 행동으로: ${bible.lesson || ""}` : "",
      `[이번 비트] ${beat.index} ${beat.type}: ${str(beat.summary, 500)}${list(outline.tension)[i] !== undefined ? ` · 목표 긴장 ${outline.tension[i]}` : ""}`,
      // R36: who tells this beat (a picture-led diet draft's plan) — permission to leave the picture's part unsaid.
      lean ? picturePlanWriterLine(planOf(outline, beat.index), lang) : "",
      // R38: the expectation, the turn and what the ending shows (outlines with a change line only).
      lean ? storyChangeWriterLine(outline, beat, lang) : "",
      // R39: the try's kind and consequence, the secret, the companion's want, the flipped refrain (drama outlines only).
      lean ? storyDramaWriterLine(outline, beat, lang) : "",
      // R31e: on the diet the writer gets the brief's story-carrying fields; light, weather and creatures are the picture's.
      brief
        ? lean
          ? `[장면 디테일 — 글에 쓸 것: 소리·소품·동작·대사·웃음 포인트. 빛·날씨·작은 생물은 그림이 보여 줘요] ${str(JSON.stringify(writerBriefView(brief)), 900)}`
          : `[장면 디테일(그림과 같아야 함)] ${str(JSON.stringify(brief), 900)}`
        : "",
      // R31e: the English of a diet draft gets its range (no tension-scaled target) — the target pushed two-sentence beats into 16-word sentences.
      lean && !ko
        ? `[분량] 이 비트의 영어는 ${budget.min}~${budget.max}문장, 한 문장 ${object(spec.wordsPerSentence) ? spec.wordsPerSentence.min : 4}~${maxWords(spec)} words.${cast ? ` 등장인물은 고른 인물만: ${cast}.` : ""}`
        : lean && spec.pictureLed?.version === 1
          // R35 그림책 결: a few sentences, the picture carries the rest — the check reads the band and a hard cap.
          ? `${pictureLedBudgetLine(budget, spec)}${cast ? ` 등장인물은 고른 인물만: ${cast}.` : ""}`
        : lean && input.storyVoice
          // R34: a voiced book is asked for contrast, not even sentences — the check reads the same band.
          ? `[분량] 이 비트는 ${budget.min}~${budget.max}문장. 짧은 문장과 긴 문장을 섞어요(한 단어 문장도 좋아요); 평균이 ${Array.isArray(spec.eojeolPerSentence) ? `${spec.eojeolPerSentence[0]}~${spec.eojeolPerSentence[1]}` : maxWords(spec)}어절 안이면 되고, ${maxWords(spec) + 1}어절을 넘는 문장은 셋에 하나까지.${cast ? ` 등장인물은 고른 인물만: ${cast}.` : ""}`
          : `[분량] 이 비트는 ${budget.target}문장 안팎(범위 ${budget.min}~${budget.max}). 한 문장 ${maxWords(spec)}${ko ? "어절" : " words"} 안팎.${cast ? ` 등장인물은 고른 인물만: ${cast}.` : ""}`,
      needsRefrain ? (ko ? `[되풀이 말 — 글자 그대로 한 번] ${refrain}` : `[Refrain — use this exact line once] ${refrain}`) : "",
      prior.text ? `[앞 비트까지 쓴 글${prior.summarized ? "(앞부분은 줄거리 요약)" : ""}]\n${prior.text}` : "[앞 비트] 없음 — 이 비트가 책의 첫 장면이에요.",
      anchor ? `[문체 기준 — 이 책의 첫 비트. 같은 목소리·리듬으로]\n${anchor}` : "",
      styleSamples.length ? `[부모가 고른 문체 예시]\n${styleSamples.join("\n")}` : "",
      retry ? `[이전 시도의 문제 — 고쳐서 다시]\n${retry.problems.join("\n")}\n${retry.delta}\n[이전 시도]\n${retry.text}` : "",
      draft ? `[초안 ${draft}]` : "",
      `[출력] JSON만. {"text":"이 비트의 글"}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const response = await journal.call("beatWriter", { system, user, jsonSchema: TEXT_SCHEMA, temperature: draft === 2 ? 0.9 : 0.7, maxTokens: 1400 }, services);
    const data = response?.json !== undefined ? response.json : parseJsonLenient(String(response?.text || ""));
    // One paragraph per beat: any line breaks the model adds are folded away.
    const text = str(object(data) ? data.text : response?.text, 4000);
    const check = checkBeatText(text, lang, budget, spec, { refrain, needsRefrain, lean });
    if (report.attemptLog)
      (report.attemptLog[`${lang}:${beat.index}`] ||= []).push({
        ...(draft ? { draft } : {}),
        ...(retry ? { retry: true } : {}),
        sentences: check.sentences,
        words: check.words,
        problems: check.problems,
      });
    return { text, check };
  };
  // R31e: a lean English retry is told to split (up to the band), never to keep the count.
  // R31f: the thresholds are the beat's band (beatBand), for Korean too.
  const deltaOf = (check, budget, band) =>
    check.sentences > band.max
      ? `[고칠 양] 지금 ${check.sentences}문장 → ${budget.target}문장으로 ${check.sentences - budget.target}문장 줄여 주세요(목표 대비 −${Math.round(((check.sentences - budget.target) / Math.max(1, check.sentences)) * 100)}%).`
      : check.sentences < band.min
        ? `[고칠 양] 지금 ${check.sentences}문장 → ${budget.target}문장으로 ${budget.target - check.sentences}문장 늘려 주세요.`
        : band.lean === "en"
          ? `[고칠 양] 긴 문장은 짧은 문장 여러 개로 나누세요(이 비트는 ${budget.max}문장까지 괜찮아요). 영어는 한글보다 덜 말해도 돼요 — 그림이 보여 주는 순간만 쓰세요.`
          : "[고칠 양] 문장 수는 그대로 두고 위 문제만 고쳐 주세요.";
  // One beat: up to three attempts; after that the attempt closest to its budget, with a warning.
  const settle = async (lang, beat, i, ctx, first) => {
    const budget = budgets[i][lang];
    let best = first,
      current = first,
      attempts = 1;
    while (current.check.problems.length && attempts < BEAT_WRITER_ATTEMPTS && spent() < budgetLimit) {
      current = await write(lang, beat, i, { ...ctx, retry: { problems: current.check.problems, delta: deltaOf(current.check, budget, beatBand(lang, input.specs?.[lang] || {}, budget, lean)), text: current.text } });
      attempts++;
      if (current.check.distance < best.check.distance) best = current;
    }
    if (current.check.problems.length === 0) best = current;
    report.attempts[`${lang}:${beat.index}`] = attempts;
    if (best.check.problems.length)
      report.warnings.push(`${lang === "ko" ? "한글" : "영어"} ${beat.index}비트: ${best.check.problems.join(" / ")}${attempts >= BEAT_WRITER_ATTEMPTS ? " (세 번 써서 가장 가까운 글을 썼어요)" : " (호출 예산이 다해 가장 가까운 글을 썼어요)"}`);
    return best;
  };
  const voice = { ko: "", en: "" };
  try {
    // The voice card (checklist 3): the refrain fixed as one exact line per
    // language, with its count, before any beat is written. The outline's line
    // stays as it is; one economy call fixes the other language's line.
    if (refrainText && refrainBeats.size) {
      const hangul = /[가-힣]/u.test(refrainText),
        other = hangul ? "en" : "ko";
      voice[hangul ? "ko" : "en"] = refrainText;
      const card = await journal.call(
        "cheap",
        {
          system: "너는 그림책 편집자다. 이 책의 되풀이 말을 다른 언어로 한 줄 정한다. 아이가 따라 말하기 쉬운 짧고 리듬 있는 한 줄, 뜻은 같게. 직역이 어색하면 자연스러운 말로. JSON으로만.",
          user: `[되풀이 말] ${refrainText}\n[쓸 비트] ${[...refrainBeats].join(", ")}\n[정할 언어] ${other === "en" ? `English (${input.specs?.en?.id || ""}, 3~7 words)` : `한국어 (${input.specs?.ko?.id || ""}, 2~5어절)`}\n\n[출력] JSON만. {"text":"한 줄"}`,
          jsonSchema: TEXT_SCHEMA,
          temperature: 0.2,
          maxTokens: 200,
        },
        services,
      );
      const data = card?.json !== undefined ? card.json : parseJsonLenient(String(card?.text || ""));
      voice[other] = str(object(data) ? data.text : card?.text, 150).replace(/^["“'‘]+|["”'’]+$/gu, "");
    }
    report.refrain = { voiceCard: { ...voice }, beats: [...refrainBeats] };
    const written = Object.fromEntries(languages.map((lang) => [lang, []])),
      anchors = {};
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      options.onProgress?.({ stage: "prose", phase: "beat", message: `정성 모드 · ${i + 1}/${beats.length}비트를 쓰고 있어요.`, beatIndex: beat.index });
      await Promise.all(
        languages.map(async (lang) => {
          const ctx = { written: written[lang], anchor: anchors[lang] || "" };
          let chosen;
          if (i === 0) {
            // The style anchor: two drafts, then the better voice.
            const [a, b] = await Promise.all([write(lang, beat, i, { ...ctx, draft: 1 }), write(lang, beat, i, { ...ctx, draft: 2 })]);
            const passA = !a.check.problems.length,
              passB = !b.check.problems.length;
            // One passes: that one. Both fail: the closer one (it goes on to the retries).
            let pick = passA !== passB ? (passA ? 1 : 2) : a.check.distance <= b.check.distance ? 1 : 2;
            if (passA && passB) {
              const sniff = await journal.call(
                "cheap",
                {
                  system: "너는 그림책 편집자다. 같은 첫 장면의 두 초안 중 이 책 전체의 목소리로 삼을 글을 고른다. 기준: 아이 귀에 리듬이 살아 있는가, 보이고 들리는 구체가 있는가, 말맛, 목표 분량에 가까운가. JSON으로만.",
                  user: `[목표] ${budgets[0][lang].target}문장 안팎\n\n[초안 1]\n${a.text}\n\n[초안 2]\n${b.text}\n\n[출력] JSON만. {"pick":1|2,"reason":"한 줄"}`,
                  jsonSchema: PICK_SCHEMA,
                  temperature: 0.1,
                  maxTokens: 200,
                },
                services,
              );
              const data = sniff?.json !== undefined ? sniff.json : parseJsonLenient(String(sniff?.text || ""));
              if (Number(data?.pick) === 1 || Number(data?.pick) === 2) pick = Number(data.pick);
              report.anchor[lang] = { pick, reason: str(data?.reason, 200), judged: true };
            } else report.anchor[lang] = { pick, judged: false };
            chosen = await settle(lang, beat, i, ctx, pick === 1 ? a : b);
            anchors[lang] = chosen.text;
          } else chosen = await settle(lang, beat, i, ctx, await write(lang, beat, i, ctx));
          // Never an empty paragraph: an empty beat keeps its outline line, with a warning.
          if (!chosen.text) report.warnings.push(`${lang === "ko" ? "한글" : "영어"} ${beat.index}비트: 글이 비어 줄거리 문장으로 채웠어요`);
          written[lang].push({ beatIndex: beat.index, text: chosen.text || str(beat.summary, 600) || "…" });
        }),
      );
    }
    const prose = {
      ko: "",
      en: "",
      usedRefrainAt: voice.ko
        ? written.ko
            .filter((row) => refrainBeats.has(Number(row.beatIndex)) && hasRefrain(row.text, voice.ko))
            .map((row) => row.beatIndex)
            .slice(0, 3)
        : [],
      paragraphBeats: { ko: [], en: [] },
    };
    for (const lang of languages) {
      prose[lang] = written[lang].map((row) => row.text).join("\n\n");
      prose.paragraphBeats[lang] = written[lang].map((row) => row.beatIndex);
      const share = dialogueShare(written[lang].map((row) => row.text));
      // R34: the free style numbers of the writer's Korean text (advisory: ③, the check report and the runner show them).
      if (lang === "ko") report.style = styleReport(written[lang].map((row) => row.text), { names: list(input.characters).map((c) => c?.name) });
      report[`dialogue_${lang}`] = Math.round(share * 100) / 100;
      if (share < DIALOGUE_MIN(input))
        report.warnings.push(`${lang === "ko" ? "한글" : "영어"} 대화 비율 ${Math.round(share * 100)}% (책 전체 기준 ${Math.round(DIALOGUE_MIN(input) * 100)}% 이상 권장)`);
    }
    for (const lang of voice.ko ? languages : []) {
      const count = written[lang].filter((row) => hasRefrain(row.text, voice[lang])).length;
      report.refrain[lang] = { text: voice[lang], expected: refrainBeats.size, found: count };
      if (count !== refrainBeats.size)
        report.warnings.push(`${lang === "ko" ? "한글" : "영어"} 되풀이 말 "${voice[lang]}" ${count}번(정한 횟수 ${refrainBeats.size}번)`);
    }
    report.calls = spent();
    await journal.save();
    return {
      data: prose,
      usage: journal.usage(),
      meta: { ...journal.summary(), stage: "prose", writer: clone(report), ...(report.style ? { style: clone(report.style) } : {}), ...(report.warnings.length ? { softIssues: [...report.warnings] } : {}) },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw journal.fail(error);
  }
}
