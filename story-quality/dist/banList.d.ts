/**
 * 책 간 금지 목록 — "같은 말 반복"은 한 권 안에서만이 아니라 권과 권 사이에서도 생긴다.
 * 최근 N권에서 쓴 심은 물건·생물·반전 유형·패턴·장소를 모아 다음 생성에서 피하게 한다.
 */
import type { BookRecord, Inventories } from './types.js';
export interface BanList {
    plantedObjects: string[];
    creatures: string[];
    twistTypes: string[];
    patterns: string[];
    places: string[];
}
export interface BanListOptions {
    /** 최근 몇 권을 볼지. 기본 10. */
    recentBooks?: number;
    /** 패턴은 더 짧은 창으로 본다(6개뿐이라 10권 금지면 남는 게 없다). 기본 3. */
    recentBooksForPattern?: number;
    /** 같은 시리즈 책만 볼지(기본 false = 전체). */
    sameSeriesOnly?: string;
}
export declare function buildBanList(records: BookRecord[], opts?: BanListOptions): BanList;
/**
 * 프롬프트의 [이번에 쓰지 않는 것] 한 줄. 비어 있으면 빈 문자열(코드가 줄을 지운다).
 * 조합 재료(seed)가 이미 금지 항목을 피해 뽑히므로, 프롬프트에는 짧은 상기용으로만 넣는다(기본 물건 6·생물 5·반전 3, 장소는 생략).
 */
export declare function renderBanListForPrompt(ban: BanList, inventories?: Inventories, max?: {
    planted: number;
    creatures: number;
    twists: number;
    places: number;
}): string;
export declare function headNoun(ko: string): string;
/** 두 글자 이상 머리 명사를 조사와 함께 찾되 긴 고유명사의 일부는 잡지 않는다. */
export declare function containsMaterial(text: string, material: string): boolean;
/** 금지 목록과 같은 항목 또는 같은 머리 명사("빨간 우산"이 금지면 "우산"·"파란 우산"도)를 뺀다. 전부 빠지면 원본을 돌려준다. */
export declare function filterBanned<T extends {
    ko: string;
}>(items: readonly T[], banned: readonly string[]): T[];
export declare function filterBannedById<T extends {
    id: string;
}>(items: readonly T[], bannedIds: readonly string[]): T[];
/** 생성 결과가 금지 목록을 어겼는지 (사후 검사). */
export declare function violatesBanList(outline: {
    plan: {
        planted: string;
    };
    beats: {
        summary: string;
    }[];
}, ban: BanList): string[];
