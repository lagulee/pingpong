// 설정 단축키 (v7.18): Tab = 설정 열기/닫기. main.js는 DOM이 필요해 Node에서 실행할 수 없으므로 소스로 확인한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHOT_KEYS } from '../public/shared/constants.js';

const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');

test('Tab: 구질 키(Q·W·E·R)와 겹치지 않고, 설정을 열고 닫으며 포커스 이동은 막는다', () => {
  assert.ok(!('Tab' in SHOT_KEYS));
  const m = main.match(/if \(e\.code === 'Tab'[^\n]*\{\n([^}]*)\}/);
  assert.ok(m, 'Tab 처리');
  assert.match(m[0], /!modified\(e\)/, 'Alt+Tab 등 조합은 무시');
  assert.match(m[1], /e\.preventDefault\(\)/);
  assert.match(m[1], /setSettingsOpen\(settingsEl\.hidden\)/);
  // 입력창(닉네임·코드·비밀번호)에서는 단축키가 동작하지 않는다
  assert.match(main, /const typing = [^\n]*'password'/);
  assert.ok(main.indexOf("if (typing(e)) return;") < main.indexOf("e.code === 'Tab'"));
});
