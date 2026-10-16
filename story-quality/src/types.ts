/**
 * 공통 타입. 지시서 2·4의 인터페이스와 호환되도록 최소한만 정의한다.
 * 앱에 이미 같은 이름의 타입이 있으면 그쪽을 쓰고 이 파일은 지워도 된다.
 */

export type Bi = { ko: string; en: string };

export interface CompleteRequest {
  system: string;
  user: string;
  jsonSchema?: object;
  temperature: number;
  maxTokens: number;
}

export interface CompleteResult {
  text: string;
  json?: unknown;
  usage: { input: number; output: number };
  costUsd?: number;
}

/** 지시서 2의 TextEngine과 동일 시그니처. 앱의 어댑터를 그대로 넘기면 된다. */
export interface TextEngine {
  id: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

export type BeatType = 'setup' | 'want' | 'attempt' | 'turn' | 'resolution' | 'close';
export type FailureReason = 'wrong_place' | 'wrong_method' | 'interrupted';

export interface Beat {
  index: number;
  type: BeatType;
  summary: string;
  characters: string[];
  settingKey: string;
  newElement?: string;
  failureReason?: FailureReason | null;
}

export interface OutlinePlan {
  pattern: string;
  planted: string;
  twistReveal: string;
  funnyMoment: string;
  failureReasons: FailureReason[];
}

export interface StoryOutline {
  plan: OutlinePlan;
  titleCandidates: string[];
  logline: string;
  want: string;
  problem: string;
  beats: Beat[];
  refrain?: { text: string; usedAtBeats: number[]; variation?: string };
  newWordsKo: string[];
  newWordsEn: string[];
  endingType: 'home_sleep' | 'open';
}

/** 승인된 책 1권의 기록. 검색 few-shot과 금지 목록의 재료. */
export interface BookRecord {
  bookId: string;
  seriesId?: string;
  topic: string;
  patternId: string;
  levelKo: string;
  levelEn: string;
  outline: StoryOutline;
  approved: boolean;
  createdAt: string; // ISO
  /** 승인 시점에 앱이 채운다. 금지 목록 계산용. */
  usedElements: {
    planted: string;
    creatures: string[];
    twistTypeId?: string;
    patternId: string;
    places: string[];
  };
  /** 부모 피드백 */
  feedback?: { difficulty?: 'easy' | 'fit' | 'hard'; regenerated?: boolean; rubricTotal?: number };
}

export interface PlotPatternCard {
  id: string;
  name: string;
  bestFor: string[];
  emotions: string[];
  beats: { type: BeatType; slot: string }[];
  refrain: { type: 'frame' | 'question' | 'count' | 'none'; hint: string };
  pageTurn: string;
  avoid: string;
}

export interface Inventories {
  plantedObjects: Bi[];
  obstacleTypes: { id: string; ko: string; en: string; sense: string; sound: string }[];
  twistTypes: { id: string; ko: string; en: string; hint: string }[];
  creatures: Bi[];
  subLocations: Record<string, Bi[]>;
  humorBeats: Bi[];
  failureReasons: { id: FailureReason; ko: string; hint: string }[];
  forbiddenKeywords: string[];
}

export interface GestureEntry {
  id: string;
  ko: string;
  tells: string[];
  gestures_ko: string[];
  gestures_en: string[];
}

export interface GestureDictionary {
  emotions: GestureEntry[];
  moral_tails_ko: string[];
}

export interface LevelSpecKo {
  label: string;
  sentencesPerPage: [number, number];
  eojeolPerSentence: [number, number];
  vocabGrade?: number;
}

export interface LevelSpecEn {
  label: string;
  sentencesPerPage: [number, number];
  wordsPerSentence: [number, number];
  vocab?: string;
  decodable?: boolean;
}
