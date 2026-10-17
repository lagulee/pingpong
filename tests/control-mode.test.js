// v7.4 조작 모드 테스트: 기본(드래그 방향·곡률·속도로 구질, v6.3 방식) / 고급(Q·W·E·R 구질 버튼, 7단계)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShot, judgeBasic, controlMode } from '../public/js/input.js';
import { serveGuide } from '../public/js/ai.js';
import { createBall, step, cloneBall } from '../public/shared/physics.js';
import {
  NET, PHYSICS, SERVE, TUNABLE, TUNABLE_DEFAULTS, TUNABLE_GROUPS, TUNABLE_RANGES, TUNABLE_ONLINE_FREE,
  CONTROL_MODES, CONTROL_DEFAULT,
} from '../public/shared/constants.js';

const RPS = 2 * Math.PI;

// 드래그 샘플 (input.test.js와 같은 모양): 시각 t1에 (x1, z1)에 도착하는 T초짜리 직선(+볼록한 호) 드래그, 구질 버튼 k
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
function incoming({ x = 0, y = -1.5, z = 0.25, vy = -5, vz = 0, topspin = 0, sidespin = 0, t = 1 } = {}) {
  return createBall({ pos: { x, y, z }, vel: { x: 0, y: vy, z: vz }, spin: { x: topspin * RPS, y: 0, z: sidespin * RPS }, t });
}
function firstEvent(ball, seconds = 2) {
  const b = cloneBall(ball);
  for (let i = 0; i < seconds / PHYSICS.DT; i++) {
    const ev = step(b, PHYSICS.DT);
    if (ev.length) return ev[0];
  }
  return null;
}
const out = (ballIn, r) => createBall({ pos: ballIn.pos, vel: r.vel, spin: r.spin, t: ballIn.t });
const onOppTable = (e) => e && (e.type === 'bounce' || e.type === 'edge') && e.pos.y > 0;

// v6.3 대표 드래그 (버튼 없음)
const SWINGS = {
  drive: (b, k = null) => drag({ ux: 0.1, uy: 1.8, x1: b.pos.x, z1: b.pos.z, t1: b.t, k }),
  smash: (b, k = null) => drag({ ux: 0, uy: -4.0, x1: b.pos.x, z1: b.pos.z, t1: b.t, k }),
  cut: (b, k = null) => drag({ ux: 0, uy: -1.0, x1: b.pos.x, z1: b.pos.z, t1: b.t, k }),
  side: (b, k = null) => drag({ ux: 1.8, uy: 0.2, x1: b.pos.x, z1: b.pos.z, t1: b.t, curve: 0.25, T: 0.1, k }),
  block: (b, k = null) => drag({ ux: 0.02, uy: 0.01, x1: b.pos.x, z1: b.pos.z, t1: b.t, k }),
};
const LOW = () => incoming({ z: 0.25 });
const HIGH = () => incoming({ y: -1.3, z: 0.75, vy: -3 });
const basic = (samples, b, ctx = {}) => classifyShot(samples, b, { apexT: b.t, control: 'basic', ...ctx });

test('기본 모드: 드래그 방향·곡률·속도로 드라이브·스매시·커트·사이드·블록을 판정하고 상대 코트에 들어간다', () => {
  for (const [type, mk] of Object.entries(SWINGS)) {
    const b = type === 'smash' ? HIGH() : LOW();
    const r = basic(mk(b), b);
    assert.equal(r.shotType, type, `${type} 드래그 → ${r.shotType}`);
    if (type !== 'block') assert.ok(onOppTable(firstEvent(out(b, r))), `${type}가 상대 코트에 들어감`);
  }
  const b = LOW();
  assert.ok(basic(SWINGS.drive(b), b).spin.x < 0, '위로 = 탑스핀');
  assert.ok(basic(SWINGS.cut(b), b).spin.x > 0, '아래로 = 백스핀');
  assert.ok(Math.abs(basic(SWINGS.side(b), b).spin.z) > 20 * RPS, '곡선 = 횡회전');
});

test('기본 모드는 구질 버튼을 보지 않는다 (샘플의 k·ctx.button 모두)', () => {
  const b = LOW();
  for (const k of ['drive', 'cut', 'side', 'smash', 'sidecut']) {
    assert.equal(basic(SWINGS.cut(b, k), b).shotType, 'cut', `아래로 + ${k} 버튼 → 커트`);
    assert.equal(basic(SWINGS.drive(b, k), b).shotType, 'drive', `위로 + ${k} 버튼 → 드라이브`);
    assert.equal(basic(SWINGS.drive(b), b, { button: k }).shotType, 'drive');
  }
  // 고급 모드(기본값·로봇)는 그대로 버튼이 정한다: 버튼 없는 위 드래그 = 일반, 커트 버튼 + 위 드래그 = 커트
  assert.equal(classifyShot(SWINGS.drive(b), b, { apexT: b.t }).shotType, 'normal');
  assert.equal(classifyShot(SWINGS.drive(b, 'cut'), b, { apexT: b.t }).shotType, 'cut');
  assert.equal(classifyShot(SWINGS.drive(b, 'cut'), b, { apexT: b.t, control: 'advanced' }).shotType, 'cut');
});

test('기본 모드: 낮은 공(노란 고리)을 빠르게 내려치면 실타 대신 센 커트, 느린 내려치기는 높은 공에서도 커트', () => {
  const low = LOW();
  const r = basic(SWINGS.smash(low), low);
  assert.equal(r.shotType, 'cut');
  assert.ok(r.quality.strength > 0.9, `센 커트 (세기 ${r.quality.strength})`);
  const high = HIGH();
  assert.equal(basic(SWINGS.cut(high), high).shotType, 'cut', '스매시 기준 속도 미만');
  // 판정 함수 단독: 기준 속도와 높이 경계
  const d = (speed, sin, kappa = 0) => ({ speed, sin, kappa, u: { x: 0, y: sin * speed } });
  const zHigh = NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT, zLow = zHigh - 0.01;
  assert.equal(judgeBasic(d(TUNABLE.BASIC_SMASH_SPEED, -1), zHigh), 'smash');
  assert.equal(judgeBasic(d(TUNABLE.BASIC_SMASH_SPEED - 0.01, -1), zHigh), 'cut');
  assert.equal(judgeBasic(d(TUNABLE.BASIC_SMASH_SPEED, -1), zLow), 'cut');
  assert.equal(judgeBasic(d(1, -TUNABLE.DIR_SIN + 0.01), 0.3), 'drive', '옆으로 = 드라이브');
  assert.equal(judgeBasic(d(1, 0, TUNABLE.CURVE_MIN), 0.3), 'side');
  assert.equal(judgeBasic(d(1, 1), 0.3, TUNABLE, false), 'block', '버튼 없음 = 약한 블록');
  assert.equal(judgeBasic(d(TUNABLE.BLOCK_SPEED - 0.01, 1), 0.3), 'block');
});

test('기본 모드 터치: 스매시 기준은 BASIC_TOUCH_SMASH_SPEED (main.js가 smashSpeed로 넘김)', () => {
  const h = HIGH();
  const s = drag({ ux: 0, uy: -1.8, x1: h.pos.x, z1: h.pos.z, t1: h.t });
  assert.equal(basic(s, h).shotType, 'cut', '마우스 기준 2.8 m/s 미만');
  assert.equal(basic(s, h, { smashSpeed: TUNABLE.BASIC_TOUCH_SMASH_SPEED }).shotType, 'smash');
  assert.ok(TUNABLE_GROUPS['모바일'].includes('BASIC_TOUCH_SMASH_SPEED') && TUNABLE_ONLINE_FREE.includes('BASIC_TOUCH_SMASH_SPEED'));
  for (const k of ['BASIC_SMASH_SPEED', 'DIR_SIN', 'CURVE_MIN']) {
    assert.ok(TUNABLE_GROUPS['판정'].includes(k), `${k}는 판정 묶음`);
    assert.ok(TUNABLE_RANGES[k] && TUNABLE_DEFAULTS[k] === TUNABLE[k]);
  }
});

test('기본 모드에서도 같은 회전으로 받아치면 회전이 쌓인다', () => {
  const top = incoming({ topspin: 60 });
  const r = basic(SWINGS.drive(top), top, { spinIn: top.spin });
  assert.equal(r.shotType, 'drive');
  assert.ok(r.quality.stack && r.quality.stack.add > 10, `누적 ${r.quality.stack?.add}`);
});

test('기본 모드 서브: 위로 = 드라이브 서브, 아래로(빠르게 내려쳐도) = 커트 서브, 둘 다 규칙대로 들어간다', () => {
  const ball = createBall({ pos: { x: 0, y: SERVE.TOSS_Y, z: SERVE.HIT_Z }, vel: { x: 0, y: 0, z: -1 }, t: 1 });
  const serve = (samples) => basic(samples, ball, { serve: true });
  for (const [mk, type, sign] of [[SWINGS.drive, 'drive', -1], [SWINGS.cut, 'cut', 1], [SWINGS.smash, 'cut', 1]]) {
    const r = serve(mk(ball));
    assert.equal(r.shotType, type);
    assert.ok(Math.sign(r.spin.x) === sign, `${type} 서브 회전 부호`);
    const b = out(ball, r);
    const bounces = [];
    for (let i = 0; i < 3 / PHYSICS.DT && bounces.length < 2; i++) {
      for (const e of step(b, PHYSICS.DT)) bounces.push(e);
    }
    assert.ok(bounces[0]?.type === 'bounce' && bounces[0].pos.y < 0, '내 코트 첫 바운드');
    assert.ok(onOppTable(bounces[1]), '상대 코트 착지');
  }
  // 서브 가이드라인: 기본 모드는 버튼과 상관없이 위로 휘두른 드라이브 서브
  const g = serveGuide(-1, 0, TUNABLE, 'cut', 'basic');
  assert.ok(g && g.shotType === 'drive', `가이드 ${g?.shotType}`);
  assert.equal(serveGuide(-1, 0, TUNABLE, 'cut')?.shotType, 'cut', '고급 모드 가이드는 버튼');
});

test('조작 모드 값: 기본값은 기본 모드, 모르는 값은 기본 모드로', () => {
  assert.deepEqual([...CONTROL_MODES], ['basic', 'advanced']);
  assert.equal(CONTROL_DEFAULT, 'basic');
  assert.equal(controlMode(null), 'basic');
  assert.equal(controlMode('zzz'), 'basic');
  assert.equal(controlMode('advanced'), 'advanced');
  assert.equal(controlMode('basic'), 'basic');
});
