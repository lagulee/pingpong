// rules.js — 탁구 규칙 상태 기계. 브라우저(연습 모드)·서버(대전 모드) 공용.
// applyEvent(이전 상태, 이벤트 1개) → { state: 새 상태, result: 득점 결과 | null }
// 상태는 바꾸지 않고 새 객체를 돌려준다. 시간·난수를 쓰지 않는다.
//
// 플레이어는 물리 좌표의 쪽(side)으로 부른다: −1(y < 0 쪽), +1(y > 0 쪽). score[0]이 −1, score[1]이 +1의 점수.
//
// 이벤트
//  - 물리 이벤트: bounce, edge(모서리, 유효 바운드), net, floor → { type, side(바운드한 쪽) }
//  - racket: { type: 'racket', racket 또는 side(친 사람) }
//  - toss: { type: 'toss', side } 서브권자가 공을 띄움 (waitingServe → serving)
//  - timeout: 공이 멈춰 더 이상 이벤트가 없을 때 진행 쪽이 보낸다
//  - next: pointOver 뒤 다음 서브(또는 다음 게임)로 넘어감
//
// phase: waitingServe → serving → rally → pointOver → (next) → waitingServe … / gameOver
import { RULES } from './constants.js';

export const idx = (side) => (side < 0 ? 0 : 1);
const other = (side) => -side;

// 지금까지 난 점수로 서브권자와 "이번이 몇 번째 서브인지(0부터)"를 정한다.
// 서브권은 SERVE_TURN점마다, 둘 다 DEUCE_AT 이상(듀스)이면 1점마다 바뀐다.
export function serverFor(score, firstServer, rules = RULES) {
  const total = score[0] + score[1];
  const deuce = Math.min(score[0], score[1]) >= rules.DEUCE_AT;
  let turns, count;
  if (!deuce) {
    turns = Math.floor(total / rules.SERVE_TURN);
    count = total % rules.SERVE_TURN;
  } else {
    const before = 2 * rules.DEUCE_AT; // 듀스가 시작된 시점의 총점
    turns = Math.floor(before / rules.SERVE_TURN) + (total - before);
    count = 0;
  }
  return { server: turns % 2 === 0 ? firstServer : other(firstServer), serveCount: count };
}

// 게임 승자 (없으면 0)
export function gameWinner(score, rules = RULES) {
  const [a, b] = score;
  if (Math.max(a, b) >= rules.POINTS_TO_WIN && Math.abs(a - b) >= rules.WIN_BY) return a > b ? -1 : 1;
  return 0;
}

// 매치포인트인 쪽: 그쪽이 1점을 더 내면 경기(매치)가 끝난다. 없으면 0. (연출: 심장 박동·슬로모션)
export function matchPointSide(state, rules = RULES) {
  for (const side of [-1, 1]) {
    const score = [...state.score];
    score[idx(side)]++;
    if (gameWinner(score, rules) === side && state.games[idx(side)] + 1 > state.bestOf / 2) return side;
  }
  return 0;
}

export function createRules({ firstServer = -1, bestOf = RULES.BEST_OF } = {}) {
  return {
    score: [0, 0],
    games: [0, 0],
    bestOf,
    firstServer,             // 이번 게임 첫 서브권자
    server: firstServer,
    serveCount: 0,
    phase: 'waitingServe',
    lastHitter: 0,           // 마지막으로 친 쪽 (서브 토스 중에는 0)
    bounceSide: 0,           // 마지막 타격 뒤 공이 바운드한 쪽 (없으면 0)
    bouncesOnSide: 0,        // 그쪽에서 연속으로 바운드한 횟수
    netTouched: false,       // 마지막 타격 뒤 네트에 닿았는지
    returnPending: false,    // 랠리 중 리턴이 상대 코트에 들어가면 rally를 센다 (서브·연습 공은 세지 않음)
    rally: 0,                // 이번 포인트의 정상 리턴 수
    winner: 0,               // 경기 승자
    lastResult: null,
  };
}

// 연습용: side가 방금 친 공으로 랠리를 시작한다 (디버그 발사기·연습 공 보내기). 점수는 그대로.
export function startRally(state, side) {
  return {
    ...state, phase: 'rally', lastHitter: side, bounceSide: 0, bouncesOnSide: 0,
    netTouched: false, returnPending: false, rally: 0, lastResult: null,
  };
}

// 지금 점수 그대로 서브 대기로 되돌린다 (연습 공·디버그가 끝난 뒤). 서브권은 점수로 다시 정한다.
export function toServe(state) {
  if (state.phase === 'gameOver') return state;
  return {
    ...state, ...serverFor(state.score, state.firstServer), phase: 'waitingServe', lastHitter: 0, bounceSide: 0,
    bouncesOnSide: 0, netTouched: false, returnPending: false, rally: 0, lastResult: null,
  };
}

// side가 지금 공을 칠 수 있는가 (공이 자기 쪽으로 오는 중). 바운드 전에 치면 발리로 실점한다.
export function canHit(state, side) {
  if (state.phase === 'serving') return state.lastHitter === 0 ? side === state.server : side !== state.lastHitter;
  if (state.phase === 'rally') return side !== state.lastHitter;
  return false;
}

// side 쪽 코트에 이미 바운드한 공인가 (칠 차례인 공이 정상적으로 들어왔는가)
export const bouncedOn = (state, side) => state.bounceSide === side && state.bouncesOnSide >= 1;

// 실점 처리: loser가 실점, 상대가 1점
function point(state, loser, reason) {
  const winnerSide = other(loser);
  const score = [...state.score];
  score[idx(winnerSide)]++;
  const gw = gameWinner(score);
  const next = { ...state, score, lastHitter: state.lastHitter };
  const result = { type: 'point', winner: winnerSide, loser, reason, score: [...score], rally: state.rally, gameOver: false, matchOver: false };
  if (gw) {
    const games = [...state.games];
    games[idx(gw)]++;
    next.games = games;
    result.gameOver = true;
    result.games = [...games];
    if (games[idx(gw)] > state.bestOf / 2) {
      result.matchOver = true;
      next.winner = gw;
      next.phase = 'gameOver';
    } else next.phase = 'pointOver';
  } else {
    next.phase = 'pointOver';
    Object.assign(next, serverFor(score, state.firstServer)); // 다음 서브권
  }
  next.lastResult = result;
  return { state: next, result };
}

function noPoint(state, reason) {
  const result = { type: reason, winner: 0, loser: 0, reason, score: [...state.score], rally: state.rally, gameOver: false, matchOver: false };
  return { state: { ...state, phase: 'pointOver', lastResult: result }, result };
}

const same = (state) => ({ state, result: null });
const hitterOf = (e) => e.racket ?? e.side;
const isBounce = (e) => e.type === 'bounce' || e.type === 'edge'; // 모서리는 유효

// 다음 서브(또는 다음 게임)를 준비한 상태
function nextServe(state) {
  const base = {
    ...state, phase: 'waitingServe', lastHitter: 0, bounceSide: 0, bouncesOnSide: 0,
    netTouched: false, returnPending: false, rally: 0,
  };
  if (state.lastResult?.gameOver) {
    // 다음 게임: 점수 초기화, 첫 서브권은 지난 게임의 반대
    const firstServer = other(state.firstServer);
    return { ...base, score: [0, 0], firstServer, server: firstServer, serveCount: 0 };
  }
  return base;
}

// ── 서브 ──
function onServing(state, e) {
  const server = state.server, receiver = other(server);
  if (state.lastHitter === 0) {
    // 토스한 공을 아직 치지 않음
    if (e.type === 'racket') {
      if (hitterOf(e) !== server) return point(state, receiver, 'volley'); // 서브 전에 받는 쪽이 건드림
      return same({ ...state, lastHitter: server, bounceSide: 0, bouncesOnSide: 0, netTouched: false });
    }
    if (isBounce(e) || e.type === 'floor' || e.type === 'net' || e.type === 'timeout') return noPoint(state, 'retoss');
    return same(state);
  }
  const ownBounced = bouncedOn(state, server);
  switch (e.type) {
    case 'racket': {
      const h = hitterOf(e);
      if (h === server) return point(state, server, 'doubleHit');
      // 받는 쪽 코트에 바운드하기 전에 침: 인플레이 공이면 발리(받는 쪽 실점),
      // 코트 밖으로 나가던 공(e.outside)이면 서브의 아웃(서버 실점)
      if (e.outside) return point(state, server, state.netTouched ? 'net' : ownBounced ? 'out' : 'serveNoBounce');
      return point(state, receiver, 'volley');
    }
    case 'bounce': case 'edge':
      if (e.side === server) {
        if (!ownBounced && state.bounceSide === 0) return same({ ...state, bounceSide: server, bouncesOnSide: 1 });
        return point(state, server, state.netTouched ? 'net' : 'serveFault'); // 자기 코트에 두 번
      }
      if (!ownBounced) return point(state, server, 'serveNoBounce');
      if (state.netTouched) return noPoint(state, 'let');
      return same({ ...state, phase: 'rally', bounceSide: receiver, bouncesOnSide: 1, returnPending: false });
    case 'net':
      if (!ownBounced) return point(state, server, 'net'); // 자기 코트에 닿기 전에 네트
      return same({ ...state, netTouched: true });
    case 'floor':
      return point(state, server, state.netTouched ? 'net' : ownBounced ? 'out' : 'serveNoBounce');
    case 'timeout':
      return point(state, server, state.netTouched ? 'net' : 'serveFault');
    default:
      return same(state);
  }
}

// ── 랠리 ──
function onRally(state, e) {
  const H = state.lastHitter, R = other(H);
  const bounced = bouncedOn(state, R);
  switch (e.type) {
    case 'racket': {
      const h = hitterOf(e);
      if (h === H) return point(state, H, 'doubleHit');
      // 바운드 전에 침: 인플레이 공이면 발리(받는 쪽 실점), 코트 밖으로 나가던 공(e.outside)이면 친 쪽의 아웃
      if (!bounced) return e.outside ? point(state, H, state.netTouched ? 'net' : 'out') : point(state, R, 'volley');
      return same({ ...state, lastHitter: R, bounceSide: 0, bouncesOnSide: 0, netTouched: false, returnPending: true });
    }
    case 'bounce': case 'edge':
      if (e.side === R) {
        if (bounced) return point(state, R, 'twoBounce');
        return same({
          ...state, bounceSide: R, bouncesOnSide: 1,
          rally: state.rally + (state.returnPending ? 1 : 0), returnPending: false,
        });
      }
      if (bounced) return point(state, R, 'miss');        // 받을 쪽 코트에 맞고 되돌아온 공
      return point(state, H, state.netTouched ? 'net' : 'ownCourt');
    case 'net':
      if (bounced) return same(state);
      return same({ ...state, netTouched: true });
    case 'floor':
    case 'timeout':
      if (bounced) return point(state, R, 'miss');
      return point(state, H, state.netTouched ? 'net' : 'out');
    default:
      return same(state);
  }
}

export function applyEvent(state, e) {
  switch (state.phase) {
    case 'waitingServe':
      if (e.type === 'toss' && e.side === state.server) {
        return same({ ...state, phase: 'serving', lastHitter: 0, bounceSide: 0, bouncesOnSide: 0, netTouched: false, rally: 0, lastResult: null });
      }
      return same(state);
    case 'serving': return onServing(state, e);
    case 'rally': return onRally(state, e);
    case 'pointOver':
      if (e.type === 'next') return same(nextServe(state));
      return same(state);
    default: // gameOver: 더 이상 바뀌지 않는다
      return same(state);
  }
}

// 이벤트 목록을 차례로 적용 (테스트·서버 재생용). 반환 { state, results }
export function applyEvents(state, events) {
  const results = [];
  for (const e of events) {
    const r = applyEvent(state, e);
    state = r.state;
    if (r.result) results.push(r.result);
  }
  return { state, results };
}
