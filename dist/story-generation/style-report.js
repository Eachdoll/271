/* 문체 실측 (R34, 2026-10-23): the free, deterministic numbers behind "every
 * book reads the same" — how many sentences open with a character's name,
 * how many end in the past-tense "-었어요", how many carry dialogue or ask
 * a question, and how uneven the sentence lengths are. Advisory only: the
 * writer report, the A/B runner and the check report show them; no checker
 * stops or rewrites a book over them. Pure. */
import { splitSentences } from "../story-quality/dist/util.js";

const list = (value) => (Array.isArray(value) ? value : []);
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const PARTICLE = "(?:는|은|가|이|도|의|를|을|와|과|랑|에게|한테|께서)?";
/** True when the sentence ends in a past-tense '-었어요/-았어요' form (the syllable before 어요 carries ㅆ). */
export function endsInPastYo(sentence) {
  const core = String(sentence || "").replace(/[\s.!?…~"”’'」)]+$/u, "");
  if (!/어요$/u.test(core) || core.length < 3) return false;
  const before = core.charCodeAt(core.length - 3) - 0xac00;
  return before >= 0 && before < 11172 && before % 28 === 20;
}
const endingOf = (sentence) => {
  const core = String(sentence || "").replace(/[\s.!?…~"”’'」)]+$/u, "");
  const match = /([가-힣]{1,2})$/u.exec(core);
  return match ? match[1] : core.slice(-2);
};
/** The style numbers of a book's Korean text (pages or paragraphs). */
export function styleReport(texts, { names = [] } = {}) {
  const sentences = list(texts)
    .flatMap((text) => splitSentences(String(text || "")))
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return null;
  const lengths = sentences.map((s) => s.split(/\s+/u).filter(Boolean).length),
    mean = lengths.reduce((a, b) => a + b, 0) / lengths.length,
    sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length);
  const known = list(names).map((n) => String(n || "").trim()).filter(Boolean),
    nameRe = known.length ? new RegExp(`^[“"'‘]?(?:${known.map(escapeRe).join("|")})${PARTICLE}(?:\\s|,|$)`, "u") : null,
    nameOpeners = nameRe ? sentences.filter((s) => nameRe.test(s)).length : 0,
    past = sentences.filter(endsInPastYo).length,
    dialogue = sentences.filter((s) => /[“”"「」]/u.test(s)).length,
    questions = sentences.filter((s) => /\?/u.test(s)).length,
    exclaims = sentences.filter((s) => /!/u.test(s)).length;
  const endings = new Map();
  for (const s of sentences) endings.set(endingOf(s), (endings.get(endingOf(s)) || 0) + 1);
  const words = sentences.flatMap((s) => s.split(/\s+/u).filter(Boolean));
  const share = (n) => Math.round((100 * n) / sentences.length) / 100;
  return {
    version: 1,
    sentences: sentences.length,
    nameOpenerShare: share(nameOpeners),
    pastShare: share(past),
    dialogueShare: share(dialogue),
    questions,
    exclaims,
    lengthMean: Math.round(mean * 10) / 10,
    lengthSd: Math.round(sd * 10) / 10,
    topEndings: [...endings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ending, count]) => ({ ending, count })),
    typeTokenRatio: Math.round((100 * new Set(words).size) / Math.max(1, words.length)) / 100,
  };
}
const pct = (value) => `${Math.round((Number(value) || 0) * 100)}%`;
/** One advisory line: 문체 실측 · 이름으로 시작 25% · '-었어요' 끝 80% · 대화 12% · 물음 0 · 문장 길이 5.7±2.0어절 */
export function styleSummaryLine(report) {
  if (!report || typeof report !== "object" || !report.sentences) return "";
  return `문체 실측 · 이름으로 시작 ${pct(report.nameOpenerShare)} · '-었어요' 끝 ${pct(report.pastShare)} · 대화 ${pct(report.dialogueShare)} · 물음 ${Number(report.questions) || 0} · 문장 길이 ${report.lengthMean}±${report.lengthSd}어절`;
}
