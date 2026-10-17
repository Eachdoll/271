/**
 * 아이 시뮬레이터 — 보급형 모델을 '비평가'로 쓴다.
 *  1) curiosityCheck: 쪽마다 "다음 쪽이 궁금한가" 0~2점 → 0점 쪽만 재작성
 *  2) retellCheck: 4세 아이의 세 문장 되말하기 → want/turn/resolution이 빠지면 두서없는 이야기
 */
import type { Beat, TextEngine } from './types.js';
import { CHILD_CURIOSITY_SYSTEM, CHILD_CURIOSITY_USER, CHILD_RETELL_SYSTEM, CHILD_RETELL_USER, fill } from './prompts.js';
import { extractJson } from './util.js';

export interface PageText {
  pageNo: number;
  text: string;
}

export interface CuriosityResult {
  pages: { pageNo: number; score: 0 | 1 | 2; childQuestion: string | null; why: string }[];
  dropPages: number[];
  overall: number;
  pass: boolean;
  costUsd: number;
}

export async function curiosityCheck(engine: TextEngine, pages: PageText[]): Promise<CuriosityResult> {
  const user = fill(CHILD_CURIOSITY_USER, { pages: pages.map((p) => `${p.pageNo}. ${p.text}`).join('\n') });
  const r = await engine.complete({ system: CHILD_CURIOSITY_SYSTEM, user, temperature: 0.3, maxTokens: 900 });
  const j = (r.json as Partial<CuriosityResult> | undefined) ?? extractJson<Partial<CuriosityResult>>(r.text) ?? {};
  const scored = (j.pages ?? []).map((p) => ({
    pageNo: Number(p.pageNo),
    score: clamp(Number(p.score), 0, 2) as 0 | 1 | 2,
    childQuestion: p.childQuestion ?? null,
    why: p.why ?? '',
  }));
  const drop = scored.filter((p) => p.score === 0).map((p) => p.pageNo);
  // 모델이 쓰는 overall은 척도가 흔들린다(0~2 평균을 쓰는 경우가 많음). 쪽 점수가 있으면 항상 쪽 점수 평균×5(0~10)로 계산한다.
  const overall = scored.length ? Math.round((scored.reduce((a, p) => a + p.score, 0) / scored.length) * 5 * 10) / 10 : typeof j.overall === 'number' ? clamp(j.overall, 0, 10) : 0;
  return { pages: scored, dropPages: drop.length ? drop : j.dropPages ?? [], overall, pass: drop.length === 0 && overall >= 6, costUsd: r.costUsd ?? 0 };
}

export interface RetellResult {
  retell: string[];
  coveredBeats: number[];
  missingCore: string[];
  /** 모델이 적었지만 핵심 유형이 아닌 누락(참고용) */
  notedMissing: string[];
  confusions: string[];
  coherence: number;
  pass: boolean;
  /** turn이 빠졌으면 전문의 turn 문단 재작성 권고 */
  recommendTurnRewrite: boolean;
  costUsd: number;
}

export async function retellCheck(engine: TextEngine, prose: string, beats: Beat[]): Promise<RetellResult> {
  const user = fill(CHILD_RETELL_USER, {
    prose,
    beats: beats.map((b) => `${b.index} [${b.type}] ${b.summary}`).join('\n'),
  });
  const r = await engine.complete({ system: CHILD_RETELL_SYSTEM, user, temperature: 0.3, maxTokens: 600 });
  const j = (r.json as Partial<RetellResult> | undefined) ?? extractJson<Partial<RetellResult>>(r.text) ?? {};
  const covered = (j.coveredBeats ?? []).map(Number);
  const coreTypes: Beat['type'][] = ['want', 'turn', 'resolution'];
  const coreIdx = beats.filter((b) => coreTypes.includes(b.type)).map((b) => b.index);
  const missingFromCovered = coreIdx.filter((i) => !covered.includes(i)).map((i) => beats.find((b) => b.index === i)?.type ?? String(i));
  // 모델이 적은 missingCore에는 핵심이 아닌 비트(마무리 등)나 서술문이 섞인다. 통과 판정은 핵심 유형(want·turn·resolution)만 본다.
  const coreFromModel = (j.missingCore ?? []).map((m) => {
    const n = Number(m);
    const byIndex = Number.isInteger(n) ? beats.find((b) => b.index === n) : undefined;
    return byIndex ? byIndex.type : String(m);
  }).filter((t) => (coreTypes as string[]).includes(t));
  const missingCore = [...new Set([...coreFromModel, ...missingFromCovered])];
  const notedMissing = (j.missingCore ?? []).map(String).filter((m) => !missingCore.includes(m));
  const coherence = clamp(Number(j.coherence ?? 0), 0, 2);
  return {
    retell: j.retell ?? [],
    coveredBeats: covered,
    missingCore,
    notedMissing,
    confusions: j.confusions ?? [],
    coherence,
    pass: missingCore.length === 0 && coherence >= 1,
    recommendTurnRewrite: missingCore.includes('turn'),
    costUsd: r.costUsd ?? 0,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
