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
