import test from 'node:test';
import assert from 'node:assert/strict';
import {COUNCIL_ROLES, councilAvatar, councilRole} from '../dist/story-generation/council-avatars.js';
import {COUNCIL_PHASES, liveCouncilRecord, emptyCouncilRecord, seatLine, renderCouncilRoom, councilRoomBlock} from '../dist/story-generation/council-room.js';

/**
 * 2026-10-20 R21 회의실: five original avatars ship as inline SVG, and the
 * room is drawn from the meeting record (live from the checkpoint, later from
 * the outline), one seat per role with what it said so far.
 */
const pitch = (title, planted = '작은 종') => ({title, logline: `유하가 ${planted} 소리를 따라가요`, stakes: '저녁 노래를 못 불러요', planted: {name: planted, nameEn: 'a small bell', firstSeen: '가방 고리'}, ladder: ['꿀길', '풍차'], lowPoint: '"그냥 집에 갈까"', turn: {seen: '돌 틈의 작은 종', realized: '"내 종이잖아!"', overturns: '남의 종이 아니었다'}, payoff: '종을 울려요', echo: '머리맡의 종'});
const record = (phase, extra = {}) => ({phase, direction: '5~6세 독자가 절정에서 공감', reader: {age: '5~6세'}, pitches: [pitch('따르릉'), pitch('빨간 장화의 종', '빨간 장화'), pitch('노란 우산', '노란 우산')], scores: [], verdicts: null, chosen: null, bible: null, decisions: [], roles: {chair: 'waiting', author: 'done', editor: 'speaking', art: 'speaking', reader: 'speaking'}, ...extra});

test('every role has an original inline SVG avatar with its own gradients and a label', () => {
  assert.deepEqual(COUNCIL_ROLES.map(r => r.id), ['chair', 'author', 'editor', 'art', 'reader']);
  for (const role of COUNCIL_ROLES) {
    const svg = councilAvatar(role.id);
    assert.match(svg, /^<svg class="council-avatar" viewBox="0 0 120 120" role="img" aria-label="/u);
    assert.match(svg, new RegExp(`aria-label="${role.name}"`, 'u'));
    assert.doesNotMatch(svg, /<image|href="http|url\(http/u, 'no external resource: nothing to fetch, nothing to pay');
    assert.ok((svg.match(/<radialGradient id="[a-z]{2}-iris"/gu) || []).length === 1, `${role.id} has one iris gradient`);
    assert.ok((svg.match(/<circle [^>]*fill="#fff"/gu) || []).length >= 4, `${role.id} has eye highlights`);
  }
  assert.equal(councilAvatar('nobody'), '');
  assert.equal(councilRole('reader').title, '소리로만 듣는 아이');
  const ids = new Set(COUNCIL_ROLES.map(r => councilAvatar(r.id).match(/id="([a-z]{2})-bg"/u)[1]));
  assert.equal(ids.size, 5, 'gradient ids do not collide between avatars on one page');
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
  assert.deepEqual(COUNCIL_PHASES.map(([id]) => id), ['pitches', 'verdicts', 'bible', 'done']);
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
