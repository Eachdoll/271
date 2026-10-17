import type { TextEngine, GestureDictionary } from '../types.js';
export interface ProseEvalConfig {
    from: string;
    out: string;
    runId: string;
    pageCount: number;
    generator?: TextEngine;
    cheap?: TextEngine;
    mock?: boolean;
    budget?: boolean;
    condense?: boolean;
    limit?: number;
    gestureDict: GestureDictionary;
}
export declare function runProseEvaluation(config: ProseEvalConfig): Promise<{
    pagination: {
        approximate: boolean;
        method: string;
    };
    n: number;
    skipped: number;
    errors: number;
    costUsd: any;
    curiosityPassCount: number;
    retellPassCount: number;
    stage: string;
    mock: boolean;
    budget: boolean;
    condense: boolean;
    pageCount: number;
    generator: string | undefined;
    cheap: string | undefined;
    runId: string;
}>;
