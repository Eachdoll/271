import type { BookRecord, Inventories, PlotPatternCard, StoryOutline, TextEngine } from '../types.js';
import type { WorldLibrary } from '../worlds.js';
import { type Character } from '../outlinePrompt.js';
import { type RubricResult } from './rubricJudge.js';
export interface EvalTopic {
    id: string;
    topic: string;
    worldId: string;
    patternId: string;
    levelKo: string;
    levelEn: string;
}
export interface EvalConfig {
    runId: string;
    generator: TextEngine;
    judge: TextEngine;
    fixer?: TextEngine;
    topics: EvalTopic[];
    pages: number;
    patterns: PlotPatternCard[];
    worlds: WorldLibrary;
    inventories: Inventories;
    protagonist: Character;
    supporting: Character[];
    approvedBooks: BookRecord[];
    outDir: string;
    options?: {
        useBeamSearch?: boolean;
        useFixPass?: boolean;
        exampleCount?: number;
        rules?: string[];
        banExamples?: string[];
        notes?: string;
    };
    onResult?: (r: EvalRow) => void;
}
export interface EvalRow {
    runId: string;
    topicId: string;
    topic: string;
    worldId: string;
    patternId: string;
    outline: StoryOutline | null;
    plotOk: boolean;
    plotIssues: number;
    rubric: RubricResult['scores'] | null;
    rubricTotal: number;
    rubricPass: boolean;
    fixed: boolean;
    latencyMs: number;
    costUsd: number;
    error?: string;
}
export interface EvalSummary {
    runId: string;
    generatorId: string;
    judgeId: string;
    n: number;
    errors: number;
    plotPassRate: number;
    rubricPassRate: number;
    rubricMean: number;
    rubricByItem: Record<string, number>;
    byPattern: Record<string, {
        n: number;
        rubricMean: number;
        plotPassRate: number;
    }>;
    byEra: Record<string, {
        n: number;
        rubricMean: number;
    }>;
    costUsd: number;
    costPerBook: number;
    latencyMsMedian: number;
    options: EvalConfig['options'];
    createdAt: string;
}
export declare function runEval(cfg: EvalConfig): Promise<EvalSummary>;
export declare function summarize(cfg: Pick<EvalConfig, 'runId' | 'generator' | 'judge' | 'options' | 'worlds'>, rows: EvalRow[]): EvalSummary;
/** 여러 run의 summary를 한 표로. 기준 run 대비 차이를 함께 낸다. */
export declare function compareSummaries(summaries: EvalSummary[], baselineRunId?: string): string;
/** 판정기 캘리브레이션: 골드는 ≥8, 나쁜 예시는 ≤ expectedRubricMax. 통과 못 하면 판정기 모델/프롬프트를 믿지 않는다. */
export declare function calibrateJudge(judge: TextEngine, gold: BookRecord[], bad: {
    bookId: string;
    expectedRubricMax: number;
    outline: StoryOutline;
}[]): Promise<{
    ok: boolean;
    goldMean: number;
    badMean: number;
    separation: number;
    goldFail: string[];
    badFail: string[];
    costUsd: number;
}>;
