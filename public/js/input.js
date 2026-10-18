// input.js — 마우스 드래그 타격과 구질 판정.
// 앞부분은 DOM 없이 테스트할 수 있는 순수 함수(classifyShot 등), 맨 끝 createMouseInput만 DOM을 쓴다.
// 이 파일은 'three'를 import하지 않는다 (Node 테스트와 AI가 그대로 불러 쓴다).
//
// 마우스 샘플 { t, x, y, b, k }: t = 게임 시각(s), (x, y) = 라켓 평면 위 좌표(m, x 좌우·y 높이), b = 버튼 누름,
// k = 구질 버튼(7단계: 'drive'·'cut'·'side'·'smash' 또는 null). 구질은 버튼이 정하고, 스윙은 세기·좌우 조준만 정한다.
// 모든 판정은 플레이어 기준 좌표("자기 쪽 y < 0, +y로 친다")에서 하고, 결과만 세계 좌표로 돌려준다.
import {
  vec, add, sub, scale, length, cross, createBall, makeLaunch, solveAim, solveArc, solveBlock, solveServe,
  faceNormal, racketResponse, ballToLocal, toWorld, flightLanding,
} from '../shared/physics.js';
import {
  NET, TABLE, SWING, TUNABLE, RENDER, SHOT_BUTTONS, SHOT_COMBOS, CONTROL_MODES, CONTROL_DEFAULT, FEEL,
} from '../shared/constants.js';
import { createTouchTracker } from './touch.js';

const DEG = Math.PI / 180;
const RPS = 2 * Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ── 결정론적 난수 (mulberry32) ──────────────────────────────
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// −1~1 삼각분포 (가운데가 잦고 끝은 드묾)
const tri = (rng) => rng() + rng() - 1;

// ── 화면 → 라켓 평면 ──────────────────────────────────────
// 광선 origin + s·dir이 평면 y = planeY와 만나는 점의 (x, z). 평행하거나 뒤쪽이면 null.
export function rayPlaneY(origin, dir, planeY) {
  if (Math.abs(dir.y) < 1e-9) return null;
  const s = (planeY - origin.y) / dir.y;
  if (s <= 0) return null;
  return {
    x: clamp(origin.x + s * dir.x, -SWING.X_MAX, SWING.X_MAX),
    z: clamp(origin.z + s * dir.z, SWING.Z_MIN, SWING.Z_MAX),
  };
}

// ── 시점(카메라)과 마우스 감도 (6단계) ────────────────────────────
// render.js(Three.js)와 같은 원근 투영을 순수 함수로 계산한다: 카메라 cam = { pos, target, fov(세로 °) }, 위쪽 = +z.
export function cameraBasis(cam) {
  const norm = (a) => scale(a, 1 / length(a));
  const f = norm(sub(cam.target, cam.pos));
  const r = norm(cross(f, vec(0, 0, 1)));
  return { f, r, u: cross(r, f), tan: Math.tan((cam.fov * Math.PI) / 360) };
}

// 화면 정규 좌표(ndcX, ndcY: −1~1, 위가 +)에서 나가는 광선이 평면 y = planeY와 만나는 점 (물리 좌표). 없으면 null
export function screenToPlane(cam, aspect, ndcX, ndcY, planeY) {
  const { f, r, u, tan } = cameraBasis(cam);
  const dir = add(f, add(scale(r, ndcX * tan * aspect), scale(u, ndcY * tan)));
  if (Math.abs(dir.y) < 1e-9) return null;
  const s = (planeY - cam.pos.y) / dir.y;
  return s > 0 ? add(cam.pos, scale(dir, s)) : null;
}

// 물리 좌표 → 화면 정규 좌표
export function planeToScreen(cam, aspect, p) {
  const { f, r, u, tan } = cameraBasis(cam);
  const d = sub(p, cam.pos);
  const z = d.x * f.x + d.y * f.y + d.z * f.z;
  return { x: (d.x * r.x + d.y * r.y + d.z * r.z) / z / (tan * aspect), y: (d.x * u.x + d.y * u.y + d.z * u.z) / z / tan };
}

// 기준 타점(RENDER.DRAG_REF_POINT)에서 화면 높이 1%만큼 마우스를 움직였을 때 라켓 평면에서 움직이는 거리 (m, 가로·세로 평균)
export function dragGain(cam, aspect = 16 / 9) {
  const p = RENDER.DRAG_REF_POINT;
  const c = planeToScreen(cam, aspect, p);
  const at = (dx, dy) => screenToPlane(cam, aspect, c.x + dx, c.y + dy, p.y);
  const o = at(0, 0), h = at(0.02, 0), v = at(0, 0.02);
  const d = (a) => Math.hypot(a.x - o.x, a.z - o.z);
  return (d(h) / aspect + d(v)) / 2;
}

// 사람 드래그 속도 배율: 기존 시점(RENDER.CAMERA_CLASSIC)에서 같은 손놀림이 내는 속도로 바꾼다.
// 시점이 높고 멀어지면 화면 1 px가 라켓 평면에서 더 길어져(약 1.4배) 같은 손놀림이 더 빠른 스윙으로 판정되기 때문.
// 사용자가 맞춰 둔 판정 임계값(SMASH_SPEED 등)이 시점과 무관하게 같은 뜻을 갖는다. 로봇·서버는 1.
export const dragScaleFor = (cam, aspect) => dragGain(RENDER.CAMERA_CLASSIC, aspect) / dragGain(cam, aspect);

// 내 자리(side)의 카메라: side +1은 z축으로 180° 돌린다 (자기 기준 같은 시점)
export function cameraFor(cam, side) {
  const flip = (p) => (side < 0 ? vec(p.x, p.y, p.z) : vec(-p.x, -p.y, p.z));
  return { pos: flip(cam.pos), target: flip(cam.target), fov: cam.fov };
}

// 시점 거리 배율(CAM_DIST): 바라보는 점에서 k배 멀리 (방향·시야각 그대로)
export function zoomCamera(cam, k) {
  const t = cam.target, p = cam.pos;
  return { pos: vec(t.x + (p.x - t.x) * k, t.y + (p.y - t.y) * k, t.z + (p.z - t.z) * k), target: t, fov: cam.fov };
}

// TUNABLE의 새 시점 (CAM_*)
export const tunableCamera = (params = TUNABLE) => ({
  pos: vec(params.CAM_X, params.CAM_Y, params.CAM_Z), target: vec(params.CAM_TX, params.CAM_TY, params.CAM_TZ), fov: params.CAM_FOV,
});

// ── 샘플 다루기 ──────────────────────────────────────────
// 시각 t 이전(포함)의 가장 최근 샘플. 없으면 null. (샘플은 시간 순서)
export function sampleAt(samples, t) {
  for (let i = samples.length - 1; i >= 0; i--) if (samples[i].t <= t + 1e-9) return samples[i];
  return null;
}

// 시각 t의 라켓 평면 위치: 앞뒤 샘플 사이를 선형 보간 (마우스 이벤트 간격보다 물리 스텝이 촘촘하므로).
// t 뒤 샘플이 아직 없으면 마지막 샘플 위치. 반환 { x, y, b } 또는 null
export function racketPointAt(samples, t) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const a = samples[i];
    if (a.t <= t + 1e-9) {
      const n = samples[i + 1];
      if (!n || n.t - a.t < 1e-9) return { x: a.x, y: a.y, b: a.b };
      const f = Math.min(1, (t - a.t) / (n.t - a.t));
      return { x: a.x + (n.x - a.x) * f, y: a.y + (n.y - a.y) * f, b: a.b };
    }
  }
  return null;
}

// 오래된 샘플을 버린다 (배열을 직접 줄인다)
export function pruneSamples(samples, t) {
  let k = 0;
  while (k < samples.length - 1 && samples[k + 1].t < t - SWING.MAX_SAMPLE_AGE) k++;
  if (k > 0) samples.splice(0, k);
}

// 접촉 시각 t 직전 드래그 분석.
// u: SWING_WINDOW 동안의 평균 속도 = (p(t) − p(t − W)) / W, p(τ)는 τ 이전 마지막 샘플 위치. 방향(θ)에 쓴다.
// speed: 같은 창 안에서 PEAK_DT 길이 구간 속도의 최댓값. 세기·구질 판정에 쓴다.
//   평균은 가속 중인 스윙 앞부분까지 섞여 빠른 내려치기(스매시)와 빠른 커트가 거의 같게 나오기 때문.
//   위치는 샘플 사이를 선형 보간하고, 접촉 시각 t 뒤 샘플은 쓰지 않는다.
// avgSpeed: |u|
// kappa: CURVE_WINDOW 동안 경로가 현(시작→끝)에서 벗어난 최대 거리 / 현 길이 (부호: 현 기준 왼쪽 +).
// speedScale: 속도(u, speed, avgSpeed)에 곱하는 배율 (사람의 시점 보정 dragScaleFor, 기본 1). 방향·곡률은 그대로.
export function analyzeDrag(samples, t, params = TUNABLE, speedScale = 1) {
  const none = { u: { x: 0, y: 0 }, speed: 0, sin: 0, theta: 0, kappa: 0 };
  const end = sampleAt(samples, t);
  if (!end) return none;
  const W = params.SWING_WINDOW;
  let start = sampleAt(samples, t - W);
  let span = W;
  if (!start) {
    start = samples[0];
    span = t - start.t;
  }
  if (span <= 1e-6) return none;
  const u = { x: (end.x - start.x) / span, y: (end.y - start.y) / span };
  const avgSpeed = Math.hypot(u.x, u.y);
  const sin = avgSpeed > 0 ? u.y / avgSpeed : 0;
  const speed = peakSpeed(samples, t, Math.min(W, span), params.PEAK_DT);

  // 곡률
  const C = params.CURVE_WINDOW;
  const c0 = sampleAt(samples, t - C) ?? samples[0];
  const pts = samples.filter((s) => s.t > c0.t && s.t <= t + 1e-9);
  const cx = end.x - c0.x, cy = end.y - c0.y;
  const chord = Math.hypot(cx, cy);
  let kappa = 0;
  if (chord >= 0.01) {
    for (const p of pts) {
      const d = (cx * (p.y - c0.y) - cy * (p.x - c0.x)) / chord; // 현 기준 왼쪽이 +
      if (Math.abs(d) > Math.abs(kappa)) kappa = d;
    }
    kappa /= chord;
  }
  const k = speedScale;
  return { u: { x: u.x * k, y: u.y * k }, speed: speed * k, avgSpeed: avgSpeed * k, sin, theta: Math.atan2(u.y, u.x), kappa };
}

// 시각 t 직전 W초 안에서, 길이 d인 구간의 평균 속도 중 최댓값 (t 뒤 샘플은 쓰지 않음)
function peakSpeed(samples, t, W, d) {
  const past = [];
  for (const q of samples) if (q.t <= t + 1e-9) past.push(q);
  if (past.length < 2) return 0;
  const at = (tau) => racketPointAt(past, Math.max(tau, past[0].t));
  const dd = Math.min(d, W);
  if (dd <= 1e-6) return 0;
  let best = 0;
  // 구간 끝을 t − W + d부터 t까지 촘촘히(샘플 시각 포함) 옮겨 가며 잰다
  const ends = new Set([t]);
  for (let k = 0; k <= 16; k++) ends.add(t - W + dd + ((W - dd) * k) / 16);
  for (const q of past) if (q.t > t - W + dd && q.t <= t) { ends.add(q.t); ends.add(q.t + dd); }
  for (const e of ends) {
    if (e > t + 1e-9 || e < t - W + dd - 1e-9) continue;
    const a = at(e - dd), b = at(e);
    best = Math.max(best, Math.hypot(b.x - a.x, b.y - a.y) / dd);
  }
  return best;
}

// 구질 버튼 (7단계): 접촉 시각 t 직전 BUTTON_WINDOW 안(창 시작 순간의 상태 포함)에서 가장 최근에 눌려 있던 버튼.
// 키를 조금 일찍 떼도 인정한다. 없으면 null (일반 스윙)
export function buttonAt(samples, t, params = TUNABLE) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.t > t + 1e-9) continue;
    if (s.k) return s.k;
    if (s.t < t - params.BUTTON_WINDOW - 1e-9) break; // 창 시작 순간의 상태까지 봤다
  }
  return null;
}

// 구질 판정 (7단계 버튼). zLocal: 공 중심 높이(탁구대 윗면 기준), button: buttonAt 결과
// 버튼을 누른 채 라켓을 멈추면(스윙 속도 < BLOCK_SPEED) 버튼과 상관없이 블록.
// 스매시 버튼: 스윙이 smashSpeed(마우스 SMASH_SPEED, 터치 TOUCH_SMASH_SPEED) 이상이어야 하고(방향 무관, 느리면 일반 스윙),
// 낮은 공(노란 고리)이면 실타(네트).
export function judgeType(drag, zLocal, params = TUNABLE, pressed = true, button = null, smashSpeed = params.SMASH_SPEED) {
  if (!pressed || drag.speed < params.BLOCK_SPEED) return 'block';
  if (button === 'smash') {
    if (drag.speed < smashSpeed) return 'normal';
    return zLocal >= NET.HEIGHT + params.SMASH_MIN_HEIGHT ? 'smash' : 'mishit';
  }
  return SHOT_BUTTONS.includes(button) || SHOT_COMBOS[button] ? button : 'normal';
}

// 기본 조작 모드 (7단계 수정, v6.3 방식): 버튼 없이 드래그 방향·곡률·속도로 구질을 정한다.
// 아래로(sinθ ≤ −DIR_SIN) 느리면 커트, smashSpeed(BASIC_SMASH_SPEED) 이상이면 빨간 고리에서 스매시·노란 고리에서 센 커트
// (v6.3 기본값 LOW_SMASH_MISHIT = 0과 같음), 휘어지게(|κ| ≥ CURVE_MIN) 쓸면 사이드, 나머지(위·옆)는 드라이브
export function judgeBasic(drag, zLocal, params = TUNABLE, pressed = true, smashSpeed = params.BASIC_SMASH_SPEED) {
  if (!pressed || drag.speed < params.BLOCK_SPEED) return 'block';
  if (drag.sin <= -params.DIR_SIN) {
    if (drag.speed < smashSpeed) return 'cut';
    return zLocal >= NET.HEIGHT + params.SMASH_MIN_HEIGHT ? 'smash' : 'cut';
  }
  if (Math.abs(drag.kappa) >= params.CURVE_MIN) return 'side';
  return 'drive';
}

// 저장된 조작 모드 값을 고친다 (모르는 값이면 기본 모드)
export const controlMode = (v) => (CONTROL_MODES.includes(v) ? v : CONTROL_DEFAULT);

// 타이밍: dt = 타격 시각 − 예측 정점 시각
export function gradeTiming(dt, params = TUNABLE) {
  const a = Math.abs(dt);
  if (!(a <= params.OK_WINDOW)) return { timing: 'BAD', accuracy: params.ACC_BAD };
  if (a <= params.PERFECT_WINDOW) return { timing: 'PERFECT', accuracy: params.ACC_PERFECT };
  if (a <= params.GOOD_WINDOW) return { timing: 'GOOD', accuracy: params.ACC_GOOD };
  return { timing: 'OK', accuracy: params.ACC_OK };
}

// ── 빗나감 판정 (7단계 수정): 헛스윙이 빨랐나 느렸나 ──
// samples: 공이 올 때부터 모은 내 샘플(오래된 것도 버리지 않은 사본), apexT: 예측 정점 시각(PERFECT 시각),
// apex: 정점의 기준 좌표 { x, z }, scale: 드래그 속도 보정(dragScale).
// 정점 MISS_EARLY 전 ~ MISS_LOOK 뒤에서 버튼을 누르고 가장 빠르게 휘두른 순간(PEAK_DT 구간의 가운데)을 스윙 시각으로 본다.
// 반환 { kind: 'early'(빠름)|'late'(느림)|'pos'(타이밍은 맞았는데 자리가 빗나감), dt(스윙 − 정점, s), dx, dz(공 − 라켓, m) } | null
export function judgeMiss(samples, apexT, apex, params = TUNABLE, scale = 1) {
  if (apexT == null || !samples.length) return null;
  const d = params.PEAK_DT;
  let best = null;
  for (const s of samples) {
    if (!s.b || s.t < apexT - FEEL.MISS_EARLY || s.t > apexT + FEEL.MISS_LOOK + d) continue;
    const a = racketPointAt(samples, s.t - d);
    if (!a || !a.b) continue;
    const v = (Math.hypot(s.x - a.x, s.y - a.y) / d) * scale;
    if (v >= params.BLOCK_SPEED && (!best || v > best.v)) best = { v, t: s.t - d / 2 };
  }
  const t = best ? best.t : apexT;
  const r = racketPointAt(samples, t);
  const off = r && apex ? { dx: apex.x - r.x, dz: apex.z - r.y } : { dx: 0, dz: 0 };
  if (!best) return r ? { kind: 'pos', dt: 0, ...off } : null; // 휘두르지 않았는데 못 맞힘 = 자리
  const dt = best.t - apexT;
  if (Math.abs(dt) <= params.GOOD_WINDOW) return { kind: 'pos', dt, ...off };
  return { kind: dt < 0 ? 'early' : 'late', dt, ...off };
}

// 빗나감 표시 글자: 빠름/느림 + 몇 ms, 자리면 공이 있던 쪽
export function missText(m) {
  if (!m) return '';
  if (m.kind === 'early') return `빠름 ${Math.round(-m.dt * 1000)} ms`;
  if (m.kind === 'late') return `느림 ${Math.round(m.dt * 1000)} ms`;
  const h = Math.abs(m.dx) >= Math.abs(m.dz);
  const dir = h ? (m.dx > 0 ? '오른쪽' : '왼쪽') : (m.dz > 0 ? '위' : '아래');
  return `빗나감 · 공은 라켓 ${dir}`;
}

// 방향 오차 (계획 4장): 정확도 a가 1이면 0
export function aimErrors(accuracy, dt, rng, params = TUNABLE) {
  const k = 1 - accuracy;
  const bias = Number.isFinite(dt) ? Math.sign(dt) : 0;
  return {
    yaw: k * (params.ERR_YAW * tri(rng) + params.ERR_BIAS * bias),
    pitch: k * params.ERR_PITCH * tri(rng),
    speed: k * params.ERR_SPEED * tri(rng),
  };
}

// 퍼펙트 콤보 (7단계 수정): 공격 스윙을 PERFECT로 치면 콤보 + 1, PERFECT가 아니거나 블록·실타면 0. 서브는 세지도 끊지도 않는다.
// 반환 { combo(이 타격 뒤 콤보 수), level(이 타격의 위력 단계 = min(콤보 − 1, COMBO_MAX)) }
export const COMBO_SHOTS = Object.freeze(['normal', 'drive', 'cut', 'side', 'smash', 'sidecut', 'sidedrive']);
export function comboAfter(prev, shotType, timing, { serve = false, pressed = true } = {}, params = TUNABLE) {
  if (serve) return { combo: prev, level: 0 };
  if (!pressed || timing !== 'PERFECT' || !COMBO_SHOTS.includes(shotType)) return { combo: 0, level: 0 };
  const combo = prev + 1;
  // 첫 PERFECT는 위력 그대로, 둘째 연속 PERFECT부터 한 단계씩
  return { combo, level: Math.min(combo - 1, params.COMBO_MAX) };
}

// 조합 구질(사이드 커트·사이드 드라이브)은 속도·정점·깊이·면을 바탕 구질 값으로 쓴다
const PREFIX = { normal: 'NORMAL', drive: 'DRIVE', smash: 'SMASH', cut: 'CUT', side: 'SIDE', block: 'BLOCK', sidecut: 'CUT', sidedrive: 'DRIVE' };
const lerpP = (params, P, key, s) => params[`${P}_${key}_MIN`] + s * (params[`${P}_${key}_MAX`] - params[`${P}_${key}_MIN`]);

// 들어온 회전이 바꾸는 몫 (계획 2장 ①): P(ω_in) − P(0), 라켓 면 n, 라켓 속도 u (기본 0)
export function spinEffect(ball, n, params = TUNABLE, u = vec()) {
  const withSpin = racketResponse(ball, n, u, params);
  const noSpin = racketResponse(createBall({ pos: ball.pos, vel: ball.vel, t: ball.t }), n, u, params);
  return { dv: sub(withSpin.vel, noSpin.vel), dw: sub(withSpin.spin, noSpin.spin) };
}

// 들어온 회전을 진행 방향 기준으로 나눈다 (7단계): top = 탑스핀(+)/백스핀(−) 성분 rps, side = 횡회전 rps(위에서 봐서 반시계 +),
// par = 수평축 회전 벡터(탑·백 효과용), perp = 수직축 회전 벡터(횡 효과용)
export function spinParts(ball) {
  const hx = ball.vel.x, hy = ball.vel.y, h = Math.hypot(hx, hy) || 1;
  // 진행 방향 기준 탑스핀 축 = ẑ × 진행 방향
  const top = ((-hy / h) * ball.spin.x + (hx / h) * ball.spin.y) / RPS;
  return { top, side: ball.spin.z / RPS, par: vec(ball.spin.x, ball.spin.y, 0), perp: vec(0, 0, ball.spin.z) };
}

// 들어온 공의 회전이 탑스핀(공 윗면이 나를 향해 돎)인지 백스핀인지에 따라 회전 효과가 남는 비율
// 조합 구질은 바탕 구질과 사이드의 평균
export function spinLambda(type, ball, params = TUNABLE) {
  if (SHOT_COMBOS[type]) return (spinLambda(SHOT_COMBOS[type], ball, params) + spinLambda('side', ball, params)) / 2;
  const P = PREFIX[type];
  return spinParts(ball).top >= 0 ? params[`${P}_LAMBDA_TOP`] : params[`${P}_LAMBDA_BACK`];
}

// 들어온 횡회전 효과가 남는 비율 (7단계)
export const sideLambda = (type, params = TUNABLE) => (SHOT_COMBOS[type]
  ? (sideLambda(SHOT_COMBOS[type], params) + sideLambda('side', params)) / 2
  : params[`${PREFIX[type]}_LAMBDA_SIDE`]);

// 들어온 회전의 효과 (λ를 곱한 몫): 탑·백 성분과 횡 성분을 따로 계산해 각자의 λ를 곱한다. 라켓 면 n, 라켓 속도 u.
// 7단계: 라켓 속도를 넣어 계산한다. 정지 라켓(u = 0)으로 재면 바운드 뒤 느린 공(1~2 m/s)은 법선 충격량이 작아
// 마찰로 바뀌는 몫도 작아져, 백스핀 공을 일반 스윙으로 쳐도 거의 영향이 없었다.
export function incomingEffect(type, ball, n, params = TUNABLE, u = vec()) {
  const parts = spinParts(ball);
  const lt = spinLambda(type, ball, params), ls = sideLambda(type, params);
  const withSpin = (w) => createBall({ pos: ball.pos, vel: ball.vel, spin: w, t: ball.t });
  const ft = spinEffect(withSpin(parts.par), n, params, u), fs = spinEffect(withSpin(parts.perp), n, params, u);
  return { dv: add(scale(ft.dv, lt), scale(fs.dv, ls)), dw: add(scale(ft.dw, lt), scale(fs.dw, ls)) };
}

// 회전 누적 (7단계): 나가는 회전(rps) = min(상한, 기본 회전 + STACK × 들어온 같은 종류 회전).
// 드라이브는 들어온 탑스핀, 커트는 들어온 백스핀, 사이드는 들어온 횡회전 크기를 더한다. 다른 종류는 쌓이지 않는다.
export function stackSpin(type, base, ball, params = TUNABLE) {
  const P = PREFIX[type];
  const cap = params[`${P}_SPIN_CAP`];
  if (cap == null) return { spin: base, base, add: 0, capped: false };
  const parts = spinParts(ball);
  const same = type === 'drive' ? Math.max(0, parts.top) : type === 'cut' ? Math.max(0, -parts.top) : Math.abs(parts.side);
  const add = params[`${P}_STACK`] * same;
  const raw = base + add;
  return { spin: Math.min(cap, raw), base, add, capped: raw >= cap };
}

// 조준한 공이 상대 코트에 떨어지는가 (flightLanding 결과)
const landsIn = (l) => !l.short && Number.isFinite(l.y) && l.y > 0 && l.y <= TABLE.LENGTH / 2 && Math.abs(l.x) <= TABLE.WIDTH / 2;

// 구질별 목표 착지점 (기준 좌표)
export function aimTarget(type, drag, racketX, params = TUNABLE) {
  const ux = drag.speed > 0 ? drag.u.x / drag.speed : 0;
  const x = clamp(params.AIM_X_POS * racketX + params.AIM_X_DRAG * ux, -params.AIM_X_MAX, params.AIM_X_MAX);
  const depth = params[`${PREFIX[type]}_DEPTH`];
  const y = clamp(depth, 0.2, 1.3);
  return { x, y };
}

// ── 구질 판정 + 나가는 공 상태 ─────────────────────────────
// samples: 마우스 샘플, ballState: 접촉 순간 공(세계 좌표)
// ctx: { t(접촉 시각, 기본 ballState.t), side(−1/+1, 기본 −1), apexT(예측 정점 시각), rng, params,
//        racketX(라켓 x, 기준 좌표, 기본 마지막 샘플 x), pressed(버튼, 기본 true),
//        serve(서브: 자기 코트 → 상대 코트로 조준, 기본 false), dragScale(사람 시점 보정, 기본 1),
//        button(구질 버튼, 기본 샘플의 k로 buttonAt), spinIn(판정용 들어온 회전, 세계 좌표 rad/s. 기본 공의 물리 회전),
//        smashSpeed(스매시 기준 스윙 속도, 기본 SMASH_SPEED. 터치는 TOUCH_SMASH_SPEED),
//        ringZ(화면 고리 = 예측 정점의 높이. 이 높이가 스매시 높이 이상(빨간 고리)이면 맞은 높이가 조금 낮아도 스매시),
//        control('advanced' 구질 버튼(기본값, 로봇) | 'basic' 드래그 방향으로 구질, 설정 ⚙),
//        combo(이 타격 전까지 이어진 퍼펙트 콤보 수, 기본 0. 로봇은 넘기지 않는다) }
// 반환: { shotType, vel, spin, quality: { timing, accuracy, strength, dtApex, weak, target, button, spinIn, stack, combo, comboLevel } }
export function classifyShot(samples, ballState, ctx = {}) {
  const params = ctx.params ?? TUNABLE;
  const side = ctx.side ?? -1;
  const t = ctx.t ?? ballState.t;
  const rng = ctx.rng ?? (() => 0.5); // 기본: 오차 없음
  const pressed = ctx.pressed ?? true;
  // 판정용 회전(7단계): 들어온 회전은 상대가 쳐 보낸 회전(공기 감쇠만)으로 읽는다. 라켓 접촉 계산에도 이 회전을 쓴다.
  const b = ballToLocal(ctx.spinIn ? { ...ballState, spin: ctx.spinIn } : ballState, side);
  const drag = analyzeDrag(samples, t, params, ctx.dragScale ?? 1);
  const racketX = ctx.racketX ?? sampleAt(samples, t)?.x ?? b.pos.x;
  const serve = !!ctx.serve;
  const basic = ctx.control === 'basic';
  // 기본 모드는 구질 버튼을 보지 않는다
  const button = basic ? null : ctx.button !== undefined ? ctx.button : buttonAt(samples, t, params);
  const smashSpeed = ctx.smashSpeed ?? (basic ? params.BASIC_SMASH_SPEED : params.SMASH_SPEED);
  // 스매시 높이는 화면의 고리(예측 정점 높이 ringZ)와 맞춘다 (7단계 수정): 빨간 고리면 정점보다 조금 일찍·늦게 쳐서
  // 맞은 높이가 스매시 높이보다 낮아도, 네트 + SMASH_RING_FLOOR 이상이면 스매시로 본다 (그보다 낮으면 넣을 각이 없어 실타)
  const ringOk = (ctx.ringZ ?? -Infinity) >= NET.HEIGHT + params.SMASH_MIN_HEIGHT && b.pos.z >= NET.HEIGHT + params.SMASH_RING_FLOOR;
  const smashZ = ringOk ? Math.max(b.pos.z, ctx.ringZ) : b.pos.z;
  let shotType = basic ? judgeBasic(drag, smashZ, params, pressed, smashSpeed) : judgeType(drag, smashZ, params, pressed, button, smashSpeed);
  // 서브에서는 스매시를 막는다: 고급 모드는 일반 서브, 기본 모드는 내려친 동작이므로 커트 서브
  if (serve && (shotType === 'smash' || shotType === 'mishit')) shotType = basic ? 'cut' : 'normal';
  const parts = spinParts(b);
  const dtApex = ctx.apexT == null ? Infinity : t - ctx.apexT;
  const { timing, accuracy } = gradeTiming(dtApex, params);
  const cb = comboAfter(ctx.combo ?? 0, shotType, timing, { serve, pressed }, params);
  const strength = clamp((drag.speed - params.BLOCK_SPEED) / (params.SPEED_FULL - params.BLOCK_SPEED), 0, 1);
  const err = aimErrors(accuracy, dtApex, rng, params);
  // 서브는 오차를 줄여 타이밍이 조금 어긋나도 들어가게 한다
  if (serve) for (const k of Object.keys(err)) err[k] *= params.SERVE_ERR_SCALE;
  // dragSpeed·dragSin: 판정에 쓴 스윙 최고 속도(m/s)와 방향(+ 위). 화면에 보여 줘서 사용자가 임계값을 맞출 수 있게 한다.
  const quality = {
    timing, accuracy, strength, dtApex, weak: !pressed, target: null, dragSpeed: drag.speed, dragSin: drag.sin, serve,
    button, smashSlow: button === 'smash' && shotType === 'normal' && !serve, smashNoServe: serve && button === 'smash', smashSpeed,
    spinIn: { top: parts.top, side: parts.side }, stack: null, combo: cb.combo, comboLevel: cb.level,
  };
  const boostV = 1 + params.COMBO_SPEED * cb.level, boostW = 1 + params.COMBO_SPIN * cb.level;

  let out; // 기준 좌표의 { vel, spin }
  if (serve && shotType !== 'block') {
    out = serveShot(shotType, drag, b, t, racketX, strength, err, params);
    quality.target = out.target;
  } else if (shotType === 'mishit') {
    // 낮은 공 내려치기: 네트 아랫부분을 향해 곧게 꽂힌다
    const tx = clamp(b.pos.x, -params.AIM_X_MAX, params.AIM_X_MAX);
    const dir = sub(vec(tx, 0, params.MISHIT_AIM_Z), b.pos);
    out = { vel: scale(dir, params.MISHIT_SPEED / length(dir)), spin: vec() };
  } else if (shotType === 'block') {
    if (!pressed) {
      // 약한 블록: 면 고정, 조준 없음, 순수 물리
      out = racketResponse(b, faceNormal(params.WEAK_PITCH, 0), vec(), params);
    } else {
      const u = vec(drag.u.x, params.BLOCK_PUSH, drag.u.y);
      const target = aimTarget('block', drag, racketX, params);
      quality.target = target;
      // 면 각도는 "회전이 (1 − λ)만큼만 있는 공"에 맞춘다: λ = 1이면 회전을 못 읽은 블록
      const lt = spinLambda('block', b, params), ls = sideLambda('block', params);
      const seen = createBall({ pos: b.pos, vel: b.vel, spin: add(scale(parts.par, 1 - lt), scale(parts.perp, 1 - ls)), t: b.t });
      const face = solveBlock(seen, u, target, params);
      // 면을 δ/2 돌리면 반사 방향은 약 δ 돌아간다
      out = racketResponse(b, faceNormal(face.pitch + err.pitch / 2, face.yaw + err.yaw / 2), scale(u, 1 + err.speed), params);
    }
  } else {
    const P = PREFIX[shotType];
    let speed = lerpP(params, P, 'V', strength) * boostV; // 퍼펙트 콤보: 스매시 속도 (높은 포물선 구질은 아래 solveArc가 속도를 정한다)
    let topspin = 0, sidespin = 0;
    const dirX = Math.abs(drag.u.x) > 0.05 * drag.speed ? Math.sign(drag.u.x) : (racketX > 0 ? 1 : -1);
    const combo = SHOT_COMBOS[shotType];
    if (combo) {
      // 조합 구질: 바탕 회전(탑·백)과 횡회전을 각각 같은 종류로 쌓고 COMBO_MIX를 곱해 합친다
      const k = params.COMBO_MIX;
      const stB = stackSpin(combo, lerpP(params, P, 'SPIN', strength), b, params);
      const stS = stackSpin('side', lerpP(params, 'SIDE', 'SPIN', strength), b, params);
      topspin = (combo === 'cut' ? -1 : 1) * k * stB.spin;
      sidespin = dirX * k * stS.spin;
      const base = k * Math.hypot(stB.base, stS.base), spin = Math.hypot(topspin, sidespin);
      quality.stack = { spin, base, add: spin - base, capped: stB.capped || stS.capped };
    } else if (shotType !== 'normal') {
      // 같은 종류 회전으로 받아치면 회전이 쌓인다 (스매시는 쌓이지 않음)
      const st = stackSpin(shotType, lerpP(params, P, 'SPIN', strength), b, params);
      if (shotType !== 'smash') quality.stack = st;
      const spin = st.spin;
      if (shotType === 'drive' || shotType === 'smash') topspin = spin;
      else if (shotType === 'cut') topspin = -spin;
      else {
        // 라켓이 공 뒤를 오른쪽(+x)으로 쓸면 위에서 봐서 반시계(+) 회전 → 진행 방향 왼쪽으로 휜다.
        // 좌우 성분이 거의 없으면 탁구대 가운데 쪽으로 휘게 한다 (dirX)
        sidespin = dirX * spin;
        topspin = lerpP(params, P, 'TOP', strength);
      }
    }
    // 퍼펙트 콤보: 회전(누적 상한 포함)을 boostW배로
    topspin *= boostW;
    sidespin *= boostW;
    if (quality.stack) quality.stack = { ...quality.stack, spin: quality.stack.spin * boostW };
    const target = aimTarget(shotType, drag, racketX, params);
    quality.target = target;
    // 6단계 높은 포물선: 세기로 목표 정점 높이를 정하고 속도·발사각을 함께 푼다 (스매시는 가장 낮은 각 그대로)
    let aim;
    if (params[`${P}_APEX_WEAK`] != null) {
      // 퍼펙트 콤보: 정점을 낮춰 같은 깊이를 더 빠르게 보내고, 속도 한계도 boostV배로 올린다
      const apex = (params[`${P}_APEX_WEAK`] + strength * (params[`${P}_APEX_STRONG`] - params[`${P}_APEX_WEAK`]))
        * (1 - params.COMBO_APEX * cb.level);
      aim = solveArc({
        pos: b.pos, topspin, sidespin, target, t, apex, vMin: params[`${P}_V_MIN`], vMax: params[`${P}_V_MAX`] * boostV,
      }, params);
      speed = aim.speed;
      quality.apex = aim.apex;
    } else {
      aim = solveAim({ pos: b.pos, speed, topspin, sidespin, target, t }, params);
    }
    const launchAt = (v, am) => makeLaunch({
      pos: b.pos, t,
      speed: v * (1 + err.speed),
      elevation: am.elevation + err.pitch,
      azimuth: am.azimuth + err.yaw,
      topspin, sidespin,
    });
    let launch = launchAt(speed, aim);
    // 스매시 속도 보조 (7단계 수정): 낮은 타점·타이밍 오차로 이 속도의 공(오차 포함)이 상대 코트에 떨어지지 않으면
    // SMASH_ASSIST_STEP씩 SMASH_ASSIST_V까지 늦춰 다시 조준한다 (스매시는 들어온 회전 영향 λ = 0이라 이 공이 그대로 나간다)
    while (shotType === 'smash' && !landsIn(flightLanding(launch, params, 0))
      && speed - SWING.SMASH_ASSIST_STEP >= params.SMASH_ASSIST_V - 1e-9) {
      speed -= SWING.SMASH_ASSIST_STEP;
      aim = solveAim({ pos: b.pos, speed, topspin, sidespin, target, t }, params);
      launch = launchAt(speed, aim);
    }
    const face = faceNormal(params[`${P}_PITCH`], 0);
    const fx = incomingEffect(shotType, b, face, params, scale(face, speed));
    out = { vel: add(launch.vel, fx.dv), spin: add(launch.spin, fx.dw) };
  }
  return {
    shotType,
    vel: toWorld(out.vel, side),
    spin: toWorld(out.spin, side),
    quality,
  };
}

// 서브: 버튼 구질로 회전을 정하고(일반 = 무회전, 드라이브 = 탑, 커트 = 백, 사이드 = 횡, 조합 = 횡 + 탑·백. 스매시 버튼은 일반 서브),
// 자기 코트 → 상대 코트 SERVE_DEPTH에 떨어지게 조준한다. 속도는 세기로 SERVE_V_MIN~MAX.
function serveShot(type, drag, b, t, racketX, strength, err, params) {
  const P = PREFIX[type];
  const k = params.SERVE_SPIN_SCALE;
  const spin = type === 'normal' ? 0 : k * lerpP(params, P, 'SPIN', strength);
  const dirX = Math.abs(drag.u.x) > 0.05 * drag.speed ? Math.sign(drag.u.x) : (racketX > 0 ? 1 : -1);
  let topspin = 0, sidespin = 0;
  if (type === 'drive') topspin = spin;
  else if (type === 'cut') topspin = -spin;
  else if (type === 'side') {
    sidespin = dirX * spin;
    topspin = k * lerpP(params, P, 'TOP', strength);
  } else if (SHOT_COMBOS[type]) {
    // 조합 서브 (사이드 커트·사이드 드라이브)
    topspin = (SHOT_COMBOS[type] === 'cut' ? -1 : 1) * params.COMBO_MIX * spin;
    sidespin = dirX * params.COMBO_MIX * k * lerpP(params, 'SIDE', 'SPIN', strength);
  }
  const speed = params.SERVE_V_MIN + strength * (params.SERVE_V_MAX - params.SERVE_V_MIN);
  const target = { x: aimTarget(type, drag, racketX, params).x, y: params.SERVE_DEPTH };
  // 속도 보조: 이 속도로 들어가는 서브가 없으면(낮은 타점 등) SERVE_ASSIST_V까지 조금씩 빠르게 해 본다
  let v = speed;
  let aim = solveServe({ pos: b.pos, speed: v, topspin, sidespin, target, t }, params);
  while (!aim.valid && v + SWING.SERVE_ASSIST_STEP <= params.SERVE_ASSIST_V + 1e-9) {
    v += SWING.SERVE_ASSIST_STEP;
    aim = solveServe({ pos: b.pos, speed: v, topspin, sidespin, target, t }, params);
  }
  if (!aim.valid) {
    v = speed;
    aim = solveServe({ pos: b.pos, speed: v, topspin, sidespin, target, t }, params);
  }
  const launch = makeLaunch({
    pos: b.pos, t,
    speed: v * (1 + err.speed),
    elevation: aim.elevation + err.pitch,
    azimuth: aim.azimuth + err.yaw,
    topspin, sidespin,
  });
  return { vel: launch.vel, spin: launch.spin, target };
}

// ── 타격 순간 판정 (사람·로봇 공용) ───────────────────────────
// player: { side, samples, yPlane(기준 좌표 라켓 평면 y) }, ball: 세계 좌표 공(이번 스텝 시작 상태)
// 반환: 'swing'(휘두르는 중, 도달 범위 안) | 'block'(버튼 누르고 정지, 라켓 평면 통과)
//     | 'weak'(버튼 없음, 도달 범위 뒤끝 통과 — 늦게 휘두를 여유를 준다) | null
// radius: 좌우·높이 도달 범위(원 반지름, 화면의 라켓 반지름과 같음. 서브는 SERVE_HIT_RADIUS로 넓힌다)
export function checkHit(player, ball, t, dt, params = TUNABLE, radius = params.HIT_RADIUS) {
  const s = racketPointAt(player.samples, t);
  if (!s) return null;
  const b = ballToLocal(ball, player.side);
  const dx = b.pos.x - s.x, dz = b.pos.z - s.y;
  if (Math.hypot(dx, dz) > radius) return null; // 원: 화면의 라켓·고리와 같은 크기
  const yp = player.yPlane;
  const crosses = (y) => b.vel.y < 0 && b.pos.y >= y && b.pos.y + b.vel.y * dt < y;
  if (s.b && Math.abs(b.pos.y - yp) <= params.REACH_Y) {
    const drag = analyzeDrag(player.samples, t, params, player.dragScale ?? 1);
    if (drag.speed >= params.BLOCK_SPEED) {
      // 휘두르는 라켓이 공에 "닿는 순간" 친다: 스윙 방향으로 봤을 때 라켓 중심이 공 중심에 도달(또는 지나침).
      // 스윙을 시작하자마자(아직 가속 중일 때) 치지 않도록 하기 위함. 도달 범위 뒤끝에서는 마지막 기회로 친다.
      const along = (dx * drag.u.x + dz * drag.u.y) / drag.speed;
      if (along <= 0 || crosses(yp - params.REACH_Y)) return 'swing';
      return null;
    }
  }
  if (s.b && crosses(yp)) return 'block';
  if (!s.b && crosses(yp - params.REACH_Y)) return 'weak';
  return null;
}

// 라켓의 기준 좌표 위치. ballLocalY를 주면 도달 범위 안에서 앞뒤로 공을 따라간다 (화면 표시용).
export function racketLocal(player, t, ballLocalY = null, params = TUNABLE) {
  const s = racketPointAt(player.samples, t);
  if (!s) return null;
  const y = ballLocalY == null ? player.yPlane
    : clamp(ballLocalY, player.yPlane - params.REACH_Y, player.yPlane + params.REACH_Y);
  return vec(s.x, y, s.y);
}

// ── 구질 버튼 상태 (7단계, DOM 없음) ────────────────────────────
// 누른 버튼(누른 순서)으로 구질을 정한다 (7단계 수정: 동시 누름):
//  - 스매시가 눌려 있으면 스매시 (다른 버튼과 섞이지 않음)
//  - 사이드 + 커트 = 사이드 커트(횡+백), 사이드 + 드라이브 = 사이드 드라이브(횡+탑)
//  - 드라이브와 커트를 같이 누르면 나중에 누른 것
export function resolveShotKeys(held) {
  if (held.includes('smash')) return 'smash';
  let base = null;
  for (const k of held) if (k === 'drive' || k === 'cut') base = k;
  const side = held.includes('side');
  if (base && side) return base === 'cut' ? 'sidecut' : 'sidedrive';
  return base ?? (side ? 'side' : null);
}

// 구질 → 눌린 버튼 목록 (화면 표시용)
export const shotKeysOf = (shot) => (shot ? (SHOT_COMBOS[shot] ? [SHOT_COMBOS[shot], 'side'] : [shot]) : []);

// 버튼 상태: 같은 버튼을 두 곳(모바일의 단일·조합 버튼)에서 누를 수 있어 누른 횟수를 센다
export function createShotKeys() {
  const held = [];
  const count = new Map();
  return {
    press(k) {
      if (!SHOT_BUTTONS.includes(k)) return;
      count.set(k, (count.get(k) ?? 0) + 1);
      const i = held.indexOf(k);
      if (i >= 0) held.splice(i, 1);
      held.push(k);
    },
    release(k) {
      const c = (count.get(k) ?? 0) - 1;
      if (c > 0) { count.set(k, c); return; }
      count.delete(k);
      const i = held.indexOf(k);
      if (i >= 0) held.splice(i, 1);
    },
    clear() { held.length = 0; count.clear(); },
    get current() { return resolveShotKeys(held); },
  };
}

// ── DOM: 마우스·터치 → 샘플 ─────────────────────────────────
// opts.toPlane(clientX, clientY) → { x, z } | null, opts.now() → 게임 시각(s), opts.onPress(),
// opts.button() → 지금 누른 구질 버튼(7단계, 샘플의 k)
// 터치(pointerType 'touch')는 touch.js가 같은 샘플 배열로 바꾼다 (6단계 모바일). 마우스 동작은 그대로다.
export function createMouseInput(canvas, opts) {
  const samples = [];
  let pressed = false;
  let last = { x: 0, z: SWING.HOME.z };
  let touchActive = false; // 마지막으로 쓴 입력이 터치인가 (터치 감도 보정용)
  const button = () => opts.button?.() ?? null;
  const touch = createTouchTracker(samples, { toPlane: opts.toPlane, button });

  function push(clientX, clientY, t) {
    const p = opts.toPlane(clientX, clientY);
    if (p) last = p;
    const prev = samples[samples.length - 1];
    const s = { t: prev && t < prev.t ? prev.t : t, x: last.x, y: last.z, b: pressed, k: button() };
    samples.push(s);
    pruneSamples(samples, s.t);
  }
  // 묶인 이벤트는 실제 발생 시각 차이만큼 과거로 놓는다
  const coalesced = (e, now, fn) => {
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of list.length ? list : [e]) fn(ev.clientX, ev.clientY, now - (e.timeStamp - ev.timeStamp) / 1000);
  };

  canvas.addEventListener('pointermove', (e) => {
    const now = opts.now();
    if (e.pointerType === 'touch') {
      coalesced(e, now, (x, y, t) => touch.move(e.pointerId, x, y, t));
      return;
    }
    touchActive = false;
    coalesced(e, now, push);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      if (!touch.down(e.pointerId, e.clientX, e.clientY, opts.now())) return;
      touchActive = true;
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 이미 끝난 손가락 등 */ }
      opts.onPress?.();
      return;
    }
    if (e.button !== 0) return;
    touchActive = false;
    pressed = true;
    canvas.setPointerCapture?.(e.pointerId);
    push(e.clientX, e.clientY, opts.now());
    opts.onPress?.();
  });
  const release = (e) => {
    if (e.pointerType === 'touch') {
      touch.up(e.pointerId, e.clientX, e.clientY, opts.now());
      return;
    }
    if (!pressed) return;
    pressed = false;
    push(e.clientX, e.clientY, opts.now());
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    samples,
    get pressed() { return touchActive ? touch.touching : pressed; },
    get touchActive() { return touchActive; },
    // 프레임마다 마우스가 멈춰 있어도 현재 위치를 한 번 기록 (라켓 평면 y가 바뀌었을 때 반영)
    refresh(t) {
      if (touchActive) { touch.refresh(t); return; }
      const prev = samples[samples.length - 1];
      if (!prev || t - prev.t > 0.05) {
        samples.push({ t: Math.max(t, prev?.t ?? t), x: last.x, y: last.z, b: pressed, k: button() });
        pruneSamples(samples, t);
      }
    },
    // 구질 버튼을 누르거나 뗐을 때: 라켓이 멈춰 있어도 지금 상태를 바로 기록한다
    mark(t) {
      if (touchActive) { touch.mark(t); return; }
      const prev = samples[samples.length - 1];
      samples.push({ t: Math.max(t, prev?.t ?? t), x: last.x, y: last.z, b: pressed, k: button() });
      pruneSamples(samples, t);
    },
  };
}
