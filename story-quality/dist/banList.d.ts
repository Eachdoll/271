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
/** 프롬프트의 [이번에 쓰지 않는 것] 한 줄. 비어 있으면 빈 문자열(코드가 줄을 지운다). */
export declare function renderBanListForPrompt(ban: BanList, inventories?: Inventories): string;
/** 인벤토리에서 금지 항목을 뺀다. 다 빠지면(금지가 전부면) 원본을 돌려줘 생성이 멈추지 않게 한다. */
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
