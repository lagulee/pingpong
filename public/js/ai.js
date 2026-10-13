// ai.js — AI 로봇과 연습 랠리 진행(사람·로봇 공용).
// 로봇은 궤적을 물리로 예측해 칠 자리로 라켓을 옮기고, 가상 마우스 샘플을 만들어
// 사람과 똑같이 checkHit → classifyShot 경로로 공을 친다.
// 이 파일은 'three'·DOM을 쓰지 않는다 (Node의 자동 랠리 테스트가 그대로 불러 쓴다).
import {
  step, predictPath, positionAt, solveAim, ballToLocal, toWorld, toLocal, createBall, vec,
} from '../shared/physics.js';
import { NET, PHYSICS, SWING, PRACTICE, TUNABLE } from '../shared/constants.js';
import { classifyShot, checkHit, racketLocal, pruneSamples } from './input.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEG = Math.PI / 180;
const SHOTS = ['DRIVE', 'BLOCK', 'CUT', 'SIDE', 'SMASH'];

// ── 플레이어 (사람·로봇 공통 상태) ────────────────────────────
export function createPlayer(side) {
  return {
    side,
    samples: [],             // 마우스 샘플 (사람: DOM, 로봇: 가상)
    yPlane: SWING.HOME_Y,    // 라켓 평면 y (기준 좌표)
    apexT: null,             // 예측 정점 시각
    apexPos: null,           // 예측 정점 위치 (세계 좌표, 표시용)
    lastShot: null,
  };
}

// 상대가 친(또는 보낸) 직후 공으로 내 쪽 정점을 예측해 라켓 평면을 맞춘다.
export function predictFor(player, ball, params = TUNABLE) {
  const pred = predictPath(ball, player.side, { params });
  if (pred.apex) {
    player.apexT = pred.apex.t;
    player.apexPos = pred.apex.pos;
    player.yPlane = clamp(toLocal(pred.apex.pos, player.side).y, SWING.Y_MIN, SWING.Y_MAX);
  } else {
    player.apexT = null;
    player.apexPos = null;
    player.yPlane = SWING.HOME_Y;
  }
  return pred;
}

// ── 랠리 판정 (연습용 임시. 3단계에서 rules.js로 대체) ────────────
// 랠리 1회 = 상대 코트에 정상 바운드한 타구 하나 (로봇이 보낸 첫 공은 세지 않음)
export function createRallyTracker() {
  const tr = {
    phase: 'idle',           // idle → toward(상대 코트로 가는 중) → bounced(받을 쪽 코트에 바운드) → over
    hitter: 0, receiver: 0, fed: false, count: 0, lastHitT: 0, reason: '', loser: 0,
    start(fromSide, t) {
      Object.assign(tr, { phase: 'toward', hitter: fromSide, receiver: -fromSide, fed: true, count: 0, lastHitT: t, reason: '', loser: 0 });
    },
    canHit(side) { return tr.phase === 'bounced' && tr.receiver === side; },
    onHit(side, t) {
      Object.assign(tr, { phase: 'toward', hitter: side, receiver: -side, fed: false, lastHitT: t });
    },
    end(reason, loser) {
      if (tr.phase === 'over') return;
      Object.assign(tr, { phase: 'over', reason, loser });
    },
    onEvent(e) {
      if (tr.phase === 'idle' || tr.phase === 'over') return;
      if (e.type === 'bounce' || e.type === 'edge') {
        if (tr.phase === 'toward') {
          if (e.side === tr.receiver) {
            tr.phase = 'bounced';
            if (!tr.fed) tr.count++;
          } else tr.end('자기 코트 바운드', tr.hitter);
        } else tr.end('두 번 바운드', tr.receiver);
      } else if (e.type === 'floor') {
        if (tr.phase === 'toward') tr.end('아웃', tr.hitter);
        else tr.end('못 받음', tr.receiver);
      }
    },
    checkTimeout(t) {
      if (tr.phase !== 'idle' && tr.phase !== 'over' && t - tr.lastHitT > PRACTICE.RALLY_TIMEOUT) {
        tr.end('시간 초과', tr.phase === 'toward' ? tr.hitter : tr.receiver);
      }
    },
  };
  return tr;
}

// ── 로봇 ──────────────────────────────────────────────────
// difficulty: 'EASY' | 'NORMAL' | 'HARD', rng: 시드 있는 난수
export function createAI(side, difficulty, rng) {
  return {
    player: createPlayer(side),
    difficulty,
    rng,
    pos: { x: SWING.HOME.x, z: SWING.HOME.z }, // 라켓 평면 위치 (기준 좌표 x, 높이 z)
    thinkAt: null,           // 이 시각에 궤적을 예측하고 계획을 세운다
    plan: null,
    lastPlanType: null,      // 마지막으로 고른 구질 (표시·테스트용)
    lastSampleT: -Infinity,
  };
}

const diffParam = (ai, key, params) => params[`AI_${ai.difficulty}_${key}`];
const uniform = (rng, a, b) => a + (b - a) * rng();

// 상대가 쳤다: 반응 지연 뒤에 생각한다
export function aiOnIncoming(ai, t, params = TUNABLE) {
  ai.thinkAt = t + diffParam(ai, 'DELAY', params);
  ai.plan = null;
}

function pickShot(ai, params, allowed) {
  const w = SHOTS.map((s) => (allowed[s] ? Math.max(0, diffParam(ai, `W_${s}`, params)) : 0));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return 'DRIVE';
  let r = ai.rng() * total;
  for (let i = 0; i < SHOTS.length; i++) {
    r -= w[i];
    if (r < 0) return SHOTS[i];
  }
  return 'DRIVE';
}

// 궤적 예측 → 구질·세기·타격 시각 결정 → 가상 드래그 경로 계획
function think(ai, ball, t, params) {
  const p = ai.player;
  const pred = predictFor(p, ball, params);
  if (!pred.apex) { ai.plan = { skip: true }; return; }
  const rng = ai.rng;
  const timing = diffParam(ai, 'TIMING', params);
  let tc = Math.max(t + PHYSICS.DT, pred.apex.t + uniform(rng, -timing, timing));
  // 정점이 라켓이 닿는 앞뒤 범위 밖(너무 깊음)이면 공이 그 범위에 있을 때 친다
  const yLimit = SWING.Y_MIN + SWING.AI_PLANE_BACK;
  for (let i = pred.states.length - 1; i > 0 && pred.states[i].t >= tc - 1e-9; i--) {
    if (toLocal(positionAt(pred.states, tc), p.side).y >= yLimit) break;
    tc = pred.states[i - 1].t;
  }
  const pc = toLocal(positionAt(pred.states, tc), p.side);
  const apexLocal = ballToLocal({ pos: pred.apex.pos, vel: pred.apex.vel, spin: vec(), t: 0 }, p.side);
  const inSpeed = Math.hypot(apexLocal.vel.x, apexLocal.vel.y);

  const allowed = {
    DRIVE: true, CUT: true, SIDE: true,
    BLOCK: inSpeed >= 4,                                     // 느린 공은 블록으로 넘기기 어렵다
    SMASH: pc.z >= NET.HEIGHT + params.SMASH_MIN_HEIGHT + 0.03, // 높은 공만
  };
  const type = pickShot(ai, params, allowed);
  ai.lastPlanType = type;
  const s = uniform(rng, diffParam(ai, 'S_MIN', params), diffParam(ai, 'S_MAX', params));
  let speed = params.BLOCK_SPEED + s * (params.SPEED_FULL - params.BLOCK_SPEED);

  // 목표 x를 고르고, classifyShot의 조준식(목표 x = AIM_X_POS·라켓 x + AIM_X_DRAG·ûx)을 거꾸로 풀어 드래그 방향을 정한다
  const aimX = diffParam(ai, 'AIM_X', params);
  const xT = uniform(rng, -aimX, aimX);
  let ux = params.AIM_X_DRAG > 0 ? (xT - params.AIM_X_POS * pc.x) / params.AIM_X_DRAG : 0;
  let dir, curve = 0;
  if (type === 'SIDE') {
    const sgn = rng() < 0.5 ? -1 : 1;
    const a = SWING.AI_DIR.side * DEG;
    dir = { x: sgn * Math.cos(a), y: Math.sin(a) };
    curve = SWING.AI_SIDE_CURVE * (rng() < 0.5 ? -1 : 1);
  } else {
    ux = clamp(ux, -0.6, 0.6);
    const vy = Math.sqrt(1 - ux * ux);
    dir = { x: ux, y: type === 'DRIVE' ? vy : type === 'BLOCK' ? 0 : -vy };
  }
  if (type === 'CUT') speed = Math.min(speed, params.SMASH_SPEED * 0.9);
  if (type === 'SMASH') speed = Math.max(speed, params.SMASH_SPEED * 1.1);
  if (type === 'BLOCK') speed = 0;

  const T = SWING.AI_SWING_TIME;
  const u = { x: dir.x * speed, y: dir.y * speed };
  const start = type === 'BLOCK' ? { x: pc.x, z: pc.z } : { x: pc.x - u.x * T, z: pc.z - u.y * T };
  ai.plan = {
    type, tc, pc, u, curve, start,
    swingStart: Math.max(t, tc - T),
    pressAt: type === 'BLOCK' ? tc - SWING.AI_BLOCK_LEAD : tc - PHYSICS.DT,
    releaseAt: tc + SWING.AI_FOLLOW_TIME,
    // 스윙은 평면 통과(블록 판정)보다 먼저 일어나야 하므로 평면을 타점보다 조금 뒤에 둔다
    yPlane: clamp(type === 'BLOCK' ? pc.y : pc.y - SWING.AI_PLANE_BACK, SWING.Y_MIN, SWING.Y_MAX),
    swingFrom: null,
  };
  p.yPlane = ai.plan.yPlane;
}

function moveToward(pos, target, maxDist) {
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDist) { pos.x = target.x; pos.z = target.z; return; }
  pos.x += (dx / d) * maxDist;
  pos.z += (dz / d) * maxDist;
}

// 고정 스텝마다: 계획 → 이동 → 가상 마우스 샘플 기록
export function aiUpdate(ai, ball, t, dt, params = TUNABLE) {
  if (ai.thinkAt !== null && t >= ai.thinkAt) {
    ai.thinkAt = null;
    think(ai, ball, t, params);
  }
  const plan = ai.plan;
  let pressed = false;
  const jitter = diffParam(ai, 'JITTER', params);
  if (plan && !plan.skip) {
    if (t < plan.swingStart) {
      moveToward(ai.pos, plan.start, diffParam(ai, 'MOVE', params) * dt);
    } else if (t <= plan.releaseAt) {
      if (!plan.swingFrom) plan.swingFrom = { x: ai.pos.x, z: ai.pos.z };
      if (plan.type !== 'BLOCK') {
        // 스윙 시작점 → 타점을 잇는 직선 + 곡률만큼 옆으로 볼록한 호 (τ: 0 → 1에서 4τ(1−τ)).
        // 제때 도착했으면 시작점 = 타점 − u·T라서 드래그 속도가 정확히 u. 늦었으면 그만큼 비뚤어진다.
        const from = plan.swingFrom;
        const span = Math.max(plan.tc - plan.swingStart, 1e-6);
        const tau = clamp((t - plan.swingStart) / span, 0, 1);
        const dx = plan.pc.x - from.x, dz = plan.pc.z - from.z;
        const L = Math.hypot(dx, dz);
        const perp = L > 0 ? { x: -dz / L, z: dx / L } : { x: 0, z: 0 };
        const bump = plan.curve * L * 4 * tau * (1 - tau);
        const over = Math.max(0, t - plan.tc); // 팔로스루: 같은 속도로 계속
        ai.pos.x = from.x + dx * tau + perp.x * bump + (dx / span) * over;
        ai.pos.z = from.z + dz * tau + perp.z * bump + (dz / span) * over;
      } else {
        moveToward(ai.pos, plan.start, diffParam(ai, 'MOVE', params) * dt);
      }
      pressed = t >= plan.pressAt;
    } else {
      ai.plan = null;
    }
  } else {
    moveToward(ai.pos, SWING.HOME, SWING.AI_RETURN_SPEED * dt);
  }
  ai.pos.x = clamp(ai.pos.x, -SWING.X_MAX, SWING.X_MAX);
  ai.pos.z = clamp(ai.pos.z, SWING.Z_MIN, SWING.Z_MAX);

  // 가상 마우스 샘플 (사람 마우스처럼 일정 간격, 버튼 상태가 바뀌면 바로 기록)
  const samples = ai.player.samples;
  const last = samples[samples.length - 1];
  if (!last || t - ai.lastSampleT >= SWING.AI_SAMPLE_DT - 1e-9 || last.b !== pressed) {
    const j = () => (ai.rng() * 2 - 1) * jitter;
    samples.push({ t, x: ai.pos.x + j(), y: ai.pos.z + j(), b: pressed });
    ai.lastSampleT = t;
    pruneSamples(samples, t);
  }
}

// ── 랠리 진행 (연습 모드·자동 랠리 테스트 공용) ─────────────────
// players: { [-1]: player, [1]: player }, ais: 로봇 목록, rng: 판정 오차용 난수
export function createRally({ players, ais = [], rng }) {
  return { ball: null, players, ais, rng, tracker: createRallyTracker(), lastShot: null };
}

// 로봇이 공을 보낸다 (서브 규칙 없이 받는 쪽 코트에 한 번 떨어지는 공)
export function feedBall(game, fromSide, t, params = TUNABLE) {
  const rng = game.rng;
  const target = { x: uniform(rng, -PRACTICE.FEED_X_RANGE, PRACTICE.FEED_X_RANGE), y: PRACTICE.FEED_DEPTH };
  const aim = solveAim({
    pos: PRACTICE.FEED_POS, speed: PRACTICE.FEED_SPEED, topspin: PRACTICE.FEED_TOPSPIN, target, t,
  }, params);
  return serveBall(game, ballToLocal(aim.ball, fromSide), fromSide, params); // 180° 회전은 자기 역변환
}

// 임의의 공(세계 좌표)을 fromSide가 보낸 공으로 랠리를 시작한다 (디버그 발사기용)
export function serveBall(game, ball, fromSide, params = TUNABLE) {
  game.ball = createBall(ball);
  game.tracker.start(fromSide, ball.t);
  incoming(game, -fromSide, ball.t, params);
  return game.ball;
}

// 랠리 판정 없이 공만 놓는다 (디버그 떨어뜨리기용)
export function placeBall(game, ball) {
  game.ball = createBall(ball);
  game.tracker.phase = 'idle';
  for (const ai of game.ais) { ai.plan = null; ai.thinkAt = null; }
  return game.ball;
}

function incoming(game, side, t, params) {
  predictFor(game.players[side], game.ball, params);
  for (const ai of game.ais) if (ai.player.side === side) aiOnIncoming(ai, t, params);
}

// 고정 스텝 하나. 반환: 이벤트 목록 (racket 이벤트에는 shot 판정 결과가 붙는다)
export function stepRally(game, dt = PHYSICS.DT, params = TUNABLE) {
  const ball = game.ball;
  const t = ball.t;
  for (const ai of game.ais) aiUpdate(ai, ball, t, dt, params);
  const events = [];

  for (const side of [-1, 1]) {
    if (!game.tracker.canHit(side)) continue;
    const p = game.players[side];
    const kind = checkHit(p, ball, t, dt, params);
    if (!kind) continue;
    const shot = classifyShot(p.samples, ball, {
      t, side, apexT: p.apexT, rng: game.rng, params, pressed: kind !== 'weak',
    });
    ball.vel = shot.vel;
    ball.spin = shot.spin;
    const speed = Math.hypot(shot.vel.x, shot.vel.y, shot.vel.z);
    p.lastShot = shot;
    game.lastShot = { side, ...shot };
    events.push({ type: 'racket', t, pos: { ...ball.pos }, speed, side, racket: side, shot });
    game.tracker.onHit(side, t);
    incoming(game, -side, t, params);
    break;
  }

  for (const e of step(ball, dt, { params })) {
    events.push(e);
    game.tracker.onEvent(e);
  }
  game.tracker.checkTimeout(ball.t);
  return events;
}

// 라켓을 그릴 세계 좌표 (샘플이 없으면 null). 칠 수 있는 공이 오면 도달 범위 안에서 앞뒤로 따라간다.
export function racketWorld(player, t, ball = null) {
  const by = ball ? toLocal(ball.pos, player.side).y : null;
  const p = racketLocal(player, t, by);
  return p ? toWorld(p, player.side) : null;
}
