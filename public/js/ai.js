// ai.js — AI 로봇과 경기 진행(사람·로봇 공용). 규칙 판정은 shared/rules.js.
// 로봇은 궤적을 물리로 예측해 칠 자리로 라켓을 옮기고, 가상 마우스 샘플을 만들어
// 사람과 똑같이 checkHit → classifyShot 경로로 공을 친다.
// 이 파일은 'three'·DOM을 쓰지 않는다 (Node의 자동 랠리 테스트가 그대로 불러 쓴다).
import {
  step, predictPath, positionAt, solveAim, ballToLocal, ballToWorld, toWorld, toLocal, createBall, vec,
  tossTimeAt, makeLaunch, serveLanding, simTime, carriedSpin,
} from '../shared/physics.js';
import { NET, TABLE, PHYSICS, SWING, PRACTICE, SERVE, RULES, SCENARIO, TUNABLE, SERVE_GUIDE } from '../shared/constants.js';
import { applyEvent, canHit, startRally, toServe } from '../shared/rules.js';
import {
  createMatch, holdBall, startToss, applyHit, stepBall, stepGame, isServeHit, isEarly,
} from '../shared/match.js';
import { classifyShot, checkHit, racketLocal, pruneSamples, spinParts } from './input.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DEG = Math.PI / 180;
const SHOTS = ['DRIVE', 'BLOCK', 'CUT', 'SIDE', 'SMASH', 'NORMAL'];
// 로봇 구질 → 누르는 구질 버튼 (7단계. 일반은 버튼 없음).
// 블록은 드라이브 버튼을 누른 채 멈춘다: 라켓이 제자리에 늦게 도착해 아직 움직이는 중에 공이 닿으면 스윙으로 판정되는데,
// 그때 버튼이 없으면 일반 스윙(회전을 그대로 받음)이 되어 탑스핀 공 블록이 거의 다 아웃됐다 (블록은 탑스핀 공에만 고른다)
const SHOT_KEY = { DRIVE: 'drive', CUT: 'cut', SIDE: 'side', SMASH: 'smash', BLOCK: 'drive' };
// 들어온 회전 종류별 "맞는 대응" (7단계): 그 밖의 구질(일반 포함)은 잘못 읽은 대응이다
const CORRECT = {
  top: ['DRIVE', 'CUT', 'BLOCK', 'SMASH'],
  back: ['DRIVE', 'CUT', 'SMASH'],
  side: ['SIDE', 'SMASH'],
};

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
    lastRead: null,          // 마지막으로 읽은 회전 { kind, level, wrong } (테스트·측정용)
    inSpin: null,            // 상대 타격의 회전 { t, spin } (판정용 회전의 출발점)
    lastSampleT: -Infinity,
  };
}

const diffParam = (ai, key, params) => params[`AI_${ai.difficulty}_${key}`];
const uniform = (rng, a, b) => a + (b - a) * rng();

// 상대가 쳤다: 반응 지연 뒤에 생각한다. inSpin: 상대 타격의 회전 { t, spin }
export function aiOnIncoming(ai, t, params = TUNABLE, inSpin = null) {
  ai.thinkAt = t + diffParam(ai, 'DELAY', params);
  ai.plan = null;
  ai.inSpin = inSpin;
}

// 들어온 회전 읽기 (7단계). ball: 기준 좌표 공(spin = 판정용 회전). 반환 { kind: 'none'|'top'|'back'|'side', level(0~1) }
export function readSpin(ball, params = TUNABLE) {
  const { top, side } = spinParts(ball);
  if (Math.max(Math.abs(top), Math.abs(side)) < SWING.AI_READ_MIN) return { kind: 'none', level: 0 };
  if (Math.abs(side) >= Math.abs(top)) return { kind: 'side', level: clamp(Math.abs(side) / params.SIDE_SPIN_CAP, 0, 1) };
  return top > 0 ? { kind: 'top', level: clamp(top / params.DRIVE_SPIN_CAP, 0, 1) }
    : { kind: 'back', level: clamp(-top / params.CUT_SPIN_CAP, 0, 1) };
}

// 비율대로 하나 고른다 (모두 0이면 목록에서 고르게)
function pickWeighted(ai, params, list) {
  if (!list.length) return 'DRIVE';
  const w = list.map((s) => Math.max(0, diffParam(ai, `W_${s}`, params)));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return list[Math.min(list.length - 1, Math.floor(ai.rng() * list.length))];
  let r = ai.rng() * total;
  for (let i = 0; i < list.length; i++) {
    r -= w[i];
    if (r < 0) return list[i];
  }
  return list[list.length - 1];
}

// 회전을 잘못 읽을 확률 (7단계): (1 − READ)·(0.5 + 0.5·세기). 쉬울수록, 회전이 셀수록 크다
export const misreadChance = (difficulty, level, params = TUNABLE) =>
  (1 - params[`AI_${difficulty}_READ`]) * (0.5 + 0.5 * clamp(level, 0, 1));

// 구질 고르기: read(들어온 회전)가 있으면 맞는 대응 중에서 고르되,
// (1 − READ)·(0.5 + 0.5·세기) 확률로 잘못 읽어 맞지 않는 구질(일반 포함)을 고른다 (쉬움일수록, 회전이 셀수록 자주)
function pickShot(ai, params, allowed, read = null) {
  const ok = SHOTS.filter((s) => allowed[s]);
  if (!read || read.kind === 'none') { ai.lastRead = read && { ...read, wrong: false }; return pickWeighted(ai, params, ok); }
  const right = ok.filter((s) => CORRECT[read.kind].includes(s));
  const wrongs = ok.filter((s) => !CORRECT[read.kind].includes(s));
  const pWrong = misreadChance(ai.difficulty, read.level, params);
  const wrong = wrongs.length > 0 && (right.length === 0 || ai.rng() < pWrong);
  ai.lastRead = { ...read, wrong };
  return wrong ? wrongs[Math.min(wrongs.length - 1, Math.floor(ai.rng() * wrongs.length))] : pickWeighted(ai, params, right);
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
    DRIVE: true, CUT: true, SIDE: true, NORMAL: true,
    BLOCK: inSpeed >= 4,                                     // 느린 공은 블록으로 넘기기 어렵다
    // 높은 공만. 라켓 높이 한계(Z_MAX)에 닿는 너무 높은 공은 휘두를 자리가 없어 스매시하지 않는다
    SMASH: pc.z >= NET.HEIGHT + params.SMASH_MIN_HEIGHT + 0.03 && pc.z <= SWING.Z_MAX - 0.05,
  };
  // 들어온 회전 읽기 (타격 예정 시각의 판정용 회전)
  const w = carriedSpin(ai.inSpin, tc, params);
  const read = w ? readSpin(ballToLocal({ pos: pred.apex.pos, vel: pred.apex.vel, spin: w, t: 0 }, p.side), params) : null;
  const type = pickShot(ai, params, allowed, read);
  const yPlane = type === 'BLOCK' ? pc.y : pc.y - SWING.AI_PLANE_BACK;
  planSwing(ai, type, pc, tc, t, yPlane, params);
}

// 구질·타점·타격 시각으로 가상 드래그 경로를 계획한다 (랠리·서브 공용)
function planSwing(ai, type, pc, tc, t, yPlane, params) {
  const p = ai.player;
  const rng = ai.rng;
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
    // 방향은 판정에 쓰지 않는다 (7단계 버튼 구질). 모양만 사람처럼: 드라이브·일반은 위로, 커트·스매시는 아래로
    dir = { x: ux, y: type === 'DRIVE' || type === 'NORMAL' ? vy : type === 'BLOCK' ? 0 : -vy };
  }
  if (type === 'SMASH') speed = Math.max(speed, params.SMASH_SPEED * 1.1);
  // 스매시는 방향과 상관없으므로(7단계), 내려치기 시작점이 라켓 높이 한계 위면 아래에서 올려 친다
  if (type === 'SMASH' && pc.z - dir.y * speed * SWING.AI_SWING_TIME > SWING.Z_MAX) dir = { x: dir.x, y: -dir.y };
  if (type === 'BLOCK') speed = 0;

  const T = SWING.AI_SWING_TIME;
  const u = { x: dir.x * speed, y: dir.y * speed };
  const start = type === 'BLOCK' ? { x: pc.x, z: pc.z } : { x: pc.x - u.x * T, z: pc.z - u.y * T };
  ai.plan = {
    type, key: SHOT_KEY[type] ?? null, tc, pc, u, curve, start,
    swingStart: Math.max(t, tc - T),
    pressAt: type === 'BLOCK' ? tc - SWING.AI_BLOCK_LEAD : tc - PHYSICS.DT,
    releaseAt: tc + SWING.AI_FOLLOW_TIME,
    // 스윙은 평면 통과(블록 판정)보다 먼저 일어나야 하므로 평면을 타점보다 조금 뒤에 둔다
    yPlane: clamp(yPlane, SWING.Y_MIN, SWING.Y_MAX),
    swingFrom: null,
  };
  p.yPlane = ai.plan.yPlane;
}

// 로봇 서브: 토스한 공(세계 좌표)이 떨어지며 SERVE.HIT_Z를 지나는 순간을 노려 휘두른다.
// 서브 구질은 드라이브(탑)·커트(백)·사이드 중에서 난이도 비율로 고른다.
export function aiPlanServe(ai, ball, t, params = TUNABLE) {
  const p = ai.player;
  const tHit = tossTimeAt(ball, SERVE.HIT_Z, params);
  if (tHit === null) { ai.plan = { skip: true }; return; }
  const timing = diffParam(ai, 'TIMING', params);
  const tc = Math.max(t + PHYSICS.DT, tHit + uniform(ai.rng, -timing, timing));
  const pred = predictPath(ball, p.side, { params });
  const pc = toLocal(positionAt(pred.states, tc), p.side);
  p.apexT = tHit;
  p.apexPos = null;
  ai.thinkAt = null;
  const type = pickShot(ai, params, { DRIVE: true, CUT: true, SIDE: true, NORMAL: true, BLOCK: false, SMASH: false });
  planSwing(ai, type, pc, tc, t, pc.y, params);
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
  // 구질 버튼은 스윙을 시작할 때 누르고 계획이 끝나면 뗀다
  const key = plan && !plan.skip && t >= plan.swingStart ? plan.key : null;
  if (!last || t - ai.lastSampleT >= SWING.AI_SAMPLE_DT - 1e-9 || last.b !== pressed || (last.k ?? null) !== key) {
    const j = () => (ai.rng() * 2 - 1) * jitter;
    samples.push({ t, x: ai.pos.x + j(), y: ai.pos.z + j(), b: pressed, k: key });
    ai.lastSampleT = t;
    pruneSamples(samples, t);
  }
}

// ── 경기 진행 (연습 모드·자동 경기 테스트 공용) ─────────────────
// 경기 흐름(서브 대기·토스·타격 적용·물리·규칙·다음 서브)은 shared/match.js(서버와 공용)가 맡고,
// 여기서는 그 위에 로봇·사람 플레이어(타격 판정), 연습 공, 디버그 규칙 시험을 얹는다.
// players: { [-1]: player, [1]: player }, ais: 로봇 목록, rng: 판정 오차·연습 공 난수
// local: 이 컴퓨터에서 타격을 판정하는 쪽 (연습: 양쪽, 대전: 내 쪽만), retoss: false면 토스 실패 = 서브 실점(대전)
export function createRally({ players, ais = [], rng, firstServer = -1, bestOf = RULES.BEST_OF, local = [-1, 1], retoss = true }) {
  for (const ai of ais) ai.player.robot = true;
  return {
    ...createMatch({ firstServer, bestOf, retoss }),
    players, ais, rng, local,
    lastShot: null,
    tossAt: null,            // 로봇이 토스할 시각
    scenario: null,          // 디버그 규칙 시험 대기 { kind, at }
  };
}

// 서브 대기를 새로 시작할 때: 플레이어 라켓 평면을 서브 자리로, 로봇 서브권자는 토스 시각을 잡는다
function onHold(game, t) {
  const server = game.rules.server;
  game.scenario = null;
  game.tossAt = null;
  for (const side of [-1, 1]) {
    const p = game.players[side];
    p.apexT = null;
    p.apexPos = null;
    p.yPlane = side === server ? SERVE.TOSS_Y : SWING.HOME_Y;
  }
  for (const ai of game.ais) {
    ai.plan = null;
    ai.thinkAt = null;
    if (ai.player.side === server) game.tossAt = t + PRACTICE.SERVE_DELAY;
  }
}

// 서브권자가 자기 토스 위치에서 공을 들고 기다린다
export function holdServe(game, t, params = TUNABLE) {
  holdBall(game, t);
  onHold(game, t);
}

// side가 기준 좌표 x에서 공을 띄운다 (서브 대기 중 서브권자만). 성공하면 true
export function tossBall(game, side, x, t, params = TUNABLE) {
  if (game.scenario || !startToss(game, side, x, t)) return false;
  game.tossAt = null;
  const p = game.players[side];
  p.yPlane = SERVE.TOSS_Y;
  p.apexT = tossTimeAt(game.ball, SERVE.HIT_Z, params); // 이 높이에서 치면 PERFECT
  p.apexPos = toWorld(vec(toLocal(game.ball.pos, side).x, SERVE.TOSS_Y, SERVE.HIT_Z), side); // 타점 고리
  for (const ai of game.ais) if (ai.player.side === side) aiPlanServe(ai, game.ball, t, params);
  return true;
}

// 연습 공: 지금 점수를 그대로 두고, 이 공의 결과는 점수에 넣지 않는다
function beginPractice(game, fromSide, t) {
  if (!game.practice) game.practice = toServe(game.rules);
  game.rules = startRally(game.rules, fromSide);
  game.holding = false;
  game.free = false;
  game.nextAt = null;
  game.tossAt = null;
  game.lastHitT = t;
}

// 로봇이 연습 공을 보낸다 (서브 규칙 없이 받는 쪽 코트에 한 번 떨어지는 공)
export function feedBall(game, fromSide, t, params = TUNABLE) {
  const rng = game.rng;
  const target = { x: uniform(rng, -PRACTICE.FEED_X_RANGE, PRACTICE.FEED_X_RANGE), y: PRACTICE.FEED_DEPTH };
  const aim = solveAim({
    pos: PRACTICE.FEED_POS, speed: PRACTICE.FEED_SPEED, topspin: PRACTICE.FEED_TOPSPIN, target, t,
  }, params);
  return serveBall(game, ballToWorld(aim.ball, fromSide), fromSide, params);
}

// 임의의 공(세계 좌표)을 fromSide가 친 공으로 연습 랠리를 시작한다 (디버그 발사기용)
export function serveBall(game, ball, fromSide, params = TUNABLE) {
  beginPractice(game, fromSide, ball.t);
  game.ball = createBall(ball);
  incoming(game, -fromSide, ball.t, params);
  return game.ball;
}

// 규칙·타격 없이 공만 놓는다 (디버그 떨어뜨리기용). endFree로 서브 대기로 돌아간다.
export function placeBall(game, ball) {
  if (!game.practice) game.practice = toServe(game.rules);
  game.ball = createBall(ball);
  game.free = true;
  game.holding = false;
  for (const ai of game.ais) { ai.plan = null; ai.thinkAt = null; }
  return game.ball;
}

export function endFree(game, t, params = TUNABLE) {
  game.rules = game.practice ?? toServe(game.rules);
  game.practice = null;
  holdServe(game, t, params);
}

// 상대가 친(보낸) 직후: 받는 쪽 정점 예측, 로봇 반응. 지금 공의 회전을 판정용 회전의 출발점으로 기록한다(7단계)
export function incoming(game, side, t, params = TUNABLE) {
  game.inSpin = { t: game.ball.t, spin: vec(game.ball.spin.x, game.ball.spin.y, game.ball.spin.z) };
  predictFor(game.players[side], game.ball, params);
  for (const ai of game.ais) if (ai.player.side === side) aiOnIncoming(ai, t, params, game.inSpin);
}

// 로봇 갱신 → 타격 판정(이 컴퓨터가 맡은 쪽만) → applyHit. 만든 racket 이벤트에는 shot 판정 결과가 붙는다.
function hitPhase(game, t, dt, events, params) {
  const ball = game.ball;
  for (const ai of game.ais) aiUpdate(ai, ball, t, dt, params);
  const rules = game.rules;
  const live = !game.free && (rules.phase === 'serving' || rules.phase === 'rally');

  for (const side of live ? game.local : []) {
    if (!canHit(rules, side)) continue;
    const p = game.players[side];
    const serveHit = isServeHit(rules);
    const kind = checkHit(p, ball, t, dt, params, serveHit ? params.SERVE_HIT_RADIUS : params.HIT_RADIUS);
    if (!kind) continue;
    // 자기 쪽에 바운드하기 전 공: 일부러 휘두르거나 막은 경우만 맞는다(발리 → 실점).
    // 버튼 없이 라켓이 놓여 있던 경우와 로봇은 치지 않는다.
    if (isEarly(rules, side) && (kind === 'weak' || p.robot)) continue;
    const shot = classifyShot(p.samples, ball, {
      t, side, apexT: p.apexT, rng: game.rng, params, pressed: kind !== 'weak', serve: serveHit, dragScale: p.dragScale ?? 1,
      spinIn: carriedSpin(game.inSpin, t, params) ?? undefined, smashSpeed: p.smashSpeed,
      ringZ: serveHit || p.robot ? undefined : p.apexPos?.z, // 사람: 화면 고리 높이로 스매시 판정 (로봇은 맞은 높이로 고른다)
    });
    p.lastShot = shot;
    game.lastShot = { side, ...shot };
    // 바운드 전 공이 코트 밖으로 나가던 공이면 applyHit가 outside를 붙인다 (쳐도 발리가 아니라 상대의 아웃)
    events.push(applyHit(game, side, { vel: shot.vel, spin: shot.spin, shot }, params));
    incoming(game, -side, t, params);
    break;
  }
}

// 연습 모드의 경기 흐름 훅 (shared/match.js의 stepGame에 넘긴다)
function practiceHooks(params) {
  return {
    onHold,
    idle(game, t, dt) {
      for (const ai of game.ais) aiUpdate(ai, game.ball, t, dt, params);
    },
    afterIdle(game, t) {
      if (game.tossAt !== null && t >= game.tossAt) {
        const ai = game.ais.find((a) => a.player.side === game.rules.server);
        tossBall(game, ai.player.side, uniform(game.rng, -PRACTICE.FEED_X_RANGE, PRACTICE.FEED_X_RANGE), game.ball.t, params);
      }
    },
    nextServe(game) {
      if (!game.practice) return false;
      game.rules = game.practice; // 연습 공은 점수에 넣지 않는다
      game.practice = null;
      return true;
    },
    beforeStep(game, t, dt, events) {
      hitPhase(game, t, dt, events, params);
    },
  };
}

// 고정 스텝 하나(서브·랠리 중): 로봇 → 타격 판정 → 물리 → 규칙. 반환: 물리·타격 이벤트 목록
// 득점 결과는 game.results에 쌓인다.
export function stepRally(game, dt = PHYSICS.DT, params = TUNABLE) {
  const events = [];
  hitPhase(game, game.ball.t, dt, events, params);
  return stepBall(game, dt, params, events);
}

// 대전 되감기 재생용 한 스텝: 로봇·타격 판정 없이 물리·규칙만 다시 돌린다 (서브 대기 준비만 한다)
export function replayStep(game, dt = PHYSICS.DT, params = TUNABLE) {
  return stepGame(game, dt, params, { onHold });
}

// 경기 흐름 한 스텝: 서브 대기(로봇 토스) → 서브·랠리 → 득점 표시 → 다음 서브 … → 게임 끝
// 반환: 이번 스텝의 물리·타격 이벤트
export function stepMatch(game, dt = PHYSICS.DT, params = TUNABLE) {
  if (game.scenario) {
    const t = game.ball.t;
    for (const ai of game.ais) aiUpdate(ai, game.ball, t, dt, params);
    game.ball.t += dt;
    if (t >= game.scenario.at) runScenario(game, game.scenario.kind, game.ball.t, params);
    return [];
  }
  return stepGame(game, dt, params, practiceHooks(params));
}

// ── 규칙 시험 (디버그 패널) ──────────────────────────────────
// 렛·투 바운드·코트 밖 긴 공을 일부러 만든다. 로봇(+1 쪽 고정 아님: robotSide)이 공을 보내고, 결과는 점수에 넣지 않는다.
//  - let: 로봇 서브가 네트 윗줄을 스치고 내 코트에 들어간다 → 렛
//  - twoBounce: 짧은 백스핀 공이 내 코트에 두 번 떨어진다 (치지 않으면) → 투 바운드(내 실점)
//  - volley: 긴 공이 내 코트에 닿지 않고 라켓 평면(엔드라인 밖)을 지나간다. 코트 밖 공이므로
//            버튼을 누른 채 표시된 고리에 라켓을 대도, 그냥 두어도 → 아웃(로봇 실점). (이름은 디버그 버튼 호환을 위해 그대로 둔다)
export const SCENARIOS = Object.freeze(['let', 'twoBounce', 'volley']);

export function queueScenario(game, kind, t) {
  if (!game.practice) game.practice = toServe(game.rules);
  game.rules = { ...toServe(game.rules), phase: 'pointOver', lastResult: null }; // 기다리는 동안 아무도 서브하지 않는다
  game.nextAt = null;
  game.holding = false;
  game.free = false;
  game.scenario = { kind, at: t + PRACTICE.SCENARIO_DELAY };
  const robot = game.ais[0]?.player.side ?? 1;
  game.ball = createBall({ pos: toWorld(PRACTICE.FEED_POS, robot), t });
}

// 네트 윗줄을 스치고 상대 코트에 들어가는 서브 (서버 기준 좌표). 속도·발사각을 훑어 처음 찾은 공
export function findLetServe(t = 0, params = TUNABLE) {
  const pos = vec(0, SERVE.TOSS_Y, SERVE.HIT_Z);
  for (const speed of SCENARIO.LET_SPEEDS) {
    for (let el = SERVE.PITCH_MIN; el <= SERVE.PITCH_MAX; el += SCENARIO.LET_PITCH_STEP) {
      const ball = makeLaunch({ pos, speed, elevation: el, topspin: SCENARIO.LET_TOPSPIN, t });
      const l = serveLanding(ball, params);
      if (l.own && l.netCord && !l.short && l.y > 0 && l.y < TABLE.LENGTH / 2 - SCENARIO.LET_MARGIN) return ball;
    }
  }
  return null;
}

// 받는 쪽 라켓 평면(보내는 쪽 기준 좌표 y = planeY)을 바운드 없이 높이 z로 지나가는 긴 공 (보내는 쪽 기준 좌표)
export function findLongBall(planeY, z, t = 0, params = TUNABLE) {
  let best = null;
  for (let el = SCENARIO.LONG_PITCH_MIN; el <= SCENARIO.LONG_PITCH_MAX; el += SCENARIO.LONG_PITCH_STEP) {
    const ball = makeLaunch({ pos: PRACTICE.FEED_POS, speed: SCENARIO.LONG_SPEED, elevation: el, t });
    const b = createBall(ball);
    let cross = null;
    for (let i = 0; i < Math.round(simTime(SWING.PREDICT_T, params) / PHYSICS.DT); i++) {
      const y0 = b.pos.y;
      if (step(b, PHYSICS.DT, { params }).length) break; // 무엇엔가 닿음: 탈락
      if (y0 < planeY && b.pos.y >= planeY) { cross = { t: b.t, pos: vec(b.pos.x, b.pos.y, b.pos.z) }; break; }
    }
    if (cross && (!best || Math.abs(cross.pos.z - z) < Math.abs(best.cross.pos.z - z))) best = { ball, cross };
  }
  return best;
}

function runScenario(game, kind, t, params) {
  const robot = game.ais[0]?.player.side ?? 1;
  const me = -robot;
  game.scenario = null;
  if (kind === 'let') {
    let s = { ...toServe(game.rules), server: robot };
    s = applyEvent(s, { type: 'toss', side: robot }).state;
    s = applyEvent(s, { type: 'racket', side: robot, racket: robot }).state;
    game.rules = s;
    game.ball = ballToWorld(findLetServe(t, params), robot);
    game.lastHitT = t;
    game.nextAt = null;
    incoming(game, me, t, params);
    return;
  }
  let ball, cross = null;
  if (kind === 'twoBounce') {
    ball = solveAim({ pos: PRACTICE.FEED_POS, speed: SCENARIO.SHORT_SPEED, topspin: SCENARIO.SHORT_TOPSPIN, target: SCENARIO.SHORT_TARGET, t }, params).ball;
  } else {
    const found = findLongBall(-SWING.HOME_Y, SCENARIO.LONG_Z, t, params);
    ball = found.ball;
    cross = found.cross;
  }
  serveBall(game, ballToWorld(ball, robot), robot, params);
  if (cross) {
    // 바운드가 없어 예측 정점이 없으므로, 공이 내 라켓 평면을 지나는 곳을 고리로 보여 준다
    const p = game.players[me];
    p.apexPos = ballToWorld({ pos: cross.pos, vel: vec(), spin: vec(), t: 0 }, robot).pos;
    p.apexT = cross.t;
    p.yPlane = SWING.HOME_Y;
  }
}

// ── 서브 가이드라인 ─────────────────────────────────────────
// side가 기준 좌표 x에서 토스해 타점 높이(SERVE.HIT_Z)에서 PERFECT 타이밍으로 위로 휘두른
// 보통 세기(SERVE_GUIDE.STRENGTH) 서브의 예상 궤적. button: 지금 누른 구질 버튼(7단계, 없으면 무회전 서브).
// 실제 서브와 같은 classifyShot 경로를 쓴다.
// 반환: { hit, points, bounces } (모두 세계 좌표. bounces = [내 코트 첫 바운드, 상대 코트 착지]) 또는 null
export function serveGuide(side, x, params = TUNABLE, button = null) {
  const cx = clamp(x, -SERVE.TOSS_X_MAX, SERVE.TOSS_X_MAX);
  const hit = vec(cx, SERVE.TOSS_Y, SERVE.HIT_Z);
  const speed = params.BLOCK_SPEED + SERVE_GUIDE.STRENGTH * (params.SPEED_FULL - params.BLOCK_SPEED);
  const T = SERVE_GUIDE.SWING_TIME;
  const samples = [];
  for (let k = 0; k * SWING.AI_SAMPLE_DT <= T + 1e-9; k++) {
    const tau = k * SWING.AI_SAMPLE_DT;
    samples.push({ t: tau - T, x: cx, y: hit.z - speed * (T - tau), b: true }); // 아래 → 위 일정 속도
  }
  const ball = ballToWorld(createBall({ pos: hit, vel: vec(0, 0, -1), t: 0 }), side);
  const shot = classifyShot(samples, ball, { t: 0, side, apexT: 0, params, serve: true, rng: () => 0.5, button });
  const b = createBall({ pos: ball.pos, vel: shot.vel, spin: shot.spin, t: 0 });
  const points = [{ ...b.pos }], bounces = [];
  const n = Math.round(SERVE_GUIDE.MAX_T / PHYSICS.DT);
  for (let i = 1; i <= n && bounces.length < 2; i++) {
    const ev = step(b, PHYSICS.DT, { params });
    if (i % SERVE_GUIDE.POINT_STEP === 0) points.push({ ...b.pos });
    for (const e of ev) {
      if (e.type === 'bounce' || e.type === 'edge') bounces.push({ ...e.pos });
      else return null; // 네트·바닥: 가이드로 보여 줄 수 없는 서브
    }
  }
  if (bounces.length < 2) return null;
  points.push({ ...b.pos });
  const own = toLocal(bounces[0], side).y < 0, there = toLocal(bounces[1], side).y > 0;
  return own && there ? { hit: toWorld(hit, side), points, bounces, shotType: shot.shotType } : null;
}

// 점수판에 보여 줄 규칙 상태: 연습 공 중에는 연습 전 상태(점수가 바뀌지 않음)
export const scoreState = (game) => game.practice ?? game.rules;

// 라켓을 그릴 세계 좌표 (샘플이 없으면 null). 칠 수 있는 공이 오면 도달 범위 안에서 앞뒤로 따라간다.
export function racketWorld(player, t, ball = null) {
  const by = ball ? toLocal(ball.pos, player.side).y : null;
  const p = racketLocal(player, t, by);
  return p ? toWorld(p, player.side) : null;
}
