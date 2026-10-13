// 3단계: 규칙을 실제 물리·타격과 함께 돌리는 테스트
// - AI 대 AI 한 게임을 서브부터 끝까지 자동 진행 (stepMatch)
// - 디버그 규칙 시험 공 (렛·투 바운드·발리)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAI, createRally, stepMatch, createPlayer, queueScenario, tossBall, scoreState,
} from '../public/js/ai.js';
import { createRng } from '../public/js/input.js';
import { serverFor } from '../public/shared/rules.js';
import { RULES, SERVE } from '../public/shared/constants.js';

const MAX_STEPS = 240 * 3600; // 시뮬레이션 1시간이면 충분히 끝나야 한다

function playGame(seed, diffA = 'NORMAL', diffB = diffA) {
  const a = createAI(-1, diffA, createRng(seed * 7 + 1));
  const b = createAI(1, diffB, createRng(seed * 13 + 5));
  const firstServer = seed % 2 ? -1 : 1;
  const game = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(seed), firstServer });
  const serves = [];   // 토스 순간의 { server, score }
  const hits = [];
  let steps = 0;
  for (; steps < MAX_STEPS && game.rules.phase !== 'gameOver'; steps++) {
    const before = game.rules.phase;
    const score = [...game.rules.score];
    for (const e of stepMatch(game)) if (e.type === 'racket') hits.push(e);
    if (before === 'waitingServe' && game.rules.phase === 'serving') serves.push({ server: game.rules.server, score, firstServer });
  }
  return { game, serves, hits, steps };
}

test('AI 대 AI 한 게임이 서브부터 끝까지 진행되고, 점수가 규칙에 맞게 끝난다', () => {
  for (const [seed, dA, dB] of [[1, 'NORMAL', 'NORMAL'], [2, 'HARD', 'EASY'], [3, 'NORMAL', 'HARD']]) {
    const { game, serves, hits, steps } = playGame(seed, dA, dB);
    const tag = `시드 ${seed} (${dA}/${dB})`;
    assert.equal(game.rules.phase, 'gameOver', `${tag}: ${steps} 스텝 안에 끝나야 함`);
    const [x, y] = game.rules.score;
    const hi = Math.max(x, y), lo = Math.min(x, y);
    // 11점 이상, 2점 차. 듀스가 아니면 정확히 11점, 듀스면 정확히 2점 차로 끝
    assert.ok(hi >= RULES.POINTS_TO_WIN && hi - lo >= RULES.WIN_BY, `${tag}: ${x}:${y}`);
    if (lo >= RULES.POINTS_TO_WIN - 1) assert.equal(hi - lo, RULES.WIN_BY, `${tag}: 듀스 ${x}:${y}`);
    else assert.equal(hi, RULES.POINTS_TO_WIN, `${tag}: ${x}:${y}`);
    assert.equal(game.rules.winner, x > y ? -1 : 1);

    // 득점 기록을 다시 더하면 최종 점수, 렛·토스 다시는 점수를 바꾸지 않는다
    const sum = [0, 0];
    for (const r of game.results) {
      assert.equal(r.practice, false);
      if (r.type === 'point') sum[r.winner < 0 ? 0 : 1]++;
      else assert.ok(r.type === 'let' || r.type === 'retoss', r.type);
    }
    assert.deepEqual(sum, [x, y], tag);
    assert.equal(game.results.at(-1).gameOver, true);

    // 매 서브의 서브권자가 그때 점수로 정한 서브권자와 같다 (2점마다, 듀스에서는 1점마다 교대)
    assert.ok(serves.length >= x + y, `${tag}: 서브 ${serves.length}번`);
    for (const s of serves) assert.equal(s.server, serverFor(s.score, s.firstServer).server, `${tag}: ${s.score} 서브권`);
    // 양쪽 로봇 모두 서브했다
    const serveHits = hits.filter((e) => e.shot.quality.serve);
    assert.ok(serveHits.some((e) => e.side === -1) && serveHits.some((e) => e.side === 1), `${tag}: 양쪽 서브`);
    // 서브가 대부분 들어간다 (서브 폴트·토스 실수는 일부만)
    const serveFaults = game.results.filter((r) => ['serveNoBounce', 'serveFault', 'retoss'].includes(r.reason)).length;
    assert.ok(serveFaults <= serves.length * 0.3, `${tag}: 서브 실수 ${serveFaults}/${serves.length}`);
    // 랠리가 실제로 오간다
    const rallies = game.results.filter((r) => r.type === 'point').map((r) => r.rally);
    assert.ok(rallies.reduce((s, v) => s + v, 0) / rallies.length >= 3, `${tag}: 평균 랠리 ${rallies}`);
  }
});

test('AI 대 AI 게임은 같은 시드면 완전히 같게 흘러간다 (결정론)', () => {
  const run = () => playGame(4).game.results.map((r) => [r.type, r.reason, r.winner, r.t]);
  assert.deepEqual(run(), run());
});

// 사람 자리(−1)는 아무것도 하지 않는 플레이어, 로봇(+1)
function humanVsRobot() {
  const human = createPlayer(-1);
  const robot = createAI(1, 'NORMAL', createRng(5));
  const game = createRally({ players: { [-1]: human, [1]: robot.player }, ais: [robot], rng: createRng(1) });
  return { human, robot, game };
}

function runScenario(kind, onStep = () => {}) {
  const h = humanVsRobot();
  for (let i = 0; i < 10; i++) stepMatch(h.game);
  queueScenario(h.game, kind, h.game.ball.t);
  const events = [];
  for (let i = 0; i < 240 * 10 && h.game.results.length === 0; i++) {
    onStep(h);
    events.push(...stepMatch(h.game));
  }
  return { ...h, events, result: h.game.results[0] };
}

test('규칙 시험 공: 렛 · 투 바운드 · 발리 · 아웃이 실제 물리로 나오고, 점수는 바뀌지 않는다', () => {
  const lets = runScenario('let');
  assert.equal(lets.result?.type, 'let');
  assert.ok(lets.events.some((e) => e.type === 'net' && e.over), '네트 윗줄을 스침');

  const two = runScenario('twoBounce');
  assert.equal(two.result?.reason, 'twoBounce');
  assert.equal(two.result.loser, -1);
  assert.equal(two.events.filter((e) => e.type === 'bounce' && e.side === -1).length, 2);

  // 긴 공을 그냥 두면 아웃(보낸 로봇 실점)
  const out = runScenario('volley');
  assert.equal(out.result?.reason, 'out');
  assert.equal(out.result.loser, 1);

  // 버튼을 누른 채 표시된 고리에 라켓을 대면 바운드 전에 맞아 발리(내 실점)
  const volley = runScenario('volley', ({ human, game }) => {
    if (human.apexPos) human.samples.push({ t: game.ball.t, x: human.apexPos.x, y: human.apexPos.z, b: true });
  });
  assert.equal(volley.result?.reason, 'volley');
  assert.equal(volley.result.loser, -1);

  // 시험 공 결과는 점수에 들어가지 않는다: 표시 끝나면 0:0 서브 대기로 돌아감
  for (const s of [lets, two, out, volley]) {
    assert.equal(s.result.practice, true);
    assert.deepEqual(scoreState(s.game).score, [0, 0]);
    for (let i = 0; i < 240 * 3; i++) stepMatch(s.game);
    assert.deepEqual(s.game.rules.score, [0, 0]);
    assert.equal(s.game.rules.phase, 'waitingServe');
  }
});

test('사람 서브: 서브 차례에만 토스되고, 토스 뒤 치지 않으면 점수 없이 다시 토스', () => {
  const { game } = humanVsRobot();       // 첫 서브는 −1 (사람)
  stepMatch(game);
  assert.equal(game.rules.phase, 'waitingServe');
  assert.equal(tossBall(game, 1, 0, game.ball.t), false, '서브권 없는 쪽은 토스 못 함');
  assert.equal(tossBall(game, -1, 0.2, game.ball.t), true);
  assert.equal(game.rules.phase, 'serving');
  for (let i = 0; i < 240 * 3 && !game.results.length; i++) stepMatch(game);
  assert.equal(game.results[0].type, 'retoss');
  for (let i = 0; i < 240 * 3; i++) stepMatch(game);
  assert.equal(game.rules.phase, 'waitingServe');
  assert.equal(game.rules.server, -1);
  assert.deepEqual(game.rules.score, [0, 0]);
});

test('사람 서브: 토스한 공을 위로 쓸어 올리면(드라이브)·아래로 깎으면(커트) 자기 코트 → 상대 코트로 들어간다', () => {
  // 사람 플레이어(로봇 아님)의 마우스 샘플을 직접 만든다: 타점 시각(apexT)에 라켓이 타점에 오도록 일정 속도로 휘두름
  for (const [name, vz, x, shot] of [['드라이브', 2.2, 0.1, 'drive'], ['커트', -1.6, -0.2, 'cut'], ['드라이브 오른쪽', 2.6, 0.4, 'drive']]) {
    const { human, game } = humanVsRobot();
    stepMatch(game);
    const t0 = game.ball.t;
    assert.equal(tossBall(game, -1, x, t0), true);
    assert.ok(human.apexPos && Math.abs(human.apexPos.z - SERVE.HIT_Z) < 1e-9, '타점 고리');
    const tc = human.apexT;
    const z0 = SERVE.HIT_Z - vz * 0.15; // 0.15 s 전 출발점
    human.samples.length = 0;
    human.samples.push({ t: t0, x, y: z0, b: true });
    const events = [];
    for (let i = 0; i < 240 * 3 && !game.results.length; i++) {
      const t = game.ball.t;
      if (t >= tc - 0.15 && t <= tc + 0.1) human.samples.push({ t, x, y: z0 + vz * (t - (tc - 0.15)), b: true });
      events.push(...stepMatch(game));
      if (game.rules.phase === 'rally') break;
    }
    const hit = events.find((e) => e.type === 'racket');
    assert.ok(hit, `${name}: 맞음`);
    assert.equal(hit.shot.shotType, shot, name);
    assert.equal(hit.shot.quality.serve, true);
    assert.equal(game.rules.phase, 'rally', `${name}: 서브 성공 (${game.results.map((r) => r.reason)})`);
    const bounces = events.filter((e) => e.type === 'bounce' || e.type === 'edge').map((e) => e.side);
    assert.deepEqual(bounces, [-1, 1], `${name}: 내 코트 → 로봇 코트`);
  }
});
