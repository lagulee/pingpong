// 6단계: 게임용 중력 G_GAME (.claude/rules/physics.md "게임용 중력")
// 엔진이 맞는지는 physics.test.js가 실제 중력 9.8로 확인하고, 여기서는 중력을 바꿨을 때의 스케일링 법칙을 확인한다.
//   v = √k·u, t = s/√k로 바꾸면  du/ds = −g ẑ − K_D|u|u + K_M(ω/√k) × u
//   → 같은 거리에 필요한 속도 √k배, 체공 시간 1/√k배, 마그누스/중력 비 1/√k배 (공기저항까지 포함해 정확히 성립)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLaunch, step, cloneBall, makeToss, integrate, solveArc, flightLanding, vec, gravity } from '../public/shared/physics.js';
import { PHYSICS, TUNABLE, TUNABLE_DEFAULTS, TUNABLE_RANGES } from '../public/shared/constants.js';

const DT = PHYSICS.DT;
const withG = (k) => ({ ...TUNABLE_DEFAULTS, G_GAME: k * PHYSICS.G });
const POS = vec(0, -1.6, 0.3);

// 첫 충돌까지 날려 { y, t } (t = 비행 시간)
function fly(ball, params) {
  const b = cloneBall(ball);
  for (let i = 0; i < 240 * 5; i++) {
    const ev = step(b, DT, { params });
    if (ev.length) return { type: ev[0].type, y: ev[0].pos.y, t: ev[0].t - ball.t };
  }
  return null;
}
// 발사각 20° 무회전 공이 0.8 m 지점에 떨어지는 속도 (이분법)
function speedFor(params) {
  let lo = 1, hi = 20;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    const r = fly(makeLaunch({ pos: POS, speed: m, elevation: 20 }), params);
    if (r.type === 'net' || r.y < 0.8) lo = m; else hi = m;
  }
  return hi;
}

test('게임용 중력: 같은 거리에 필요한 속도 √k배, 체공 시간 1/√k배 (오차 1% 이내)', () => {
  const v1 = speedFor(withG(1));
  const t1 = fly(makeLaunch({ pos: POS, speed: v1, elevation: 20 }), withG(1)).t;
  for (const k of [0.8, 0.7, 0.6]) {
    const v = speedFor(withG(k));
    const t = fly(makeLaunch({ pos: POS, speed: v, elevation: 20 }), withG(k)).t;
    assert.ok(Math.abs(v / v1 / Math.sqrt(k) - 1) < 0.01, `k=${k}: 속도비 ${(v / v1).toFixed(4)} / √k ${Math.sqrt(k).toFixed(4)}`);
    assert.ok(Math.abs((t / t1) * Math.sqrt(k) - 1) < 0.01, `k=${k}: 체공비 ${(t / t1).toFixed(4)} / 1/√k ${(1 / Math.sqrt(k)).toFixed(4)}`);
    // 마그누스/중력 비: K_M·ω·v / g 에 v ∝ √k, g ∝ k를 넣으면 1/√k
    const ratio = (TUNABLE.K_M * 2 * Math.PI * 50 * v / (k * PHYSICS.G)) / (TUNABLE.K_M * 2 * Math.PI * 50 * v1 / PHYSICS.G);
    assert.ok(Math.abs(ratio * Math.sqrt(k) - 1) < 0.01, `k=${k}: 마그누스/중력 비 ${ratio.toFixed(4)}`);
  }
});

test('게임용 중력: 같은 속도·회전으로 쳐도 회전의 휘는 효과가 더 크게 보인다 (탑스핀 낙하 거리 증가)', () => {
  // 스케일된 속도에서 탑스핀 15 rps 공이 무회전보다 짧게 떨어지는 거리: 중력이 낮을수록 크다
  const dip = (k) => {
    const v = 5.983 * Math.sqrt(k); // 실제 중력에서 0.8 m에 떨어지는 속도의 √k배
    const plain = fly(makeLaunch({ pos: POS, speed: v, elevation: 20 }), withG(k));
    const top = fly(makeLaunch({ pos: POS, speed: v, elevation: 20, topspin: 15 }), withG(k));
    return plain.y - top.y;
  };
  assert.ok(dip(0.6) > dip(0.8) && dip(0.8) > dip(1), `${dip(1).toFixed(3)} < ${dip(0.8).toFixed(3)} < ${dip(0.6).toFixed(3)}`);
});

test('G_GAME: 기본값은 실제 중력의 0.6배, 슬라이더는 0.5배~1배 (풍선처럼 보이는 0.5배 아래는 막음)', () => {
  assert.ok(Math.abs(TUNABLE_DEFAULTS.G_GAME - 0.6 * PHYSICS.G) < 0.01);
  assert.equal(gravity(TUNABLE_DEFAULTS), TUNABLE_DEFAULTS.G_GAME);
  assert.equal(gravity({}), PHYSICS.G);
  assert.ok(TUNABLE_RANGES.G_GAME.min >= 0.5 * PHYSICS.G - 1e-9 && TUNABLE_RANGES.G_GAME.max <= PHYSICS.G + 1e-9);
});

test('토스: 중력을 바꿔도 같은 높이까지 올라간다 (속도 = √(2·g·높이))', () => {
  const top = (params) => {
    const b = makeToss(0, 0, params);
    let z = b.pos.z;
    for (let i = 0; i < 480; i++) { integrate(b, DT, params); z = Math.max(z, b.pos.z); }
    return z;
  };
  const h1 = top(withG(1)), h6 = top(withG(0.6)), h5 = top(withG(0.5));
  assert.ok(Math.abs(h1 - h6) < 0.02 && Math.abs(h1 - h5) < 0.02, `${h1.toFixed(3)} / ${h6.toFixed(3)} / ${h5.toFixed(3)}`);
});

// 정점이 높을수록 수평 속도는 줄고 체공은 늘어난다 (총속도는 발사각이 45°를 넘으면 위쪽 성분 때문에 다시 커질 수 있다)
test('정점 조준(solveArc): 목표 착지 5 cm, 목표 정점 3 cm 이내. 정점이 높을수록 수평으로 느리고 오래 난다', () => {
  const cases = [
    { pos: vec(0.2, -1.5, 0.6), target: { x: -0.3, y: 0.8 }, topspin: 50 },
    { pos: vec(-0.3, -1.6, 0.4), target: { x: 0.4, y: 0.7 }, topspin: 30 },
    { pos: vec(0, -1.2, 0.7), target: { x: 0, y: 0.9 }, topspin: -30 },
    { pos: vec(0.3, -1.65, 0.3), target: { x: -0.2, y: 0.8 }, topspin: 15, sidespin: 40 },
  ];
  for (const c of cases) {
    let prev = null;
    for (const apex of [0.85, 1.0, 1.15]) {
      const r = solveArc({ ...c, apex, vMin: 0, vMax: 30 });
      assert.equal(r.clamped, false, JSON.stringify(c));
      const l = flightLanding(r.ball);
      assert.ok(Math.hypot(l.x - c.target.x, l.y - c.target.y) < 0.05, `착지 (${l.x.toFixed(3)}, ${l.y.toFixed(3)})`);
      assert.ok(Math.abs(r.apex - apex) < 0.03, `정점 ${r.apex} / ${apex}`);
      const t = fly(r.ball, TUNABLE).t;
      const vh = Math.hypot(r.ball.vel.x, r.ball.vel.y);
      if (prev) assert.ok(vh < prev.vh && t > prev.t, `정점 ${apex}: 수평 속도 ${vh} / 체공 ${t}`);
      prev = { vh, t };
    }
  }
});

test('정점 조준: 속도가 한계 밖이면 한계 속도로 가장 낮은 각 조준(solveAim)을 쓴다', () => {
  const r = solveArc({ pos: POS, target: { x: 0, y: 0.8 }, topspin: 30, apex: 1.0, vMin: 7, vMax: 8 });
  assert.equal(r.clamped, true);
  assert.equal(r.speed, 7);
});
