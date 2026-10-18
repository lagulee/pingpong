// v7.11 빗나감 표시: 헛스윙이 정점보다 빨랐나(빠름) 느렸나(느림), 타이밍은 맞았는데 자리가 빗나갔나
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeMiss, missText } from '../public/js/input.js';
import { TUNABLE, FEEL } from '../public/shared/constants.js';

// t0에 시작해 T초 동안 위로 speed m/s로 휘두르는 샘플 (120 Hz), 앞뒤로 멈춘 샘플
function swing(t0, { speed = 2, T = 0.12, x = 0, z = 0.2, b = true } = {}) {
  const s = [];
  for (let t = t0 - 0.3; t < t0; t += 1 / 120) s.push({ t, x, y: z, b });
  for (let k = 0; k <= T * 120; k++) s.push({ t: t0 + k / 120, x, y: z + speed * (k / 120), b });
  const end = s[s.length - 1];
  for (let k = 1; k < 30; k++) s.push({ t: end.t + k / 120, x, y: end.y, b });
  return s;
}

test('빗나감: 정점보다 일찍 휘두르면 빠름, 늦게 휘두르면 느림 (몇 ms인지 함께)', () => {
  const apexT = 1, apex = { x: 0, z: 0.3 };
  const early = judgeMiss(swing(0.7), apexT, apex);
  assert.equal(early.kind, 'early');
  assert.ok(early.dt < -TUNABLE.GOOD_WINDOW && early.dt > -0.4, `dt ${early.dt}`);
  assert.match(missText(early), /^빠름 \d+ ms$/);
  const late = judgeMiss(swing(1.2), apexT, apex);
  assert.equal(late.kind, 'late');
  assert.ok(late.dt > TUNABLE.GOOD_WINDOW, `dt ${late.dt}`);
  assert.match(missText(late), /^느림 \d+ ms$/);
  // 아주 이른 헛스윙(정점 0.6 s 전)도 빠름
  assert.equal(judgeMiss(swing(0.4), apexT, apex).kind, 'early');
  // 빠를수록 ms가 크다
  assert.ok(-judgeMiss(swing(0.65), apexT, apex).dt > -early.dt);
});

test('빗나감: 타이밍이 맞았는데 못 맞히면 자리 — 공이 라켓 어느 쪽에 있었는지', () => {
  const apexT = 1;
  // 스윙 가운데(최고 속도)가 정점 근처
  const m = judgeMiss(swing(0.94, { x: -0.2 }), apexT, { x: 0, z: 0.3 });
  assert.equal(m.kind, 'pos');
  assert.ok(Math.abs(m.dt) <= TUNABLE.GOOD_WINDOW);
  assert.equal(missText(m), '빗나감 · 공은 라켓 오른쪽');
  assert.equal(missText({ kind: 'pos', dt: 0, dx: 0.01, dz: -0.2 }), '빗나감 · 공은 라켓 아래');
  // 휘두르지 않고(멈춘 블록) 못 맞힘도 자리
  const still = [];
  for (let t = 0.5; t < 1.5; t += 1 / 120) still.push({ t, x: 0.3, y: 0.2, b: true });
  const s = judgeMiss(still, apexT, { x: 0, z: 0.25 });
  assert.equal(s.kind, 'pos');
  assert.equal(missText(s), '빗나감 · 공은 라켓 왼쪽');
});

test('빗나감: 버튼 없이 움직인 것·정점에서 먼 스윙은 스윙으로 치지 않는다(자리), 샘플이 없으면 표시 없음', () => {
  const apexT = 1;
  const noButton = judgeMiss(swing(0.7, { b: false }), apexT, { x: 0, z: 0.3 });
  assert.equal(noButton.kind, 'pos', '버튼 없이 움직인 것은 스윙이 아님 (약한 블록이 못 닿음 = 자리)');
  const far = judgeMiss(swing(apexT - FEEL.MISS_EARLY - 0.3), apexT, { x: 0, z: 0.3 });
  assert.equal(far.kind, 'pos', '창 밖 스윙은 무시');
  assert.equal(judgeMiss([], apexT, { x: 0, z: 0 }), null);
  assert.equal(judgeMiss(swing(0.7), null, { x: 0, z: 0 }), null);
  assert.equal(missText(null), '');
});
