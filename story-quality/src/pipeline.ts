/**
 * 전체 흐름 예시 — 앱의 1단계(줄거리)와 2단계(전문)를 이 패키지로 바꿀 때의 호출 순서.
 * Codex는 이 파일을 참고해 기존 StoryOutline/StoryProse 생성 코드를 교체하면 된다.
 */
import type { BookRecord, GestureDictionary, Inventories, LevelSpecEn, LevelSpecKo, PlotPatternCard, StoryOutline, TextEngine } from './types.js';
import { buildBanList, renderBanListForPrompt } from './banList.js';
import type { WorldCard } from './worlds.js';
import { composeSeed, preferObstaclesForTopic, type BackgroundType, type StorySeed } from './composeSeed.js';
import { buildOutlinePrompt, roughTokenCount, type Character } from './outlinePrompt.js';
import { plotCheck, renderFixInstructions, containsPlanted } from './plotCheck.js';
import { generateBeatsWithBeam } from './beamSearch.js';
import { writeRichThenSimplify, RICH_LEVEL_OF } from './richThenSimplify.js';
import { curiosityCheck, retellCheck, type PageText } from './childSimulator.js';
import { extractJson, hashString } from './util.js';
import { catchphraseClauses, isCatchphraseFix } from './catchphrase.js';

export interface Engines {
  outline: TextEngine; // 상위 권장(줄거리는 토큰이 적다)
  prose: TextEngine; // 보급형(중)
  cheap: TextEngine; // 보급형(하): 심사·단순화·시뮬레이터
}

export interface OutlineStageInput {
  engines: Engines;
  bookId: string;
  protagonist: Character;
  supporting: Character[];
  worldCore: string[];
  topic: string;
  value?: string;
  levelKo: string;
  levelEn: string;
  pages: number;
  pattern: PlotPatternCard;
  backgroundType: BackgroundType;
  inventories: Inventories;
  approvedBooks: BookRecord[];
  endingType: 'home_sleep' | 'open';
  rules?: string[];
  banExamples?: string[];
  /** 보급형 모델로 줄거리를 만들 때 ON 권장 */
  useBeamSearch?: boolean;
  seriesId?: string;
  banWindow?: number;
  patternBanWindow?: number;
  excludeBookIds?: string[];
  referenceBooks?: BookRecord[];
  world?: WorldCard;
  variantChance?: number;
  /** 반복 검사에 쓸 말버릇. 없으면 등장인물의 catchphrase(돌려 쓰느라 뺀 인물 포함)를 쓴다. */
  catchphrases?: string[];
  /**
   * true면 말버릇 항목만으로는 유료 수정 호출을 하지 않는다. 항목은 check.fix에 남아 호출자가 권고로 다룬다.
   * 다른 수정 항목과 함께 있으면 같은 수정 호출에 넣는다. 앱은 true, 평가 하네스·CLI는 기본(false).
   */
  advisoryCatchphrases?: boolean;
  /**
   * true면 R9 이전(r8) 요청을 글자 그대로 보낸다: 등장인물 줄에 사용 한도 문구가 없고, 말버릇 반복 검사를 하지 않아
   * 수정 호출에도 말버릇 항목이 없다. 말버릇 정책 없이 고정된 앱의 기존 초안이 완료한 유료 호출을 재결제하지 않게 한다.
   */
  legacyCatchphrasePrompt?: boolean;
  /**
   * true면 2026-10-19 견고성 수정 이전의 검사(plotCheck legacyChecks)를 쓴다. 앱이 그 이전에 저장된 유료 체크포인트를 이어 갈 때만 켠다:
   * 검사 결과가 바뀌면 수정 호출 요청이 달라져 이미 산 응답을 다시 쓰지 못하기 때문이다.
   */
  legacyChecks?: boolean;
}

export interface OutlineStageResult {
  outline: StoryOutline;
  check: ReturnType<typeof plotCheck>;
  seedSummary: string;
  seed: StorySeed;
  calls: number;
  costUsd: number;
}

export async function runOutlineStage(input: OutlineStageInput): Promise<OutlineStageResult> {
  const ban = buildBanList(input.approvedBooks, {
    recentBooks: Math.min(50, Math.max(1, Math.round(input.banWindow ?? 10))),
    recentBooksForPattern: Math.min(20, Math.max(1, Math.round(input.patternBanWindow ?? 3))),
  });
  const seed = composeSeed({
    pattern: input.pattern,
    inventories: input.inventories,
    backgroundType: input.backgroundType,
    rngSeed: hashString(input.bookId),
    ban,
    preferObstacleIds: preferObstaclesForTopic(input.topic),
    world: input.world,
    variantChance: input.variantChance,
  });
  const cast = [input.protagonist, ...input.supporting];
  const clauses = input.legacyCatchphrasePrompt ? cast.map((c) => (c.catchphrase ? ` "${c.catchphrase}"` : '')) : catchphraseClauses(cast);
  const charactersCompact = cast.map((c, i) => `${c.name}: ${c.traits.slice(0, 2).join('·')}${clauses[i]}`).join(' / ');

  let calls = 0;
  let cost = 0;
  let outline: StoryOutline;

  if (input.useBeamSearch) {
    // 비트는 빔 서치로, 나머지 필드(제목·후렴·새 단어)는 한 번의 짧은 호출로 채운다
    const beam = await generateBeatsWithBeam({
      engine: input.engines.outline,
      judgeEngine: input.engines.cheap,
      pattern: input.pattern,
      seed,
      inventories: input.inventories,
      topic: input.topic,
      charactersCompact,
      banListText: renderBanListForPrompt(ban, input.inventories),
    });
    calls += beam.calls;
    cost += beam.costUsd;
    const wrapUser = [
      `아래 비트로 된 그림책 줄거리의 나머지 필드를 JSON으로만 채운다.`,
      `주인공: ${input.protagonist.name}. 주제: ${input.topic}. 심은 물건: ${seed.planted.ko}. 반전: ${seed.twist.ko}.`,
      beam.beats.map((b) => `${b.index} [${b.type}] ${b.summary}`).join('\n'),
      `APPROVED_BEAM_BEATS_JSON: ${JSON.stringify(beam.beats)}`,
      `{"titleCandidates": ["...","...","..."], "logline": "...", "want": "...", "problem": "...", "twistReveal": "...", "funnyMoment": "...", "refrain": {"text": "...", "usedAtBeats": [2,4], "variation": "..."}, "newWordsKo": ["...","...","..."], "newWordsEn": ["...","...","..."]}`,
    ].join('\n\n');
    const wrap = await input.engines.cheap.complete({ system: '너는 그림책 편집자다. JSON으로만 답한다.', user: wrapUser, temperature: 0.5, maxTokens: 600 });
    calls++;
    cost += wrap.costUsd ?? 0;
    const extra = (wrap.json as Record<string, unknown> | undefined) ?? extractJson<Record<string, unknown>>(wrap.text) ?? {};
    outline = {
      ...extra,
      plan: {
        pattern: input.pattern.id,
        planted: seed.planted.ko,
        twistReveal: String(extra.twistReveal ?? (extra.plan as StoryOutline['plan'] | undefined)?.twistReveal ?? ''),
        funnyMoment: String(extra.funnyMoment ?? (extra.plan as StoryOutline['plan'] | undefined)?.funnyMoment ?? seed.humor.ko),
        failureReasons: seed.failureReasons,
      },
      titleCandidates: (extra.titleCandidates as string[]) ?? [],
      logline: String(extra.logline ?? ''),
      want: String(extra.want ?? ''),
      problem: String(extra.problem ?? ''),
      beats: (extra.beats as StoryOutline['beats'] | undefined) ?? beam.beats,
      refrain: extra.refrain as StoryOutline['refrain'],
      newWordsKo: (extra.newWordsKo as string[]) ?? [],
      newWordsEn: (extra.newWordsEn as string[]) ?? [],
      endingType: input.endingType,
    };
  } else {
    const makePrompt = (exampleCount: number, legacyCatchphrasePrompt = input.legacyCatchphrasePrompt) => buildOutlinePrompt({
      protagonist: input.protagonist,
      supporting: input.supporting,
      worldCore: input.worldCore,
      topic: input.topic,
      value: input.value,
      levelKo: input.levelKo,
      levelEn: input.levelEn,
      pages: input.pages,
      pattern: input.pattern,
      seed,
      inventories: input.inventories,
      ban,
      approvedBooks: [...input.approvedBooks, ...(input.referenceBooks ?? [])],
      endingType: input.endingType,
      rules: input.rules,
      banExamples: input.banExamples,
      exampleCount,
      excludeBookIds: input.excludeBookIds,
      legacyCatchphrasePrompt,
    });
    // R9: 말버릇 사용 한도 문구는 참고 예시 예산(1,800)에 세지 않는다. r8 문안 길이로 재므로 한도 문구 때문에
    // 예시가 빠지지 않고, 예시 수는 r8과 같다(r8 문안이면 실제 프롬프트와 같은 길이).
    const overBudget = (exampleCount: number) => {
      const measured = makePrompt(exampleCount, true);
      return roughTokenCount(measured.system + measured.user) > 1800;
    };
    let exampleCount = 2;
    while (exampleCount > 0 && overBudget(exampleCount)) exampleCount--;
    const prompt = makePrompt(exampleCount);
    const r = await input.engines.outline.complete(prompt);
    calls++;
    cost += r.costUsd ?? 0;
    const parsed = (r.json as StoryOutline | undefined) ?? extractJson<StoryOutline>(r.text);
    if (!parsed) throw new Error('줄거리 JSON 파싱 실패');
    outline = parsed;
  }

  // 코드 검사 → 지적된 비트만 고치는 수정 호출 1회
  const catchphrases = input.legacyCatchphrasePrompt ? [] : input.catchphrases ?? cast.map((c) => c.catchphrase ?? '');
  outline = plantedFromSeed(outline, seed);
  let check = plotCheck({ outline, topic: input.topic, protagonistName: input.protagonist.name, seed, ban, inventories: input.inventories, catchphrases, legacyChecks: input.legacyChecks });
  const onlyAdvisory = input.advisoryCatchphrases === true && check.fix.every((message) => isCatchphraseFix(message));
  if (check.fix.length > 0 && check.regenerate.length === 0 && !onlyAdvisory) {
    const fixUser = [`아래 줄거리 JSON에서 지적된 항목만 고쳐 전체 JSON을 다시 출력한다. 나머지 비트는 글자 하나 바꾸지 않는다.`, renderFixInstructions(check), JSON.stringify(outline)].join('\n\n');
    const fr = await input.engines.cheap.complete({ system: '너는 그림책 편집자다. JSON으로만 답한다.', user: fixUser, temperature: 0.3, maxTokens: 4000 });
    calls++;
    cost += fr.costUsd ?? 0;
    const fixed = (fr.json as StoryOutline | undefined) ?? extractJson<StoryOutline>(fr.text);
    if (fixed) {
      outline = plantedFromSeed(fixed, seed);
      check = plotCheck({ outline, topic: input.topic, protagonistName: input.protagonist.name, seed, ban, inventories: input.inventories, catchphrases, legacyChecks: input.legacyChecks });
    }
  }

  return { outline, check, seedSummary: `${seed.planted.ko} · ${seed.twist.ko} · ${seed.creature.ko}`, seed, calls, costUsd: cost };
}

/**
 * 모델이 plan.planted를 시드 재료가 든 설명 문장으로 쓰면("엄마의 커다란 무늬 모자는 안쪽 띠가 좁다. …")
 * 시드 재료 이름으로 되돌린다. 시드 재료가 들어 있지 않은 다른 물건이면 그대로 두어 검사가 잡게 한다.
 */
export function plantedFromSeed(outline: StoryOutline, seed: { planted?: { ko?: string } } | undefined): StoryOutline {
  const want = seed?.planted?.ko;
  const got = outline?.plan?.planted;
  if (!want || typeof got !== 'string' || got === want) return outline;
  if (!got.includes(want) && !containsPlanted(got, want)) return outline;
  return { ...outline, plan: { ...outline.plan, planted: want } };
}

export interface ProseStageInput {
  engines: Engines;
  lang: 'ko' | 'en';
  outline: StoryOutline;
  charactersCompact: string;
  briefsCompact: string;
  emotions: string[];
  gestureDict: GestureDictionary;
  levels: Record<string, LevelSpecKo | LevelSpecEn>; // 'K1'…'E4'
  targetLevelId: string;
  styleSamples?: string[];
  vocabLabel?: string;
  twoPass?: boolean;
  /** 책 쪽 수. 전체 문장 예산에 쓴다. */
  pageCount?: number;
  condenseOverBudget?: boolean;
  /** true면 규칙 9(말버릇 한도)가 없는 r8 풍부 쓰기 문안을 쓴다(앱의 기존 초안 재결제 방지). */
  legacyCatchphrasePrompt?: boolean;
}

export async function runProseStage(input: ProseStageInput) {
  const target = input.levels[input.targetLevelId];
  const rich = input.twoPass === false ? target : input.levels[RICH_LEVEL_OF[input.targetLevelId] ?? input.targetLevelId] ?? target;
  return writeRichThenSimplify({
    engine: input.engines.prose,
    simplifyEngine: input.engines.cheap,
    lang: input.lang,
    charactersCompact: input.charactersCompact,
    beatsCompact: input.outline.beats.map((b) => `${b.index} [${b.type}] ${b.summary}`).join('\n'),
    briefsCompact: input.briefsCompact,
    emotions: input.emotions,
    gestureDict: input.gestureDict,
    targetLevel: target,
    richLevel: rich,
    refrainText: input.outline.refrain?.text,
    refrainBeats: input.outline.refrain?.usedAtBeats,
    styleSamples: input.styleSamples,
    vocabLabel: input.vocabLabel,
    twoPass: input.twoPass,
    decodable: input.targetLevelId === 'E1',
    presentTenseOnly: input.lang === 'en' && input.targetLevelId === 'E0',
    pageCount: input.pageCount,
    condenseOverBudget: input.condenseOverBudget,
    legacyCatchphrasePrompt: input.legacyCatchphrasePrompt,
  });
}

/** 쪽 나누기 뒤 게이트: 호기심 + 되말하기. 둘 다 보급형(하) 엔진. */
export async function runChildGate(engines: Engines, pages: PageText[], prose: string, outline: StoryOutline) {
  const [cur, ret] = await Promise.all([curiosityCheck(engines.cheap, pages), retellCheck(engines.cheap, prose, outline.beats)]);
  return {
    curiosity: cur,
    retell: ret,
    pass: cur.pass && ret.pass,
    rewritePages: cur.dropPages,
    rewriteTurnParagraph: ret.recommendTurnRewrite,
    costUsd: cur.costUsd + ret.costUsd,
  };
}
