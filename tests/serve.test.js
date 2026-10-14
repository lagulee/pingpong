// v4.1: 쉬워진 서브와 서브 가이드라인
// - 서브는 도달 범위가 넓고(SERVE_HIT_RADIUS), 오차가 작고(SERVE_ERR_SCALE), 낮은 타점이면 속도를 올려 준다(SERVE_ASSIST_V)
// - 가이드라인은 내 코트 → 상대 코트로 들어가는 궤적이고, 실제로 그렇게 친 서브와 거의 같은 곳에 떨어진다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAI, createRally, createPlayer, stepMatch, tossBall, serveGuide } from '../public/js/ai.js';
import { createRng, classifyShot, checkHit } from '../public/js/input.js';
import { createBall, vec, ballToWorld, toLocal, serveLanding } from '../public/shared/physics.js';
import { SERVE, SERVE_GUIDE, TUNABLE, PHYSICS } from '../public/shared/constants.js';

function humanVsRobot(seed = 1) {
  const human = createPlayer(-1);
  const robot = createAI(1, 'NORMAL', createRng(seed + 4));
  const game = createRally({ players: { [-1]: human, [1]: robot.player }, ais: [robot], rng: createRng(seed) });
  return { human, game };
}

// 사람 서브 한 번: 토스 → 타점 시각 + dtOff에 라켓이 (타점 높이 + dz)를 지나도록 세로로 일정 속도 vz로 휘두른다
function humanServe({ vz, dtOff = 0, dz = 0, x = 0, seed = 1 }) {
  const { human, game } = humanVsRobot(seed);
  stepMatch(game);
  const t0 = game.ball.t;
  tossBall(game, -1, x, t0);
  const tc = human.apexT + dtOff;
  const T = SERVE_GUIDE.SWING_TIME;
  const z0 = SERVE.HIT_Z + dz - vz * T;
  human.samples.length = 0;
  human.samples.push({ t: t0, x, y: z0, b: true });
  const events = [];
  for (let i = 0; i < 240 * 4 && !game.results.length; i++) {
    const t = game.ball.t;
    if (t >= tc - T && t <= tc + 0.1) human.samples.push({ t, x, y: z0 + vz * (t - (tc - T)), b: true });
    events.push(...stepMatch(game));
    if (game.rules.phase === 'rally' && events.some((e) => (e.type === 'bounce' || e.type === 'edge') && e.side === 1)) break;
  }
  return { game, events, hit: events.find((e) => e.type === 'racket') ?? null };
}

const guideSwing = () => TUNABLE.BLOCK_SPEED + SERVE_GUIDE.STRENGTH * (TUNABLE.SPEED_FULL - TUNABLE.BLOCK_SPEED);

test('서브 가이드라인: 양쪽 모두, 토스 위치 어디서나 내 코트 → 상대 코트로 들어가는 궤적', () => {
  for (const side of [-1, 1]) {
    for (const x of [-SERVE.TOSS_X_MAX, -0.3, 0, 0.3, SERVE.TOSS_X_MAX]) {
      const g = serveGuide(side, x);
      assert.ok(g, `side ${side}, x ${x}: 가이드 있음`);
      assert.equal(g.bounces.length, 2);
      assert.ok(toLocal(g.bounces[0], side).y < 0, '첫 바운드는 내 코트');
      assert.ok(toLocal(g.bounces[1], side).y > 0, '두 번째는 상대 코트');
      assert.ok(Math.abs(g.hit.z - SERVE.HIT_Z) < 1e-9, '타점은 고리 높이');
      assert.ok(g.points.length > 10, '점선 점');
      assert.equal(g.shotType, 'drive');
    }
  }
});

test('서브 가이드라인: 가이드대로 정점에서 위로 휘두르면 가이드 착지점 근처에 떨어진다', () => {
  for (const x of [-0.3, 0, 0.25]) {
    const g = serveGuide(-1, x);
    const { game, events, hit } = humanServe({ vz: guideSwing(), x });
    assert.ok(hit, `x ${x}: 맞음`);
    assert.equal(game.rules.phase, 'rally', `x ${x}: 서브 성공 (${game.results.map((r) => r.reason)})`);
    const land = events.filter((e) => e.type === 'bounce' || e.type === 'edge')[1];
    const d = Math.hypot(land.pos.x - g.bounces[1].x, land.pos.y - g.bounces[1].y);
    assert.ok(d < 0.15, `x ${x}: 가이드와 실제 착지점 거리 ${d.toFixed(3)} m`);
  }
});

test('쉬운 서브: 타이밍이 ±80 ms 어긋나거나 10 cm 빗맞아도 대부분 들어간다', () => {
  let ok = 0, n = 0;
  for (const vz of [1.5, 2.5, 3.5]) {
    for (const dtOff of [-0.08, -0.04, 0, 0.04, 0.08]) {
      for (const dz of [-0.1, 0, 0.1]) {
        n++;
        const { game } = humanServe({ vz, dtOff, dz, x: 0.1, seed: n });
        if (game.rules.phase === 'rally') ok++;
      }
    }
  }
  assert.ok(ok / n >= 0.9, `서브 성공 ${ok}/${n}`);
});

test('서브 도달 범위: 랠리 범위 밖이지만 서브 범위 안이면 맞는다', () => {
  const player = { side: -1, yPlane: SERVE.TOSS_Y, samples: [{ t: 0, x: 0, y: 0.3, b: true }, { t: 0.1, x: 0, y: 0.3, b: true }] };
  const off = (TUNABLE.HIT_RADIUS + TUNABLE.SERVE_HIT_RADIUS) / 2;
  assert.ok(TUNABLE.SERVE_HIT_RADIUS > TUNABLE.HIT_RADIUS);
  // 버튼 누른 채 멈춘 라켓의 평면을 지나가는 공 (블록 판정 경로)
  const ball = createBall({ pos: vec(off, SERVE.TOSS_Y + 0.001, 0.3), vel: vec(0, -2, 0), t: 0.1 });
  assert.equal(checkHit(player, ball, 0.1, PHYSICS.DT), null, '랠리 범위');
  assert.equal(checkHit(player, ball, 0.1, PHYSICS.DT, TUNABLE, TUNABLE.SERVE_HIT_RADIUS), 'block', '서브 범위');
});

test('서브 속도 보조: 늦게 쳐서 타점이 낮아도 느린 스윙 서브가 들어간다', () => {
  for (const z of [0.15, 0.2]) {
    const samples = [];
    for (let k = 0; k <= 12; k++) samples.push({ t: -0.1 + k / 120, x: 0, y: z - 1.2 * (0.1 - k / 120), b: true });
    const ball = ballToWorld(createBall({ pos: vec(0, SERVE.TOSS_Y, z), vel: vec(0, 0, -2), t: 0 }), -1);
    const shot = classifyShot(samples, ball, { t: 0, side: -1, apexT: 0, serve: true });
    const l = serveLanding(createBall({ pos: ball.pos, vel: shot.vel, spin: shot.spin, t: 0 }), TUNABLE, 0);
    assert.ok(l.own && !l.short && l.y > 0, `타점 ${z} m: 착지 ${l.y}`);
    const speed = Math.hypot(shot.vel.x, shot.vel.y, shot.vel.z);
    assert.ok(speed <= TUNABLE.SERVE_ASSIST_V * (1 + TUNABLE.ERR_SPEED) + 1e-9, `속도 ${speed}`);
  }
});
