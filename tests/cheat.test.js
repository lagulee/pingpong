// 숨은 치트 테스트 (7단계 수정): 비밀번호 확인(해시)과 "무조건 퍼펙트" 판정
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShot, cheatCodeOk } from '../public/js/input.js';
import { createBall } from '../public/shared/physics.js';
import { TUNABLE } from '../public/shared/constants.js';

// 위로 올려 치는 드라이브 스윙 (고급 모드, Q 버튼)
function drag(t1 = 1) {
  const out = [];
  for (let i = 0; i <= 18; i++) {
    const back = 0.15 * (1 - i / 18);
    out.push({ t: t1 - back, x: 0, y: 0.25 - 1.5 * back, b: true, k: 'drive' });
  }
  return out;
}
const ball = () => createBall({ pos: { x: 0, y: -1.5, z: 0.25 }, vel: { x: 0, y: -5, z: 0 }, t: 1 });

test('비밀번호: 2697만 맞고 다른 값은 틀린다', () => {
  assert.equal(cheatCodeOk('2697'), true);
  assert.equal(cheatCodeOk(' 2697 '), true);
  for (const v of ['', '2696', '7962', '26970', '0000', null, undefined]) assert.equal(cheatCodeOk(v), false, String(v));
});

test('치트를 켜면 정점에서 멀리 벗어나 쳐도 PERFECT, 끄면 그대로', () => {
  for (const dt of [0.2, -0.2, 0.5]) {
    const ctx = { t: 1, side: -1, apexT: 1 - dt, rng: () => 0.9 };
    const off = classifyShot(drag(), ball(), ctx);
    assert.notEqual(off.quality.timing, 'PERFECT');
    const on = classifyShot(drag(), ball(), { ...ctx, perfect: true });
    assert.equal(on.quality.timing, 'PERFECT');
    assert.equal(on.quality.accuracy, TUNABLE.ACC_PERFECT);
    assert.ok(Math.abs(on.quality.dtApex - dt) < 1e-9, '화면의 정점 대비 시각은 실제 값');
    // 정점에서 친 공과 같은 공 (오차 없음)
    const exact = classifyShot(drag(), ball(), { ...ctx, apexT: 1 });
    assert.deepEqual(on.vel, exact.vel);
  }
});

test('치트로도 퍼펙트 콤보가 이어진다', () => {
  const ctx = { t: 1, side: -1, apexT: 0.7, perfect: true };
  const a = classifyShot(drag(), ball(), { ...ctx, combo: 0 });
  const b = classifyShot(drag(), ball(), { ...ctx, combo: a.quality.combo });
  assert.equal(b.quality.combo, 2);
  assert.equal(b.quality.comboLevel, 1);
});

// ── 헛스윙 보정 (v7.13) ──
import { checkHit } from '../public/js/input.js';
import { CHEAT, ONLINE } from '../public/shared/constants.js';

test('헛스윙 보정: 넓힌 범위는 대전 서버 허용 범위 안이다', () => {
  assert.ok(CHEAT.REACH_EXTRA > 0);
  // 서버는 x·z 각각 반지름 + RACKET_TOL(정사각형)로 검사하므로 원 반지름 + REACH_EXTRA는 항상 통과한다
  assert.ok(CHEAT.REACH_EXTRA < ONLINE.RACKET_TOL);
});

test('헛스윙 보정: 범위 밖으로 살짝 빗나간 공을 넓힌 범위로는 맞힌다', () => {
  const yPlane = -1.4, off = TUNABLE.HIT_RADIUS + CHEAT.REACH_EXTRA * 0.7;
  // 라켓을 대고 멈춘 채(블록) 공이 라켓 평면을 지나간다
  const samples = [0.9, 0.95, 1.0].map((t) => ({ t, x: 0, y: 0.25, b: true, k: null }));
  const player = { side: -1, samples, yPlane, dragScale: 1 };
  const b = createBall({ pos: { x: off, y: yPlane + 0.01, z: 0.25 }, vel: { x: 0, y: -5, z: 0 }, t: 1 });
  const dt = 1 / 240;
  assert.equal(checkHit(player, b, 1, dt, TUNABLE, TUNABLE.HIT_RADIUS), null);
  assert.equal(checkHit(player, b, 1, dt, TUNABLE, TUNABLE.HIT_RADIUS + CHEAT.REACH_EXTRA), 'block');
});

// ── 치트 성능 (v7.14): 속도·회전 최대 2배, 스매시 높이 절반 ──
import { smashMinHeight } from '../public/js/input.js';
import { step } from '../public/shared/physics.js';
import { NET, PHYSICS } from '../public/shared/constants.js';

const RPS = 2 * Math.PI;
const norm = (v) => Math.hypot(v.x, v.y, v.z);
// 구질 버튼 k를 누른 채 sin 방향(+ 위)으로 휘두르는 스윙
function swing(k, sin, { x = 0, z = 0.25, s = 0.6 } = {}) {
  const v = TUNABLE.BLOCK_SPEED + s * (TUNABLE.SPEED_FULL - TUNABLE.BLOCK_SPEED);
  const out = [];
  for (let i = 0; i <= 12; i++) out.push({ t: -0.1 + i / 120, x, y: z - sin * v * 0.1 * (1 - i / 12), b: true, k });
  return out;
}
const inBall = ({ x = 0, y = -1.5, z = 0.25, top = 0 } = {}) => createBall({ pos: { x, y, z }, vel: { x: 0, y: -4, z: -1 }, spin: { x: top * RPS, y: 0, z: 0 }, t: 0 });
function landsIn(shot, ball) {
  const b = createBall({ pos: ball.pos, vel: shot.vel, spin: shot.spin, t: 0 });
  for (let i = 0; i < 240 * 4; i++) {
    const ev = step(b, PHYSICS.DT);
    if (!ev.length || (ev[0].type === 'net' && ev[0].over)) continue;
    return (ev[0].type === 'bounce' || ev[0].type === 'edge') && ev[0].pos.y > 0;
  }
  return false;
}

test('치트 성능: 스매시 가능 높이(빨간 고리 기준)가 절반이다', () => {
  assert.equal(smashMinHeight(TUNABLE, false), TUNABLE.SMASH_MIN_HEIGHT);
  assert.ok(Math.abs(smashMinHeight(TUNABLE, true) - TUNABLE.SMASH_MIN_HEIGHT * 0.5) < 1e-12);
  // 네트 위 (기준의 절반 ~ 기준) 사이의 공: 치트 없이는 실타, 치트면 스매시로 들어간다
  const z = NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT * 0.75;
  const ball = inBall({ z });
  const ctx = { t: 0, side: -1, apexT: 0, ringZ: z };
  assert.equal(classifyShot(swing('smash', -0.9, { z }), ball, ctx).shotType, 'mishit');
  const on = classifyShot(swing('smash', -0.9, { z }), ball, { ...ctx, cheat: true });
  assert.equal(on.shotType, 'smash');
  assert.ok(landsIn(on, ball));
});

test('치트 성능: 드라이브·스매시는 속도와 회전이 2배이고 그대로 들어간다', () => {
  for (const [k, sin, z] of [['drive', 0.9, 0.25], ['smash', -0.9, 0.9]]) {
    const ball = inBall({ z });
    const ctx = { t: 0, side: -1, apexT: 0, ringZ: z };
    const off = classifyShot(swing(k, sin, { z }), ball, ctx);
    const on = classifyShot(swing(k, sin, { z }), ball, { ...ctx, cheat: true });
    assert.equal(on.shotType, k);
    assert.deepEqual(on.quality.cheat, { speed: 2, spin: 2 }, k);
    assert.ok(norm(on.vel) / norm(off.vel) > 1.6, `${k} 속도 ${norm(off.vel).toFixed(2)} → ${norm(on.vel).toFixed(2)}`);
    assert.ok(landsIn(on, ball), k);
  }
});

test('치트 성능: 2배로 넣을 수 없는 공은 들어가는 데까지만 올린다 (치트 때문에 실점하지 않는다)', () => {
  // 타점·세기·들어온 회전 격자: 치트 공이 들어가는 비율이 치트 없는 공보다 낮지 않다
  for (const [k, sin] of [['drive', 0.9], ['cut', -0.9], ['side', 0.3]]) {
    let off = 0, on = 0;
    for (const y of [-1.2, -1.8]) for (const z of [0.05, 0.3, 0.6]) for (const s of [0.2, 0.9]) for (const top of [-30, 0, 40]) {
      const ball = inBall({ y, z, top });
      const ctx = { t: 0, side: -1, apexT: 0, racketX: 0 };
      if (landsIn(classifyShot(swing(k, sin, { z, s }), ball, ctx), ball)) off++;
      if (landsIn(classifyShot(swing(k, sin, { z, s }), ball, { ...ctx, cheat: true }), ball)) on++;
    }
    assert.ok(on >= off, `${k}: 치트 ${on} < 기본 ${off}`);
  }
});

test('치트 성능: 퍼펙트 콤보 최고 단계와 겹쳐도 서버 한도(MAX_V·MAX_SPIN) 안이다', () => {
  let vmax = 0, wmax = 0;
  for (const [k, sin, z, top] of [['drive', 0.9, 0.3, 100], ['drive', 0.9, 0.05, 100], ['cut', -0.9, 0.3, -70], ['side', 0.3, 0.3, 0], ['smash', -0.9, 0.9, 0], ['smash', -0.9, 1.1, 0]]) {
    const ball = inBall({ z, top });
    const shot = classifyShot(swing(k, sin, { z, s: 1 }), ball, { t: 0, side: -1, apexT: 0, ringZ: z, cheat: true, perfect: true, combo: 50 });
    vmax = Math.max(vmax, norm(shot.vel)); wmax = Math.max(wmax, norm(shot.spin) / RPS);
  }
  assert.ok(vmax <= ONLINE.MAX_V, `속도 ${vmax.toFixed(1)} m/s`);
  assert.ok(wmax <= ONLINE.MAX_SPIN, `회전 ${wmax.toFixed(0)} rps`);
});
