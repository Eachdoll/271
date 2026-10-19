import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {renderTextEngineQuick} from '../dist/text-generation/settings-ui.js';
import {renderImageEngineQuick} from '../dist/image-generation/settings-ui.js';
import {
  accountLine, signedOutNote, renderSignedOutChoices, renderCloudAccountControls, renderSimpleAccountRow,
  renderLocalOnlyEscape, renderFamilyAuthForm, renderRecoveryCode, renderPasswordForm, renderDeleteForm,
  renderFramedNotice, isFramed, LOCAL_ONLY_NOTE,
} from '../dist/family-auth-ui.js';

const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../dist/style.css', import.meta.url), 'utf8');
const buttons = html => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => match[1].replace(/<[^>]+>/g, '').trim());
const tag = (html, id) => html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] || '';
const family = {id: 'family:7d3c-11ee', kind: 'family', username: 'yuha_home', displayName: '유하네', email: ''};
const chatgpt = {id: 'owner-A', displayName: '부모', email: 'family@example.test'};
const states = {
  signedOut: {phase: 'signed-out', authenticated: false, user: null, signInPath: '/signin-with-chatgpt?return_to=%2Fbooks'},
  family: {phase: 'ready', authenticated: true, user: family},
  chatgpt: {phase: 'ready', authenticated: true, user: chatgpt},
};
function bodyOf(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start > 0, name);
  return app.slice(start, app.indexOf('\n}\n', start));
}

test('labels: family shows display name and username, ChatGPT keeps its label, expiry is explained', () => {
  assert.equal(accountLine(family), '로그인: 유하네 (가족 아이디 yuha_home)');
  assert.equal(accountLine({...family, displayName: ''}), '로그인: yuha_home (가족 아이디 yuha_home)');
  assert.equal(accountLine(chatgpt), '로그인: 부모');
  assert.equal(accountLine({id: 'owner-B', email: 'b@example.test'}), '로그인: b@example.test');
  assert.equal(signedOutNote({reason: 'family-session-expired'}), '가족 아이디 로그인이 끝났어요. 다시 로그인해 주세요.');
  assert.match(signedOutNote({reason: 'sign-in'}), /같은 가족 아이디나 ChatGPT 계정으로/);
});

test('signed out: family login is primary, sign-up secondary, ChatGPT a small link to signInPath', () => {
  const html = renderSignedOutChoices(states.signedOut);
  assert.deepEqual(buttons(html), ['가족 아이디로 로그인', '가족 계정 만들기']);
  assert.match(html, /class="btn btn-green" data-action="family-login"/);
  assert.match(html, /class="btn btn-outline" data-action="family-signup"/);
  assert.match(html, /<a class="family-chatgpt-link" href="\/signin-with-chatgpt\?return_to=%2Fbooks" target="_top" data-action="chatgpt-signin">ChatGPT로 로그인<\/a>/);
  assert.match(renderSignedOutChoices({signInPath: '//evil.example/x'}), /href="\/signin-with-chatgpt\?return_to=%2F"/, 'only same-origin paths');
});

test('signed in: family gets 로그아웃 and a folded 가족 계정 관리; ChatGPT keeps its sign-out and can move to a family ID', () => {
  const fam = renderCloudAccountControls(states.family);
  assert.deepEqual(buttons(fam), ['로그아웃', '비밀번호 바꾸기', '가족 계정 삭제']);
  assert.match(fam, /<details class="family-manage"><summary>가족 계정 관리<\/summary>/);
  const gpt = renderCloudAccountControls(states.chatgpt);
  assert.doesNotMatch(gpt, /<details|family-password|family-delete/);
  assert.match(gpt, /data-action="chatgpt-signout">ChatGPT 로그아웃/);
  assert.deepEqual(buttons(gpt), ['가족 아이디로 옮기기']);
  assert.equal(renderCloudAccountControls(states.signedOut), '');
});

test('simple settings 보관: at most two new buttons for each sign-in state', () => {
  const expected = {
    signedOut: ['가족 아이디로 로그인', '가족 계정 만들기'],
    family: ['로그아웃', '클라우드 관리'],
    chatgpt: ['가족 아이디로 옮기기', '클라우드 관리'],
  };
  for (const [name, status] of Object.entries(states)) {
    const html = renderSimpleAccountRow(status);
    assert.deepEqual(buttons(html), expected[name], name);
    assert.match(html, /id="simple-account-row"/);
  }
  assert.match(renderSimpleAccountRow(states.signedOut), /data-action="chatgpt-signin"/);
  assert.match(renderSimpleAccountRow(states.family), /로그인: 유하네 \(가족 아이디 yuha_home\)/);
  assert.match(renderSimpleAccountRow({...states.signedOut, reason: 'family-session-expired'}), /가족 아이디 로그인이 끝났어요/);
});

test('the whole simple settings page stays within 12 buttons with the account row', () => {
  const state = seedState();
  migrateWorldState(state);
  migrateReadingSettings(state.settings);
  const body = bodyOf('simpleSettingsPage');
  assert.match(body, /\$\{renderSimpleAccountRow\(cloudStatus\)\}/);
  assert.match(body, /id="simple-settings-backup"[\s\S]*renderSimpleAccountRow/);
  // Buttons written in the page itself (the conditional 'return to story' one included).
  const own = (body.match(/\bbtn\(|managementButton\(|<button\b/g) || []).length;
  const quick = buttons(renderTextEngineQuick(state) + renderImageEngineQuick(state)).length;
  const row = Math.max(...Object.values(states).map(status => buttons(renderSimpleAccountRow(status)).length));
  assert.equal(row, 2);
  assert.ok(own + quick + row <= 12, `simple settings: ${own} + ${quick} + ${row} buttons`);
});

test('the sign-in modal: a real form with tabs, username and password attributes, a show toggle and no confirm field', () => {
  const login = renderFamilyAuthForm('login', {username: ' YuHa_Home '});
  assert.match(login, /role="tablist"/);
  assert.deepEqual(buttons(login).slice(1, 4), ['로그인', '계정 만들기', '비밀번호를 잊었어요']);
  assert.match(login, /aria-selected="true" data-family-tab="login"/);
  assert.match(login, /<form id="family-auth-form"[^>]*data-family-form="login"/);
  const user = tag(login, 'family-username');
  for (const attr of ['autocomplete="username"', 'autocapitalize="none"', 'autocorrect="off"', 'spellcheck="false"', 'inputmode="latin"'])
    assert.ok(user.includes(attr), attr);
  assert.match(login, /아이디: yuha_home/, 'live preview of the canonical username');
  assert.ok(tag(login, 'family-password').includes('autocomplete="current-password"'));
  assert.match(login, /data-family-show-password[^>]*> 비밀번호 보기/);
  assert.match(login, /role="alert"/);
  assert.match(login, /<button type="submit" class="btn btn-primary" id="family-auth-submit">로그인<\/button>/);
  assert.equal((login.match(/type="password"/g) || []).length, 1, 'no confirm field');
  const signup = renderFamilyAuthForm('signup');
  assert.ok(tag(signup, 'family-password').includes('autocomplete="new-password"'));
  assert.match(signup, /가족 초대 코드/);
  assert.match(signup, /가족 이름 \(선택\)/);
  assert.equal((signup.match(/type="password"/g) || []).length, 1);
  assert.match(signup, /id="family-auth-submit">가족 계정 만들기</);
  const recover = renderFamilyAuthForm('recover');
  assert.match(recover, /id="family-recovery-input"/);
  assert.ok(tag(recover, 'family-password').includes('autocomplete="new-password"'));
  assert.equal(renderFamilyAuthForm('nonsense').includes('data-family-form="login"'), true);
  assert.match(renderFamilyAuthForm('login', {username: '<b>'}), /value="&lt;b&gt;"/);
});

test('the recovery code screen: large grouped code, copy/save/print, and a check that gates 계속', () => {
  const html = renderRecoveryCode('ABCD-EFGH-JKMN-PQRS-TVWX');
  assert.match(html, /<p class="family-recovery-code" id="family-recovery-code" translate="no" lang="en">ABCD-EFGH-JKMN-PQRS-TVWX<\/p>/);
  assert.deepEqual(buttons(html), ['복사', '텍스트 파일로 저장', '인쇄', '계속']);
  assert.match(html, /<input type="checkbox" id="family-recovery-saved"> 안전한 곳에 적어 두었어요/);
  assert.match(html, /id="family-recovery-done" disabled>계속/);
  assert.match(html, /data-modal-lock/, 'Escape cannot close it');
  assert.doesNotMatch(html, /data-action="close-modal"/, 'no close button before the parent confirms');
  assert.match(css, /\.family-recovery-code \{[^}]*monospace/);
});

test('password and delete dialogs: sign-out-others is off by default, delete needs the typed word, books stay', () => {
  const password = renderPasswordForm({username: 'yuha_home'});
  assert.ok(tag(password, 'family-current-password').includes('autocomplete="current-password"'));
  assert.ok(tag(password, 'family-password').includes('autocomplete="new-password"'));
  assert.match(password, /<input type="checkbox" id="family-signout-others"> 다른 기기도 모두 로그아웃/);
  assert.doesNotMatch(password, /id="family-signout-others" checked/);
  assert.match(password, /책은 각 기기에 그대로 있어요/);
  assert.match(password, /name="username" autocomplete="username" value="yuha_home" hidden/);
  const remove = renderDeleteForm({username: 'yuha_home'});
  assert.match(remove, /‘삭제’라고 적어 주세요/);
  assert.match(remove, /id="family-auth-submit" disabled>가족 계정 삭제/);
  assert.match(remove, /이 기기의 책은 그대로 남아요/);
});

test('the locked-device escape explains what it does', () => {
  const html = renderLocalOnlyEscape();
  assert.deepEqual(buttons(html), ['이 기기 자료로 계속 쓰기']);
  assert.match(html, /data-action="cloud-continue-local"/);
  assert.ok(html.includes(LOCAL_ONLY_NOTE));
  assert.equal(LOCAL_ONLY_NOTE, '클라우드와 연결을 끊고 이 기기의 책만 써요. 나중에 다시 로그인하면 어느 쪽 자료를 쓸지 고를 수 있어요.');
});

test('auth and delete forms refuse to render inside a frame', () => {
  const top = {};
  assert.equal(isFramed({top, self: top}), false);
  assert.equal(isFramed({top: {}, self: {}}), true);
  assert.equal(isFramed({get top() {throw new Error('cross-origin');}, self: {}}), true);
  assert.equal(isFramed(undefined), false);
  const notice = renderFramedNotice();
  assert.doesNotMatch(notice, /<form|type="password"/);
  assert.match(notice, /새 창에서 열기/);
});

test('app.js wires the family controls into the status card, cloud panel, lock screen and simple settings', () => {
  assert.match(bodyOf('cloudStatusCard'), /renderSignedOutChoices\(c\)/);
  assert.match(bodyOf('cloudStatusCard'), /c\.user\?\.kind === "family"[\s\S]*data-action="family-logout">로그아웃</, 'family sign-out on the status card');
  const panel = bodyOf('showCloudPanel');
  assert.match(panel, /renderCloudAccountControls\(c\)/);
  assert.match(panel, /renderSignedOutChoices\(c\)/);
  assert.match(panel, /accountLine\(c\.user\)/);
  assert.match(panel, /cloudPrivacyLocked \? renderLocalOnlyEscape\(\)/);
  assert.match(bodyOf('pageContent'), /if \(cloudPrivacyLocked\)[\s\S]*renderLocalOnlyEscape\(\)/);
  assert.match(bodyOf('continueLocalOnlyWithPin'), /pinCallback = async[\s\S]*cloudSync\.continueLocalOnly\(\)[\s\S]*openPin\(\)/);
  assert.match(bodyOf('continueLocalOnlyWithPin'), /if \(!state\.settings\.pinHash\)/, 'no PIN, no escape');
  for (const action of ['chatgpt-signin', 'family-login', 'family-signup', 'family-migrate', 'family-logout', 'family-password', 'family-delete', 'cloud-continue-local'])
    assert.ok(app.includes(`a === "${action}"`), action);
  assert.match(app, /\.cloud-panel,\.cloud-confirm,\.family-auth/, 'family-auth modal is in the canApplyRemote allowlist');
  assert.match(app, /isAutoRunning: \(\) => isFullAutoRunning\(\)/);
  assert.match(app, /if \(modalRoot\.querySelector\("\[data-modal-lock\]"\)\) return;/);
  assert.doesNotMatch(app, /같은 ChatGPT 계정으로|같은 계정으로 로그인해 주세요|같은 계정으로 로그인하거나/);
  assert.match(app, /같은 가족 아이디나 ChatGPT 계정으로/);
});
