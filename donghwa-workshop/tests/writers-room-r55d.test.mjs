import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R55d (2026-11-08): the roundtable's story-side items, cut down after the
 * parent asked whether more premise fields would just bring the checklist
 * back. What reaches the writer is one line of permission (the narrator is
 * the writer's to choose) and the parent's own value when one was chosen in
 * ①. Everything else listens: the adult reader names a page hard to read
 * aloud and a page whose speech level is wrong, and the targeted rewrite
 * hears both. The new-character look guidance asks for a stable sheet.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
/* R55h: a job frozen before R55h has no weave — its requests are the ones this test pins, byte for byte. */
const preWeave = (input) => { const {weave, ...room} = input.writersRoom; return {...input, writersRoom: room}; };
const roomInput = (id, extra = {}) => preWeave(normalizeStoryInput({...inputFromWizard(setup(), {...wizard, ...extra}, {layout: 'openings'}).input, bookId: id}));
const PREMISE = {title: '내 뒤에 누가 있게?', line: '숲에서', engine: 'reader_knows', laugh: '뒤에 숨어요', picture: '큰 귀', cast: []};

test('R55d the draft request frees the narrator in one sentence (permission, not a menu); the premise schema gains no field', () => {
  const input = roomInput('d1');
  const req = W.draftRequest(input, PREMISE);
  assert.match(req.system, /화자는 자유예요 — 이야기꾼이 들려줘도, 주인공이 '나'로 말해도, 조연이나 사물이 말해도, 읽는 아이에게 말을 걸어도 돼요; 이 이야기에 맞는 목소리로\./);
  const premise = W.premisesRequest(input).jsonSchema.properties.premises.items;
  assert.deepEqual(premise.required, ['title', 'line', 'engine', 'laugh', 'picture', 'cast'], 'no voice/conflict/change fields');
  assert.match(W.premisesRequest(input).system, /look\(그림 시트용 생김새 한 줄, 영어 — 주인공과 견준 크기, 색 둘, 한눈에 알아볼 표시 하나\(귀·무늬·모자 같은 것\); 쪽마다 같은 인물로 그릴 수 있게\)/);
});

test('R55d the brief passes the parent\'s value on only when one was chosen in ①', () => {
  const none = W.roomBrief(roomInput('d2'));
  assert.doesNotMatch(none, /함께 생각하고 싶은 것/);
  const brave = W.roomBrief(roomInput('d3', {value: '용기'}));
  assert.match(brave, /\n\[부모님이 아이와 함께 생각하고 싶은 것\] 용기 — 말로 가르치지 않고, 이야기 속 일과 행동에 스며들게\.\n\[좋은 그림책이 하는 일\]/);
  assert.equal(roomInput('d4', {value: '용기'}).moral, '용기', 'the wizard value is the input moral, room or not');
});

test('R55d the adult reader names a page hard to read aloud and a page with the wrong speech level; the notes and the rewrite hear them; the pull does not change', () => {
  const input = roomInput('d5');
  const req = W.panelReadRequest(input, [{title: 'a', pages: [{ko: '가.'}]}, {title: 'b', pages: [{ko: '나.'}]}]);
  const draft = req.jsonSchema.properties.readers.items.properties.drafts.items;
  assert.deepEqual(draft.required.slice(-2), ['hardPage', 'mannersPage']);
  assert.equal(draft.properties.hardPage.minimum, 0);
  assert.match(req.system, /읽어 주는 어른\(parent\)만 둘을 더 말해요: 소리 내어 읽기 힘든 쪽 하나\(hardPage[^)]*\)와 존댓말·반말이 어색한 쪽 하나\(mannersPage[^)]*\); 아이들은 둘 다 0\./);
  assert.match(W.readerPanel(input).find((p) => p.id === 'parent').line, /존댓말·반말은 읽다가 바로 걸려요/);
  const child = (reader, i) => ({reader, favorite: 1, again: true, drafts: [{draft: 1, skipPage: i + 1, lostPage: 0, laughPages: [2], change: '', hardPage: 0, mannersPage: 0}, {draft: 2, skipPage: 1, lostPage: 0, laughPages: [], change: '', hardPage: 0, mannersPage: 0}]});
  const answer = {readers: [...['action', 'laugh', 'heart', 'eye', 'ours'].map(child), {reader: 'parent', favorite: 1, again: false, drafts: [{draft: 1, skipPage: 7, lostPage: 0, laughPages: [2], change: '', hardPage: 5, mannersPage: 3}, {draft: 2, skipPage: 1, lostPage: 0, laughPages: [], change: '', hardPage: 0, mannersPage: 0}]}]};
  const rows = W.countReadings(answer, 2);
  assert.deepEqual([rows[0].hardPages, rows[0].mannersPages, rows[1].hardPages, rows[1].mannersPages], [[5], [3], [], []]);
  // votes 6 × 4 + again 5 × 2 + laugh pages 1 (page 2, six readers) − bored (page 1 named by one child only; skip pages 1..5 by one each; page 1 by one) = 35
  assert.equal(rows[0].pull, 6 * 4 + 5 * 2 + 1, 'the adult\'s two pages do not move the pull');
  assert.match(W.rewriteNotes(rows[0]), /소리 내어 읽기 힘든 쪽: 5 — 입에 붙게 다듬어요\(뜻은 그대로\)\.\n존댓말·반말이 어색한 쪽: 3 — 누가 누구에게 하는 말인지에 맞게 말높임만 고쳐요\./);
  assert.equal(W.nothingToRewrite({boredPages: [], lostPages: [], words: [], hardPages: [5], mannersPages: []}), false);
  assert.equal(W.nothingToRewrite({boredPages: [], lostPages: [], words: [], hardPages: [], mannersPages: [3]}), false);
  assert.equal(W.nothingToRewrite({boredPages: [], lostPages: [], words: ['']}), true, 'an answer journaled before R55d has neither list');
  // An answer saved before R55d (no hardPage) still counts.
  const old = W.countReadings({readers: [{reader: 'parent', favorite: 1, again: false, drafts: [{draft: 1, skipPage: 2, lostPage: 0, laughPages: [], change: ''}]}]}, 1);
  assert.deepEqual([old[0].hardPages, old[0].mannersPages], [[], []]);
  assert.match(W.rewriteRequest(input, {title: 't', pages: [{ko: '가.'}]}, 'x').system, /읽기 힘든 쪽·말높임이 어색한 쪽/);
});
