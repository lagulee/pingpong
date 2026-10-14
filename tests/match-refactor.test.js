// 5단계 리팩터링 회귀 테스트: 경기 흐름을 shared/match.js로 옮기기 전에 기록한 연습 경기의
// 득점 순서·물리 이벤트 지문(fixtures/match-golden.json)과 지금 결과가 완전히 같아야 한다.
// 지문을 다시 기록하려면(의도한 동작 변경일 때만): GOLDEN_WRITE=1 node --test tests/match-refactor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createAI, createRally, stepMatch, stepRally, feedBall, createPlayer, queueScenario, tossBall,
  serveBall, placeBall, endFree,
} from '../public/js/ai.js';
import { createRng } from '../public/js/input.js';
import { makeLaunch, createBall, vec } from '../public/shared/physics.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/match-golden.json', import.meta.url));

function digest(log) {
  return createHash('sha256').update(JSON.stringify(log)).digest('hex');
}
// 타격 직후 공 상태는 이후 물리 이벤트의 위치·속도에 모두 반영되므로 shot.vel(옛 코드에서는 공 속도와 같은
// 객체라 이후 물리가 덮어씀)은 넣지 않고, 판정 결과(구질·타이밍·세기)만 넣는다.
const evRow = (e) => [e.type, e.t, e.pos?.x, e.pos?.y, e.pos?.z, e.speed, e.side, e.outside ?? null, e.shot?.shotType ?? null,
  e.shot ? [e.shot.quality.timing, e.shot.quality.strength, e.shot.quality.dtApex] : null];
const resRow = (r) => [r.type, r.reason, r.winner, r.t, r.rally, r.score, r.practice];

function aiGame(seed, dA, dB) {
  const a = createAI(-1, dA, createRng(seed * 7 + 1));
  const b = createAI(1, dB, createRng(seed * 13 + 5));
  const game = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(seed), firstServer: seed % 2 ? -1 : 1 });
  const log = [];
  for (let i = 0; i < 240 * 3600 && game.rules.phase !== 'gameOver'; i++) for (const e of stepMatch(game)) log.push(evRow(e));
  return { results: game.results.map(resRow), events: digest(log), n: log.length };
}

function rallies(seed) {
  const a = createAI(-1, 'NORMAL', createRng(seed * 7 + 1));
  const b = createAI(1, 'HARD', createRng(seed * 13 + 5));
  const game = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(seed) });
  feedBall(game, 1, 0);
  const log = [];
  for (let i = 0; i < 240 * 120 && game.rules.phase === 'rally'; i++) for (const e of stepRally(game)) log.push(evRow(e));
  return { results: game.results.map(resRow), events: digest(log) };
}

// 사람(아무것도 안 함) 대 로봇: 토스·연습 공·떨어뜨리기·규칙 시험을 섞는다
function humanMix() {
  const human = createPlayer(-1);
  const robot = createAI(1, 'NORMAL', createRng(5));
  const game = createRally({ players: { [-1]: human, [1]: robot.player }, ais: [robot], rng: createRng(1) });
  const log = [];
  const run = (n, hook = () => {}) => {
    for (let i = 0; i < n; i++) { hook(i); for (const e of stepMatch(game)) log.push(evRow(e)); }
  };
  run(10);
  log.push(['toss', tossBall(game, 1, 0, game.ball.t), tossBall(game, -1, 0.2, game.ball.t)]);
  run(240 * 6);
  serveBall(game, makeLaunch({ pos: vec(0, -1.6, 0.3), speed: 7, elevation: 8, topspin: 30, t: game.ball.t }), -1);
  run(240 * 6);
  placeBall(game, createBall({ pos: vec(0, 0.3, 0.5), t: game.ball.t }));
  run(240 * 2);
  endFree(game, game.ball.t);
  for (const kind of ['let', 'twoBounce', 'volley']) {
    queueScenario(game, kind, game.ball.t);
    run(240 * 8, () => {
      if (kind === 'volley' && human.apexPos) human.samples.push({ t: game.ball.t, x: human.apexPos.x, y: human.apexPos.z, b: true });
    });
  }
  run(240 * 60); // 로봇 서브 차례가 오면 로봇이 서브, 사람은 받지 않음
  return { results: game.results.map(resRow), events: digest(log), score: game.rules.score };
}

function fingerprint() {
  return {
    games: [[1, 'NORMAL', 'NORMAL'], [2, 'HARD', 'EASY'], [3, 'NORMAL', 'HARD']].map(([s, a, b]) => aiGame(s, a, b)),
    rallies: [1, 2, 3, 4, 5].map(rallies),
    human: humanMix(),
  };
}

test('리팩터링 회귀: 연습 경기(AI 대 AI·사람 대 로봇·연습 공·규칙 시험)가 기록과 완전히 같다', () => {
  const now = fingerprint();
  if (process.env.GOLDEN_WRITE === '1') writeFileSync(FIXTURE, `${JSON.stringify(now, null, 1)}\n`);
  assert.ok(existsSync(FIXTURE), '기록 파일 없음');
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(now)), golden);
});
