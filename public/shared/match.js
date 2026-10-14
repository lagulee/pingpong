// match.js — 경기 흐름 (연습 모드·대전 클라이언트·서버 공용, 순수 함수)
// 서브 대기(공을 들고 있음) → 토스 → 서브·랠리 → 득점 표시 → 다음 서브 … → 게임 끝.
// 규칙 판정은 rules.js 상태 기계, 공은 physics.js. 타격을 "만드는" 부분(마우스·로봇 → classifyShot)은
// 클라이언트(public/js) 몫이고, 여기서는 만들어진 타격 { vel, spin }을 공에 적용만 한다.
// 그래서 서버는 클라이언트가 보낸 타격을 같은 applyHit → stepGame 경로로 재생해 득점을 판정한다.
import { step, createBall, toWorld, ballToWorld, makeToss, vec, inPlayFor } from './physics.js';
import { PHYSICS, PRACTICE, SERVE, RULES, TUNABLE } from './constants.js';
import { createRules, applyEvent, bouncedOn } from './rules.js';

// 경기 상태. practice·free는 연습 모드(ai.js)의 연습 공·디버그 떨어뜨리기 표시이고, 대전에서는 쓰지 않는다.
export function createMatch({ firstServer = -1, bestOf = RULES.BEST_OF } = {}) {
  return {
    ball: createBall({ pos: vec(0, 0, 1) }),
    rules: createRules({ firstServer, bestOf }),
    results: [],             // 득점·렛 결과 기록 (rules.js의 result + t)
    lastHitT: 0,             // 마지막 타격(토스) 시각: 시간 초과 판정용
    holding: false,          // 서브 대기 중 서브권자가 공을 들고 있음 (물리 정지)
    nextAt: null,            // 득점 표시가 끝나고 다음 서브로 넘어갈 시각
    lastToss: null,          // 마지막 토스 { side, x, t } (대전: 상대에게 보낼 정보)
    practice: null,          // 연습 공: 점수를 바꾸지 않고, 끝나면 이 규칙 상태로 돌아간다
    free: false,             // 디버그 떨어뜨리기: 규칙·타격 없이 물리만
  };
}

// 규칙에 이벤트 1개를 넣는다. 결과가 나오면 기록하고 다음 서브 시각을 정한다.
export function ruleEvent(game, e, t) {
  const r = applyEvent(game.rules, e);
  game.rules = r.state;
  if (r.result) {
    game.results.push({ ...r.result, t, practice: !!game.practice });
    game.nextAt = t + PRACTICE.POINT_DELAY;
  }
  return r.result;
}

// 서브권자가 자기 토스 위치에서 공을 들고 기다린다
export function holdBall(game, t) {
  game.ball = createBall({ pos: toWorld(vec(0, SERVE.TOSS_Y, SERVE.TOSS_Z), game.rules.server), t });
  game.holding = true;
  game.free = false;
  game.nextAt = null;
}

// side가 기준 좌표 x에서 공을 띄운다 (서브 대기 중 서브권자만). 성공하면 true
export function startToss(game, side, x, t) {
  if (game.free || game.rules.phase !== 'waitingServe' || game.rules.server !== side) return false;
  ruleEvent(game, { type: 'toss', side }, t);
  game.ball = ballToWorld(makeToss(x, t), side);
  game.holding = false;
  game.lastHitT = t;
  game.lastToss = { side, x, t };
  return true;
}

// 토스한 공을 아직 치지 않은 서브 순간인가
export const isServeHit = (rules) => rules.phase === 'serving' && rules.lastHitter === 0;
// side가 지금 치면 "바운드 전 공"인가 (서브 제외)
export const isEarly = (rules, side) => !isServeHit(rules) && !bouncedOn(rules, side);

// side의 타격을 지금 공(game.ball, 시각 ball.t)에 적용한다. hit: { vel, spin, shot }
// 바운드 전에 코트 밖으로 나가던 공이면 outside 플래그를 붙인다(rules.js가 발리 대신 상대 아웃으로 판정).
// 반환: racket 이벤트
export function applyHit(game, side, hit, params = TUNABLE) {
  const ball = game.ball;
  const t = ball.t;
  const outside = isEarly(game.rules, side) && !inPlayFor(ball, side, params);
  ball.vel = vec(hit.vel.x, hit.vel.y, hit.vel.z);
  ball.spin = vec(hit.spin.x, hit.spin.y, hit.spin.z);
  const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
  const e = { type: 'racket', t, pos: { ...ball.pos }, speed, side, racket: side, shot: hit.shot ?? null };
  if (outside) e.outside = true;
  game.lastHitT = t;
  ruleEvent(game, e, t);
  return e;
}

// 공을 dt만큼 진행: 물리 이벤트를 규칙에 넣고, 마지막 타격 뒤 RALLY_TIMEOUT이 지나면 시간 초과
export function stepBall(game, dt = PHYSICS.DT, params = TUNABLE, events = []) {
  for (const e of step(game.ball, dt, { params })) {
    events.push(e);
    if (!game.free) ruleEvent(game, e, e.t);
  }
  const ph = game.rules.phase;
  if (!game.free && (ph === 'serving' || ph === 'rally') && game.ball.t - game.lastHitT > PRACTICE.RALLY_TIMEOUT) {
    ruleEvent(game, { type: 'timeout' }, game.ball.t);
  }
  return events;
}

// 경기 흐름 한 스텝. 반환: 이번 스텝의 물리·타격 이벤트
// hooks(모두 선택, 연습 모드의 로봇·사람 처리용. 서버는 넘기지 않는다):
//   onHold(game, t)           서브 대기를 새로 시작함 (공을 손에 듦)
//   idle(game, t, dt)         서브 대기 중 매 스텝 (시각을 올리기 전)
//   afterIdle(game, t)        서브 대기 중 매 스텝 (시각을 올린 뒤: 토스 시점. t는 올리기 전 시각)
//   nextServe(game, t)        다음 서브로 넘어갈 때. true를 반환하면 규칙의 'next'를 대신 처리한 것
//   beforeStep(game, t, dt, events)  서브·랠리 중 물리 스텝 전 (로봇 갱신·타격 판정 → applyHit)
export function stepGame(game, dt = PHYSICS.DT, params = TUNABLE, hooks = {}) {
  const t = game.ball.t;
  const ph = game.rules.phase;
  if (!game.free && ph === 'waitingServe') {
    if (!game.holding) {
      holdBall(game, t);
      hooks.onHold?.(game, t);
    }
    hooks.idle?.(game, t, dt);
    game.ball.t += dt; // 공은 손에 들려 있다
    hooks.afterIdle?.(game, t);
    return [];
  }
  if (!game.free && ph === 'pointOver' && game.nextAt !== null && t >= game.nextAt) {
    if (!hooks.nextServe?.(game, t)) ruleEvent(game, { type: 'next' }, t);
    holdBall(game, t);
    hooks.onHold?.(game, t);
    game.ball.t += dt;
    return [];
  }
  const events = [];
  hooks.beforeStep?.(game, t, dt, events);
  return stepBall(game, dt, params, events);
}
