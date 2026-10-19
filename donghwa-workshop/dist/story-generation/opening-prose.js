/* R12 openings prose (펼침 구성): token budgets, request timeouts, the LAYOUT
 * rule line and the app length-fit pass that moves beat paragraphs into their
 * frozen per-opening sentence ranges. Pure (no network, storage or clock).
 * Everything here applies only to an input frozen with layoutPolicy 'openings';
 * every other draft keeps its pre-R12 constants and requests byte for byte. */
import { splitSentences } from "../story-quality/dist/util.js";

export const isOpeningsInput = (input) =>
  input?.layoutPolicy?.kind === "openings" &&
  !!input?.specs?.ko?.units &&
  !!input?.specs?.en?.units;
const openingsOf = (input) => Number(input.pageCount) / 2;

/* Worst-case output tokens from the frozen specs: Korean (max + 2) sentences ×
 * the top eojeol × 4.8 tokens; English min(max sentences × top words, the words
 * cap) × 2.4 tokens; JSON about 270 tokens per entry (2O entries) plus 300. */
const KO_TOKENS_PER_EOJEOL = 4.8,
  EN_TOKENS_PER_WORD = 2.4,
  JSON_PER_ENTRY = 270,
  JSON_BASE = 300;
function koUnitTokens(spec, unit) {
  return (unit.max + 2) * Number(spec.wordsPerSentence?.max || 7) * KO_TOKENS_PER_EOJEOL;
}
function enUnitTokens(spec, unit) {
  const words = unit.max * Number(spec.wordsPerSentence?.max || 8);
  return Math.min(words, unit.words?.max ?? Infinity) * EN_TOKENS_PER_WORD;
}
/** Worst output tokens of one openings request stage, or null for stages it does not size. */
export function openingWorstTokens(stage, input) {
  if (!isOpeningsInput(input)) return null;
  const { ko, en } = input.specs,
    count = openingsOf(input),
    opening = koUnitTokens(ko, ko.units.opening) + enUnitTokens(en, en.units.opening);
  switch (stage) {
    case "pagination":
      return count * opening + JSON_PER_ENTRY * 2 * count + JSON_BASE;
    case "prose":
      return count * opening + JSON_BASE + 100;
    case "coherenceRepair":
      return count * opening + 85 * 2 * count + JSON_BASE;
    case "page":
      return (
        koUnitTokens(ko, ko.units.spread) +
        enUnitTokens(en, en.units.spread) +
        JSON_PER_ENTRY
      );
    case "proseFit":
    case "qualityWrap":
      return (
        count *
        Math.max(koUnitTokens(ko, ko.units.opening), enUnitTokens(en, en.units.opening))
      );
    default:
      return null;
  }
}
/**
 * maxTokens of a request: the pre-R12 constant for every page draft and for
 * stages openings do not size; otherwise min(32000, max(legacy, ceil(1.25 ×
 * worst) + 1000)), below every economy cap and the providers.js 32000 rule.
 */
export function budgetFor(stage, input, legacy) {
  const worst = openingWorstTokens(stage, input);
  if (worst == null) return legacy;
  return Math.min(32000, Math.max(legacy, Math.ceil(1.25 * worst) + 1000));
}
/** The quality adapter's fixed wrap budget for page drafts (quality-adapter.js). */
export const QUALITY_WRAP_TOKENS = 12000;
/** Stages whose openings requests carry req.timeoutMs (long outputs on slow rows). */
export const OPENING_TIMEOUT_STAGES = Object.freeze([
  "pagination",
  "prose",
  "coherenceRepair",
  "qualityWrap",
  "proseFit",
]);
/** 60 s plus 15 ms per output token; providers.js takes the larger of this and its own. */
export function openingTimeoutMs(maxTokens) {
  return 60000 + 15 * Number(maxTokens || 0);
}
/** { timeoutMs } for an openings request of a timed stage, else {} (no key at all). */
export function openingTimeout(stage, input, maxTokens) {
  return isOpeningsInput(input) && OPENING_TIMEOUT_STAGES.includes(stage)
    ? { timeoutMs: openingTimeoutMs(maxTokens) }
    : {};
}

const rangeText = (unit) =>
  unit.min === unit.max ? `${unit.min}` : `${unit.min}–${unit.max}`;
/** The LAYOUT rule (openings only): one approved beat paragraph is one opening. */
export function layoutRuleLine(input) {
  if (!isOpeningsInput(input)) return "";
  const count = openingsOf(input),
    ko = input.specs.ko.units.opening,
    en = input.specs.en.units.opening,
    words = en.words ? `, ${en.words.min}–${en.words.max} words` : "";
  return `LAYOUT: ${count} openings = ${count * 2} printed pages; each approved beat paragraph is one opening (Korean ${rangeText(ko)} sentences, target ${ko.target}; English ${rangeText(en)} sentences${words}, target ${en.target}); pagination later shows an opening as one spread or two single pages.`;
}
/** APP CANON layout key (openings only). */
export function layoutCanon(input) {
  if (!isOpeningsInput(input)) return null;
  const count = openingsOf(input);
  return { openings: count, printedPages: count * 2, oneBeatPerOpening: true };
}

/* ---------- the app length-fit pass ---------- */

const LABEL = /^\s*\[(?:비트|Beat)\s+(\d+)(?:\s*[·:—-][^\]\r\n]*)?\]/imu;
const LABEL_START = /^(?=\s*\[(?:비트|Beat)\s+\d+)/gimu;
/** Labeled prose → [{ beatIndex, raw }] blocks (text before the first label is kept as beat null). */
export function labeledBlocks(text) {
  return String(text || "")
    .split(LABEL_START)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => ({ beatIndex: Number(raw.match(LABEL)?.[1]) || null, raw }));
}
const blockBody = (raw) => raw.replace(LABEL, "");
/** Sentences per beat of a list of { beatIndex, text|raw } paragraphs. */
export function beatSentenceCounts(paragraphs) {
  const counts = new Map();
  for (const row of paragraphs) {
    const body = row.text ?? blockBody(row.raw);
    counts.set(
      row.beatIndex,
      (counts.get(row.beatIndex) || 0) + splitSentences(body).length,
    );
  }
  return counts;
}
/** The band a beat must reach: Korean [min − 1, max + 1]; English strict [min, max]. */
export function fitBand(spec, language) {
  const unit = spec.units.opening;
  return language === "ko"
    ? { min: unit.min - 1, max: unit.max + 1 }
    : { min: unit.min, max: unit.max };
}
const outside = (count, band) => count < band.min || count > band.max;
/**
 * Which beats the length-fit pass should change. Korean: any beat outside
 * [min − 1, max + 1], or (when none is) the beats below min while the book total
 * is under O × min; English: any beat outside the strict opening range.
 * Returns { band, counts, triggered: [{beatIndex, count}], lines }.
 */
export function lengthFitPlan(paragraphs, spec, language, openings) {
  const unit = spec.units.opening,
    band = fitBand(spec, language),
    counts = beatSentenceCounts(paragraphs);
  let triggered = [...counts].filter(([beat, count]) => beat != null && outside(count, band));
  if (!triggered.length && language === "ko") {
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    if (total < openings * unit.min)
      triggered = [...counts].filter(([beat, count]) => beat != null && count < unit.min);
    else if (total > openings * (unit.max + 1))
      triggered = [...counts].filter(([beat, count]) => beat != null && count > unit.max);
  }
  const rows = triggered.map(([beatIndex, count]) => ({ beatIndex, count }));
  return {
    band,
    counts,
    triggered: rows,
    lines: rows.map(({ beatIndex, count }) =>
      language === "ko"
        ? `[비트 ${beatIndex}] 지금 ${count}문장 → ${unit.min}~${unit.max}문장(목표 ${unit.target})`
        : `[Beat ${beatIndex}] now ${count} sentences → ${unit.min}-${unit.max} sentences (target ${unit.target})`,
    ),
  };
}
/** The cheap fit request (plain labeled text in, plain labeled text out). */
export function lengthFitRequest(text, plan, spec, language) {
  const words = spec.wordsPerSentence || {};
  return language === "ko"
    ? {
        system:
          "너는 그림책 글의 분량만 맞추는 편집자야. 지정한 비트 문단의 문장 수만 맞추고, 비트 라벨과 다른 비트 문단은 한 글자도 바꾸지 않는다. 라벨이 있는 글만 돌려준다.",
        user: `[분량 맞추기] 아래 비트만 문장 수를 맞춘다.\n${plan.lines.join("\n")}\n- 늘릴 때: 이미 있는 사건 안에서 감각·몸짓·대화를 더한다. 새 사건·소품·장소·인물을 만들지 않는다.\n- 줄일 때: 되풀이된 내용을 줄인다. 원인·시도·결과·반전은 지킨다.\n- 문장마다 주어를 쓰고, 문장당 ${words.min}~${words.max}어절로 쓴다.\n- 모든 비트 라벨([비트 n · 유형])과 순서를 그대로 둔다. 다른 비트 문단은 그대로 옮긴다.\n\n[글]\n${text}`,
        temperature: 0.3,
      }
    : {
        system:
          "You only adjust the length of picture-book beat paragraphs. Change the sentence count of the listed beats only; keep every beat label and every other paragraph exactly as it is. Return the labeled text only.",
        user: `[Length fit] Change only these beats.\n${plan.lines.join("\n")}\n- To lengthen: add sensory detail, gesture or dialogue inside the existing events. Never add a new event, prop, place or character.\n- To shorten: cut repetition; keep cause, attempts, results and the turn.\n- Every sentence has a subject; ${words.min}-${words.max} words per sentence.\n- Keep every beat label ([Beat n · type]) and their order; copy the other paragraphs unchanged.\n\n[Text]\n${text}`,
        temperature: 0.3,
      };
}
/**
 * The fitted text, or null when the response is discarded. Accepted only when
 * the labels (beats and their order) are unchanged, fewer beats are out of band
 * and no beat that was in band goes out of band. Untriggered beats keep their
 * original blocks byte for byte; only triggered beats take the new blocks.
 */
export function applyLengthFit(text, nextText, plan) {
  const before = labeledBlocks(text),
    after = labeledBlocks(nextText),
    order = (blocks) => blocks.map((block) => block.beatIndex).join(",");
  if (!after.length || order(before) !== order(after)) return null;
  const triggered = new Set(plan.triggered.map((row) => row.beatIndex)),
    merged = before.map((block, index) =>
      triggered.has(block.beatIndex) ? after[index] : block,
    );
  return fitAccepted(plan, beatSentenceCounts(merged))
    ? merged.map((block) => block.raw).join("\n\n")
    : null;
}
/**
 * The acceptance rule of a fit result's per-beat counts: no beat that was in
 * band leaves it, and fewer beats are out of band (when the plan was triggered
 * by a short book total only, none may be out and the total must grow).
 */
export function fitAccepted(plan, counts) {
  const wasOut = [...plan.counts].filter(([, count]) => outside(count, plan.band)),
    nowOut = [...counts].filter(([, count]) => outside(count, plan.band)),
    total = (map) => [...map.values()].reduce((sum, value) => sum + value, 0);
  if ([...plan.counts.keys()].join(",") !== [...counts.keys()].join(","))
    return false;
  if (nowOut.some(([beat]) => !outside(plan.counts.get(beat) ?? 0, plan.band)))
    return false;
  if (wasOut.length) return nowOut.length < wasOut.length;
  return !nowOut.length && total(counts) > total(plan.counts);
}
/**
 * Paragraph rows ({beatIndex, text}) with each triggered beat's paragraphs
 * replaced by its one new paragraph (at the first one's place); the rest are
 * kept byte for byte. Null when the replacements do not cover exactly the
 * triggered beats or the result is not accepted.
 */
export function applyParagraphFit(rows, replacements, plan) {
  const triggered = new Set(plan.triggered.map((row) => row.beatIndex)),
    given = new Map();
  for (const row of Array.isArray(replacements) ? replacements : []) {
    const text = String(row?.text ?? "").trim();
    if (!triggered.has(row?.beatIndex) || given.has(row.beatIndex) || !text)
      return null;
    given.set(row.beatIndex, text);
  }
  if (given.size !== triggered.size) return null;
  const out = [],
    placed = new Set();
  for (const row of rows) {
    if (!triggered.has(row.beatIndex)) out.push(row);
    else if (!placed.has(row.beatIndex)) {
      placed.add(row.beatIndex);
      out.push({ beatIndex: row.beatIndex, text: given.get(row.beatIndex) });
    }
  }
  return fitAccepted(plan, beatSentenceCounts(out)) ? out : null;
}
