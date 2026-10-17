// v6.2 모바일 모드 테스트: 터치 → 라켓 샘플 변환(touch.js), 모바일 감지·자동 품질(mobile.js), 진동(effects.js),
// 모바일 화면에서 라켓이 손에 닿는 범위. classifyShot·checkHit은 PC와 같은 함수를 그대로 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTouchTracker, touchSpeedScale, mobileCamera } from '../public/js/touch.js';
import {
  classifyShot, analyzeDrag, checkHit, racketPointAt, screenToPlane, planeToScreen, dragScaleFor,
} from '../public/js/input.js';
import { detectMobile, createQualityGovernor } from '../public/js/mobile.js';
import { vibrationMs } from '../public/js/effects.js';
import { createBall } from '../public/shared/physics.js';
import {
  TUNABLE, TUNABLE_DEFAULTS, TUNABLE_GROUPS, TUNABLE_ONLINE_FREE, TUNABLE_TOGGLES, SWING, MOBILE,
} from '../public/shared/constants.js';

const PHONE = { W: 844, H: 390 };   // 가로로 든 휴대폰 (CSS px)
const PLANE_Y = -1.3;               // 라켓 평면 (기준 좌표)
const HZ = 60;                      // 터치 이벤트 빈도

// 화면(가로 W × 세로 H)과 모바일 시점: 화면 좌표 → 라켓 평면 (main.js의 toPlane과 같은 계산, side −1)
function screenFor({ W, H }, planeY = PLANE_Y, params = TUNABLE) {
  const aspect = W / H;
  const cam = mobileCamera(params);
  const toPlane = (cx, cy) => {
    const p = screenToPlane(cam, aspect, (cx / W) * 2 - 1, 1 - (cy / H) * 2, planeY);
    return p && {
      x: Math.min(SWING.X_MAX, Math.max(-SWING.X_MAX, p.x)),
      z: Math.min(SWING.Z_MAX, Math.max(SWING.Z_MIN, p.z)),
    };
  };
  // 라켓이 (x, z)에 오려면 손가락을 어디에 대야 하나 (오프셋만큼 아래)
  const fingerFor = (x, z) => {
    const s = planeToScreen(cam, aspect, { x, y: planeY, z });
    return { x: ((s.x + 1) / 2) * W, y: ((1 - s.y) / 2) * H + params.TOUCH_OFFSET_PX };
  };
  return { toPlane, fingerFor, dragScale: dragScaleFor(cam, aspect) * touchSpeedScale(H, params), cam, aspect, W, H };
}

// 손가락 스와이프: 라켓이 (x, z)에 도착하도록 (dx, dy) px를 T초 동안 쓴다 (curve: 현 길이 대비 옆으로 볼록한 정도).
// 반환 { samples, t(도착 시각) }
function swipe(scr, { x, z, dx, dy, T, curve = 0, t0 = 1, lift = false }) {
  const samples = [];
  const tr = createTouchTracker(samples, { toPlane: scr.toPlane });
  const end = scr.fingerFor(x, z);
  const L = Math.hypot(dx, dy) || 1;
  const n = Math.max(2, Math.round(T * HZ));
  const at = (k) => {
    const tau = k / n;
    const bump = curve * L * 4 * tau * (1 - tau);
    return { x: end.x - dx * (1 - tau) + (-dy / L) * bump, y: end.y - dy * (1 - tau) + (dx / L) * bump };
  };
  // 손가락은 화면 안에서만 움직일 수 있다
  for (let k = 0; k <= n; k++) {
    const p = at(k);
    assert.ok(p.x >= 0 && p.x <= scr.W && p.y >= 0 && p.y <= scr.H, `손가락이 화면 밖 (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
  }
  const p0 = at(0);
  tr.down(1, p0.x, p0.y, t0);
  for (let k = 1; k <= n; k++) {
    const p = at(k);
    tr.move(1, p.x, p.y, t0 + (T * k) / n);
  }
  if (lift) tr.up(1, end.x, end.y, t0 + T);
  return { samples, t: t0 + T, tracker: tr };
}

// 내(side −1) 쪽으로 오는 공
const incoming = (x, z, t, vy = -4) => createBall({ pos: { x, y: PLANE_Y, z }, vel: { x: 0, y: vy, z: 0 }, t });

function judge(scr, sw, x, z) {
  const ball = incoming(x, z, sw.t);
  const last = racketPointAt(sw.samples, sw.t);
  return classifyShot(sw.samples, ball, { apexT: sw.t, dragScale: scr.dragScale, pressed: last.b });
}

// ── 대표 스와이프 5종 ─────────────────────────────────────
// 속도는 화면 높이로 CSS px 기준에 맞춘다: 1 px/ms ≈ 1.3 m/s (TOUCH_SPEED_GAIN 0.7)
const SWIPES = {
  drive: { z: 0.3, dx: 15, dy: -120, T: 0.06 },            // 위로 2 px/ms
  smash: { z: 0.8, dx: 0, dy: 150, T: 0.04 },              // 아래로 3.75 px/ms, 높은 공
  cut: { z: 0.3, dx: 0, dy: 80, T: 0.1 },                  // 아래로 0.8 px/ms
  side: { z: 0.3, dx: 120, dy: -10, T: 0.06, curve: 0.25 }, // 옆으로 휘어 쓸기
  block: { z: 0.3, dx: 1, dy: 1, T: 0.15 },                // 대고 거의 멈춤
};

test('터치: 가로 휴대폰에서 대표 스와이프 5종이 드라이브·스매시·커트·사이드스핀·블록으로 판정된다', () => {
  const scr = screenFor(PHONE);
  for (const [type, s] of Object.entries(SWIPES)) {
    const sw = swipe(scr, { x: 0.1, ...s });
    const r = judge(scr, sw, 0.1, s.z);
    assert.equal(r.shotType, type, `${type} 스와이프 → ${r.shotType} (스윙 ${r.quality.dragSpeed.toFixed(2)} m/s)`);
  }
});

test('터치: 대고 멈춘 손가락은 버튼을 누른 블록(조준 블록)이고, 라켓 평면을 지나는 공을 막는다', () => {
  const scr = screenFor(PHONE);
  const sw = swipe(scr, { x: 0, ...SWIPES.block });
  const player = { side: -1, samples: sw.samples, yPlane: PLANE_Y, dragScale: scr.dragScale };
  const ball = createBall({ pos: { x: 0, y: PLANE_Y + 0.005, z: 0.3 }, vel: { x: 0, y: -4, z: 0 }, t: sw.t });
  assert.equal(checkHit(player, ball, sw.t, 1 / 240), 'block');
  assert.equal(judge(scr, sw, 0, 0.3).quality.weak, false, '조준 블록 (약한 블록 아님)');
});

test('터치: 손가락을 뗐다가 다른 곳에 대도 순간 이동이 스윙 속도로 재지지 않는다 (스매시 오판 없음)', () => {
  const scr = screenFor(PHONE);
  const samples = [];
  const tr = createTouchTracker(samples, { toPlane: scr.toPlane });
  tr.down(1, 300, 330, 1);
  tr.move(1, 301, 330, 1.05);
  tr.up(1, 301, 330, 1.1);
  const before = samples.map((q) => ({ ...q }));
  // 0.2 s 뒤 화면 반대쪽 위에 다시 댄다 (라켓이 약 1 m 이동)
  tr.down(2, 640, 120, 1.3);
  tr.move(2, 640, 121, 1.316);
  const d = analyzeDrag(samples, 1.316, TUNABLE, scr.dragScale);
  assert.ok(d.speed < TUNABLE.BLOCK_SPEED, `속도 ${d.speed.toFixed(2)} m/s`);
  const p = racketPointAt(samples, 1.316);
  const r = classifyShot(samples, incoming(p.x, p.y, 1.316), { dragScale: scr.dragScale, pressed: p.b });
  assert.equal(r.shotType, 'block');
  // 비교: 마우스처럼 샘플을 이어 두면 순간 이동이 스매시 영역 속도로 재진다
  const merged = [...before, ...samples];
  const j = analyzeDrag(merged, 1.316, TUNABLE, scr.dragScale);
  assert.ok(j.speed > TUNABLE.SMASH_SPEED, `이어서 재면 ${j.speed.toFixed(2)} m/s`);
});

test('터치: 라켓은 손가락보다 TOUCH_OFFSET_PX 위에 있다', () => {
  const scr = screenFor(PHONE);
  const samples = [];
  const tr = createTouchTracker(samples, { toPlane: scr.toPlane });
  tr.down(1, 420, 300, 0);
  const want = scr.toPlane(420, 300 - TUNABLE.TOUCH_OFFSET_PX);
  assert.ok(Math.abs(samples[0].x - want.x) < 1e-12 && Math.abs(samples[0].y - want.z) < 1e-12);
  assert.ok(samples[0].y > scr.toPlane(420, 300).z + 0.05, '손가락 자리보다 높다');
  // 오프셋 0이면 손가락 바로 아래
  const s0 = [];
  createTouchTracker(s0, { toPlane: scr.toPlane, params: { ...TUNABLE, TOUCH_OFFSET_PX: 0 } }).down(1, 420, 300, 0);
  assert.ok(Math.abs(s0[0].y - scr.toPlane(420, 300).z) < 1e-12);
});

test('터치: 손가락을 떼도 TOUCH_LIFT_HOLD 동안은 누름, 그 뒤에는 버튼 없음(약한 블록)', () => {
  const scr = screenFor(PHONE);
  const sw = swipe(scr, { x: 0, ...SWIPES.drive, lift: true });
  const hold = TUNABLE.TOUCH_LIFT_HOLD;
  assert.equal(racketPointAt(sw.samples, sw.t + hold * 0.5).b, true);
  assert.equal(racketPointAt(sw.samples, sw.t + hold + 1e-6).b, false);
  // 뗀 직후 공이 닿으면 쓸던 스윙 그대로 판정된다 (튕기듯 쓸어도 드라이브)
  const tHit = sw.t + 0.02;
  const r = classifyShot(sw.samples, incoming(0, SWIPES.drive.z, tHit), { dragScale: scr.dragScale, pressed: racketPointAt(sw.samples, tHit).b });
  assert.equal(r.shotType, 'drive');
  // 유예가 지나면 약한 블록 (PC에서 버튼을 놓은 것과 같다)
  const tLate = sw.t + hold + 0.2;
  sw.tracker.refresh(tLate);
  const late = classifyShot(sw.samples, incoming(0, SWIPES.drive.z, tLate), { dragScale: scr.dragScale, pressed: racketPointAt(sw.samples, tLate).b });
  assert.equal(late.shotType, 'block');
  assert.equal(late.quality.weak, true);
});

test('터치: 두 번째 손가락은 무시한다', () => {
  const scr = screenFor(PHONE);
  const samples = [];
  const tr = createTouchTracker(samples, { toPlane: scr.toPlane });
  assert.equal(tr.down(1, 400, 300, 0), true);
  assert.equal(tr.down(2, 100, 100, 0.01), false);
  tr.move(2, 120, 100, 0.02);
  tr.up(2, 120, 100, 0.03);
  assert.equal(samples.length, 1);
  assert.equal(tr.touching, true);
});

test('터치 감도: 같은 px 속도의 스와이프는 휴대폰·태블릿에서 거의 같은 스윙 속도로 판정된다 (±10%)', () => {
  for (const v of [0.8, 2]) { // px/ms
    const speeds = [PHONE, { W: 1180, H: 820 }, { W: 1024, H: 768 }].map((dev) => {
      const scr = screenFor(dev);
      const sw = swipe(scr, { x: 0, z: 0.4, dx: 0, dy: -80, T: 80 / v / 1000 });
      return analyzeDrag(sw.samples, sw.t, TUNABLE, scr.dragScale).speed;
    });
    const lo = Math.min(...speeds), hi = Math.max(...speeds);
    assert.ok(hi / lo < 1.1, `${v} px/ms: ${speeds.map((s) => s.toFixed(2)).join(' / ')} m/s`);
  }
  // 감도 배율은 화면 높이에 비례 (작은 화면일수록 같은 px가 화면의 더 큰 비율이므로 줄인다)
  assert.ok(Math.abs(touchSpeedScale(MOBILE.TOUCH_REF_H) - TUNABLE.TOUCH_SPEED_GAIN) < 1e-12);
  assert.ok(Math.abs(touchSpeedScale(390) / touchSpeedScale(780) - 0.5) < 1e-12);
});

test('모바일 화면: 오프셋을 둬도 손가락이 낮은 라켓(탁구대 위 0.12 m 이하)과 높은 라켓(1.3 m)에 닿는다', () => {
  for (const H of [390, 360]) { // 휴대폰 가로 높이 (주소창이 보이면 더 낮다)
    const W = Math.round(H * 2.16);
    for (const y of [SWING.Y_MIN, PLANE_Y, SWING.Y_MAX]) {
      const scr = screenFor({ W, H }, y);
      // 손가락을 화면 맨 아래 가운데에 대면 라켓이 충분히 낮다 (x는 탁구대 가운데 근처)
      const cx = scr.fingerFor(0, 0.3).x;
      const low = scr.toPlane(cx, H - 1 - TUNABLE.TOUCH_OFFSET_PX);
      assert.ok(low.z <= 0.12, `H ${H}, 평면 y ${y.toFixed(2)}: 맨 아래 → 라켓 높이 ${low.z.toFixed(3)} m`);
      const high = scr.toPlane(cx, 0);
      assert.ok(high.z >= 1.3, `H ${H}, 평면 y ${y.toFixed(2)}: 맨 위 → 라켓 높이 ${high.z.toFixed(3)} m`);
    }
  }
});

test('모바일 화면: 서브 타점·낮은 공 타점 아래에도 위로 쓸어 올릴 자리가 있다', () => {
  // 처음 구현(PC 구도 그대로, 오프셋 60 px)은 브라우저 점검에서 서브 타점 아래 자리가 약 40 px라 쓸 수 없었다.
  // 기준: 서브 타점 80 px, 낮은 공 70 px, 엔드라인 뒤 낮은 공 55 px (2 px/ms로 30 ms 이상 쓸 수 있는 길이)
  for (const H of [390, 360]) {
    const W = Math.round(H * 2.16);
    for (const [y, z, min, name] of [[-1.55, 0.3, 80, '서브 타점'], [-1.3, 0.2, 70, '낮은 공'], [-1.67, 0.2, 55, '엔드라인 뒤 낮은 공']]) {
      const f = screenFor({ W, H }, y).fingerFor(0, z);
      assert.ok(H - f.y >= min, `H ${H} ${name}: 손가락 아래 ${Math.round(H - f.y)} px`);
    }
  }
});

test('모바일 감지: ?mobile=1/0이 우선, 아니면 손가락 화면 + 짧은 변 기준', () => {
  assert.equal(detectMobile({ query: '1' }), true);
  assert.equal(detectMobile({ query: '0', coarse: true, width: 390, height: 844 }), false);
  assert.equal(detectMobile({ coarse: true, width: 390, height: 844 }), true);   // 휴대폰
  assert.equal(detectMobile({ coarse: true, width: 1180, height: 820 }), true);  // 태블릿
  assert.equal(detectMobile({ coarse: false, width: 390, height: 844 }), false); // 작은 창의 PC (마우스)
  assert.equal(detectMobile({ coarse: true, width: 2560, height: 1440 }), false); // 터치 모니터 PC
  assert.equal(detectMobile(), false);
});

test('진동: 내 타격은 속도가 빠를수록 길고, 상대 타격·상대 코트 바운드는 진동하지 않는다', () => {
  const hit = (speed, side = -1) => vibrationMs({ type: 'racket', side, speed, pos: { x: 0, y: -1.3, z: 0.3 } }, -1);
  let prev = -1;
  for (const v of [0, 2, 4, 6, 10, 15]) {
    const ms = hit(v);
    assert.ok(ms >= prev && ms >= TUNABLE.VIB_HIT_MIN && ms <= TUNABLE.VIB_HIT_MAX, `${v} m/s → ${ms} ms`);
    prev = ms;
  }
  assert.ok(hit(15) > hit(2));
  assert.equal(hit(10, 1), 0, '상대 타격');
  const bounce = (y, me) => vibrationMs({ type: 'bounce', speed: 3, pos: { x: 0, y, z: 0 } }, me);
  assert.equal(bounce(-0.8, -1), TUNABLE.VIB_BOUNCE, '내 코트');
  assert.equal(bounce(0.8, -1), 0, '상대 코트');
  assert.equal(bounce(0.8, 1), TUNABLE.VIB_BOUNCE, '대전 side +1의 내 코트');
  assert.equal(vibrationMs({ type: 'net', speed: 3, pos: { x: 0, y: 0, z: 0.1 } }, -1), 0);
  assert.equal(vibrationMs({ type: 'racket', side: -1, speed: 10, pos: { x: 0, y: -1, z: 0 } }, -1, { ...TUNABLE, FX_VIBRATE: 0 }), 0);
});

test('자동 품질: 평균 FPS가 기준보다 낮으면 픽셀 비율을 단계적으로 낮추고, 최소값 아래로는 내리지 않는다', () => {
  const p = { ...TUNABLE };
  const q = createQualityGovernor(1.5, p, 3);
  const run = (fps, seconds) => {
    const out = [];
    for (let i = 0; i < fps * seconds; i++) { const r = q.update(1 / fps); if (r !== null) out.push(r); }
    return out;
  };
  assert.deepEqual(run(60, 4), [], '60 fps는 그대로');
  assert.deepEqual(run(30, 2.05), [1.25]);
  assert.deepEqual(run(30, 6.1), [1], '1.0에서 멈춤');
  assert.equal(q.ratio, MOBILE.PIXEL_RATIO_MIN);
  // 탭 전환 뒤 긴 프레임은 측정에서 뺀다
  assert.equal(q.update(5), null);
  // 디버그 패널에서 상한을 바꾸면 그 값(기기 픽셀 비율 이하)에서 다시 시작
  p.MOB_PIXEL_RATIO = 2;
  assert.equal(q.update(1 / 60), 2);
  // 자동 품질을 끄면 낮추지 않는다
  p.FX_AUTO_QUALITY = 0;
  assert.deepEqual(run(20, 4), []);
});

test('모바일 튜닝 값: "모바일" 묶음·대전 중 변경 허용, 판정 값은 여전히 대전 중 고정', () => {
  const mob = TUNABLE_GROUPS['모바일'];
  for (const k of ['TOUCH_OFFSET_PX', 'TOUCH_SPEED_GAIN', 'TOUCH_LIFT_HOLD', 'MOB_CAM_FOV', 'MOB_PIXEL_RATIO', 'MOB_SHADOW_SIZE',
    'VIB_HIT_MIN', 'VIB_HIT_MAX', 'VIB_BOUNCE']) {
    assert.ok(mob.includes(k), k);
    assert.ok(TUNABLE_ONLINE_FREE.includes(k), `${k} 대전 중 변경 허용`);
  }
  for (const k of ['FX_VIBRATE', 'SND_SILENT_SWITCH', 'FX_AUTO_QUALITY']) assert.ok(TUNABLE_TOGGLES.includes(k) && TUNABLE_ONLINE_FREE.includes(k), k);
  for (const k of ['SMASH_SPEED', 'CURVE_MIN', 'BLOCK_SPEED', 'HIT_RADIUS', 'G_GAME']) assert.ok(!TUNABLE_ONLINE_FREE.includes(k), k);
  // 터치 뗀 뒤 유예 기본값 = 판정 창(접촉 직전 드래그를 재는 시간)
  assert.equal(TUNABLE_DEFAULTS.TOUCH_LIFT_HOLD, TUNABLE_DEFAULTS.SWING_WINDOW);
});
