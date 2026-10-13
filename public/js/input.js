// input.js — 마우스 드래그 타격과 구질 판정.
// 앞부분은 DOM 없이 테스트할 수 있는 순수 함수(classifyShot 등), 맨 끝 createMouseInput만 DOM을 쓴다.
// 이 파일은 'three'를 import하지 않는다 (Node 테스트와 AI가 그대로 불러 쓴다).
//
// 마우스 샘플 { t, x, y, b }: t = 게임 시각(s), (x, y) = 라켓 평면 위 좌표(m, x 좌우·y 높이), b = 버튼 누름.
// 모든 판정은 플레이어 기준 좌표("자기 쪽 y < 0, +y로 친다")에서 하고, 결과만 세계 좌표로 돌려준다.
import {
  vec, add, sub, scale, length, cross, createBall, makeLaunch, solveAim, solveBlock,
  faceNormal, racketResponse, ballToLocal, toWorld,
} from '../shared/physics.js';
import { NET, SWING, TUNABLE } from '../shared/constants.js';

const DEG = Math.PI / 180;
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
// u: SWING_WINDOW 동안의 평균 속도 = (p(t) − p(t − W)) / W, p(τ)는 τ 이전 마지막 샘플 위치.
// kappa: CURVE_WINDOW 동안 경로가 현(시작→끝)에서 벗어난 최대 거리 / 현 길이 (부호: 현 기준 왼쪽 +).
export function analyzeDrag(samples, t, params = TUNABLE) {
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
  const speed = Math.hypot(u.x, u.y);
  const sin = speed > 0 ? u.y / speed : 0;

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
  return { u, speed, sin, theta: Math.atan2(u.y, u.x), kappa };
}

// 구질 판정 (판정 순서는 계획 3장 표). zLocal: 공 중심 높이(탁구대 윗면 기준)
export function judgeType(drag, zLocal, params = TUNABLE, pressed = true) {
  if (!pressed || drag.speed < params.BLOCK_SPEED) return 'block';
  if (drag.sin <= -params.DIR_SIN) {
    if (drag.speed < params.SMASH_SPEED) return 'cut';
    return zLocal >= NET.HEIGHT + params.SMASH_MIN_HEIGHT ? 'smash' : 'mishit';
  }
  if (Math.abs(drag.kappa) >= params.CURVE_MIN) return 'side';
  return 'drive';
}

// 타이밍: dt = 타격 시각 − 예측 정점 시각
export function gradeTiming(dt, params = TUNABLE) {
  const a = Math.abs(dt);
  if (!(a <= params.OK_WINDOW)) return { timing: 'BAD', accuracy: params.ACC_BAD };
  if (a <= params.PERFECT_WINDOW) return { timing: 'PERFECT', accuracy: params.ACC_PERFECT };
  if (a <= params.GOOD_WINDOW) return { timing: 'GOOD', accuracy: params.ACC_GOOD };
  return { timing: 'OK', accuracy: params.ACC_OK };
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

const PREFIX = { drive: 'DRIVE', smash: 'SMASH', cut: 'CUT', side: 'SIDE' };
const lerpP = (params, P, key, s) => params[`${P}_${key}_MIN`] + s * (params[`${P}_${key}_MAX`] - params[`${P}_${key}_MIN`]);

// 들어온 회전이 바꾸는 몫 (계획 2장 ①): P(ω_in) − P(0), 라켓 면 n, 라켓 속도 0
export function spinEffect(ball, n, params = TUNABLE) {
  const withSpin = racketResponse(ball, n, vec(), params);
  const noSpin = racketResponse(createBall({ pos: ball.pos, vel: ball.vel, t: ball.t }), n, vec(), params);
  return { dv: sub(withSpin.vel, noSpin.vel), dw: sub(withSpin.spin, noSpin.spin) };
}

// 들어온 공의 회전이 탑스핀(공 윗면이 나를 향해 돎)인지 백스핀인지에 따라 회전 효과가 남는 비율
export function spinLambda(type, ball, params = TUNABLE) {
  const hx = ball.vel.x, hy = ball.vel.y, h = Math.hypot(hx, hy) || 1;
  // 진행 방향 기준 탑스핀 축 = ẑ × 진행 방향
  const top = (-hy / h) * ball.spin.x + (hx / h) * ball.spin.y;
  const P = type === 'block' ? 'BLOCK' : PREFIX[type];
  return top >= 0 ? params[`${P}_LAMBDA_TOP`] : params[`${P}_LAMBDA_BACK`];
}

// 구질별 목표 착지점 (기준 좌표)
export function aimTarget(type, drag, racketX, params = TUNABLE) {
  const ux = drag.speed > 0 ? drag.u.x / drag.speed : 0;
  const x = clamp(params.AIM_X_POS * racketX + params.AIM_X_DRAG * ux, -params.AIM_X_MAX, params.AIM_X_MAX);
  const depth = type === 'block' ? params.BLOCK_DEPTH : params[`${PREFIX[type]}_DEPTH`];
  const gain = type === 'drive' ? params.DEPTH_GAIN * (drag.sin - SWING.REF_SIN) : 0;
  const y = clamp(depth + gain, 0.2, 1.3);
  return { x, y };
}

// ── 구질 판정 + 나가는 공 상태 ─────────────────────────────
// samples: 마우스 샘플, ballState: 접촉 순간 공(세계 좌표)
// ctx: { t(접촉 시각, 기본 ballState.t), side(−1/+1, 기본 −1), apexT(예측 정점 시각), rng, params,
//        racketX(라켓 x, 기준 좌표, 기본 마지막 샘플 x), pressed(버튼, 기본 true) }
// 반환: { shotType, vel, spin, quality: { timing, accuracy, strength, dtApex, weak, target } }
export function classifyShot(samples, ballState, ctx = {}) {
  const params = ctx.params ?? TUNABLE;
  const side = ctx.side ?? -1;
  const t = ctx.t ?? ballState.t;
  const rng = ctx.rng ?? (() => 0.5); // 기본: 오차 없음
  const pressed = ctx.pressed ?? true;
  const b = ballToLocal(ballState, side);
  const drag = analyzeDrag(samples, t, params);
  const racketX = ctx.racketX ?? sampleAt(samples, t)?.x ?? b.pos.x;
  const shotType = judgeType(drag, b.pos.z, params, pressed);
  const dtApex = ctx.apexT == null ? Infinity : t - ctx.apexT;
  const { timing, accuracy } = gradeTiming(dtApex, params);
  const strength = clamp((drag.speed - params.BLOCK_SPEED) / (params.SPEED_FULL - params.BLOCK_SPEED), 0, 1);
  const err = aimErrors(accuracy, dtApex, rng, params);
  const quality = { timing, accuracy, strength, dtApex, weak: !pressed, target: null };

  let out; // 기준 좌표의 { vel, spin }
  if (shotType === 'mishit') {
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
      const lambda = spinLambda('block', b, params);
      const seen = createBall({ pos: b.pos, vel: b.vel, spin: scale(b.spin, 1 - lambda), t: b.t });
      const face = solveBlock(seen, u, target, params);
      // 면을 δ/2 돌리면 반사 방향은 약 δ 돌아간다
      out = racketResponse(b, faceNormal(face.pitch + err.pitch / 2, face.yaw + err.yaw / 2), scale(u, 1 + err.speed), params);
    }
  } else {
    const P = PREFIX[shotType];
    const speed = lerpP(params, P, 'V', strength);
    let topspin = 0, sidespin = 0;
    const spin = lerpP(params, P, 'SPIN', strength);
    if (shotType === 'drive') topspin = spin * Math.max(0.4, drag.sin);
    else if (shotType === 'smash') topspin = spin;
    else if (shotType === 'cut') topspin = -spin;
    else {
      // 라켓이 공 뒤를 오른쪽(+x)으로 쓸면 위에서 봐서 반시계(+) 회전 → 진행 방향 왼쪽으로 휜다
      const dirX = Math.abs(drag.u.x) > 1e-9 ? Math.sign(drag.u.x) : Math.sign(drag.kappa) || 1;
      sidespin = dirX * spin;
      topspin = lerpP(params, P, 'TOP', strength);
    }
    const target = aimTarget(shotType, drag, racketX, params);
    quality.target = target;
    const aim = solveAim({ pos: b.pos, speed, topspin, sidespin, target, t }, params);
    const launch = makeLaunch({
      pos: b.pos, t,
      speed: speed * (1 + err.speed),
      elevation: aim.elevation + err.pitch,
      azimuth: aim.azimuth + err.yaw,
      topspin, sidespin,
    });
    const fx = spinEffect(b, faceNormal(params[`${P}_PITCH`], 0), params);
    const lambda = spinLambda(shotType, b, params);
    out = { vel: add(launch.vel, scale(fx.dv, lambda)), spin: add(launch.spin, scale(fx.dw, lambda)) };
  }
  return {
    shotType,
    vel: toWorld(out.vel, side),
    spin: toWorld(out.spin, side),
    quality,
  };
}

// ── 타격 순간 판정 (사람·로봇 공용) ───────────────────────────
// player: { side, samples, yPlane(기준 좌표 라켓 평면 y) }, ball: 세계 좌표 공(이번 스텝 시작 상태)
// 반환: 'swing'(휘두르는 중, 도달 범위 안) | 'block'(버튼 누르고 정지, 라켓 평면 통과)
//     | 'weak'(버튼 없음, 도달 범위 뒤끝 통과 — 늦게 휘두를 여유를 준다) | null
export function checkHit(player, ball, t, dt, params = TUNABLE) {
  const s = racketPointAt(player.samples, t);
  if (!s) return null;
  const b = ballToLocal(ball, player.side);
  const dx = b.pos.x - s.x, dz = b.pos.z - s.y;
  if (Math.abs(dx) > params.HIT_RADIUS || Math.abs(dz) > params.HIT_RADIUS) return null;
  const yp = player.yPlane;
  const crosses = (y) => b.vel.y < 0 && b.pos.y >= y && b.pos.y + b.vel.y * dt < y;
  if (s.b && Math.abs(b.pos.y - yp) <= params.REACH_Y) {
    const drag = analyzeDrag(player.samples, t, params);
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

// ── DOM: 마우스 → 샘플 ──────────────────────────────────────
// opts.toPlane(clientX, clientY) → { x, z } | null, opts.now() → 게임 시각(s), opts.onPress()
export function createMouseInput(canvas, opts) {
  const samples = [];
  let pressed = false;
  let last = { x: 0, z: SWING.HOME.z };

  function push(clientX, clientY, t) {
    const p = opts.toPlane(clientX, clientY);
    if (p) last = p;
    const prev = samples[samples.length - 1];
    const s = { t: prev && t < prev.t ? prev.t : t, x: last.x, y: last.z, b: pressed };
    samples.push(s);
    pruneSamples(samples, s.t);
  }

  canvas.addEventListener('pointermove', (e) => {
    const now = opts.now();
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    // 묶인 이벤트는 실제 발생 시각 차이만큼 과거로 놓는다
    for (const ev of list.length ? list : [e]) push(ev.clientX, ev.clientY, now - (e.timeStamp - ev.timeStamp) / 1000);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pressed = true;
    canvas.setPointerCapture?.(e.pointerId);
    push(e.clientX, e.clientY, opts.now());
    opts.onPress?.();
  });
  const release = (e) => {
    if (!pressed) return;
    pressed = false;
    push(e.clientX, e.clientY, opts.now());
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    samples,
    get pressed() { return pressed; },
    // 프레임마다 마우스가 멈춰 있어도 현재 위치를 한 번 기록 (라켓 평면 y가 바뀌었을 때 반영)
    refresh(t) {
      const prev = samples[samples.length - 1];
      if (!prev || t - prev.t > 0.05) {
        samples.push({ t: Math.max(t, prev?.t ?? t), x: last.x, y: last.z, b: pressed });
        pruneSamples(samples, t);
      }
    },
  };
}
