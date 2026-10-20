import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COUNCIL_ROLES, COUNCIL_AVATAR_SHEET, councilAvatar, councilRole} from '../dist/story-generation/council-avatars.js';
import {COUNCIL_PHASES, liveCouncilRecord, emptyCouncilRecord, seatLine, renderCouncilRoom, councilRoomBlock, reviewPending, renderCouncilReviewForm, readCouncilChoice, readCouncilDirection} from '../dist/story-generation/council-room.js';

/**
 * 2026-10-20 R21 회의실: five original watercolor avatars ship in a bundled sheet, and the
 * room is drawn from the meeting record (live from the checkpoint, later from
 * the outline), one seat per role with what it said so far.
 */
const pitch = (title, planted = '작은 종') => ({title, logline: `유하가 ${planted} 소리를 따라가요`, stakes: '저녁 노래를 못 불러요', planted: {name: planted, nameEn: 'a small bell', firstSeen: '가방 고리'}, ladder: ['꿀길', '풍차'], lowPoint: '"그냥 집에 갈까"', turn: {seen: '돌 틈의 작은 종', realized: '"내 종이잖아!"', overturns: '남의 종이 아니었다'}, payoff: '종을 울려요', echo: '머리맡의 종'});
const record = (phase, extra = {}) => ({phase, direction: '5~6세 독자가 절정에서 공감', reader: {age: '5~6세'}, pitches: [pitch('따르릉'), pitch('빨간 장화의 종', '빨간 장화'), pitch('노란 우산', '노란 우산')], scores: [], verdicts: null, chosen: null, bible: null, decisions: [], roles: {chair: 'waiting', author: 'done', editor: 'speaking', art: 'speaking', reader: 'speaking'}, ...extra});

test('watercolor avatars preserve accessible role labels and use one bundled offline sheet', () => {
  assert.deepEqual(COUNCIL_ROLES.map(r => r.id), ['chair', 'author', 'editor', 'art', 'reader']);
  const frames = new Set();
  for (const role of COUNCIL_ROLES) {
    const svg = councilAvatar(role.id);
    assert.match(svg, /^<svg class="council-avatar" viewBox="0 0 120 120" role="img" aria-label="/u);
    assert.match(svg, new RegExp(`aria-label="${role.name}"`, 'u'));
    assert.ok(svg.includes(`href="${COUNCIL_AVATAR_SHEET}"`));
    assert.doesNotMatch(svg, /href="https?:|data:image|<script|onload=/u);
    frames.add(svg.match(/ x="(-?\d+)" y="(-?\d+)"/u).slice(1).join(','));
  }
  assert.equal(frames.size, 5, 'each role uses a distinct portrait');
  const asset = fs.readFileSync(new URL('../dist/assets/council/watercolor-portraits.webp', import.meta.url));
  assert.equal(asset.toString('ascii', 0, 4), 'RIFF');
  assert.equal(asset.toString('ascii', 8, 12), 'WEBP');
  assert.ok(asset.length < 512 * 1024, 'the five portraits share an asset smaller than 512 KiB');
  const worker = fs.readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.ok(worker.includes(`"${COUNCIL_AVATAR_SHEET}"`), 'avatars remain available offline');
  assert.equal(councilAvatar('nobody'), '');
  assert.equal(councilAvatar('__proto__'), '');
  assert.equal(councilRole('reader').title, '소리로만 듣는 아이');
});

test('the record to draw: the finished outline wins, then the live checkpoint, else nothing', () => {
  assert.equal(liveCouncilRecord({}), null);
  const partial = record('verdicts');
  assert.equal(liveCouncilRecord({councilCheckpoint: {record: partial}}), partial);
  const final = liveCouncilRecord({councilCheckpoint: {record: partial}, outline: {council: {...record('bible'), chosen: 2, scores: [{pitch: 2, editor: 12, art: 8, reader: 4, score: 12, vetoes: []}]}, bible: pitch('빨간 장화의 종')}});
  assert.equal(final.phase, 'done');
  assert.equal(final.roles, null);
  assert.equal(final.bible.title, '빨간 장화의 종');
  assert.deepEqual(emptyCouncilRecord({direction: ' 공감 '}).roles, {chair: 'speaking', author: 'waiting', editor: 'waiting', art: 'waiting', reader: 'waiting'});
  assert.equal(emptyCouncilRecord({direction: ' 공감 '}).direction, '공감');
  // R22: the parent's step sits between the verdicts and the bible (drawn only for a reviewed meeting).
  assert.deepEqual(COUNCIL_PHASES.map(([id]) => id), ['pitches', 'verdicts', 'review', 'bible', 'done']);
});

test('each seat says one line for its moment', () => {
  const empty = emptyCouncilRecord({});
  assert.equal(seatLine(empty, 'chair'), '방향과 조건을 모으고 있어요.');
  assert.equal(seatLine(empty, 'author'), '방향을 기다려요.');
  assert.equal(seatLine(empty, 'reader'), '이불을 안고 기다려요.');
  const pitching = record('pitches', {pitches: [], roles: {chair: 'speaking', author: 'speaking', editor: 'waiting', art: 'waiting', reader: 'waiting'}});
  assert.equal(seatLine(pitching, 'chair'), '방향: 5~6세 독자가 절정에서 공감');
  assert.equal(seatLine(pitching, 'author'), '피치 세 개를 쓰고 있어요.');
  assert.equal(seatLine(pitching, 'editor'), '점검표를 펴 두고 기다려요.');
  const judging = record('verdicts', {verdicts: {editor: [{pitch: 1, fixes: ['시도 2를 키울 것']}, {pitch: 2, fixes: []}, {pitch: 3, veto: true, vetoReason: '잃는 것이 없음'}], picks: {editor: 2}}});
  judging.roles.editor = 'done';
  assert.equal(seatLine(judging, 'author'), '피치: 따르릉 / 빨간 장화의 종 / 노란 우산');
  assert.equal(seatLine(judging, 'editor'), '피치 2 추천 · 피치 3 거부: 잃는 것이 없음');
  assert.equal(seatLine(judging, 'art'), '그릴 수 있는 반전인지 보고 있어요.');
  assert.equal(seatLine(judging, 'reader'), '눈을 크게 뜨고 듣고 있어요.');
  assert.equal(seatLine(judging, 'chair'), '세 판정을 모아 채점표를 만들고 있어요.');
  const done = record('done', {roles: null, chosen: 2, overrode: false, scores: [{pitch: 2, editor: 12, art: 8, reader: 4, score: 12, vetoes: []}], verdicts: {editor: [{pitch: 2, fixes: ['바닥을 조용하게']}], art: [{pitch: 2, motifs: [{ko: '빨간 장화', en: 'red boots'}, {ko: '물방울'}]}], reader: [{pitch: 2, retell: '"유하 장화가 종이었어"', nextQuestion: 2}], picks: {editor: 2, art: 2, reader: 2}}, bible: pitch('빨간 장화의 종', '빨간 장화')});
  assert.equal(seatLine(done, 'chair'), "피치 2 '빨간 장화의 종' 채택 · 편집자 12/12 · 그림 8/8 · 독자 4/4");
  assert.equal(seatLine(done, 'author'), "바이블 '빨간 장화의 종' 확정 · 심은 물건: 빨간 장화");
  assert.equal(seatLine(done, 'editor'), '피치 2 추천 · 고칠 점: 바닥을 조용하게');
  assert.equal(seatLine(done, 'art'), '피치 2 추천 · 모티프: 빨간 장화, 물방울');
  assert.equal(seatLine(done, 'reader'), '“유하 장화가 종이었어” · 다음엔? ★★');
  assert.equal(seatLine(done, 'ghost'), '');
});

test('the room: phase strip, seat states, pitch cards with scores and the settled bible', () => {
  const live = renderCouncilRoom(record('verdicts'), {live: true});
  assert.match(live, /^<div class="council-room live phase-verdicts"><ol class="council-phases" aria-label="회의 진행"><li class="done">피치<\/li><li class="active">판정<\/li><li class="">바이블<\/li><li class="">확정<\/li><\/ol>/u);
  assert.match(live, /<div class="council-seat seat-author state-done" data-role="author"><div class="seat-avatar"><svg class="council-avatar"/u);
  assert.match(live, /seat-editor state-speaking/u);
  assert.match(live, /seat-reader state-speaking[\s\S]*<span class="seat-age">5~6세<\/span>/u);
  assert.match(live, /<div class="seat-title">그림책 작가 20년<\/div>/u);
  assert.equal((live.match(/<li class=""><strong>/gu) || []).length, 3, 'three pitch cards, none chosen yet');
  assert.match(live, /판정 기다리는 중/u);
  assert.doesNotMatch(live, /council-room-bible/u);
  const done = renderCouncilRoom(record('done', {roles: null, chosen: 2, scores: [{pitch: 1, editor: 10, art: 7, reader: 2, score: 9.2, vetoes: ['독자: 반전을 되말하지 못함']}, {pitch: 2, editor: 12, art: 8, reader: 4, score: 12, vetoes: []}, {pitch: 3, editor: 3, art: 4, reader: 3, score: 5.5, vetoes: ['편집자: 잃는 것이 없음']}], bible: pitch('빨간 장화의 종', '빨간 장화')}), {compact: true});
  assert.match(done, /^<div class="council-room  phase-done">/u);
  assert.equal((done.match(/state-done/gu) || []).length, 5);
  assert.doesNotMatch(done, /seat-title/u, 'compact hides the role titles');
  assert.match(done, /<li class="council-chosen"><strong>✓ 빨간 장화의 종<\/strong>/u);
  assert.match(done, /<li class="council-vetoed"><strong>따르릉<\/strong>[\s\S]*<span class="pitch-veto">거부: 독자: 반전을 되말하지 못함<\/span>/u);
  assert.match(done, /<p class="council-room-bible"><strong>바이블<\/strong> 잃는 것: 저녁 노래를 못 불러요 · 바닥: &quot;그냥 집에 갈까&quot; · 반전: 돌 틈의 작은 종 → “내 종이잖아!”<\/p>/u);
  assert.match(renderCouncilRoom(null), /phase-waiting/u);
});

test('the ③ block: a live empty room for a council draft, the folded room afterwards, nothing for demos or legacy drafts', () => {
  const policy = {councilPolicy: {version: 1}};
  const live = councilRoomBlock({input: policy, completed: {}}, {live: true});
  assert.match(live, /^<div id="simple-council-room" class="council-room-wrap"><div class="council-room live phase-waiting">/u);
  assert.equal(councilRoomBlock({input: policy, completed: {}, demo: true}, {live: true}), '', 'a demo never meets');
  assert.equal(councilRoomBlock({input: {}, completed: {}}, {live: true}), '');
  assert.equal(councilRoomBlock({input: policy, completed: {outline: 'x'}}, {live: true}), '', 'no record once the outline is done without a meeting');
  const partial = councilRoomBlock({input: policy, completed: {}, councilCheckpoint: {record: record('verdicts')}}, {live: true});
  assert.match(partial, /council-room live phase-verdicts/u);
  const finished = councilRoomBlock({input: policy, completed: {outline: 'x'}, outline: {council: {...record('bible'), chosen: 2, scores: [{pitch: 2, editor: 12, art: 8, reader: 4, score: 12, vetoes: []}]}, bible: pitch('빨간 장화의 종')}});
  assert.match(finished, /^<details class="simple-council-details"><summary>회의실 다시 보기 · '빨간 장화의 종' 채택 · 12\/12<\/summary><div class="council-room-wrap"><div class="council-room  phase-done">/u);
  assert.equal(councilRoomBlock({input: {}, completed: {}}), '');
});

/* ---------- R22 회의 결과 보고 진행 ---------- */
const parked = (extra = {}) => record('review', {recommended: 2, chosen: null, roles: {chair: 'speaking', author: 'waiting', editor: 'done', art: 'done', reader: 'done'}, verdicts: {editor: [{pitch: 1, fixes: []}, {pitch: 2, fixes: ['바닥을 조용하게']}, {pitch: 3, veto: true, vetoReason: '잃는 것이 없음'}], art: [{pitch: 2, motifs: [{ko: '빨간 장화'}]}], reader: [{pitch: 2, retell: '"유하 장화가 종이었어"', nextQuestion: 2}], picks: {editor: 2, art: 2, reader: 2}}, scores: [{pitch: 1, editor: 10, art: 7, reader: 2, score: 9.2, vetoes: ['독자: 반전을 되말하지 못함']}, {pitch: 2, editor: 12, art: 8, reader: 4, score: 12, vetoes: []}, {pitch: 3, editor: 3, art: 4, reader: 3, score: 3.3, vetoes: ['편집자: 잃는 것이 없음']}], ...extra});

test('R22 a parked meeting: the review phase in the strip, the chair waits with a recommendation, the pitch is tagged', () => {
  const r = parked();
  assert.equal(reviewPending(r), true);
  assert.equal(reviewPending(record('verdicts')), false);
  assert.equal(reviewPending({...r, chosen: 2}), false);
  assert.equal(seatLine(r, 'chair'), "피치 2 '빨간 장화의 종' 추천 · 부모님의 선택을 기다려요.");
  assert.equal(seatLine(r, 'author'), '부모님이 고르면 그 피치로 바이블을 써요.');
  assert.equal(seatLine(r, 'editor'), '피치 2 추천 · 고칠 점: 바닥을 조용하게 · 피치 3 거부: 잃는 것이 없음');
  const html = renderCouncilRoom(r);
  assert.match(html, /^<div class="council-room  phase-review"><ol class="council-phases" aria-label="회의 진행"><li class="done">피치<\/li><li class="done">판정<\/li><li class="active">부모 선택<\/li><li class="">바이블<\/li><li class="">확정<\/li><\/ol>/u);
  assert.match(html, /<li class=" council-recommended"><strong>빨간 장화의 종 <span class="pitch-tag">의장 추천<\/span><\/strong>/u);
  assert.match(html, /seat-chair state-speaking/u);
  assert.match(html, /seat-author state-waiting/u);
  // A meeting that never parked keeps the four-step strip (the existing assertion above holds).
  assert.doesNotMatch(renderCouncilRoom(record('verdicts')), /부모 선택/u);
  // Once settled by the parent: the step stays, the chair says who chose.
  const chosen = {...parked(), phase: 'done', roles: null, chosen: 1, overrode: true, parentChoice: {pick: 1, note: '토토가 더 많이'}, bible: pitch('따르릉')};
  assert.equal(seatLine(chosen, 'chair'), "피치 1 '따르릉' 채택 · 편집자 10/12 · 그림 7/8 · 독자 2/4 · 거부권을 넘어 택함 · 부모가 고름");
  const settled = renderCouncilRoom(chosen);
  assert.match(settled, /<li class="done">부모 선택<\/li><li class="done">바이블<\/li><li class="done">확정<\/li>/u);
  assert.match(settled, /<li class="council-chosen"><strong>✓ 따르릉<\/strong>/u);
  assert.match(settled, /<li class=" council-recommended"><strong>빨간 장화의 종 <span class="pitch-tag">의장 추천<\/span>/u, 'the chair\'s pick stays visible next to the parent\'s');
  assert.equal(seatLine({...chosen, chosen: 2, overrode: false, parentChoice: {pick: 2, note: ''}, bible: pitch('빨간 장화의 종', '빨간 장화')}, 'chair'), "피치 2 '빨간 장화의 종' 채택 · 편집자 12/12 · 그림 8/8 · 독자 4/4 · 부모 확인");
});

test('R22 the choice form: one radio per pitch with the recommendation checked, a note, a folded direction; the readers', () => {
  const form = renderCouncilReviewForm(parked(), {direction: '절정에서 공감', fee: '회의 요금 약 $0.02'});
  assert.match(form, /^<div class="council-review" id="council-review"><p class="council-review-intro">의장이 피치 2 '빨간 장화의 종'을\(를\) 추천했어요\./u);
  assert.equal((form.match(/<input type="radio" name="council-pick"/gu) || []).length, 3);
  assert.match(form, /<input type="radio" name="council-pick" value="2" checked>/u);
  assert.doesNotMatch(form, /value="1" checked|value="3" checked/u);
  assert.match(form, /<label class="council-pick council-recommended"><input type="radio" name="council-pick" value="2" checked><span class="council-pick-body"><strong>빨간 장화의 종 <span class="pitch-tag">의장 추천<\/span><\/strong>/u);
  assert.match(form, /<span class="pitch-score">편집자 12\/12 · 그림 8\/8 · 독자 4\/4 · 합계 12<\/span><span class="pitch-turn">반전: 돌 틈의 작은 종 → “내 종이잖아!”<\/span>/u);
  assert.match(form, /<textarea id="council-note" maxlength="300" rows="2"/u);
  assert.match(form, /<details class="council-redirect"><summary>방향을 고쳐 다시 회의하기<\/summary>[\s\S]*<input id="council-direction" maxlength="200" value="절정에서 공감"/u);
  assert.match(form, /지금 피치는 버려요 · 회의 요금 약 \$0\.02\.<\/p><\/details><\/div>$/u);
  assert.equal(renderCouncilReviewForm(record('pitches', {pitches: []})), '', 'no pitches, no form');
  // The readers take any root with querySelector (the page, or a stub).
  const root = (map) => ({querySelector: (sel) => (sel in map ? {value: map[sel]} : null)});
  assert.deepEqual(readCouncilChoice(root({'input[name="council-pick"]:checked': '3', '#council-note': '  토토가  더 많이 '})), {pick: 3, note: '토토가 더 많이'});
  assert.deepEqual(readCouncilChoice(root({'input[name="council-pick"]:checked': '1'})), {pick: 1, note: ''});
  assert.equal(readCouncilChoice(root({})), null, 'no form on the page');
  assert.equal(readCouncilChoice(null), null);
  assert.equal(readCouncilDirection(root({'#council-direction': ' 새 방향 '})), '새 방향');
  assert.equal(readCouncilDirection(root({})), '');
  // ③ keeps the parked room open (no fold) while the parent chooses.
  const block = councilRoomBlock({input: {councilPolicy: {version: 1}}, completed: {}, councilCheckpoint: {record: parked()}}, {open: true});
  assert.match(block, /^<div class="council-room-wrap"><div class="council-room  phase-review">/u);
});
