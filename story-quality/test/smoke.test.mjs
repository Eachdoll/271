import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, '..', p), 'utf8'));

const inv = read('data/inventories.json');
const gestures = read('data/gesture_dictionary.json');
const patterns = read('data/plot_patterns.json');

const {
  buildBanList, renderBanListForPrompt, filterBanned,
  retrieveExamples, renderExamplesForPrompt,
  composeSeed, renderSeedForPrompt, preferObstaclesForTopic,
  findEmotionTells, suggestGestures, renderGestureHintForPrompt,
  extractJson, tokenize, jaccard, makeRng, hashString,
  buildOutlinePrompt, roughTokenCount, beatCountForPages,
  plotCheck, mergeRules, fill,
  runOutlineStage, runProseStage, runChildGate,
} = await import('../dist/index.js');

const P = patterns.find((p) => p.id === 'journey_repeat');

function fakeBook(id, topic, planted, creature, patternId, daysAgo, extra = {}) {
  const d = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return {
    bookId: id, topic, patternId, levelKo: 'K1', levelEn: 'E0', approved: true, createdAt: d,
    outline: {
      plan: { pattern: patternId, planted, twistReveal: `${planted}이 노래한다`, funnyMoment: '재채기', failureReasons: ['wrong_place', 'wrong_method', 'interrupted'] },
      titleCandidates: ['a', 'b', 'c'], logline: `유하가 ${topic}을 찾는다`, want: topic, problem: '없다',
      beats: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ index: i, type: i === 1 ? 'setup' : i === 7 ? 'close' : 'attempt', summary: `유하가 ${planted}을 들고 ${i}번째 일을 해요.`, characters: ['유하'], settingKey: i === 1 || i === 7 ? 'home' : 'forest' })),
      newWordsKo: [], newWordsEn: [], endingType: 'home_sleep',
    },
    usedElements: { planted, creatures: [creature], twistTypeId: 'familiar_thing', patternId, places: ['큰 바위 앞'] },
    ...extra,
  };
}

test('data files load and have expected sizes', () => {
  assert.equal(inv.plantedObjects.length, 50);
  assert.equal(inv.obstacleTypes.length, 12);
  assert.equal(inv.twistTypes.length, 8);
  assert.equal(inv.creatures.length, 30);
  assert.equal(inv.humorBeats.length, 15);
  assert.equal(gestures.emotions.length, 12);
  assert.equal(patterns.length, 6);
  for (const e of gestures.emotions) {
    assert.ok(e.gestures_ko.length >= 5 && e.gestures_en.length >= 5, e.id);
  }
});

test('banList: recent books ban planted objects, creatures, patterns (shorter window)', () => {
  const books = [
    fakeBook('b1', '비 오는 날', '빨간 장화', '달팽이', 'journey_repeat', 1),
    fakeBook('b2', '생일', '풍선', '참새', 'accumulate', 2),
    fakeBook('b3', '숨바꼭질', '열쇠', '고양이', 'search_wrong_answers', 3),
    fakeBook('b4', '밤', '손전등', '반딧불이', 'mystery_sound', 4),
  ];
  const ban = buildBanList(books, { recentBooks: 10, recentBooksForPattern: 3 });
  assert.deepEqual(new Set(ban.plantedObjects), new Set(['빨간 장화', '풍선', '열쇠', '손전등']));
  assert.ok(ban.creatures.includes('달팽이'));
  assert.deepEqual(ban.patterns, ['journey_repeat', 'accumulate', 'search_wrong_answers']);
  const txt = renderBanListForPrompt(ban, inv);
  assert.match(txt, /물건: /);
  assert.match(txt, /반전 유형: 정체는 친숙한 물건/);
  const filtered = filterBanned(inv.plantedObjects, ban.plantedObjects);
  assert.equal(filtered.length, 46);
  // 전부 금지되면 원본 반환
  assert.equal(filterBanned(inv.plantedObjects, inv.plantedObjects.map((p) => p.ko)).length, 50);
});

test('retrieval ranks the closest approved outline first and renders with the no-reuse label', () => {
  const books = [
    fakeBook('b1', '비 오는 날 모험', '빨간 장화', '달팽이', 'journey_repeat', 1, { feedback: { rubricTotal: 9 } }),
    fakeBook('b2', '생일 파티', '풍선', '참새', 'accumulate', 2),
    fakeBook('b3', '빗방울과 우산', '노란 우산', '청개구리', 'journey_repeat', 3, { feedback: { difficulty: 'hard' } }),
  ];
  const got = retrieveExamples(books, { topic: '비 오는 날 유치원 가기', patternId: 'journey_repeat', levelKo: 'K1' }, 2);
  assert.equal(got.length, 2);
  assert.equal(got[0].record.bookId, 'b1');
  assert.ok(got.every((g) => g.record.bookId !== 'b2'));
  const txt = renderExamplesForPrompt(got);
  assert.match(txt, /재사용 금지/);
  assert.match(txt, /예시 1/);
  assert.equal(renderExamplesForPrompt([]), '');
});

test('composeSeed is deterministic, respects ban list, picks distinct senses', () => {
  const ban = { plantedObjects: ['빨간 장화'], creatures: ['달팽이'], twistTypes: ['familiar_thing'], patterns: [], places: [] };
  const a = composeSeed({ pattern: P, inventories: inv, backgroundType: 'forest', rngSeed: 42, ban, preferObstacleIds: preferObstaclesForTopic('비 오는 날') });
  const b = composeSeed({ pattern: P, inventories: inv, backgroundType: 'forest', rngSeed: 42, ban, preferObstacleIds: preferObstaclesForTopic('비 오는 날') });
  assert.deepEqual(a, b);
  assert.notEqual(a.planted.ko, '빨간 장화');
  assert.notEqual(a.creature.ko, '달팽이');
  assert.notEqual(a.twist.id, 'familiar_thing');
  assert.equal(a.obstacles.length, 3);
  assert.equal(new Set(a.obstacles.map((o) => o.sense)).size, 3);
  assert.equal(new Set(a.failureReasons).size, 3);
  assert.ok(a.obstacles.some((o) => ['puddle', 'mud', 'stream'].includes(o.id)));
  const c = composeSeed({ pattern: P, inventories: inv, backgroundType: 'forest', rngSeed: 43, ban });
  assert.notDeepEqual(a.planted, c.planted);
  const block = renderSeedForPrompt(a, inv, P);
  assert.match(block, /심을 물건: /);
  assert.match(block, /장애물 순서: 1\)/);
  assert.match(block, /1차 /);
});

test('composeSeed falls back to forest sub-locations for unknown background', () => {
  const s = composeSeed({ pattern: P, inventories: inv, backgroundType: 'moon_base', rngSeed: 7 });
  assert.ok(s.subLocations.length > 0);
});

test('gestures: finds emotion tells and moral tails, renders hints', () => {
  const text = '유하는 무서웠어요. 초록이가 폴짝 뛰었어요. 서로 도우며 함께 있으니 마음이 참 따뜻해요.';
  const hits = findEmotionTells(text, gestures);
  assert.ok(hits.some((h) => h.emotionId === 'fear'));
  assert.ok(hits.some((h) => h.emotionId === 'moral_tail'));
  assert.equal(suggestGestures(gestures, 'fear', 'ko', 2, 1).length, 2);
  const hint = renderGestureHintForPrompt(gestures, ['놀람', 'joy', '편안'], 'ko');
  assert.match(hint, /- 놀람 → /);
  assert.match(hint, /- 기쁨 → /);
  assert.equal(hint.split('\n').length, 3);
});

test('extractJson handles fences, chatter, and nested braces', () => {
  assert.deepEqual(extractJson('물론입니다! ```json\n{"a": {"b": [1,2]}, "s": "}"}\n``` 끝'), { a: { b: [1, 2] }, s: '}' });
  assert.deepEqual(extractJson('[1,2,3] trailing'), [1, 2, 3]);
  assert.equal(extractJson('no json here'), null);
});

test('tokenize/jaccard treat Korean bigrams, rng/hash stable', () => {
  const a = tokenize('비 오는 날의 모험');
  const b = tokenize('비 오는 날 우산 모험');
  assert.ok(jaccard(a, b) > 0.3);
  assert.equal(hashString('book-1'), hashString('book-1'));
  const r1 = makeRng(5), r2 = makeRng(5);
  assert.equal(r1(), r2());
});

test('outline prompt fills every slot, stays under the token budget, substitutes the protagonist name', () => {
  const ban = { plantedObjects: ['풍선'], creatures: [], twistTypes: [], patterns: [], places: [] };
  const seed = composeSeed({ pattern: P, inventories: inv, backgroundType: 'dino_land', rngSeed: 1, ban });
  const prompt = buildOutlinePrompt({
    protagonist: { name: '유하', traits: ['호기심 많음', '씩씩함', '장난꾸러기'], catchphrase: '같이 가자!' },
    supporting: [{ name: '초록이', traits: ['느긋함', '먹보'], role: '공룡 친구' }],
    worldCore: ['소파 뒤 터널이 공룡나라로 열린다', '공룡은 말을 하고 풀만 먹는다', '저녁밥 냄새가 나면 돌아온다'],
    topic: '공룡나라 비 오는 날', levelKo: 'K1', levelEn: 'E0', pages: 12, pattern: P, seed, inventories: inv, ban,
    approvedBooks: [fakeBook('b9', '공룡나라 소풍', '도시락 통', '아기 공룡', 'journey_repeat', 5)], endingType: 'home_sleep',
  });
  assert.doesNotMatch(prompt.user, /\{\{/);
  assert.match(prompt.user, /\[정해진 재료\]/);
  assert.match(prompt.user, /금지: 물건: 풍선/);
  assert.match(prompt.user, /\[참고 예시/);
  assert.match(prompt.user, /"유하" 이름이 비트 summary/);
  assert.match(prompt.user, /✗ 같은 문형 반복: "유하가/);
  assert.equal(beatCountForPages(12), 7);
  const tokens = roughTokenCount(prompt.system + prompt.user);
  assert.ok(tokens < 1800, `too long: ${tokens}`);
});

test('fill removes empty labelled lines', () => {
  const out = fill('[A] {{a}}\n[B] {{b}}\n- c: {{c}}\nend', { a: 'x', b: '', c: null });
  assert.equal(out, '[A] x\nend');
});

test('plotCheck catches planted/recovery, failure reasons, moral tails, missing topic', () => {
  const seed = composeSeed({ pattern: P, inventories: inv, backgroundType: 'forest', rngSeed: 3 });
  const good = {
    plan: { pattern: 'journey_repeat', planted: seed.planted.ko, twistReveal: 'x', funnyMoment: 'y', failureReasons: seed.failureReasons },
    titleCandidates: ['t'], logline: 'l', want: 'w', problem: 'p',
    beats: [
      { index: 1, type: 'setup', summary: `아침, 유하가 ${seed.planted.ko}을 챙겨요. 비가 와요.`, characters: ['유하'], settingKey: 'home', newElement: '우산' },
      { index: 2, type: 'want', summary: `유하는 비 오는 숲의 노래하는 돌을 찾고 싶어요.`, characters: ['유하'], settingKey: 'forest', newElement: '노래하는 돌' },
      { index: 3, type: 'attempt', summary: `유하가 개울에서 돌을 두드려요. 쿵쿵 소리만 나요.`, characters: ['유하'], settingKey: 'stream', newElement: '개울', failureReason: seed.failureReasons[0] },
      { index: 4, type: 'attempt', summary: `초록이가 돌을 뒤집어요. ${seed.creature.ko}만 나와요.`, characters: ['초록이'], settingKey: 'rock', newElement: seed.creature.ko, failureReason: seed.failureReasons[1] },
      { index: 5, type: 'attempt', summary: `유하가 돌에 귀를 대는데 바람이 모자를 날려요.`, characters: ['유하'], settingKey: 'hill', newElement: '모자', failureReason: seed.failureReasons[2] },
      { index: 6, type: 'turn', summary: `바람이 ${seed.planted.ko}에 들어가 노래해요. 유하가 알아차려요.`, characters: ['유하'], settingKey: 'hill', newElement: '바람 소리' },
      { index: 7, type: 'close', summary: `유하가 집으로 돌아와 ${seed.planted.ko}을 침대 옆에 둬요.`, characters: ['유하'], settingKey: 'home', newElement: '침대' },
    ],
    refrain: { text: '후우, 바람이 불어요', usedAtBeats: [3, 5, 6], variation: '세기' },
    newWordsKo: [], newWordsEn: [], endingType: 'home_sleep',
  };
  const ok = plotCheck({ outline: good, topic: '비 오는 날', protagonistName: '유하', seed, inventories: inv });
  assert.deepEqual(ok.fix, [], ok.fix.join(' | '));
  assert.deepEqual(ok.regenerate, []);
  assert.ok(ok.ok);

  const bad = JSON.parse(JSON.stringify(good));
  bad.beats[0].summary = '둘이 숲길을 걸어요. 서로 도우며 함께 있으니 마음이 참 따뜻해요.';
  bad.beats[5].summary = '둘이 웃어요.';
  bad.beats[3].failureReason = bad.beats[2].failureReason;
  const res = plotCheck({ outline: bad, topic: '생일 케이크', protagonistName: '서준', seed, inventories: inv });
  assert.ok(!res.ok);
  assert.ok(res.fix.some((f) => f.includes('비트 1~2에 없음')));
  assert.ok(res.fix.some((f) => f.includes('회수되지 않음')));
  assert.ok(res.fix.some((f) => f.includes('실패 이유가 겹침')));
  assert.ok(res.fix.some((f) => f.includes('교훈 꼬리말')));
  assert.ok(res.regenerate.some((r) => r.includes('주제 키워드')));
  assert.ok(res.regenerate.some((r) => r.includes('"서준"')));
});

test('mergeRules enforces the cap and supports replace', () => {
  const cur = ['r1', 'r2', 'r3'];
  assert.deepEqual(mergeRules(cur, [{ text: 'r2b', replaces: 2 }], 7), ['r1', 'r2b', 'r3']);
  assert.deepEqual(mergeRules(cur, [{ text: 'r4', replaces: null }], 3), ['r2', 'r3', 'r4']);
  assert.deepEqual(mergeRules(cur, [{ text: 'r1', replaces: null }], 7), cur);
});

// ---- 전체 파이프라인을 가짜 엔진으로 끝까지 돌린다 (API 호출 없음) ----
function makeFakeEngine(id) {
  const calls = [];
  const engine = {
    id,
    calls,
    async complete(req) {
      calls.push(req);
      const u = req.user;
      let text;
      if (u.includes('후보를 3개') || u.includes('[이번에 쓸 비트]')) {
        const m = u.match(/\[이번에 쓸 비트\] (\d+) · (\w+)/);
        const idx = m ? m[1] : '1';
        const planted = (u.match(/심을 물건 ([^/\n]+?) \//) ?? [])[1]?.trim() ?? '물건';
        const fr = (u.match(/"failureReason": ("[a-z_]+"|null)/) ?? [])[1] ?? 'null';
        const base = (k) => `유하가 ${planted}을 들고 ${idx}번째 일 ${k}을 해요. 공룡나라에 비가 와요.`;
        text = JSON.stringify({ candidates: ['A', 'B', 'C'].map((k) => ({ summary: base(k), newElement: `요소${idx}${k}`, failureReason: fr === 'null' ? null : JSON.parse(fr) })) });
      } else if (u.includes('[후보]') && u.includes('A:')) {
        text = JSON.stringify({ best: 'B', scores: { A: 5, B: 8, C: 6 }, why: '인과' });
      } else if (u.includes('나머지 필드를 JSON')) {
        text = JSON.stringify({ titleCandidates: ['비 오는 공룡나라', '첨벙 모험', '노란 우산'], logline: '유하가 공룡나라에서 비를 만난다', want: '화산을 보고 싶다', problem: '비가 온다', twistReveal: '물건이 우산이 된다', funnyMoment: '재채기', refrain: { text: '토독토독 비가 와요', usedAtBeats: [3, 5], variation: '소리 크기' }, newWordsKo: ['장화', '웅덩이', '화산'], newWordsEn: ['boots', 'puddle', 'volcano'] });
      } else if (u.includes('[고칠 것')) {
        const j = JSON.parse(u.slice(u.indexOf('{')));
        text = JSON.stringify(j);
      } else if (u.includes('[이야기 쪽별 글]')) {
        const n = (u.match(/^\d+\. /gm) ?? []).length;
        text = JSON.stringify({ pages: Array.from({ length: n }, (_, i) => ({ pageNo: i + 1, score: i === 3 ? 0 : 2, childQuestion: null, why: 'ok' })), dropPages: [4], overall: 8 });
      } else if (u.includes('[원래 줄거리 비트]')) {
        text = JSON.stringify({ retell: ['유하가 갔어요', '소리가 났어요', '집에 왔어요'], coveredBeats: [1, 2, 6, 7], missingCore: [], confusions: [], coherence: 2 });
      } else if (req.system.includes('넉넉하게 쓰는 단계')) {
        text = '[비트 1 · setup] 유하가 노란 우산을 들었어요. "같이 가자!" 토독토독 비가 와요. 누가 올까요?\n\n[비트 2 · want] 유하는 쌍봉 화산을 보고 싶었어요. 초록이가 꼬리를 흔들었어요. 와!';
      } else if (req.system.includes('그림책 편집자다. 아래 글의 사건')) {
        text = u.includes('[고칠 문장') ? '[비트 1 · setup] 유하가 우산을 들어요. 비가 와요.\n\n[비트 2 · want] 유하는 화산을 보고 싶어요. 초록이가 꼬리를 흔들어요.' : '[비트 1 · setup] 유하가 우산을 들어요. 비가 와요. 유하는 무서웠어요.\n\n[비트 2 · want] 유하는 화산을 보고 싶어요.';
      } else {
        // 일반 줄거리 생성 (outline.v3)
        const planted = (u.match(/- 심을 물건: ([^—\n]+)—/) ?? [])[1]?.trim() ?? '물건';
        const reasons = [...u.matchAll(/\d차 ([^,\n]+)/g)].map((m) => m[1].trim());
        const map = { '잘못된 장소': 'wrong_place', '잘못된 방법': 'wrong_method', '거의 됐는데 방해': 'interrupted' };
        const creature = (u.match(/- 배경 생물: ([^(\n]+)\(/) ?? [])[1]?.trim() ?? '생물';
        const beats = [
          { index: 1, type: 'setup', summary: `아침, 유하가 ${planted}을 챙겨요. 공룡나라 비가 와요.`, settingKey: 'home', newElement: '현관' },
          { index: 2, type: 'want', summary: `유하는 쌍봉 화산을 보고 싶어요.`, settingKey: 'dino', newElement: '화산' },
          { index: 3, type: 'attempt', summary: `유하가 호수 쪽으로 가요. 물웅덩이뿐이에요.`, settingKey: 'lake', newElement: '웅덩이', failureReason: map[reasons[0]] },
          { index: 4, type: 'attempt', summary: `초록이가 고사리를 밀어요. ${creature}만 나와요.`, settingKey: 'fern', newElement: creature, failureReason: map[reasons[1]] },
          { index: 5, type: 'attempt', summary: `유하가 언덕에 오르는데 바람이 모자를 날려요.`, settingKey: 'hill', newElement: '모자', failureReason: map[reasons[2]] },
          { index: 6, type: 'turn', summary: `${planted}이 바람에 노래해요. 유하가 알아차려요.`, settingKey: 'hill', newElement: '노래' },
          { index: 7, type: 'close', summary: `유하가 집에 와서 ${planted}을 침대 옆에 둬요.`, settingKey: 'home', newElement: '침대' },
        ].map((b) => ({ characters: ['유하'], ...b }));
        text = JSON.stringify({ plan: { pattern: 'journey_repeat', planted, twistReveal: 'x', funnyMoment: 'y', failureReasons: reasons.map((r) => map[r]) }, titleCandidates: ['a', 'b', 'c'], logline: 'l', want: 'w', problem: 'p', beats, refrain: { text: '토독토독', usedAtBeats: [3, 5], variation: '크기' }, newWordsKo: ['장화'], newWordsEn: ['boots'], endingType: 'home_sleep' });
      }
      return { text, usage: { input: 100, output: 100 }, costUsd: 0.001 };
    },
  };
  return engine;
}

const baseInput = (engines, useBeam) => ({
  engines, bookId: 'book-77', useBeamSearch: useBeam,
  protagonist: { name: '유하', traits: ['호기심 많음', '씩씩함'], catchphrase: '같이 가자!' },
  supporting: [{ name: '초록이', traits: ['느긋함'], role: '공룡 친구' }],
  worldCore: ['소파 뒤 터널이 공룡나라로 열린다', '공룡은 말을 한다', '저녁밥 냄새가 나면 돌아온다'],
  topic: '공룡나라 비 오는 날', levelKo: 'K1', levelEn: 'E0', pages: 12, pattern: P, backgroundType: 'dino_land',
  inventories: inv, approvedBooks: [fakeBook('b1', '공룡나라 소풍', '도시락 통', '아기 공룡', 'accumulate', 2)], endingType: 'home_sleep',
});

test('pipeline (single-shot outline) runs end to end with a fake engine and passes plotCheck', async () => {
  const outline = makeFakeEngine('outline'), prose = makeFakeEngine('prose'), cheap = makeFakeEngine('cheap');
  const res = await runOutlineStage(baseInput({ outline, prose, cheap }, false));
  assert.equal(res.outline.beats.length, 7);
  assert.deepEqual(res.check.regenerate, [], res.check.regenerate.join(' | '));
  assert.deepEqual(res.check.fix, [], res.check.fix.join(' | '));
  assert.ok(res.check.ok);
  assert.equal(outline.calls.length, 1);
  assert.match(outline.calls[0].user, /\[정해진 재료\]/);
  assert.match(outline.calls[0].user, /금지: 물건: 도시락 통/);
  assert.ok(res.costUsd > 0);
});

test('pipeline (beam search) chooses judged candidates and fills the rest with the cheap engine', async () => {
  const outline = makeFakeEngine('outline'), prose = makeFakeEngine('prose'), cheap = makeFakeEngine('cheap');
  const res = await runOutlineStage(baseInput({ outline, prose, cheap }, true));
  assert.equal(res.outline.beats.length, P.beats.length);
  assert.ok(res.outline.beats.every((b) => b.summary.includes(' B을 해요') || b.summary.includes('B을')), 'judge picked B');
  assert.equal(res.outline.titleCandidates.length, 3);
  assert.equal(outline.calls.length, P.beats.length); // 후보 생성
  assert.ok(cheap.calls.length >= P.beats.length + 1); // 심사 + 나머지 필드 (+ 수정)
  assert.equal(res.outline.plan.failureReasons.length, 3);
});

test('prose stage: rich → simplify → tell-fix pass removes emotion tells', async () => {
  const engines = { outline: makeFakeEngine('o'), prose: makeFakeEngine('p'), cheap: makeFakeEngine('c') };
  const levels = read('test/levels.fixture.json');
  const outline = (await runOutlineStage(baseInput(engines, false))).outline;
  const passes = [];
  const r = await runProseStage({
    engines, lang: 'ko', outline, charactersCompact: '유하 / 초록이', briefsCompact: '1 아침 비 / 2 화산', emotions: ['기대', '궁금함'],
    gestureDict: gestures, levels, targetLevelId: 'K1', styleSamples: ['유하가 폴짝 뛰어요. 누가 올까요?'],
  });
  assert.match(r.rich, /\[비트 1 · setup\]/);
  assert.equal(r.tellHitsAfter, 0);
  assert.equal(r.calls, 3); // rich + simplify + fix
  assert.match(engines.prose.calls[0].user, /문체 예시 — 리듬·종결어미·구체성만 참고/);
  assert.match(engines.prose.calls[0].user, /\[이번 글의 수준\] 그림책 5~6세/); // K1 → K2로 풍부하게
  assert.match(engines.cheap.calls[0].user, /\[목표 수준\] 그림책 3~4세/);
});

test('child gate aggregates curiosity + retell', async () => {
  const engines = { outline: makeFakeEngine('o'), prose: makeFakeEngine('p'), cheap: makeFakeEngine('c') };
  const outline = (await runOutlineStage(baseInput(engines, false))).outline;
  const pages = Array.from({ length: 12 }, (_, i) => ({ pageNo: i + 1, text: `쪽 ${i + 1} 글` }));
  const g = await runChildGate(engines, pages, '전문', outline);
  assert.deepEqual(g.rewritePages, [4]);
  assert.equal(g.retell.pass, true);
  assert.equal(g.pass, false); // 4쪽이 0점
  assert.equal(g.rewriteTurnParagraph, false);
});
