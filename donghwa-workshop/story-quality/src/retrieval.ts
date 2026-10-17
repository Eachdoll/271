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

export function retrieveExamples(records: BookRecord[], q: RetrievalQuery, k = 2): ScoredRecord[] {
  const ex = new Set(q.excludeBookIds ?? []);
  const ranked = records
    .filter((r) => r.approved && !ex.has(r.bookId))
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
export function renderExamplesForPrompt(examples: ScoredRecord[], maxCharsEach = 420): string {
  if (examples.length === 0) return '';
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
