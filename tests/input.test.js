// 2단계 타격 판정 테스트 (.claude/rules/input.md 검증 1~3 + 추가 테스트)
// 7단계: 구질은 버튼(샘플의 k)이 정한다. 드래그 방향은 구질 판정에 쓰지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyShot, analyzeDrag, judgeType, gradeTiming, aimErrors, createRng, rayPlaneY,
  sampleAt, pruneSamples, checkHit, spinLambda, racketLocal, buttonAt, createShotKeys, stackSpin, spinParts,
} from '../public/js/input.js';
import {
  createBall, step, predictPath, positionAt, makeLaunch, ballToLocal, toWorld, flightLanding, cloneBall,
} from '../public/shared/physics.js';
import { BALL, NET, TABLE, PHYSICS, SWING, TUNABLE, TUNABLE_DEFAULTS, TUNABLE_GROUPS, TUNABLE_RANGES } from '../public/shared/constants.js';

const R = BALL.RADIUS;
const DT = PHYSICS.DT;
const RPS = 2 * Math.PI;

// 드래그 샘플: 시각 t1에 (x1, z1)에 도착하는 T초짜리 직선(+옆으로 볼록한 호) 드래그, 120 Hz, 구질 버튼 k
function drag({ ux, uy, x1 = 0, z1 = 0.25, t1 = 1, T = 0.15, curve = 0, b = true, hz = 120, k = null }) {
  const n = Math.round(T * hz);
  const sp = Math.hypot(ux, uy) || 1;
  const L = Math.hypot(ux, uy) * T;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const tau = i / n;
    const back = T * (1 - tau);
    const bump = curve * L * 4 * tau * (1 - tau);
    out.push({ t: t1 - back, x: x1 - ux * back + (-uy / sp) * bump, y: z1 - uy * back + (ux / sp) * bump, b, k });
  }
  return out;
}

// 내(side −1) 쪽으로 오는 공: 기준 좌표 위치·속도·회전(rps, 들어오는 방향 기준 탑스핀 +)으로 만든다
function incoming({ x = 0, y = -1.5, z = 0.25, vy = -5, vz = 0, topspin = 0, sidespin = 0, t = 1 } = {}) {
  // 진행 방향 −y 기준 탑스핀 축 = ẑ × (−ŷ) = +x
  return createBall({ pos: { x, y, z }, vel: { x: 0, y: vy, z: vz }, spin: { x: topspin * RPS, y: 0, z: sidespin * RPS }, t });
}

// 친 공을 진행시켜 첫 충돌을 본다 (기준 좌표 = 세계 좌표, side −1)
function firstEvent(ball, seconds = 2) {
  const b = cloneBall(ball);
  let maxYAboveNet = -Infinity;
  for (let i = 0; i < seconds / DT; i++) {
    const ev = step(b, DT);
    if (b.pos.z > NET.HEIGHT) maxYAboveNet = Math.max(maxYAboveNet, b.pos.y);
    if (ev.length) return { event: ev[0], ball: b };
  }
  return { event: null, ball: b };
}

const out = (ballIn, r) => createBall({ pos: ballIn.pos, vel: r.vel, spin: r.spin, t: ballIn.t });
const onOppTable = (e) => e && (e.type === 'bounce' || e.type === 'edge') && e.pos.y > 0;

// 대표 스윙 6종 (공 위치에 라켓 중심이 도착). 7단계: 버튼(k)이 구질, 스윙은 세기·좌우 조준
const SAMPLES = {
  drive: (b) => drag({ ux: 0.1, uy: 1.8, x1: b.pos.x, z1: b.pos.z, t1: b.t, k: 'drive' }),
  smash: (b) => drag({ ux: 0, uy: -4.0, x1: b.pos.x, z1: b.pos.z, t1: b.t, k: 'smash' }), // 빠르게 내려치기 (최고 속도 기준)
  cut: (b) => drag({ ux: 0, uy: -1.0, x1: b.pos.x, z1: b.pos.z, t1: b.t, k: 'cut' }),
  side: (b) => drag({ ux: 1.8, uy: 0.2, x1: b.pos.x, z1: b.pos.z, t1: b.t, curve: 0.25, T: 0.1, k: 'side' }),
  block: (b) => drag({ ux: 0.02, uy: 0.01, x1: b.pos.x, z1: b.pos.z, t1: b.t }),
  normal: (b) => drag({ ux: 0.1, uy: 1.8, x1: b.pos.x, z1: b.pos.z, t1: b.t }), // 버튼 없이 휘두르기
};
const LOW = () => incoming({ z: 0.25 });
// 높은 공: v6.0에서 스매시 높이가 네트 + 50 cm(0.65 m)로 올라 0.55 → 0.75 m
const HIGH = () => incoming({ y: -1.3, z: 0.75, vy: -3 });

// ── input.md 검증 테스트 ─────────────────────────────────────

// 7단계: 기존 "드래그 방향 5종 → 5구질"은 구질을 버튼이 정하게 되어 "버튼 4종 + 일반 + 블록 → 6구질"로 바꿨다
test('[1] 구질 버튼 4종 + 버튼 없는 스윙 + 멈춤이 각각 드라이브·스매시·커트·사이드스핀·일반·블록으로 판정된다', () => {
  for (const [type, mk] of Object.entries(SAMPLES)) {
    const b = type === 'smash' ? HIGH() : LOW();
    const r = classifyShot(mk(b), b, { apexT: b.t });
    assert.equal(r.shotType, type, `${type} 샘플 → ${r.shotType}`);
    assert.ok(['vel', 'spin', 'quality'].every((k) => k in r));
  }
  // 드래그 방향은 구질을 바꾸지 않는다: 위로 쓸어도 커트 버튼이면 커트, 아래로 쓸어도 드라이브 버튼이면 드라이브
  const b0 = LOW();
  assert.equal(classifyShot(drag({ ux: 0, uy: 1.8, z1: b0.pos.z, t1: b0.t, k: 'cut' }), b0).shotType, 'cut');
  assert.equal(classifyShot(drag({ ux: 0, uy: -1.8, z1: b0.pos.z, t1: b0.t, k: 'drive' }), b0).shotType, 'drive');
  assert.equal(classifyShot(drag({ ux: 1.8, uy: 0, z1: b0.pos.z, t1: b0.t, curve: 0.3 }), b0).shotType, 'normal', '곡선이어도 버튼 없으면 일반');
  // 일반 스윙은 무회전 (들어온 공도 무회전이면 회전이 0)
  const n = classifyShot(SAMPLES.normal(b0), b0);
  assert.ok(Math.hypot(n.spin.x, n.spin.y, n.spin.z) < 1e-9, '일반 스윙 = 무회전');
  // 구질별 결과 특징: 드라이브 탑스핀, 커트 백스핀(+y로 칠 때 탑스핀 축은 −x), 스매시가 가장 빠름
  const b = LOW(), h = HIGH();
  const d = classifyShot(SAMPLES.drive(b), b), c = classifyShot(SAMPLES.cut(b), b), s = classifyShot(SAMPLES.smash(h), h);
  assert.ok(d.spin.x < 0, '드라이브 = 탑스핀');
  assert.ok(c.spin.x > 0, '커트 = 백스핀');
  const sp = (r) => Math.hypot(r.vel.x, r.vel.y, r.vel.z);
  assert.ok(sp(s) > sp(d) && sp(d) > sp(c), `스매시 ${sp(s)} > 드라이브 ${sp(d)} > 커트 ${sp(c)}`);
});

// 7단계: LOW_SMASH_MISHIT 설정이 없어지고, 낮은 공(노란 고리)에 스매시 버튼을 쓰면 항상 실타(네트)다
test('[2] 낮은 공에 스매시 버튼을 쓰면 스매시로 판정되지 않고 무조건 네트에 걸린다', () => {
  for (const z of [0.1, 0.2, 0.3, NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT - 0.01]) {
    const b = incoming({ z });
    const r = classifyShot(SAMPLES.smash(b), b, { apexT: b.t });
    assert.notEqual(r.shotType, 'smash', `z = ${z}`);
    assert.equal(r.shotType, 'mishit');
    const { event, ball } = firstEvent(out(b, r));
    assert.equal(event.type, 'net', `z = ${z}: 첫 충돌 ${event.type}`);
    assert.equal(event.over, false);
    assert.ok(ball.pos.y < 0);
  }
  // 경계: 네트 + SMASH_MIN_HEIGHT 이상이면 스매시
  const hi = incoming({ z: NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT + 0.01 });
  assert.equal(classifyShot(SAMPLES.smash(hi), hi).shotType, 'smash');
});

// 7단계: v6.3의 "낮은 공 빠른 내려치기 = 커트"는 방향 판정이 없어져 "버튼 없이 = 일반 스윙"이 됐다
test('낮은 공을 버튼 없이 빠르게 내려치면 일반 스윙(실타 아님) — 무회전 공이면 상대 코트에 들어간다', () => {
  for (const z of [0.15, 0.25, 0.35, NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT - 0.01]) {
    const b = incoming({ z });
    const r = classifyShot(drag({ ux: 0, uy: -4.0, z1: b.pos.z, t1: b.t }), b, { apexT: b.t });
    assert.equal(r.shotType, 'normal', `z = ${z}`);
    assert.equal(r.quality.strength, 1);
    const { event } = firstEvent(out(b, r));
    assert.ok(onOppTable(event), `z = ${z}: 첫 충돌 ${event?.type} y=${event?.pos.y.toFixed(2)}`);
  }
  // 높은 공(빨간 고리) + 스매시 버튼 = 스매시. 스매시 기준 속도(smashSpeed)를 두면 그보다 느린 스윙은 일반 스윙
  // (v7.3 사용자 요청으로 기본값 SMASH_SPEED = 0: 느린 스윙도 약한 스매시. 기준 동작은 값을 직접 넘겨 확인한다)
  const hi = incoming({ y: -1.3, z: 0.75, vy: -3 });
  assert.equal(classifyShot(SAMPLES.smash(hi), hi).shotType, 'smash');
  const slowSwing = drag({ ux: 0, uy: -1.0, z1: hi.pos.z, t1: hi.t, k: 'smash' });
  const slow = classifyShot(slowSwing, hi, { smashSpeed: 2.0 });
  assert.equal(slow.shotType, 'normal');
  assert.equal(slow.quality.smashSlow, true);
  assert.equal(classifyShot(slowSwing, hi).shotType, 'smash', '기본값: 느린 스윙도 스매시');
  // 방향은 상관없다: 위로 세게 휘둘러도 스매시 버튼이면 스매시
  assert.equal(classifyShot(drag({ ux: 0, uy: 4.0, z1: hi.pos.z, t1: hi.t, k: 'smash' }), hi).shotType, 'smash');
  // 서브에서는 스매시 버튼을 막는다 (일반 서브)
  const toss = incoming({ z: 0.3, vy: 0, vz: -1 });
  const sv = classifyShot(SAMPLES.smash(toss), toss, { serve: true });
  assert.equal(sv.shotType, 'normal');
  assert.equal(sv.quality.smashNoServe, true);
});

test('[3] 백스핀 공을 블록하면 반사된 공이 네트를 넘지 못한다', () => {
  for (const [rps, vy] of [[40, -4], [30, -5], [50, -3.5]]) {
    const b = incoming({ topspin: -rps, vy });
    const r = classifyShot(SAMPLES.block(b), b, { apexT: b.t });
    assert.equal(r.shotType, 'block');
    const { event } = firstEvent(out(b, r));
    assert.ok(!onOppTable(event), `백스핀 ${rps} rps: 상대 코트에 들어감 (${event?.type} y=${event?.pos.y})`);
    // 같은 공에 회전만 없으면 블록이 상대 코트에 들어간다 (면 각도 자체는 맞다)
    const flat = incoming({ vy });
    const r2 = classifyShot(SAMPLES.block(flat), flat, { apexT: flat.t });
    assert.ok(onOppTable(firstEvent(out(flat, r2)).event), `무회전 ${vy}: 블록 실패`);
  }
});

// ── 추가 테스트 ──────────────────────────────────────────

test('탑스핀 공을 블록하면 백스핀 공을 블록했을 때보다 높고 길게 나간다', () => {
  const top = incoming({ topspin: 40 }), back = incoming({ topspin: -40 });
  const rt = classifyShot(SAMPLES.block(top), top), rb = classifyShot(SAMPLES.block(back), back);
  assert.ok(rt.vel.z > rb.vel.z, `탑 v_z ${rt.vel.z} / 백 v_z ${rb.vel.z}`);
  // 탑스핀 공 블록은 면을 덮어(λ_top 작음) 상대 코트에 들어간다
  assert.ok(onOppTable(firstEvent(out(top, rt)).event));
  assert.ok(spinLambda('block', top) < spinLambda('block', back));
});

test('무회전 공을 PERFECT로 치면 6구질(일반 포함) 모두 상대 코트, 목표 지점 5 cm 이내에 떨어진다', () => {
  for (const [type, mk] of Object.entries(SAMPLES)) {
    const b = type === 'smash' ? HIGH() : LOW();
    const r = classifyShot(mk(b), b, { apexT: b.t, rng: createRng(1) });
    assert.equal(r.quality.timing, 'PERFECT');
    const { event } = firstEvent(out(b, r));
    assert.ok(onOppTable(event), `${type}: ${event?.type} y=${event?.pos.y}`);
    const d = Math.hypot(event.pos.x - r.quality.target.x, event.pos.y - r.quality.target.y);
    assert.ok(d < 0.05, `${type}: 목표에서 ${d.toFixed(3)} m`);
  }
});

test('바운드 직후 수평 속도: 드라이브 > 커트 (뻗음 / 멈칫)', () => {
  const b = LOW();
  const after = (type) => {
    const r = classifyShot(SAMPLES[type](b), b);
    const { event, ball } = firstEvent(out(b, r));
    assert.ok(onOppTable(event));
    return { before: r.vel.y, after: ball.vel.y };
  };
  const d = after('drive'), c = after('cut');
  assert.ok(d.after > c.after, `드라이브 ${d.after} / 커트 ${c.after}`);
});

test('타이밍 판정 경계값', () => {
  // 경계는 TUNABLE의 판정 창에서 1 ms 안팎 (v4.1에서 창을 넓혔다: 50 / 130 / 240 ms)
  const g = (ms) => gradeTiming(ms / 1000).timing;
  const P = TUNABLE.PERFECT_WINDOW * 1000, G = TUNABLE.GOOD_WINDOW * 1000, O = TUNABLE.OK_WINDOW * 1000;
  assert.ok(P < G && G < O);
  assert.equal(g(0), 'PERFECT');
  assert.equal(g(P - 1), 'PERFECT');
  assert.equal(g(-(P - 1)), 'PERFECT');
  assert.equal(g(P + 1), 'GOOD');
  assert.equal(g(G - 1), 'GOOD');
  assert.equal(g(-(G + 1)), 'OK');
  assert.equal(g(O - 1), 'OK');
  assert.equal(g(O + 1), 'BAD');
  assert.equal(gradeTiming(Infinity).timing, 'BAD');
  assert.equal(gradeTiming(NaN).timing, 'BAD');
  const acc = ['PERFECT', 'GOOD', 'OK', 'BAD'].map((_, i) => gradeTiming([0, (P + G) / 2000, (G + O) / 2000, O / 500][i]).accuracy);
  assert.deepEqual(acc, [1, 0.75, 0.5, 0.25]);
});

test('정확도가 낮을수록 방향 퍼짐이 커지고, 각도 오차는 최댓값을 넘지 않는다', () => {
  const spread = (accuracy) => {
    const rng = createRng(7);
    let s2 = 0, max = 0;
    for (let i = 0; i < 2000; i++) {
      const e = aimErrors(accuracy, 0, rng);
      s2 += e.yaw * e.yaw;
      max = Math.max(max, Math.abs(e.yaw));
    }
    return { sd: Math.sqrt(s2 / 2000), max };
  };
  const p = spread(1), g = spread(0.75), o = spread(0.5), b = spread(0.25);
  assert.equal(p.sd, 0, 'PERFECT는 오차 0');
  assert.ok(g.sd < o.sd && o.sd < b.sd, `${g.sd} < ${o.sd} < ${b.sd}`);
  // 늦게 친 경우 치우침 포함 최대 오차: (1 − a)·(ERR_YAW + ERR_BIAS) ≤ 13°
  for (const a of [0, 0.25, 0.5]) {
    const rng = createRng(3);
    for (let i = 0; i < 2000; i++) {
      const e = aimErrors(a, 0.2, rng);
      assert.ok(Math.abs(e.yaw) <= (1 - a) * (TUNABLE.ERR_YAW + TUNABLE.ERR_BIAS) + 1e-9);
      assert.ok(Math.abs(e.pitch) <= (1 - a) * TUNABLE.ERR_PITCH + 1e-9);
    }
  }
  // 실제 착지점도 BAD일 때 더 퍼진다
  const landSpread = (dtApex) => {
    const rng = createRng(11);
    const xs = [];
    for (let i = 0; i < 30; i++) {
      const b = LOW();
      const r = classifyShot(SAMPLES.drive(b), b, { apexT: b.t - dtApex, rng });
      xs.push(firstEvent(out(b, r)).event.pos.x);
    }
    const m = xs.reduce((a, c) => a + c, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, c) => a + (c - m) ** 2, 0) / xs.length);
  };
  assert.ok(landSpread(0.3) > landSpread(0.06) + 0.01);
});

test('같은 샘플·같은 시드면 판정 결과가 완전히 같다 (결정론)', () => {
  const run = () => {
    const b = incoming({ topspin: 20, sidespin: -10 });
    return classifyShot(SAMPLES.side(b), b, { apexT: b.t + 0.12, rng: createRng(42) });
  };
  assert.deepStrictEqual(run(), run());
  const a = createRng(5), c = createRng(5);
  for (let i = 0; i < 100; i++) assert.equal(a(), c());
});

test('80 ms보다 오래된 드래그는 판정에 영향이 없고, 샘플이 부족하면 블록이다', () => {
  // 0.3 s 전에 크게 움직였다가 그 뒤로 정지
  const old = drag({ ux: 0, uy: 3, t1: 0.7, z1: 0.25 });
  const still = [0.75, 0.8, 0.85, 0.9, 0.95, 1.0].map((t) => ({ t, x: 0, y: 0.25, b: true }));
  const d = analyzeDrag([...old, ...still], 1.0);
  assert.equal(d.speed, 0);
  assert.equal(judgeType(d, 0.25), 'block');
  // 샘플 하나 / 없음
  assert.equal(analyzeDrag([{ t: 1, x: 0, y: 0, b: true }], 1).speed, 0);
  assert.equal(analyzeDrag([], 1).speed, 0);
  const b = LOW();
  assert.equal(classifyShot([], b).shotType, 'block');
  // 접촉 뒤 샘플은 보지 않는다
  const future = [...still, { t: 1.05, x: 0, y: 0.6, b: true }];
  assert.equal(analyzeDrag(future, 1.0).speed, 0);
  // 오래된 샘플 정리
  const s = [...old, ...still];
  pruneSamples(s, 2);
  assert.ok(s.length >= 1 && s[0].t >= 1.0 - SWING.MAX_SAMPLE_AGE - 0.01);
});

test('좌우로 반대로 그으면 사이드스핀 부호와 휘는 방향이 반대가 된다', () => {
  const b = LOW();
  const right = classifyShot(drag({ ux: 1.8, uy: 0.2, curve: 0.25, x1: 0, z1: b.pos.z, t1: b.t, T: 0.1, k: 'side' }), b);
  const left = classifyShot(drag({ ux: -1.8, uy: 0.2, curve: -0.25, x1: 0, z1: b.pos.z, t1: b.t, T: 0.1, k: 'side' }), b);
  assert.equal(right.shotType, 'side');
  assert.equal(left.shotType, 'side');
  assert.ok(right.spin.z > 0 && left.spin.z < 0, `${right.spin.z} / ${left.spin.z}`);
  // 오른쪽으로 쓸어 친 공(ω_z > 0)은 진행 방향 왼쪽(−x)으로 휜다: 공중에서 x 가속도가 음수
  const curveX = (r) => {
    const a = out(b, r), c = createBall({ ...a, spin: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 40; i++) { step(a, DT); step(c, DT); }
    return a.pos.x - c.pos.x;
  };
  assert.ok(curveX(right) < 0 && curveX(left) > 0);
  // 바운드 후 옆으로 꺾임: 바운드 전후 x 속도 변화 부호가 서로 반대
  const kick = (r) => {
    const { event, ball } = firstEvent(out(b, r));
    assert.ok(onOppTable(event));
    return ball.vel.x - r.vel.x;
  };
  assert.ok(Math.sign(kick(right)) === -Math.sign(kick(left)));
});

test('곡률 계산: 직선은 0, 호는 휜 정도만큼', () => {
  const line = drag({ ux: 2, uy: 0, T: 0.1 });
  assert.ok(Math.abs(analyzeDrag(line, 1).kappa) < 1e-9);
  const arc = drag({ ux: 2, uy: 0, T: 0.1, curve: 0.2 });
  const k = analyzeDrag(arc, 1).kappa;
  assert.ok(Math.abs(Math.abs(k) - 0.2) < 0.02, `κ = ${k}`);
});

test('화면 광선 → 라켓 평면 교점', () => {
  const p = rayPlaneY({ x: 0, y: -2.9, z: 0.85 }, { x: 0.1, y: 1, z: -0.2 }, -1.6);
  assert.ok(Math.abs(p.x - 0.13) < 1e-9 && Math.abs(p.z - (0.85 - 0.26)) < 1e-9);
  assert.equal(rayPlaneY({ x: 0, y: -2.9, z: 0.85 }, { x: 0, y: -1, z: 0 }, -1.6), null, '뒤쪽');
  assert.equal(rayPlaneY({ x: 0, y: -2.9, z: 0.85 }, { x: 1, y: 0, z: 0 }, -1.6), null, '평행');
  const far = rayPlaneY({ x: 0, y: -2.9, z: 0.85 }, { x: 5, y: 1, z: 5 }, -1.6);
  assert.equal(far.x, SWING.X_MAX);
  assert.equal(far.z, SWING.Z_MAX);
});

test('predictPath: 예측한 바운드·정점이 실제 step 시뮬레이션과 일치한다', () => {
  const b = toWorldBall(makeLaunch({ pos: { x: 0.1, y: -1.5, z: 0.25 }, speed: 7, elevation: 14, topspin: 30, sidespin: 10 }), 1);
  const pred = predictPath(b, -1);
  assert.ok(pred.bounce && pred.bounce.side === -1);
  assert.ok(pred.apex && pred.apex.t > pred.bounce.t);
  const real = cloneBall(b);
  const events = [];
  while (real.t < pred.apex.t - 1e-9) events.push(...step(real, DT));
  assert.deepStrictEqual(events, pred.events);
  assert.deepStrictEqual(real.pos, pred.apex.pos);
  assert.ok(real.vel.z <= 0);
  // 정점 이후 기록 위치도 실제와 같다
  const t2 = pred.apex.t + 0.1;
  const p2 = positionAt(pred.states, t2);
  while (real.t < t2 - 1e-9) step(real, DT);
  assert.ok(Math.hypot(p2.x - real.pos.x, p2.y - real.pos.y, p2.z - real.pos.z) < 1e-9);
});

function toWorldBall(b, side) {
  return createBall({ pos: toWorld(b.pos, side), vel: toWorld(b.vel, side), spin: toWorld(b.spin, side), t: b.t });
}

test('반대편(side +1) 플레이어의 판정은 기준 좌표를 180° 돌린 결과와 같다', () => {
  const b = incoming({ x: 0.2, topspin: 15 });
  const samples = SAMPLES.drive(b).map((s) => ({ ...s, x: s.x })); // 샘플은 각자 기준 좌표
  const mine = classifyShot(samples, b, { side: -1, apexT: b.t });
  const mirrored = toWorldBall(b, 1); // 같은 상황을 반대편으로 옮김
  const theirs = classifyShot(samples, mirrored, { side: 1, apexT: b.t });
  assert.equal(theirs.shotType, mine.shotType);
  for (const k of ['x', 'y']) assert.ok(Math.abs(theirs.vel[k] + mine.vel[k]) < 1e-9);
  assert.ok(Math.abs(theirs.vel.z - mine.vel.z) < 1e-9);
  assert.ok(Math.abs(theirs.spin.x + mine.spin.x) < 1e-9 && Math.abs(theirs.spin.z - mine.spin.z) < 1e-9);
});

test('버튼 없이 공이 닿으면 약한 블록(조준 없음)', () => {
  const b = LOW();
  const samples = SAMPLES.block(b).map((s) => ({ ...s, b: false }));
  const r = classifyShot(samples, b, { pressed: false, apexT: b.t });
  assert.equal(r.shotType, 'block');
  assert.equal(r.quality.weak, true);
  assert.equal(r.quality.target, null);
  // 버튼을 누른 블록과 결과가 다르다
  const r2 = classifyShot(SAMPLES.block(b), b, { apexT: b.t });
  assert.notDeepEqual(r.vel, r2.vel);
});

test('checkHit: 스윙은 도달 범위 안에서, 블록은 라켓 평면·약한 블록은 범위 뒤끝 통과 때 일어난다', () => {
  const player = { side: -1, yPlane: -1.5, samples: [] };
  const b = incoming({ y: -1.45, z: 0.25, vy: -4 });
  // 정지 + 버튼 → 아직 평면 앞이면 없음, 통과하는 스텝이면 block
  player.samples = [{ t: 0.9, x: 0, y: 0.25, b: true }];
  assert.equal(checkHit(player, b, 1, DT), null);
  const near = incoming({ y: -1.5 + 0.01, z: 0.25, vy: -4 });
  assert.equal(checkHit(player, near, 1, DT), 'block');
  // 버튼 없이: 평면에서는 아직 아님(늦게 휘두를 여유), 도달 범위 뒤끝을 지날 때 weak
  player.samples = [{ t: 0.9, x: 0, y: 0.25, b: false }];
  assert.equal(checkHit(player, near, 1, DT), null);
  const behind = incoming({ y: -1.5 - TUNABLE.REACH_Y + 0.01, z: 0.25, vy: -4 });
  assert.equal(checkHit(player, behind, 1, DT), 'weak');
  // 휘두르는 중 → 도달 범위(앞뒤 REACH_Y) 안이면 바로 swing
  player.samples = drag({ ux: 0, uy: 2, x1: 0, z1: 0.25, t1: 1 });
  assert.equal(checkHit(player, b, 1, DT), 'swing');
  // 좌우로 HIT_RADIUS 밖이면 없음
  player.samples = drag({ ux: 0, uy: 2, x1: TUNABLE.HIT_RADIUS + 0.05, z1: 0.25, t1: 1 });
  assert.equal(checkHit(player, b, 1, DT), null);
  // 도달 범위는 원(화면의 라켓·고리와 같은 크기): 좌우·높이가 각각 범위 안이어도 대각선 거리가 넘으면 없음
  const d = TUNABLE.HIT_RADIUS * 0.8;
  player.samples = drag({ ux: 0, uy: 2, x1: d, z1: 0.25 + d, t1: 1 });
  assert.equal(checkHit(player, b, 1, DT), null);
  player.samples = drag({ ux: 0, uy: 2, x1: d * 0.85, z1: 0.25 + d * 0.85, t1: 1 });
  assert.equal(checkHit(player, b, 1, DT), 'swing');
  // 앞뒤 범위 밖
  player.samples = drag({ ux: 0, uy: 2, x1: 0, z1: 0.25, t1: 1 });
  assert.equal(checkHit(player, incoming({ y: -1.5 + TUNABLE.REACH_Y + 0.1 }), 1, DT), null);
  assert.equal(sampleAt(player.samples, 0), null);
  // 그리기용 라켓 위치: 도달 범위 안에서만 공을 따라간다
  player.samples = [{ t: 0.9, x: 0.1, y: 0.3, b: false }];
  assert.deepEqual(racketLocal(player, 1), { x: 0.1, y: -1.5, z: 0.3 });
  assert.equal(racketLocal(player, 1, -1.6).y, -1.6);
  assert.equal(racketLocal(player, 1, -3).y, -1.5 - TUNABLE.REACH_Y);
});

test('TUNABLE: 새 판정·구질·AI 값이 모두 슬라이더 범위와 묶음을 가진다', () => {
  const grouped = Object.values(TUNABLE_GROUPS).flat();
  assert.equal(new Set(grouped).size, grouped.length, '묶음 중복 없음');
  assert.deepEqual([...grouped].sort(), Object.keys(TUNABLE_DEFAULTS).sort());
  for (const k of [
    'BLOCK_SPEED', 'SMASH_SPEED', 'PERFECT_WINDOW', 'DRIVE_V_MAX', 'AI_NORMAL_DELAY', 'AI_HARD_W_SMASH',
    'BUTTON_WINDOW', 'SPIN_CARRY', 'NORMAL_V_MAX', 'NORMAL_LAMBDA_SIDE', 'CUT_SPIN_CAP', 'DRIVE_STACK', 'SIDE_LAMBDA_SIDE',
    'AI_NORMAL_READ', 'AI_EASY_W_NORMAL', 'MOB_BTN_SIZE',
  ]) {
    assert.ok(k in TUNABLE_DEFAULTS && k in TUNABLE_RANGES, k);
  }
  for (const [k, r] of Object.entries(TUNABLE_RANGES)) assert.ok(k in TUNABLE_DEFAULTS, `범위만 있는 키 ${k}`);
});

// 사람처럼 가속·감속하는 스윙: 공에서 off만큼 떨어져 정지 → 버튼 누르고 dur 동안 dist 이동(사인 곡선).
// 공은 정점 시각 1.0에 라켓 평면(y = −1.6)을 지나는 등속 수평 비행으로 근사한다.
function humanSwing({ dir, dist, dur, off, startRel, z = 0.3, vy = -4.5, k = null }) {
  const apexT = 1.0, yPlane = -1.6;
  const b = createBall({ pos: { x: 0, y: yPlane - vy * 0.6, z }, vel: { x: 0, y: vy, z: 0 }, t: 0.4 });
  const player = { side: -1, yPlane, samples: [] };
  const t0 = apexT + startRel;
  for (let i = 0; i < 400; i++) {
    const t = b.t;
    const f = Math.min(1, Math.max(0, (t - t0) / dur));
    const prog = (1 - Math.cos(Math.PI * f)) / 2;
    player.samples.push({ t, x: 0, y: z - dir * off + dir * dist * prog, b: t >= t0, k: t >= t0 ? k : null });
    const kind = checkHit(player, b, t, DT);
    if (kind) {
      const r = classifyShot(player.samples, b, { t, apexT, pressed: kind !== 'weak' });
      return { kind, ...r, progress: f };
    }
    b.pos.y += b.vel.y * DT;
    b.t += DT;
  }
  return null;
}

test('사람형 스윙: 휘두르기 시작한 순간이 아니라 라켓이 공에 닿는 순간 친다', () => {
  // 공 12 cm 아래에서 위로 35 cm를 0.15 s에 (드라이브 버튼) — 시작 시각이 달라도 모두 드라이브, 세기 0.6 이상
  for (const startRel of [-0.12, -0.1, -0.07, -0.05]) {
    const r = humanSwing({ dir: 1, dist: 0.35, dur: 0.15, off: 0.12, startRel, k: 'drive' });
    assert.equal(r.kind, 'swing');
    assert.equal(r.shotType, 'drive', `시작 ${startRel}`);
    assert.ok(r.quality.strength >= 0.6, `시작 ${startRel}: 세기 ${r.quality.strength}`);
    assert.ok(r.progress > 0.25, '가속이 시작되자마자 치지 않는다');
  }
  // 정점 근처에서 시작하면 PERFECT 범위
  assert.equal(humanSwing({ dir: 1, dist: 0.35, dur: 0.15, off: 0.12, startRel: -0.07, k: 'drive' }).quality.timing, 'PERFECT');
  // 높은 공을 스매시 버튼으로 빠르게 내려치면 스매시, 커트 버튼으로 천천히 내리면 커트 (높은 공 z: v6.0 스매시 높이 0.65 m에 맞춰 0.75)
  for (const startRel of [-0.1, -0.06, -0.04]) {
    assert.equal(humanSwing({ dir: -1, dist: 0.3, dur: 0.12, off: 0.1, startRel, z: 0.75, k: 'smash' }).shotType, 'smash', `짧은 스매시 시작 ${startRel}`);
    assert.equal(humanSwing({ dir: -1, dist: 0.4, dur: 0.12, off: 0.12, startRel, z: 0.75, k: 'smash' }).shotType, 'smash', `스매시 시작 ${startRel}`);
  }
  for (const startRel of [-0.12, -0.08]) {
    assert.equal(humanSwing({ dir: -1, dist: 0.2, dur: 0.2, off: 0.08, startRel, k: 'cut' }).shotType, 'cut', `커트 시작 ${startRel}`);
  }
  // 빠른 커트(25 cm / 0.12~0.15 s)도 커트 버튼이면 낮은 공·높은 공 모두 커트다 (빠르기로 스매시가 되지 않음)
  for (const [dur, z] of [[0.15, 0.2], [0.12, 0.2], [0.15, 0.75], [0.12, 0.75]]) {
    for (const startRel of [-0.08, -0.05]) {
      const r = humanSwing({ dir: -1, dist: 0.25, dur, off: 0.08, startRel, z, k: 'cut' });
      assert.equal(r.shotType, 'cut', `빠른 커트 ${dur}s, 공 높이 ${z}, 시작 ${startRel}: ${r.shotType}`);
    }
  }
  // 공이 오기 한참 전에 휘둘러 지나가 버리면 헛스윙 → 버튼을 뗀 뒤 도달 범위 뒤끝에서 약한 블록 (또는 놓침)
  const whiff = humanSwing({ dir: 1, dist: 0.35, dur: 0.15, off: 0.12, startRel: -0.4, k: 'drive' });
  assert.ok(!whiff || whiff.shotType === 'block' || whiff.kind !== 'swing');
});
