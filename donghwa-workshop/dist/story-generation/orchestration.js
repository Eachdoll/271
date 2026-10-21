/*
 * 정성 모드 (2026-10-21, R29 — 멀티에이전트 스펙 v1.0 적용안). New drafts
 * freeze input.orchestrationPolicy {version: 1, writerTier} in
 * inputFromWizard while the parent setting
 * `settings.textGeneration.orchestration` is not false (on by default; the
 * World's text-settings copy follows it like reviewTier). Only drafts with it get the stages below; a draft
 * without it sends every request byte for byte as before.
 *
 * R29 (this file): the writers' room asks for three plot candidates in
 * parallel, each from a different angle, with the protagonist's growth
 * (want ≠ need, flaw), the theme and the lesson (shown, never said) and a
 * tension number per beat. A deterministic curve check asks a candidate
 * once more when its curve is flat, peaks too early or never resolves. The
 * critics and the chair rank them as before; the bible carries the growth,
 * and the outline rules bind it.
 *
 * writerTier ("medium" default | "upper") is frozen now for the beat-by-beat
 * writer of the next round.
 */
export const ORCHESTRATION_POLICY_VERSION = 1;
export const WRITER_TIER_MEDIUM = "medium";
export const WRITER_TIER_UPPER = "upper";
export function orchestrationPolicy({ writerTier } = {}) {
  return {
    version: ORCHESTRATION_POLICY_VERSION,
    writerTier: writerTier === WRITER_TIER_UPPER ? WRITER_TIER_UPPER : WRITER_TIER_MEDIUM,
  };
}
export function hasOrchestrationPolicy(input) {
  return input?.orchestrationPolicy?.version === ORCHESTRATION_POLICY_VERSION;
}
/** The parent's setting (on unless turned off) → the policy a new draft freezes, or null. */
export function orchestrationPolicyFor(state) {
  const text = state?.settings?.textGeneration || {};
  if (text.orchestration === false) return null;
  return orchestrationPolicy({ writerTier: text.writerTier });
}
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 300) =>
  String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);

/** The three angles, one candidate each (spec §6.2, three parallel architects). */
export const PLOT_ANGLES = Object.freeze([
  Object.freeze({
    id: "heart",
    ko: "마음 이야기",
    line: "마음 이야기: 주인공의 약점·걱정(flaw)이 끝에서 강점이 되거나, 나눈 것이 돌아오는 이야기. 반전은 새 물건이 아니라 주인공이 자기(또는 심은 물건)를 다시 보는 순간이다.",
  }),
  Object.freeze({
    id: "adventure",
    ko: "모험·수수께끼",
    line: "모험·수수께끼: 바라는 것을 찾아 떠나는 길에서 시도가 커지고, 처음부터 곁에 있던 심은 물건을 다시 보는 반전으로 풀리는 이야기.",
  }),
  Object.freeze({
    id: "humor",
    ko: "웃음·되풀이",
    line: "웃음·되풀이: 같은 일이 조금씩 커지며 되풀이되다(누적) 마지막에 웃기게 뒤집히는 이야기. 실패는 아프지 않고 웃기다.",
  }),
]);
/** Tension per beat (0 calm … max): K1/K2 0–4, K3+ 0–5; the curve's minimum spread. */
export function tensionRange(input = {}) {
  const level = Number(String(input.specs?.ko?.id || input.koreanLevel || "K2").replace(/\D/gu, "")) || 2;
  return level <= 2 ? { min: 0, max: 4, spread: 2 } : { min: 0, max: 5, spread: 3 };
}
/**
 * Spec §7's curve check, on tension: the peak comes at or after 55% of the
 * book, the last beat is calmer than the peak, the curve is not flat, every
 * value is in range and there is one value per beat. Returns the problems
 * (empty when the curve is good).
 */
export function checkTensionCurve(values, beats, range = { min: 0, max: 4, spread: 2 }) {
  const t = list(values).map(Number);
  const problems = [];
  if (t.length !== beats || t.some((v) => !Number.isFinite(v))) {
    problems.push(`긴장도는 비트 ${beats}개마다 숫자 하나씩이어야 해요.`);
    return problems;
  }
  if (t.some((v) => v < range.min || v > range.max))
    problems.push(`긴장도는 ${range.min}~${range.max} 사이여야 해요.`);
  const peak = Math.max(...t),
    peakIndex = t.lastIndexOf(peak);
  if (peakIndex < Math.ceil((beats - 1) * 0.55))
    problems.push("가장 긴장되는 비트(절정)가 너무 일러요. 시도가 쌓인 뒤 전환 비트 근처에 두세요.");
  if (t.at(-1) >= peak) problems.push("마지막 비트가 절정만큼 긴장돼요. 끝은 풀려야 해요.");
  if (peak - Math.min(...t) < range.spread)
    problems.push(`긴장도가 평평해요(차이 ${range.spread} 이상 필요).`);
  return problems;
}
/** The extra pitch fields (strict JSON schema pieces) a policy draft asks for. */
export function growthSchemaProperties(beats) {
  const s = (maxLength) => ({ type: "string", maxLength });
  return {
    angle: { type: "string", enum: PLOT_ANGLES.map((a) => a.id) },
    growth: {
      type: "object",
      additionalProperties: false,
      required: ["want", "need", "flaw"],
      properties: { want: s(200), need: s(200), flaw: s(200) },
    },
    theme: s(120),
    lesson: s(200),
    tension: {
      type: "array",
      minItems: beats,
      maxItems: beats,
      items: { type: "integer", minimum: 0, maximum: 5 },
    },
  };
}
export function normalizeGrowth(raw, beats) {
  if (!object(raw)) return null;
  const g = object(raw.growth) ? raw.growth : {},
    tension = list(raw.tension)
      .map((v) => Math.round(Number(v)))
      .filter((v) => Number.isFinite(v))
      .slice(0, beats);
  return {
    angle: PLOT_ANGLES.some((a) => a.id === raw.angle) ? raw.angle : "",
    growth: { want: str(g.want, 200), need: str(g.need, 200), flaw: str(g.flaw, 200) },
    theme: str(raw.theme, 120),
    lesson: str(raw.lesson, 200),
    tension,
  };
}
/**
 * Step 1 of the room (before any candidate): the protagonist's growth, the
 * theme and the lesson, shared by all three candidates so whichever one wins
 * the growth design is the same (review of the spec, item 9).
 */
export const GROWTH_DESIGN_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["growth", "theme", "lesson"],
  properties: {
    growth: growthSchemaProperties(1).growth,
    theme: { type: "string", maxLength: 120 },
    lesson: { type: "string", maxLength: 200 },
  },
});
export function growthDesignInstructions() {
  return "[성장 설계 — 후보를 쓰기 전에 먼저 정한다] 주인공의 growth{want(겉으로 바라는 것), need(끝에서 실제로 얻는 것 — want와 달라야 함), flaw(걸림돌이 되는 성격·걱정)}, theme(한 낱말~짧은 구), lesson(말로 하지 않고 행동으로 보여 줄 배움 한 문장). [방향]·[주제]·[조건]에 맞추고, 주인공의 성격 카드와 어긋나지 않게. 세 각도(마음·모험·웃음)의 후보가 모두 이 설계를 함께 쓴다.";
}
export function normalizeGrowthDesign(raw) {
  if (!object(raw)) return null;
  const g = object(raw.growth) ? raw.growth : {},
    design = {
      growth: { want: str(g.want, 200), need: str(g.need, 200), flaw: str(g.flaw, 200) },
      theme: str(raw.theme, 120),
      lesson: str(raw.lesson, 200),
    };
  return design.growth.want && design.growth.need ? design : null;
}
/** The schema pieces each candidate adds: its angle and its tension curve. */
export function candidateSchemaProperties(beats) {
  const { angle, tension } = growthSchemaProperties(beats);
  return { angle, tension };
}
/** The author's instruction for one candidate (the shared growth, its angle and curve). */
export function candidateInstructions(angle, beats, range, design) {
  const g = design?.growth || {};
  return `[성장 설계 — 세 후보 공통, 바꾸지 않는다] want: ${g.want} / need: ${g.need} / flaw: ${g.flaw} / theme: ${design?.theme || ""} / lesson(말하지 않고 보여 줌): ${design?.lesson || ""}. 마지막 비트에서 want는 바뀌거나 내려놓이고 주인공의 행동으로 need를 얻는다.\n[이번 후보의 각도] ${angle.line}\n[긴장 곡선] tension: 비트 ${beats}개마다 ${range.min}~${range.max}의 정수. 시도마다 올라 전환 비트 근처가 가장 높고(${Math.ceil((beats - 1) * 0.55) + 1}번째 비트 이후), 마지막 비트는 풀려 낮다. 가장 높은 값과 낮은 값의 차이 ${range.spread} 이상.\n[출력 각도] angle="${angle.id}".`;
}
export function normalizeCandidate(raw, beats) {
  if (!object(raw)) return { angle: "", tension: [] };
  return {
    angle: PLOT_ANGLES.some((a) => a.id === raw.angle) ? raw.angle : "",
    tension: list(raw.tension)
      .map((v) => Math.round(Number(v)))
      .filter((v) => Number.isFinite(v))
      .slice(0, beats),
  };
}
/** Plain-text tension bars for the parent's choice (▁▂▃▅▇ per beat). */
export function tensionBars(values) {
  const marks = ["▁", "▂", "▃", "▄", "▅", "▇"];
  return list(values)
    .map((v) => marks[Math.max(0, Math.min(5, Math.round(Number(v) || 0)))])
    .join("");
}
export function angleLabel(id) {
  return PLOT_ANGLES.find((a) => a.id === id)?.ko || "";
}
/** Growth lines for the outline request (binding with the bible). */
export function growthOutlineLines(bible) {
  if (!object(bible?.growth)) return "";
  const g = bible.growth,
    tension = list(bible.tension);
  return [
    `GROWTH (binding): the protagonist wants "${g.want}" but what they truly gain by the last beat is "${g.need}"; the flaw in the way is "${g.flaw}". In the last beats the want changes or is let go and the need is reached through the protagonist's own action.`,
    bible.theme || bible.lesson
      ? `THEME "${bible.theme}"; LESSON "${bible.lesson}" — shown only through actions and the ending image, never stated or explained by the narrator or a character.`
      : "",
    tension.length
      ? `TENSION per beat (0 calm … high): ${tension.map((v, i) => `${i + 1}:${v}`).join(" ")} — the emotionArc and the beat events follow this curve.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
/** The editor bot's extra checklist lines for policy drafts. */
export const GROWTH_CHECKLIST = Object.freeze([
  "growth: want와 need가 다르고, 끝에서 want가 바뀌거나 내려놓이며 주인공의 행동으로 need를 얻는가(못하면 direction을 1 낮춘다)",
  "lesson: 교훈을 말로 하지 않고 행동·마지막 그림으로 보여 주는가",
]);

/**
 * R29.1: the formal outline returns the curve too (`tension`, one integer
 * per beat, required by the request schema of a policy draft), and it is
 * checked again right after the expansion. A curve that fails is replaced by
 * the bible's (already checked) curve, so the beat writer never gets a broken
 * target; the replacement and the problems are reported, never a paid retry.
 */
export function outlineTensionSchema(beats) {
  return {
    type: "array",
    items: { type: "integer", minimum: 0, maximum: 5 },
    minItems: beats,
    maxItems: beats,
  };
}
export function outlineTensionRule(beats, range, bible) {
  return `TENSION ARRAY: return tension[] with exactly ${beats} integers ${range.min}-${range.max}, one per beat in order${list(bible?.tension).length === beats ? ", following the bible's TENSION per beat" : ""}: rising through the attempts, highest at or near the turn (not before beat ${Math.ceil((beats - 1) * 0.55) + 1}), calmer at the last beat. The beats and the emotionArc follow it.`;
}
export function settleOutlineTension(outline, beats, range, bible) {
  if (!object(outline)) return null;
  const given = list(outline.tension)
    .map((v) => Math.round(Number(v)))
    .filter((v) => Number.isFinite(v));
  const problems = checkTensionCurve(given, beats, range),
    fallback = list(bible?.tension);
  if (!problems.length) {
    outline.tension = given;
    return { passed: true, problems: [] };
  }
  if (fallback.length === beats && !checkTensionCurve(fallback, beats, range).length) {
    outline.tension = [...fallback];
    return { passed: false, problems, restored: "bible" };
  }
  if (given.length === beats) outline.tension = given;
  else delete outline.tension;
  return { passed: false, problems };
}
