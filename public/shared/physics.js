// physics.js — 공 운동, 바운드, 충돌. 브라우저·서버 공용.
// 결정론: 결과는 입력 상태·dt·매개변수만으로 정해진다. 시간과 난수는 인자로 받는다.
// 좌표계: x = 너비, y = 길이, z = 높이(위 +). 원점은 탁구대 윗면 중앙.
import { BALL, TABLE, NET, RACKET, PHYSICS, TUNABLE, SWING, SERVE } from './constants.js';

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

// 중력가속도: 게임은 TUNABLE.G_GAME(게임용 중력, v6.0), 엔진 검증 테스트는 G_GAME = PHYSICS.G(9.8)를 넘긴다.
export const gravity = (params = TUNABLE) => params.G_GAME ?? PHYSICS.G;

// 시뮬레이션 최대 시간: 실제 중력 기준 시간 base를 게임 중력에 맞게 늘린다 (체공 시간 ∝ 1/√g) + 높은 포물선 여유
export const simTime = (base, params = TUNABLE) => base * SWING.SIM_T_MARGIN * Math.sqrt(PHYSICS.G / gravity(params));

// 역학적 에너지(병진 운동 + 위치)  — 검증용
export function mechanicalEnergy(b, params = TUNABLE) {
  return BALL.MASS * (0.5 * dot(b.vel, b.vel) + gravity(params) * b.pos.z);
}

// ── 자유 비행 적분 (반암시적 오일러: 속도 먼저 → 새 속도로 위치) ──
export function integrate(b, dt, params = TUNABLE) {
  const v = b.vel, w = b.spin;
  const drag = -dragCoefficient(params) * length(v);
  const mag = cross(w, v);
  const km = params.K_M;
  const g = gravity(params);
  const a = vec(
    drag * v.x + km * mag.x,
    drag * v.y + km * mag.y,
    drag * v.z + km * mag.z - g,
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
  const maxT = opts.maxT ?? simTime(SWING.PREDICT_T, params);
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
  const n = Math.round(simTime(SWING.AIM_MAX_T, params) / dt);
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

// ── 정점 조준 (v6.0, 기준 좌표, +y로 친다) ──────────────────────
// 속도 벡터 u(m/s)로 친 공. 회전(rps)은 makeLaunch와 같이 진행 방향 기준이다.
function launchVel(pos, u, topspin, sidespin, t) {
  const speed = length(u);
  return makeLaunch({
    pos, speed, t, topspin, sidespin,
    elevation: Math.asin(Math.max(-1, Math.min(1, u.z / speed))) / DEG,
    azimuth: Math.atan2(u.x, u.y) / DEG,
  });
}

// 공을 면 충돌 없이 날려, 최고점 높이와 탁구대 윗면 높이(공 중심 z = R)로 내려오는 지점을 잰다.
// 네트·탁구대 경계에서 끊기지 않는 매끄러운 함수라 뉴턴법에 쓴다(실제 착지는 flightLanding으로 다시 확인).
function arcShape(ball, params) {
  const b = cloneBall(ball);
  const dt = PHYSICS.DT;
  const n = Math.round(simTime(SWING.AIM_MAX_T, params) / dt);
  let top = b.pos.z;
  for (let i = 0; i < n; i++) {
    const p0 = copy(b.pos);
    integrate(b, dt, params);
    if (b.pos.z > top) top = b.pos.z;
    if (b.vel.z < 0 && p0.z >= R && b.pos.z < R) {
      const c = lerp(p0, b.pos, (p0.z - R) / (p0.z - b.pos.z));
      return { x: c.x, y: c.y, top };
    }
  }
  return { x: b.pos.x, y: b.pos.y, top };
}

// 3×3 연립방정식 J·d = r (크라메르 공식). 특이하면 null
function solve3(J, r) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(J);
  if (!(Math.abs(D) > 1e-12)) return null;
  return [0, 1, 2].map((k) => det(J.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / D);
}

// 높은 포물선 조준: pos에서 친 공이 target(x, y)에 떨어지고 최고점이 apex(탁구대 윗면 기준 m)가 되도록
// 속도와 발사각을 함께 푼다. 공기저항 없는 포물선으로 초깃값을 잡고, 속도 벡터 3성분에 대한 뉴턴법으로
// (착지 x, 착지 y, 최고점) 3개 조건을 맞춘다 (반복마다 비행 4번).
// 필요한 속도가 [vMin, vMax] 밖이거나, 풀리지 않거나, 실제로 네트에 걸리면 한계 속도로 solveAim(가장 낮은 각)을 쓴다.
// 반환: { elevation, azimuth, ball, landing, speed, apex, clamped }
export function solveArc({ pos, topspin = 0, sidespin = 0, target, apex, t = 0, vMin = 0, vMax = Infinity }, params = TUNABLE) {
  const g = gravity(params);
  const H = Math.max(apex, pos.z + SWING.ARC_MIN_RISE);
  const vz0 = Math.sqrt(2 * g * (H - pos.z));
  const T = vz0 / g + Math.sqrt(2 * Math.max(H - R, 0.01) / g);
  let u = vec((target.x - pos.x) / T, (target.y - pos.y) / T, vz0);
  const resid = (v) => {
    const s = arcShape(launchVel(pos, v, topspin, sidespin, t), params);
    return [s.x - target.x, s.y - target.y, s.top - H];
  };
  let r = resid(u);
  const big = (q) => Math.max(...q.map(Math.abs));
  for (let it = 0; it < SWING.ARC_ITER && big(r) > SWING.ARC_TOL; it++) {
    const h = SWING.ARC_DV;
    const cols = [vec(h, 0, 0), vec(0, h, 0), vec(0, 0, h)].map((e) => resid(add(u, e)).map((q, i) => (q - r[i]) / h));
    const J = [0, 1, 2].map((i) => cols.map((c) => c[i]));
    const d = solve3(J, r.map((q) => -q));
    if (!d) break;
    let step_ = vec(d[0], d[1], d[2]);
    const L = length(step_);
    if (L > 2) step_ = scale(step_, 2 / L); // 한 번에 너무 멀리 가지 않게
    u = add(u, step_);
    r = resid(u);
  }
  const speed = length(u);
  const fallback = () => {
    const v = Math.min(vMax, Math.max(vMin, Number.isFinite(speed) ? speed : vMax));
    return { ...solveAim({ pos, speed: v, topspin, sidespin, target, t }, params), speed: v, apex: null, clamped: true };
  };
  if (!(big(r) <= SWING.ARC_TOL * 5) || speed < vMin || speed > vMax) return fallback();
  const ball = launchVel(pos, u, topspin, sidespin, t);
  const landing = flightLanding(ball, params);
  if (landing.short || !Number.isFinite(landing.y)) return fallback();
  const elevation = Math.asin(u.z / speed) / DEG, azimuth = Math.atan2(u.x, u.y) / DEG;
  return { elevation, azimuth, ball, landing, speed, apex: H + r[2], clamped: false };
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

// ── 인플레이 판정 (발리 / 코트 밖 공) ─────────────────────────
// 공이 side 쪽 코트에 아직 바운드하지 않았을 때, 그 공이 "인플레이"인가.
// 실제 규칙(ITTF 오브스트럭션): 탁구대 위에 있거나 탁구대 쪽으로 오는(그대로 두면 side 코트에 떨어질) 공을
// 바운드 전에 건드리면 건드린 쪽 실점(발리). 이미 탁구대 밖에 있고 코트에 떨어지지 않을 공은
// 건드려도 상대가 친 공의 아웃이다.
export function inPlayFor(ball, side, params = TUNABLE) {
  const p = ball.pos;
  if (Math.abs(p.x) <= TABLE.WIDTH / 2 + R && Math.abs(p.y) <= TABLE.LENGTH / 2 + R && p.z >= 0) return true; // 탁구대 위
  const b = cloneBall(ball);
  const n = Math.round(simTime(SWING.PREDICT_T, params) / PHYSICS.DT);
  for (let i = 0; i < n; i++) {
    for (const e of step(b, PHYSICS.DT, { params })) {
      if (e.type === 'bounce' || e.type === 'edge') return e.side === side;
      if (e.type === 'floor') return false;
    }
  }
  return false;
}

// ── 서브 조준 (기준 좌표, +y로 친다) ──────────────────────────
// 서브는 자기 코트(y < 0)에 한 번 → 상대 코트(y > 0)에 떨어져야 한다.
// 첫 충돌이 자기 코트 바운드면 두 번째 충돌 위치를 돌려준다. 그 밖에는 조준 탐색이 쓸 수 있게
// "짧음"(y = 0: 자기 코트에 두 번·네트) 또는 "김"(상대 코트에 바로 떨어짐: 아주 큰 y)으로 본다.
// low: 네트 위 여유(clear)보다 낮게 넘어감, netCord: 네트 윗줄을 스침(렛).
export function serveLanding(ball, params = TUNABLE, clear = params.NET_CLEAR ?? 0) {
  const b = cloneBall(ball);
  const dt = PHYSICS.DT;
  const n = Math.round(simTime(SWING.AIM_MAX_T, params) / dt);
  const netTop = NET.HEIGHT + R + clear;
  let own = null, netCord = false, low = false;
  for (let i = 0; i < n; i++) {
    const y0 = b.pos.y, z0 = b.pos.z;
    const ev = step(b, dt, { params });
    // 네트 평면(y = 0)을 지나는 높이가 여유보다 낮으면 "네트 위험" (조준 탐색은 유효하지 않은 서브로 본다)
    if (y0 < 0 && b.pos.y >= 0 && z0 + (b.pos.z - z0) * (-y0 / (b.pos.y - y0)) < netTop) low = true;
    if (!ev.length) continue;
    const e = ev[0];
    const isBounce = e.type === 'bounce' || e.type === 'edge';
    if (!own) {
      if (isBounce && e.pos.y < 0) { own = e; continue; }
      if (e.type === 'floor' && e.pos.y < 0) return { x: e.pos.x, y: -Infinity, own: null, event: e };
      return { x: e.pos.x, y: Infinity, own: null, event: e }; // 자기 코트를 건너뜀: 너무 김
    }
    if (e.type === 'net' && !e.over) return { x: e.pos.x, y: 0, own, short: true, event: e };
    if (e.type === 'net') { netCord = true; continue; } // 네트 윗줄 스침 (렛 후보): 다음 충돌을 본다
    if (isBounce && e.pos.y < 0) return { x: e.pos.x, y: 0, own, short: true, netCord, low, event: e };
    return { x: e.pos.x, y: e.pos.y, own, short: false, netCord, low, event: e };
  }
  return { x: b.pos.x, y: Infinity, own, netCord, event: null };
}

// pos에서 친 서브가 자기 코트를 거쳐 target(x, y > 0)에 떨어지도록 발사각·방향각을 찾는다.
// 발사각에 따른 착지점은 단조롭지 않다(가파르게 치면 자기 코트 뒤쪽에 높이 튀어 길게 간다).
// 그래서 발사각을 SERVE.PITCH_STEP 간격으로 훑어 유효한 서브(자기 코트 → 상대 코트) 중 목표에 가장 가까운 각을 고르고,
// 이웃 칸과 목표를 사이에 두면 그 구간에서 이분법으로 다듬는다.
// 네트 위 여유는 NET_CLEAR부터 시작해 답이 없으면 절반, 0으로 줄여 다시 찾는다.
// 반환: { elevation, azimuth, ball, landing, valid }
export function solveServe(opts, params = TUNABLE) {
  let r = null;
  for (const k of SERVE.CLEAR_STEPS) {
    r = solveServeWith(opts, params, (params.NET_CLEAR ?? 0) * k);
    if (r.valid) return r;
  }
  return r;
}

function solveServeWith({ pos, speed, topspin = 0, sidespin = 0, target, t = 0 }, params, clear) {
  const serveLanding_ = (ball) => serveLanding(ball, params, clear);
  const launch = (elevation, azimuth) => makeLaunch({ pos, speed, elevation, azimuth, topspin, sidespin, t });
  const valid = (l) => l.own && !l.short && !l.netCord && !l.low && l.y > 0 && l.y <= TABLE.LENGTH / 2;
  let azimuth = Math.atan2(target.x - pos.x, target.y - pos.y) / DEG;
  let elevation = 0;
  let good = null; // 마지막으로 찾은 유효한 { elevation, azimuth }
  for (let round = 0; round < SWING.AIM_ROUNDS; round++) {
    const az = azimuth;
    const f = (el) => serveLanding_(launch(el, az));
    const cells = [];
    for (let el = SERVE.PITCH_MIN; el <= SERVE.PITCH_MAX + 1e-9; el += SERVE.PITCH_STEP) cells.push({ el, l: f(el) });
    // 목표 근처(SERVE.NEAR 이내)의 유효한 각 중 가장 수평에 가까운 각(낮고 자연스러운 서브), 없으면 목표에 가장 가까운 각
    let best = -1;
    const near = (c) => Math.abs(c.l.y - target.y) <= SERVE.NEAR;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!valid(c.l)) continue;
      if (best < 0) { best = i; continue; }
      const b0 = cells[best];
      const better = near(c) && near(b0) ? Math.abs(c.el) < Math.abs(b0.el)
        : near(c) || (!near(b0) && Math.abs(c.l.y - target.y) < Math.abs(b0.l.y - target.y));
      if (better) best = i;
    }
    if (best < 0) {
      if (good) break; // 방향각 보정 뒤 유효한 각이 사라짐: 이전 답을 쓴다
      // 유효한 각이 없음 (너무 빠르거나 느림): 착지 y가 목표에 가장 가까운 각
      let k = 0;
      for (let i = 1; i < cells.length; i++) {
        if (Math.abs(cells[i].l.y - target.y) < Math.abs(cells[k].l.y - target.y)) k = i;
      }
      elevation = cells[k].el;
      break;
    }
    elevation = cells[best].el;
    // 목표를 사이에 둔 이웃 칸이 있으면 이분법
    for (const j of [best - 1, best + 1]) {
      const c = cells[j];
      if (!c || !valid(c.l)) continue;
      const d0 = cells[best].l.y - target.y, d1 = c.l.y - target.y;
      if (d0 * d1 > 0) continue;
      let lo = cells[best].el, hi = c.el, flo = d0;
      for (let i = 0; i < SWING.AIM_ITER; i++) {
        const mid = (lo + hi) / 2;
        const lm = f(mid);
        const dm = valid(lm) ? lm.y - target.y : NaN;
        if (Number.isNaN(dm)) break;
        if (dm * flo > 0) { lo = mid; flo = dm; } else hi = mid;
      }
      elevation = (lo + hi) / 2;
      if (!valid(f(elevation))) elevation = cells[best].el;
      break;
    }
    good = { elevation, azimuth };
    const l = f(elevation);
    azimuth += Math.atan2(target.x - l.x, l.y - pos.y) / DEG;
  }
  if (good && !valid(serveLanding_(launch(elevation, azimuth)))) ({ elevation, azimuth } = good);
  const landing = serveLanding_(launch(elevation, azimuth));
  return { elevation, azimuth, ball: launch(elevation, azimuth), landing, valid: valid(landing) };
}

// 서브 토스: 기준 좌표 x에서 손 높이로부터 공을 위로 띄운다 (회전 없음).
// 띄우는 높이(SERVE.TOSS_HEIGHT)가 같도록 속도 = √(2·g·높이) (게임 중력을 바꿔도 토스 높이는 그대로)
export function makeToss(x, t = 0, params = TUNABLE) {
  const cx = Math.max(-SERVE.TOSS_X_MAX, Math.min(SERVE.TOSS_X_MAX, x));
  const speed = Math.sqrt(2 * gravity(params) * SERVE.TOSS_HEIGHT);
  return createBall({ pos: vec(cx, SERVE.TOSS_Y, SERVE.TOSS_Z), vel: vec(0, 0, speed), t });
}

// 토스한 공이 떨어지면서 높이 z를 지나는 시각 (공기저항 포함, 고정 스텝). 못 지나면 null
export function tossTimeAt(ball, z, params = TUNABLE) {
  const b = cloneBall(ball);
  const dt = PHYSICS.DT;
  for (let i = 0; i < Math.round(simTime(SWING.PREDICT_T, params) / dt); i++) {
    const z0 = b.pos.z;
    integrate(b, dt, params);
    if (b.vel.z < 0 && z0 >= z && b.pos.z < z) return b.t - dt * (b.pos.z - z) / (b.pos.z - z0);
  }
  return null;
}
