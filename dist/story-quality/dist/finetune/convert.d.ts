import type { BookRecord, Inventories, PlotPatternCard } from '../types.js';
import type { WorldLibrary } from '../worlds.js';
import type { DistillSample } from '../distill/generate.js';
import { type Character } from '../outlinePrompt.js';
export type FtFormat = 'mlx' | 'completions' | 'openai';
export interface FtExample {
    system: string;
    user: string;
    assistant: string;
    meta: {
        id: string;
        topicId: string;
        patternId: string;
        worldId: string;
        levelKo: string;
        source: 'distill' | 'gold';
    };
}
export interface ConvertOptions {
    samples: DistillSample[];
    gold?: BookRecord[];
    patterns: PlotPatternCard[];
    worlds: WorldLibrary;
    inventories: Inventories;
    protagonist: Character;
    supporting: Character[];
    pages?: number;
    validRatio?: number;
    seed?: number;
    /** 정답 JSON을 예쁘게(indent) 저장할지. 모델이 생성할 때도 같은 형태가 나온다. 기본 false(한 줄) */
    prettyJson?: boolean;
}
export interface ConvertResult {
    train: FtExample[];
    valid: FtExample[];
    stats: {
        total: number;
        fromDistill: number;
        fromGold: number;
        byPattern: Record<string, number>;
        byEra: Record<string, number>;
        avgAssistantChars: number;
    };
}
export declare function buildExamples(opts: ConvertOptions): ConvertResult;
export declare function toLine(e: FtExample, format: FtFormat): string;
export declare function writeDataset(outDir: string, result: ConvertResult, format: FtFormat): {
    trainPath: string;
    validPath: string;
    testPath: string;
};
