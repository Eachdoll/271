/**
 * 승인 줄거리 검색 few-shot — "우리 집에서 통과한 예시"를 새 주제와 가장 비슷한 것 2개 골라 프롬프트에 넣는다.
 * 임베딩 없이 토큰 Jaccard + 패턴·수준 일치로 점수를 낸다. 20편쯤 쌓이면 충분히 잘 맞는다.
 */
import type { BookRecord } from './types.js';
import { jaccard, tokenize } from './util.js';

export interface RetrievalQuery {
  topic: string;
  patternId?: string;
  levelKo?: string;
  /** 같은 시리즈의 직전 편은 '이어 만들기' 맥락에서 따로 들어가므로 제외. */
  excludeBookIds?: string[];
}

export interface ScoredRecord {
  record: BookRecord;
  score: number;
}

/** 2026-10-20 R19: 'arc' renders each example as a story-spine card (stakes, rising tries, low point, turn, payoff). */
export type ExampleStyle = 'arc';

export interface RetrieveOptions {
  /** Keep only records whose rubricTotal is at least this (records without a score, e.g. gold, are kept). */
  minRubric?: number;
}

export function scoreRecord(record: BookRecord, q: RetrievalQuery): number {
  const qt = tokenize(q.topic);
  const rt = tokenize(`${record.topic} ${record.outline.logline} ${record.outline.want}`);
  let s = jaccard(qt, rt); // 0~1
  if (q.patternId && record.patternId === q.patternId) s += 0.3;
  if (q.levelKo && record.levelKo === q.levelKo) s += 0.1;
  const rubric = record.feedback?.rubricTotal;
  if (typeof rubric === 'number') s += Math.max(0, rubric - 7) * 0.05; // 8점 이상이면 가산
  if (record.feedback?.difficulty === 'hard') s -= 0.1;
  if (record.feedback?.regenerated) s -= 0.1;
  return s;
}

export function retrieveExamples(records: BookRecord[], q: RetrievalQuery, k = 2, opts: RetrieveOptions = {}): ScoredRecord[] {
  const ex = new Set(q.excludeBookIds ?? []);
  const min = opts.minRubric;
  const scored = (r: BookRecord): boolean =>
    min === undefined || typeof r.feedback?.rubricTotal !== 'number' || r.feedback.rubricTotal >= min;
  const ranked = records
    .filter((r) => r.approved && !ex.has(r.bookId) && scored(r))
    .map((record) => ({ record, score: scoreRecord(record, q) }))
    .sort((a, b) => b.score - a.score);
  // When opt-in distilled candidates are present, retain a gold anchor first.
  const gold = ranked.find(item => item.record.referenceSource === 'gold');
  return (gold && k > 0 ? [gold, ...ranked.filter(item => item !== gold)] : ranked).slice(0, k);
}

/**
 * 프롬프트용 렌더. 비트는 한 줄 요약(첫 문장)만 넣어 길이를 줄인다.
 * 라벨은 고정: 구조·리듬만 참고, 재사용 금지.
 */
export function renderExamplesForPrompt(examples: ScoredRecord[], maxCharsEach = 420, style?: ExampleStyle): string {
  if (examples.length === 0) return '';
  if (style === 'arc') return renderArcExamples(examples, maxCharsEach);
  const lines: string[] = ['[참고 예시 — 구조·리듬만 참고. 인물·물건·사건·장소 재사용 금지]'];
  examples.forEach(({ record }, i) => {
    const o = record.outline;
    const beats = o.beats
      .map((b) => `${b.index} ${firstSentence(b.summary)}`)
      .join(' · ');
    let block = `예시 ${i + 1} (주제: ${record.topic}, 패턴: ${record.patternId})\n plan: 심은 물건 ${o.plan.planted} / 반전 ${o.plan.twistReveal}\n 비트: ${beats}`;
    if (block.length > maxCharsEach) block = block.slice(0, maxCharsEach - 1) + '…';
    lines.push(block);
  });
  return lines.join('\n');
}

function firstSentence(s: string): string {
  const m = s.match(/^[^.!?。]*[.!?。]?/);
  return (m ? m[0] : s).trim();
}

/**
 * R19 story-spine card: not the beat list but how the example earns its turn —
 * what is at stake, how the tries grow, the low point before the turn, the turn
 * itself in full, and what the reveal overturns. Only the structure is shown;
 * the fixed header forbids reusing its people, things, events and places.
 */
function renderArcExamples(examples: ScoredRecord[], maxCharsEach: number): string {
  const lines: string[] = [
    '[참고 예시 — 뼈대만 참고: 바라는 것이 왜 중요한지, 시도가 어떻게 더 커지는지, 바닥에서 반전이 무엇을 뒤집는지, 끝이 처음을 어떻게 비추는지. 인물·물건·사건·장소 재사용 금지]',
  ];
  examples.forEach(({ record }, i) => {
    const o = record.outline;
    const beats = o.beats ?? [];
    const attempts = beats.filter((b) => b.type === 'attempt');
    const turn = beats.find((b) => b.type === 'turn');
    const tail = beats.filter((b) => b.type === 'resolution' || b.type === 'close');
    const low = attempts[attempts.length - 1];
    const ladder = attempts.map((b) => `${b.index}${b.failureReason ? ` ${b.failureReason}` : ''}: ${firstSentence(b.summary)}`).join(' → ');
    let block = [
      `예시 ${i + 1} (주제: ${record.topic}, 패턴: ${record.patternId})`,
      ` 심은 물건: ${o.plan?.planted ?? ''}`,
      ` 바라는 것: ${o.want} / 걸림돌: ${o.problem}`,
      ladder ? ` 시도 사다리: ${ladder}` : '',
      low ? ` 바닥(마지막 시도 ${low.index}): ${low.summary}` : '',
      turn ? ` 반전(${turn.index}): ${turn.summary}` : '',
      ` 뒤집힌 뜻: ${o.plan?.twistReveal ?? ''}`,
      tail.length ? ` 되돌아옴: ${tail.map((b) => `${b.index} ${firstSentence(b.summary)}`).join(' · ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (block.length > maxCharsEach) block = block.slice(0, maxCharsEach - 1) + '…';
    lines.push(block);
  });
  return lines.join('\n');
}
