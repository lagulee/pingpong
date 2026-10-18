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
