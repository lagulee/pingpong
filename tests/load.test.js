// 0단계 기본 테스트: 폴더 구조, 설정 파일, 모든 공용·브라우저 코드가 문법 오류 없이 불러와지는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsFiles = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => join(ROOT, dir, f));

test('CLAUDE.md 3장의 폴더 구조가 모두 존재한다', () => {
  const expected = [
    'package.json', 'wrangler.jsonc', 'public/index.html',
    'public/shared/constants.js', 'public/shared/physics.js', 'public/shared/rules.js',
    ...['main', 'render', 'input', 'ai', 'audio', 'effects', 'net', 'debug'].map((n) => `public/js/${n}.js`),
    'server/worker.js', 'server/room.js', 'tests',
  ];
  for (const p of expected) assert.ok(existsSync(join(ROOT, p)), `${p} 없음`);
});

test('public/shared/*.js가 Node에서 import된다 (서버와 공용)', async () => {
  for (const f of jsFiles('public/shared')) {
    await assert.doesNotReject(import(pathToFileURL(f).href), f);
  }
});

test('public/js/*.js가 문법 오류 없이 파싱된다 (node --check)', () => {
  // 브라우저 코드는 'three'·DOM에 의존하므로 실행하지 않고 ES 모듈 문법만 검사한다.
  const files = jsFiles('public/js');
  assert.ok(files.length >= 8);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}\n${r.stderr}`);
  }
});

test('node --check가 실제로 문법 오류를 잡아낸다 (테스트 자체 검증)', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: 'import x from "y"; const = 1;', encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});

test('public/shared에서 DOM·Node 전용 API·Math.random·Date.now를 쓰지 않는다', () => {
  const banned = [/Math\.random\s*\(/, /Date\.now\s*\(/, /\bdocument\./, /\bwindow\./, /from\s+['"]node:/, /\brequire\s*\(/];
  for (const f of jsFiles('public/shared')) {
    const src = readFileSync(f, 'utf8');
    for (const re of banned) assert.ok(!re.test(src), `${f}에서 금지 패턴 ${re}`);
  }
});

test('constants.js의 규격이 CLAUDE.md 5장과 일치한다', async () => {
  const { TABLE, NET, BALL } = await import(pathToFileURL(join(ROOT, 'public/shared/constants.js')).href);
  assert.equal(TABLE.LENGTH, 2.74);
  assert.equal(TABLE.WIDTH, 1.525);
  assert.equal(TABLE.HEIGHT, 0.76);
  assert.equal(NET.HEIGHT, 0.1525);
  assert.equal(BALL.MASS, 0.0027);
  assert.equal(BALL.RADIUS * 2, 0.04);
});

test('index.html이 Three.js import map과 main.js를 불러온다', () => {
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  assert.match(map.imports.three, /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@\d+\.\d+\.\d+\//);
  assert.match(html, /<script type="module" src="js\/main\.js">/);
});

test('package.json 설정', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.test, /^node --test /);
});

test('wrangler.jsonc: 이름, 진입점, 정적 자산, SQLite Durable Object', () => {
  // 주석(// ...)만 제거해서 JSON으로 읽는다. 문자열 안의 //(URL 등)는 쓰지 않는다.
  const src = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const cfg = JSON.parse(src);
  assert.equal(cfg.name, 'pingpong');
  assert.equal(cfg.main, 'server/worker.js');
  assert.equal(cfg.assets.directory, './public');
  assert.deepEqual(cfg.durable_objects.bindings, [{ name: 'ROOM', class_name: 'Room' }]);
  assert.ok(cfg.migrations.some((m) => m.new_sqlite_classes?.includes('Room')));
  assert.ok(!cfg.migrations.some((m) => m.new_classes), '무료 플랜은 new_sqlite_classes만 사용');
});

test('worker.js가 Room을 내보내고 요청을 정적 자산으로 넘긴다', async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'server/worker.js')).href);
  assert.equal(typeof mod.Room, 'function');
  const req = new Request('https://example.com/index.html');
  let seen = null;
  const env = { ASSETS: { fetch: async (r) => { seen = r; return new Response('ok'); } } };
  const res = await mod.default.fetch(req, env);
  assert.equal(seen, req);
  assert.equal(await res.text(), 'ok');
});
