import type { PlotPatternCard } from "./types.js";
export declare const BEAT_COUNTS: Readonly<Record<number, number>>;
export declare function beatCountFor(pageCount: number, koreanLevel: string): number;
/** Same allocation as the app: setup/want, attempts, turn/resolution/close. */
export declare function adaptPatternForBook(pattern: PlotPatternCard, pageCount: number, koreanLevel: string): PlotPatternCard;
