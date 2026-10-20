/**
 * 풍부하게 쓰고 단순화 — 전문을 처음부터 K1으로 쓰지 않고 한 단계 위(K2~K3)로 넉넉히 쓴 뒤,
 * 보급형 모델에게 목표 수준으로 줄이게 한다. 작은 모델은 "단순하게 창작"보다 "있는 글을 단순화"를 훨씬 잘한다.
 */
import type {
  GestureDictionary,
  LevelSpecEn,
  LevelSpecKo,
  TextEngine,
} from "./types.js";
import {
  PROSE_CONDENSE_SYSTEM,
  PROSE_CONDENSE_USER,
  PROSE_RICH_SYSTEM,
  PROSE_RICH_USER_EN,
  PROSE_RICH_USER_EN_R8,
  PROSE_RICH_USER_KO,
  PROSE_RICH_USER_KO_R8,
  PROSE_SIMPLIFY_SYSTEM,
  PROSE_SIMPLIFY_USER_EN,
  PROSE_SIMPLIFY_USER_KO,
  fill,
} from "./prompts.js";
import { splitSentences } from "./util.js";
import {
  findEmotionTells,
  renderGestureHintForPrompt,
  renderTellFixInstructions,
} from "./gestures.js";

export type Lang = "ko" | "en";

export interface RichSimplifyInput {
  engine: TextEngine; // 1패스(풍부) 엔진 — 보급형(중)이면 충분
  simplifyEngine?: TextEngine; // 2패스 — 더 싼 엔진 가능
  lang: Lang;
  charactersCompact: string;
  beatsCompact: string; // "1 [setup] … \n2 [want] …"
  briefsCompact: string; // 비트별 브리프 한 줄 요약
  emotions: string[]; // 브리프 감정(한글 또는 id)
  gestureDict: GestureDictionary;
  targetLevel: LevelSpecKo | LevelSpecEn;
  richLevel: LevelSpecKo | LevelSpecEn; // 한 단계 위
  refrainText?: string;
  refrainBeats?: number[];
  styleSamples?: string[]; // 문체 샘플 2~3개
  vocabLabel?: string;
  decodable?: boolean; // E1
  presentTenseOnly?: boolean; // E0
  twoPass?: boolean;
  /** 책 쪽 수. 주어지면 단순화 단계에 전체 문장 수 예산(쪽 수 × 목표 수준의 쪽당 문장)을 건다. */
  pageCount?: number;
  /** 예산을 20% 넘으면 비트별 압축 1회(호출자가 선택). 앱 r8은 새 K1/E0 초안에서 언어별 기본 켬. */
  condenseOverBudget?: boolean;
  /** true면 규칙 9(말버릇 한도)가 없는 r8 문안. 말버릇 정책 없이 고정된 앱의 기존 초안용. */
  legacyCatchphrasePrompt?: boolean;
  /** R19: '[반드시 지킬 것]'에 덧붙이는 줄(뼈대 보존). 단순화·고침·압축 세 호출 모두에 들어간다. 없으면 문안 그대로. */
  keepLines?: string;
  onPass?: (
    pass: "rich" | "simplify" | "fix" | "condense",
    text: string,
  ) => void;
}

export interface RichSimplifyResult {
  rich: string;
  simplified: string;
  tellHitsAfter: number;
  /** 예산이 있을 때 최종 문장 수와 압축 단계 실행 여부 */
  sentenceCount?: number;
  condensed?: boolean;
  calls: number;
  costUsd: number;
}

/** 한 단계 위 수준 라벨: K1→K2, K2→K3, K3→K4 / E0→E2, E1→E2, E2→E3, E3→E4 */
export const RICH_LEVEL_OF: Record<string, string> = {
  K1: "K2",
  K2: "K3",
  K3: "K4",
  K4: "K4",
  E0: "E2",
  E1: "E2",
  E2: "E3",
  E3: "E4",
  E4: "E4",
};

export async function writeRichThenSimplify(
  input: RichSimplifyInput,
): Promise<RichSimplifyResult> {
  const simplifier = input.simplifyEngine ?? input.engine;
  let calls = 0;
  let cost = 0;
  const isKo = input.lang === "ko";
  const tenseRule =
    !isKo && input.presentTenseOnly
      ? "Use says, not said. Use present tense for every narration sentence."
      : "";
  const refrainText = input.refrainText
    ? `"${input.refrainText}"`
    : isKo
      ? "(없음)"
      : "(none)";
  const refrainBeats =
    (input.refrainBeats ?? []).join(", ") || (isKo ? "없음" : "none");
  const styleLabel = isKo
    ? "[문체 예시 — 리듬·종결어미·구체성만 참고. 내용·인물·사건·소품 재사용 금지]"
    : "[Style samples — borrow only rhythm, sentence endings and concreteness. Do not reuse content, characters, events or props]";
  const styleSamples = input.styleSamples?.length
    ? [styleLabel, ...input.styleSamples.slice(0, 3).map((s) => `- ${s}`)].join(
        "\n",
      )
    : "";
  const gestureHints = renderGestureHintForPrompt(
    input.gestureDict,
    input.emotions,
    input.lang,
  );

  // 1패스: 풍부하게
  const richTemplate = input.legacyCatchphrasePrompt
    ? isKo
      ? PROSE_RICH_USER_KO_R8
      : PROSE_RICH_USER_EN_R8
    : isKo
      ? PROSE_RICH_USER_KO
      : PROSE_RICH_USER_EN;
  const richUser = fill(richTemplate, {
    characters: input.charactersCompact,
    beats: input.beatsCompact,
    briefs: input.briefsCompact,
    richLevelLabel: input.richLevel.label,
    richEojeolRange: rangeOf(input.richLevel, "ko"),
    richWordsRange: rangeOf(input.richLevel, "en"),
    richSentencesRange: `${input.richLevel.sentencesPerPage[0] + 1}~${input.richLevel.sentencesPerPage[1] + 2}`,
    gestureHints,
    styleSamples,
    refrainText,
    refrainBeats,
  });
  const r1 = await input.engine.complete({
    system: PROSE_RICH_SYSTEM,
    user: richUser,
    temperature: 0.8,
    maxTokens: 2000,
  });
  calls++;
  cost += r1.costUsd ?? 0;
  const rich = r1.text.trim();
  input.onPass?.("rich", rich);
  let simplified = rich;
  let hits = isKo ? findEmotionTells(simplified, input.gestureDict) : [];

  // 2패스: 목표 수준으로
  const budget = sentenceBudget(input.targetLevel, input.pageCount);
  const richDialogue = countDialogue(rich);
  // 예산이 있으면 대화 하한도 분량에 맞춘다(전체 문장의 1/4 이하, 최소 3).
  const dialogueCount = budget
    ? Math.max(
        Math.min(3, Math.max(2, richDialogue)),
        Math.min(richDialogue, Math.floor(budget.max / 4)),
      )
    : Math.max(2, richDialogue);
  const lengthBudget = renderLengthBudget(budget, input.pageCount, isKo);
  const onoCount = Math.max(2, Math.min(4, Math.round(dialogueCount * 0.8)));
  if (input.twoPass !== false) {
    const simpUser = fill(
      isKo ? PROSE_SIMPLIFY_USER_KO : PROSE_SIMPLIFY_USER_EN,
      {
        tenseRule,
        targetLevelLabel: input.targetLevel.label,
        targetEojeolRange: rangeOf(input.targetLevel, "ko"),
        targetWordsRange: rangeOf(input.targetLevel, "en"),
        targetSentencesRange: `${input.targetLevel.sentencesPerPage[0]}~${input.targetLevel.sentencesPerPage[1] + 1}`,
        vocabLabel:
          input.vocabLabel ?? (isKo ? "기초 어휘" : "basic word list"),
        dialogueCount,
        onomatopoeiaCount: onoCount,
        refrainText,
        refrainBeats,
        decodableRule: input.decodable
          ? "- Prefer CVC words (cat, sun, big) and the sight-word list."
          : "",
        extraFixes: input.keepLines ?? "",
        lengthBudget,
        richText: rich,
      },
    );
    const r2 = await simplifier.complete({
      system: PROSE_SIMPLIFY_SYSTEM,
      user: simpUser,
      temperature: 0.4,
      maxTokens: 4000,
    });
    calls++;
    cost += r2.costUsd ?? 0;
    simplified = r2.text.trim();
    input.onPass?.("simplify", simplified);

    // 직설어가 남았으면 그 문장만 고치는 1회 재실행 (한글만 — 영어는 라벨 검사 생략)
    let hits = isKo ? findEmotionTells(simplified, input.gestureDict) : [];
    if (hits.length > 0) {
      const fixUser = fill(
        isKo ? PROSE_SIMPLIFY_USER_KO : PROSE_SIMPLIFY_USER_EN,
        {
          tenseRule,
          targetLevelLabel: input.targetLevel.label,
          targetEojeolRange: rangeOf(input.targetLevel, "ko"),
          targetWordsRange: rangeOf(input.targetLevel, "en"),
          targetSentencesRange: `${input.targetLevel.sentencesPerPage[0]}~${input.targetLevel.sentencesPerPage[1] + 1}`,
          vocabLabel: input.vocabLabel ?? "기초 어휘",
          dialogueCount,
          onomatopoeiaCount: onoCount,
          refrainText,
          refrainBeats,
          decodableRule: "",
          extraFixes: [input.keepLines, renderTellFixInstructions(hits, input.gestureDict)].filter(Boolean).join("\n"),
          lengthBudget,
          richText: simplified,
        },
      );
      const r3 = await simplifier.complete({
        system: PROSE_SIMPLIFY_SYSTEM,
        user: fixUser,
        temperature: 0.3,
        maxTokens: 4000,
      });
      calls++;
      cost += r3.costUsd ?? 0;
      simplified = r3.text.trim();
      input.onPass?.("fix", simplified);
      hits = findEmotionTells(simplified, input.gestureDict);
    }
  }

  // 분량 예산을 크게 넘으면(20% 초과) 비트별 목표 문장 수를 알려 주는 압축 1회. 작은 모델은 전체 예산보다 비트별 숫자를 더 잘 지킨다.
  let condensed = false;
  let sentenceCount = budget ? countSentences(simplified) : undefined;
  if (
    input.condenseOverBudget &&
    budget &&
    sentenceCount !== undefined &&
    sentenceCount > Math.ceil(budget.max * 1.2)
  ) {
    const paras = beatParagraphs(simplified);
    const per = allocateBeats(
      paras.map((p) => p.count),
      budget.max,
    );
    const perBeat = paras
      .map((p, i) => `${p.label}: 지금 ${p.count}문장 → ${per[i]}문장 이하`)
      .join("\n");
    const r4 = await simplifier.complete({
      system: [PROSE_CONDENSE_SYSTEM, tenseRule, input.keepLines].filter(Boolean).join("\n"),
      user: fill(PROSE_CONDENSE_USER, {
        budgetMin: budget.min,
        budgetMax: budget.max,
        currentCount: sentenceCount,
        perBeat,
        refrainText,
        refrainBeats,
        dialogueMin: Math.min(
          dialogueCount,
          Math.max(3, Math.floor(budget.max / 4)),
        ),
        text: simplified,
      }),
      temperature: 0.3,
      maxTokens: 4000,
    });
    calls++;
    cost += r4.costUsd ?? 0;
    const next = r4.text.trim();
    // 라벨이 사라지거나 비트 수가 줄면 압축 결과를 버린다.
    if (next && beatParagraphs(next).length === paras.length) {
      simplified = next;
      condensed = true;
      input.onPass?.("condense", simplified);
      sentenceCount = countSentences(simplified);
      if (isKo) hits = findEmotionTells(simplified, input.gestureDict);
    }
  }

  return {
    rich,
    simplified,
    tellHitsAfter: hits.length,
    ...(budget ? { sentenceCount, condensed } : {}),
    calls,
    costUsd: cost,
  };
}

/** 라벨을 뺀 문장 수. 따옴표 대화도 한 문장으로 센다. */
export function countSentences(text: string): number {
  return splitSentences(text).length;
}

function beatParagraphs(text: string): { label: string; count: number }[] {
  const parts = text.split(/^\s*(\[(?:비트|Beat)\s+\d+[^\]\n]*\])/gimu);
  const out: { label: string; count: number }[] = [];
  for (let i = 1; i < parts.length; i += 2)
    out.push({ label: parts[i], count: countSentences(parts[i + 1] ?? "") });
  return out;
}

/** 전체 예산을 비트별로 나눈다: 지금 길이에 비례하되 비트마다 최소 1문장. */
function allocateBeats(counts: number[], max: number): number[] {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const raw = counts.map((c) => Math.max(1, Math.floor((c / total) * max)));
  let over = raw.reduce((a, b) => a + b, 0) - max;
  for (let i = raw.length - 1; over > 0 && i >= 0; i--)
    while (over > 0 && raw[i] > 1) {
      raw[i]--;
      over--;
    }
  return raw;
}

/** 전체 문장 예산: 쪽 수 × 쪽당 문장 범위. 쪽 수가 없으면 null(기존 동작). */
export function sentenceBudget(
  level: LevelSpecKo | LevelSpecEn,
  pageCount?: number,
): { min: number; max: number } | null {
  const pages = Number(pageCount);
  if (!Number.isInteger(pages) || pages < 1) return null;
  const [lo, hi] = level.sentencesPerPage;
  return { min: lo * pages, max: hi * pages };
}

function renderLengthBudget(
  budget: { min: number; max: number } | null,
  pageCount: number | undefined,
  isKo: boolean,
): string {
  if (!budget) return "";
  return isKo
    ? `[전체 분량] ${pageCount}쪽 그림책 → 전체 ${budget.min}~${budget.max}문장(대화 문장 포함). 이 범위를 반드시 지킨다. 비트마다 문장 수를 나눠 맞춘다.`
    : `[Total length] ${pageCount}-page picture book → ${budget.min}-${budget.max} sentences in total, dialogue included. Stay inside this range; spread it across the beats.`;
}

function rangeOf(level: LevelSpecKo | LevelSpecEn, lang: Lang): string {
  const r =
    lang === "ko"
      ? (level as LevelSpecKo).eojeolPerSentence
      : (level as LevelSpecEn).wordsPerSentence;
  return r ? `${r[0]}~${r[1]}` : "";
}

export function countDialogue(text: string): number {
  const m = text.match(/[“"][^”"]{1,60}[”"]/g);
  return m ? m.length : 0;
}
