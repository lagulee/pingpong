// physics.js — 공 운동, 바운드, 충돌. 브라우저·서버 공용.
// 결정론: 결과는 입력 상태·dt·매개변수만으로 정해진다. 시간과 난수는 인자로 받는다.
// 좌표계: x = 너비, y = 길이, z = 높이(위 +). 원점은 탁구대 윗면 중앙.
import { BALL, TABLE, NET, RACKET, PHYSICS, TUNABLE, SWING } from './constants.js';

const R = BALL.RADIUS;
const AREA = Math.PI * R * R;
// 접점 미끄러짐을 0(구름)으로 만드는 데 필요한 접선 속도 변화 비율 k/(1+k), k = I/(m r²)
const ROLL_FRACTION = BALL.INERTIA_FACTOR / (1 + BALL.INERTIA_FACTOR);
// 접선 속도 변화 Δv가 접점 r_c에 가해질 때 회전 변화: Δω = (r_c × Δv) / (k r²)
const SPIN_PER_IMPULSE = 1 / (BALL.INERTIA_FACTOR * R * R);
const NET_HALF_SPAN = TABLE.WIDTH / 2 + NET.OVERHANG;
const FLOOR_Z = -TABLE.HEIGHT;

// ── 벡터 도구 ──────────────────────────────────────────
export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, s) => vec(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a) => Math.hypot(a.x, a.y, a.z);
const lerp = (a, b, f) => vec(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
const copy = (a) => vec(a.x, a.y, a.z);

// ── 공 상태 ──────────────────────────────────────────
export function createBall({ pos, vel = vec(), spin = vec(), t = 0 }) {
  return { pos: copy(pos), vel: copy(vel), spin: copy(spin), t };
}

export function cloneBall(b) {
  return createBall(b);
}

// 항력 계수를 질량으로 나눈 값 K_D = ½·C_D·ρ·A / m
export function dragCoefficient(params = TUNABLE) {
  return (0.5 * params.C_D * PHYSICS.AIR_DENSITY * AREA) / BALL.MASS;
}

// 역학적 에너지(병진 운동 + 위치)  — 검증용
export function mechanicalEnergy(b) {
  return BALL.MASS * (0.5 * dot(b.vel, b.vel) + PHYSICS.G * b.pos.z);
}

// ── 자유 비행 적분 (반암시적 오일러: 속도 먼저 → 새 속도로 위치) ──
export function integrate(b, dt, params = TUNABLE) {
  const v = b.vel, w = b.spin;
  const drag = -dragCoefficient(params) * length(v);
  const mag = cross(w, v);
  const km = params.K_M;
  const a = vec(
    drag * v.x + km * mag.x,
    drag * v.y + km * mag.y,
    drag * v.z + km * mag.z - PHYSICS.G,
  );
  v.x += a.x * dt; v.y += a.y * dt; v.z += a.z * dt;
  b.pos.x += v.x * dt; b.pos.y += v.y * dt; b.pos.z += v.z * dt;
  b.spin = scale(w, 1 - params.SPIN_DECAY * dt);
  b.t += dt;
}

// ── 접촉 응답 ──────────────────────────────────────────
// n: 면에서 공 쪽을 향하는 단위 법선, u: 면의 속도.
// 수직: 상대 법선 속도에 반발계수 e. 수평: 접점 미끄러짐 v_t + ω × r_c에 쿨롱 마찰(최대 구름까지).
// 접근 속도(양수)를 돌려준다. 이미 멀어지는 중이면 0.
export function applyContact(b, n, e, mu, u = vec()) {
  const vrel = sub(b.vel, u);
  const vn = dot(vrel, n);
  if (vn >= 0) return 0;
  const approach = -vn;
  const restitution = approach < PHYSICS.REST_SPEED ? 0 : e;
  const rc = scale(n, -R); // 공 중심 → 접점
  const vt = sub(vrel, scale(n, vn));
  const slip = add(vt, cross(b.spin, rc));
  const slipSpeed = length(slip);
  const dvn = (1 + restitution) * approach;
  let dvt = vec();
  if (slipSpeed > 0) {
    const mag = Math.min(ROLL_FRACTION * slipSpeed, mu * dvn);
    dvt = scale(slip, -mag / slipSpeed);
  }
  b.vel = add(b.vel, add(scale(n, dvn), dvt));
  b.spin = add(b.spin, scale(cross(rc, dvt), SPIN_PER_IMPULSE));
  return approach;
}

// ── 충돌 후보 찾기: 이전 위치 p0 → 현재 위치 p1 선분과 평면의 교차 ──
// 각 함수는 { kind, f(0~1, 선분 위 비율), center(접촉 순간 공 중심), n, u, ... } 또는 null

function tableHit(p0, p1) {
  if (!(p0.z >= R && p1.z < R)) return null;
  const f = (p0.z - R) / (p0.z - p1.z);
  const c = lerp(p0, p1, f);
  const hx = TABLE.WIDTH / 2, hy = TABLE.LENGTH / 2;
  if (Math.abs(c.x) > hx || Math.abs(c.y) > hy) return null;
  const edge = Math.abs(c.x) > hx - PHYSICS.EDGE_ZONE || Math.abs(c.y) > hy - PHYSICS.EDGE_ZONE;
  return { kind: edge ? 'edge' : 'bounce', f, center: c, n: vec(0, 0, 1), u: vec() };
}

function floorHit(p0, p1) {
  const z = FLOOR_Z + R;
  if (!(p0.z >= z && p1.z < z)) return null;
  const f = (p0.z - z) / (p0.z - p1.z);
  return { kind: 'floor', f, center: lerp(p0, p1, f), n: vec(0, 0, 1), u: vec() };
}

// 네트: y = 0 평면의 얇은 판. 공 표면이 닿는 평면(y = ±(R + 두께/2))을 지나는지 본다.
function netHit(p0, p1) {
  const s = Math.sign(p0.y);
  if (s === 0) return null;
  const off = R + NET.THICKNESS / 2;
  const d0 = s * p0.y, d1 = s * p1.y;
  if (!(d0 >= off && d1 < off)) return null;
  const f = (d0 - off) / (d0 - d1);
  const c = lerp(p0, p1, f);
  if (Math.abs(c.x) > NET_HALF_SPAN || c.z < 0 || c.z >= NET.HEIGHT + R) return null;
  return { kind: 'net', f, center: c, side: s, over: c.z >= NET.HEIGHT };
}

// 라켓: 중심 pos, 단위 법선 normal, 속도 vel인 얇은 원판(양면).
// 라켓도 움직이므로 라켓 기준 상대 위치 선분으로 검사한다.
function racketHit(p0, p1, racket, dt) {
  const n = racket.normal;
  const u = racket.vel ?? vec();
  const c1 = racket.pos;
  const c0 = sub(c1, scale(u, dt));
  const rel0 = sub(p0, c0), rel1 = sub(p1, c1);
  const d0 = dot(rel0, n), d1 = dot(rel1, n);
  const s = Math.sign(d0);
  if (s === 0) return null;
  const off = R + RACKET.THICKNESS / 2;
  if (!(s * d0 >= off && s * d1 < off)) return null;
  const f = (s * d0 - off) / (s * d0 - s * d1);
  const q = lerp(rel0, rel1, f);
  const lateral = sub(q, scale(n, dot(q, n)));
  if (length(lateral) > RACKET.RADIUS) return null;
  return { kind: 'racket', f, center: add(q, lerp(c0, c1, f)), n: scale(n, s), u, racket };
}

const sideOf = (p) => (p.y < 0 ? -1 : 1);

// ── 한 스텝 진행 ──────────────────────────────────────────
// opts.params: 튜닝 값(기본 TUNABLE), opts.rackets: 라켓 목록
// 반환: 이벤트 목록 [{ type, t, pos, speed, side, ... }]
export function step(b, dt, opts = {}) {
  const params = opts.params ?? TUNABLE;
  const rackets = opts.rackets ?? [];
  const t0 = b.t;
  const p0 = copy(b.pos);
  integrate(b, dt, params);
  const p1 = copy(b.pos);

  // 이번 선분에서 가장 먼저 닿는 면 하나를 처리한다.
  let hit = null;
  const candidates = [tableHit(p0, p1), netHit(p0, p1), floorHit(p0, p1)];
  for (const r of rackets) candidates.push(racketHit(p0, p1, r, dt));
  for (const c of candidates) if (c && (!hit || c.f < hit.f)) hit = c;
  if (!hit) return [];

  const speed = length(b.vel);
  const t = t0 + hit.f * dt;
  const rest = (1 - hit.f) * dt;
  const events = [];
  b.pos = hit.center;

  if (hit.kind === 'net') {
    if (hit.over) {
      // 네트 윗줄을 스치고 넘어감(네트 인): 진행 속도·회전 일부 손실
      b.vel = vec(b.vel.x, b.vel.y * params.NET_CORD_KEEP, b.vel.z);
      b.spin = scale(b.spin, params.NET_CORD_KEEP);
    } else {
      // 그물에 걸림: 속도 대부분을 흡수하고 원래 쪽으로 힘없이 튕겨 나옴
      const v = scale(b.vel, params.NET_KEEP);
      b.vel = vec(v.x, hit.side * Math.abs(v.y), v.z);
      b.spin = scale(b.spin, params.NET_KEEP);
    }
    events.push({ type: 'net', t, pos: copy(hit.center), speed, side: hit.side, over: hit.over });
  } else {
    const [e, mu] = hit.kind === 'racket' ? [params.E_RACKET, params.MU_RACKET]
      : hit.kind === 'floor' ? [params.E_FLOOR, PHYSICS.MU_FLOOR]
        : [params.E_TABLE, params.MU_TABLE];
    const approach = applyContact(b, hit.n, e, mu, hit.u);
    if (approach >= PHYSICS.REST_SPEED) {
      const ev = { type: hit.kind, t, pos: copy(hit.center), speed, side: sideOf(hit.center) };
      if (hit.racket?.id !== undefined) ev.racket = hit.racket.id;
      events.push(ev);
    }
  }

  // 남은 시간 동안 새 속도로 이동
  b.pos = add(b.pos, scale(b.vel, rest));
  return events;
}

// ── 고정 스텝 누적기 ──────────────────────────────────────
// 화면 프레임 시간과 무관하게 DT 단위로만 물리를 진행한다.
// prev는 직전 스텝의 공 위치(화면 보간용), alpha는 보간 비율.
export function createSim(ball) {
  return { ball, prev: copy(ball.pos), acc: 0, alpha: 0 };
}

export function advance(sim, elapsed, opts = {}) {
  const dt = PHYSICS.DT;
  const events = [];
  sim.acc += elapsed;
  let n = 0;
  while (sim.acc >= dt && n < PHYSICS.MAX_STEPS_PER_FRAME) {
    sim.prev = copy(sim.ball.pos);
    for (const e of step(sim.ball, dt, opts)) events.push(e);
    sim.acc -= dt;
    n++;
  }
  if (sim.acc >= dt) sim.acc = 0; // 너무 밀린 시간은 버린다
  sim.alpha = sim.acc / dt;
  return events;
}

// ── 공 발사기: 속도·각도·회전(rps)으로 공 상태를 만든다 ──
// elevation: 위쪽 각도(°), azimuth: +y 진행 기준 오른쪽(+x) 각도(°)
// topspin(rps): + 탑스핀 / − 백스핀 (진행 방향 기준)
// sidespin(rps): + 위에서 봐서 반시계 회전 → 진행 방향 왼쪽으로 휨
export function makeLaunch({ pos, speed, elevation = 0, azimuth = 0, topspin = 0, sidespin = 0, t = 0 }) {
  const el = (elevation * Math.PI) / 180, az = (azimuth * Math.PI) / 180;
  const dir = vec(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
  const heading = vec(Math.sin(az), Math.cos(az), 0);
  // 탑스핀 회전축: 위(z) × 진행 방향 → 공 윗면이 앞으로 돈다
  const topAxis = cross(vec(0, 0, 1), heading);
  const spin = add(scale(topAxis, topspin * 2 * Math.PI), vec(0, 0, sidespin * 2 * Math.PI));
  return createBall({ pos, vel: scale(dir, speed), spin, t });
}

// ── 플레이어 기준 좌표 ──────────────────────────────────────
// 판정·조준은 "자기 쪽이 y < 0이고 +y로 친다"는 기준 좌표에서 한다.
// side = −1(y < 0 쪽 플레이어)은 그대로, side = +1은 z축 기준 180° 회전 (x, y, z) → (−x, −y, z).
// 회전(행렬식 +1)이므로 각속도 벡터도 같은 식으로 바뀐다.
export const toLocal = (v, side) => (side < 0 ? vec(v.x, v.y, v.z) : vec(-v.x, -v.y, v.z));
export const toWorld = toLocal; // 180° 회전은 자기 자신이 역변환
export function ballToLocal(b, side) {
  return { pos: toLocal(b.pos, side), vel: toLocal(b.vel, side), spin: toLocal(b.spin, side), t: b.t };
}
export const ballToWorld = ballToLocal;

// ── 궤적 예측 ──────────────────────────────────────────
// 공을 복제해 라켓 없이 진행하며, side 쪽 첫 바운드와 그 뒤 정점(v_z가 0 이하로 바뀌는 순간)을 찾는다.
// 반환: { events, bounce, apex: { t, pos, vel } | null, states: [{ t, pos }] }
export function predictPath(ball, side, opts = {}) {
  const params = opts.params ?? TUNABLE;
  const maxT = opts.maxT ?? SWING.PREDICT_T;
  const after = opts.after ?? SWING.PREDICT_AFTER; // 정점 뒤로 더 기록할 시간 (늦게 치는 경우용)
  const b = cloneBall(ball);
  const dt = PHYSICS.DT;
  const t0 = b.t;
  const states = [{ t: b.t, pos: copy(b.pos) }];
  const events = [];
  let bounce = null, apex = null;
  while (b.t - t0 < maxT) {
    const ev = step(b, dt, { params });
    if (ev.length && bounce) break; // 바운드 뒤 다른 충돌: 그 뒤로는 칠 수 없는 공
    states.push({ t: b.t, pos: copy(b.pos) });
    for (const e of ev) {
      events.push(e);
      if (!bounce && (e.type === 'bounce' || e.type === 'edge') && e.side === side) bounce = e;
    }
    if (events.some((e) => e.type === 'floor')) break;
    if (bounce && !apex && b.t > bounce.t && b.vel.z <= 0) apex = { t: b.t, pos: copy(b.pos), vel: copy(b.vel) };
    if (apex && b.t - apex.t >= after) break;
  }
  return { events, bounce, apex, states };
}

// 예측 상태 목록에서 시각 t의 공 위치 (선형 보간)
export function positionAt(states, t) {
  if (!states.length) return null;
  if (t <= states[0].t) return copy(states[0].pos);
  for (let i = 1; i < states.length; i++) {
    if (states[i].t >= t) {
      const a = states[i - 1], b = states[i];
      return lerp(a.pos, b.pos, (t - a.t) / (b.t - a.t));
    }
  }
  return copy(states[states.length - 1].pos);
}

// ── 조준 (기준 좌표, +y로 친다) ──────────────────────────────
// 공을 첫 충돌까지 날려 착지 지점을 잰다. 네트에 걸리거나 네트 위 여유가 부족하면 "짧음"(y = 0)으로 본다.
export function flightLanding(ball, params = TUNABLE, clear = params.NET_CLEAR ?? 0) {
  const b = cloneBall(ball);
  const dt = PHYSICS.DT;
  const n = Math.round(SWING.AIM_MAX_T / dt);
  const netTop = NET.HEIGHT + R + clear;
  for (let i = 0; i < n; i++) {
    const y0 = b.pos.y, z0 = b.pos.z;
    const ev = step(b, dt, { params });
    // 네트 평면(y = 0)을 지나는 순간의 높이
    if (y0 < 0 && b.pos.y >= 0) {
      const f = -y0 / (b.pos.y - y0);
      const z = z0 + (b.pos.z - z0) * f;
      if (z < netTop) return { x: b.pos.x, y: 0, short: true, event: ev[0] ?? null };
    }
    if (ev.length) {
      const e = ev[0];
      if (e.type === 'net') return { x: e.pos.x, y: 0, short: true, event: e };
      return { x: e.pos.x, y: e.pos.y, short: e.pos.y <= 0, event: e };
    }
  }
  return { x: b.pos.x, y: Infinity, short: false, event: null }; // 너무 높이 뜬 공: 아주 긴 것으로 본다
}

// f(a) = target이 되는 a를 찾는다. 먼저 구간을 고르게 훑어 f가 가장 큰 a(가장 멀리 가는 각도)를 찾고,
// 그 아래 구간(대개 증가 구간)에서 이분법으로 f(a) ≥ target인 가장 작은 a를 고른다.
// target까지 못 가면 가장 멀리 가는 a, 처음부터 넘으면 lo.
function bisect(f, lo, hi, target, iter) {
  const N = SWING.AIM_SCAN;
  let best = lo, bestF = -Infinity;
  for (let i = 0; i <= N; i++) {
    const a = lo + ((hi - lo) * i) / N;
    const v = f(a);
    if (v > bestF) { bestF = v; best = a; }
  }
  if (bestF < target) return best;
  hi = best;
  if (f(lo) >= target) return lo;
  for (let i = 0; i < iter; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid; else hi = mid;
  }
  return hi; // f가 끊겨 뛰는 경우(네트에 걸림 → 넘어감) 넘어가는 쪽을 고른다
}

const DEG = Math.PI / 180;

// 속도·회전(rps)이 주어진 공을 pos에서 쳐서 target(x, y)에 떨어뜨리는 발사각·방향각을 찾는다.
// 반환: { elevation, azimuth, ball, landing }
export function solveAim({ pos, speed, topspin = 0, sidespin = 0, target, t = 0 }, params = TUNABLE) {
  const launch = (elevation, azimuth) => makeLaunch({ pos, speed, elevation, azimuth, topspin, sidespin, t });
  let azimuth = Math.atan2(target.x - pos.x, target.y - pos.y) / DEG;
  let elevation = 0, landing = null;
  for (let round = 0; round < SWING.AIM_ROUNDS; round++) {
    const az = azimuth;
    elevation = bisect((el) => flightLanding(launch(el, az), params).y,
      SWING.AIM_PITCH_MIN, SWING.AIM_PITCH_MAX, target.y, SWING.AIM_ITER);
    landing = flightLanding(launch(elevation, azimuth), params);
    if (!Number.isFinite(landing.y) || landing.short) break;
    const d = landing.y - pos.y;
    azimuth += Math.atan2(target.x - landing.x, d) / DEG;
  }
  landing = flightLanding(launch(elevation, azimuth), params);
  return { elevation, azimuth, ball: launch(elevation, azimuth), landing };
}

// 라켓 면 법선: pitch(°, + 위로 열림), yaw(°, + 오른쪽 +x)
export function faceNormal(pitch, yaw = 0) {
  const p = pitch * DEG, y = yaw * DEG;
  return vec(Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), Math.sin(p));
}

// 라켓 면(법선 n, 속도 u)에 공이 맞은 직후 상태 (기준 좌표). 원래 공은 바꾸지 않는다.
export function racketResponse(ball, n, u, params = TUNABLE) {
  const b = cloneBall(ball);
  applyContact(b, n, params.E_RACKET, params.MU_RACKET, u);
  return b;
}

// 블록: ball(회전 포함)이 target에 떨어지도록 면 기울기를 맞춘다. 반환: { pitch, yaw, normal }
// 회전을 못 읽은 블록은 회전을 뺀 공을 넘겨 면을 맞춘다 (input.js).
export function solveBlock(ball, u, target, params = TUNABLE) {
  let yaw = 0, pitch = 0;
  const land = (p, y) => flightLanding(racketResponse(ball, faceNormal(p, y), u, params), params);
  for (let round = 0; round < SWING.AIM_ROUNDS; round++) {
    const yw = yaw;
    pitch = bisect((p) => land(p, yw).y, SWING.BLOCK_PITCH_MIN, SWING.BLOCK_PITCH_MAX, target.y, SWING.AIM_ITER);
    const l = land(pitch, yaw);
    if (!Number.isFinite(l.y) || l.short) break;
    // 면을 γ 돌리면 반사 방향은 약 2γ 돌아간다
    yaw += 0.5 * Math.atan2(target.x - l.x, l.y - ball.pos.y) / DEG;
  }
  return { pitch, yaw, normal: faceNormal(pitch, yaw) };
}
