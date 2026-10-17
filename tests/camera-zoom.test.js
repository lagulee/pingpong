// v7.5 시점 거리(CAM_DIST): 카메라를 바라보는 점에서 k배 멀리 두고, 멀리서 봐도 드래그 판정은 그대로인지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tunableCamera, zoomCamera, cameraFor, planeToScreen, dragGain, dragScaleFor, analyzeDrag } from '../public/js/input.js';
import { mobileCamera } from '../public/js/touch.js';
import { RENDER, TUNABLE, TUNABLE_DEFAULTS, TUNABLE_RANGES, TUNABLE_ONLINE_FREE, TABLE } from '../public/shared/constants.js';
import { vec } from '../public/shared/physics.js';

const ASPECT = 16 / 9;
const dist = (c) => Math.hypot(c.pos.x - c.target.x, c.pos.y - c.target.y, c.pos.z - c.target.z);

test('시점 거리: 기본 1(기존 시점 그대로), 범위는 1보다 멀리까지, 대전 중에도 바꿀 수 있다', () => {
  assert.equal(TUNABLE_DEFAULTS.CAM_DIST, 1);
  assert.ok(TUNABLE_RANGES.CAM_DIST.max >= 1.5 && TUNABLE_RANGES.CAM_DIST.min <= 1);
  assert.ok(TUNABLE_ONLINE_FREE.includes('CAM_DIST'));
  const c = tunableCamera();
  assert.deepEqual(zoomCamera(c, 1), c);
});

test('시점 거리: 바라보는 점·방향·시야각은 그대로, 거리만 k배', () => {
  for (const base of [tunableCamera(), RENDER.CAMERA_CLASSIC, mobileCamera()]) {
    for (const k of [0.8, 1.5, 1.8]) {
      const z = zoomCamera(base, k);
      assert.deepEqual(z.target, base.target);
      assert.equal(z.fov, base.fov);
      assert.ok(Math.abs(dist(z) - k * dist(base)) < 1e-9);
      // 같은 방향: 바라보는 점의 화면 위치(가운데)가 그대로
      const s = planeToScreen(z, ASPECT, base.target);
      assert.ok(Math.abs(s.x) < 1e-9 && Math.abs(s.y) < 1e-9);
    }
  }
  // 상대 자리(side +1)도 회전 뒤 같은 거리
  const opp = cameraFor(zoomCamera(tunableCamera(), 1.5), 1);
  assert.ok(Math.abs(dist(opp) - 1.5 * dist(tunableCamera())) < 1e-9);
});

test('시점 거리: 멀리 볼수록 탁구대가 화면에서 작아지고, 더 높은 공까지 보인다', () => {
  const base = tunableCamera();
  const width = (c) => {
    const a = planeToScreen(c, ASPECT, vec(-TABLE.WIDTH / 2, -TABLE.LENGTH / 2, 0));
    const b = planeToScreen(c, ASPECT, vec(TABLE.WIDTH / 2, -TABLE.LENGTH / 2, 0));
    return Math.abs(b.x - a.x);
  };
  assert.ok(width(zoomCamera(base, 1.5)) < width(base) * 0.85);
  const high = vec(0, 0, 1.6); // 네트 위 1.6 m: 기본 시점에서는 화면 위로 잘림
  assert.ok(planeToScreen(base, ASPECT, high).y > 1);
  assert.ok(planeToScreen(zoomCamera(base, 1.5), ASPECT, high).y < 1);
});

test('시점 거리: 멀리서 봐도 같은 손놀림 = 같은 스윙 속도 (dragScaleFor 보정)', () => {
  const base = tunableCamera();
  const ref = analyzeDrag(mk(dragGain(RENDER.CAMERA_CLASSIC, ASPECT)), 0.1);
  for (const k of [0.8, 1.3, 1.8]) {
    const cam = zoomCamera(base, k);
    const g = dragGain(cam, ASPECT);
    assert.ok(g > dragGain(zoomCamera(base, k - 0.1), ASPECT), '멀수록 화면 1 px가 라켓 평면에서 길다');
    const a = analyzeDrag(mk(g), 0.1, TUNABLE, dragScaleFor(cam, ASPECT));
    assert.ok(Math.abs(a.speed - ref.speed) < 1e-9 && Math.abs(a.sin - ref.sin) < 1e-12, `k = ${k}`);
  }
});

// 같은 화면 드래그를 시점의 1 px 길이(gain)로 라켓 평면 샘플로 바꾼 것
function mk(gain) {
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => ({ t: i / 120, x: 0, y: 0.2 + gain * i * 3, b: true }));
}
