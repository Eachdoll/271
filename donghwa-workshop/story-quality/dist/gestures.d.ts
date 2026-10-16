/**
 * 몸짓 사전(show-don't-tell) — 감정 직설어를 찾아내고, 치환 후보를 고르고, 프롬프트 힌트를 만든다.
 * 모델이 지어내지 않고 사전에서 고르게 하면 작은 모델도 품질이 안정된다.
 */
import type { GestureDictionary, GestureEntry } from './types.js';
export interface TellHit {
    emotionId: string;
    emotionKo: string;
    match: string;
    sentence: string;
}
/** 글에서 감정 직설어를 찾는다. 금지 꼬리말(moral_tails_ko)도 함께 잡는다. */
export declare function findEmotionTells(text: string, dict: GestureDictionary): TellHit[];
export declare function findEntry(dict: GestureDictionary, emotionIdOrKo: string): GestureEntry | undefined;
/** 감정 하나에 대한 몸짓 후보 n개 (시드 고정 가능). */
export declare function suggestGestures(dict: GestureDictionary, emotionIdOrKo: string, lang?: 'ko' | 'en', n?: number, seed?: number): string[];
/**
 * 프롬프트의 [몸짓 사전] 블록. 브리프에 나온 감정들만 넣어 길이를 줄인다.
 * 주인공 이름을 넘기면 "초록이 꼬리" 같은 고정 표현을 그대로 두고, 이름 치환은 모델에게 맡긴다.
 */
export declare function renderGestureHintForPrompt(dict: GestureDictionary, emotions: string[], lang?: 'ko' | 'en', perEmotion?: number, seed?: number): string;
/** 직설어가 들어간 문장을 재작성 지시문으로 바꾼다 (풍부화 재실행에 넣을 문구). */
export declare function renderTellFixInstructions(hits: TellHit[], dict: GestureDictionary, seed?: number): string;
