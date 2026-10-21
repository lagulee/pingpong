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
  const { server, serveCount } = serveInfo(score, firstServer, rules);
  return { server, serveCount };
}

// serverFor + 서브 차례 번호 turns(0부터, 복식 좌석 순환용)
export function serveInfo(score, firstServer, rules = RULES) {
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
  return { server: turns % 2 === 0 ? firstServer : other(firstServer), serveCount: count, turns };
}

// ── 복식 (9단계, 정식 ITTF 순서) ──
// 좌석 seat 0/1은 팀(side) 안의 두 사람. 첫 서버 s0(첫 서브팀), 첫 리시버 r0(상대팀)이면 서브 차례 n(= serverFor의 turns)마다
//   n%4=0: s0 → r0 / 1: r0 → s0의 짝 / 2: s0의 짝 → r0의 짝 / 3: r0의 짝 → s0
// 한 포인트의 타격 순서는 [서버, 리시버, 서버의 짝, 리시버의 짝]을 되풀이한다.
export function doublesRoles(firstServer, firstSeats, turns) {
  const S = firstServer, R = other(firstServer), s0 = firstSeats.server, r0 = firstSeats.receiver;
  switch (turns % 4) {
    case 0: return { server: { side: S, seat: s0 }, receiver: { side: R, seat: r0 } };
    case 1: return { server: { side: R, seat: r0 }, receiver: { side: S, seat: 1 - s0 } };
    case 2: return { server: { side: S, seat: 1 - s0 }, receiver: { side: R, seat: 1 - r0 } };
    default: return { server: { side: R, seat: 1 - r0 }, receiver: { side: S, seat: s0 } };
  }
}

// 지금 서브 상황의 서버·리시버 좌석 (단식이면 0)
function serveSeats(state, info) {
  if (!state.doubles) return { serverSeat: 0, receiverSeat: 0 };
  const r = doublesRoles(state.firstServer, state.firstSeats, info.turns);
  return { serverSeat: r.server.seat, receiverSeat: r.receiver.seat };
}

// 이 포인트의 타격 순서 [{ side, seat } × 4] (복식만)
export function hitOrder(state) {
  const server = { side: state.server, seat: state.serverSeat }, receiver = { side: -state.server, seat: state.receiverSeat };
  return [server, receiver, { side: server.side, seat: 1 - server.seat }, { side: receiver.side, seat: 1 - receiver.seat }];
}

// 다음에 칠 차례인 사람 { side, seat } (복식·서브 대기 또는 랠리 중). 단식이거나 칠 때가 아니면 null
export function expectedHitter(state) {
  if (!state.doubles) return null;
  if (state.phase !== 'waitingServe' && state.phase !== 'serving' && state.phase !== 'rally') return null;
  return hitOrder(state)[state.phase === 'waitingServe' ? 0 : state.hits % 4];
}

// 좌석까지 보는 canHit: 복식이면 차례인 사람만
export function canHitSeat(state, side, seat) {
  if (!canHit(state, side)) return false;
  if (!state.doubles) return true;
  const h = expectedHitter(state);
  return !!h && h.side === side && h.seat === seat;
}

// side 쪽 코트의 "오른쪽 반" (그 쪽에서 상대를 바라본 기준)에 공이 들어갔는가. 가운데 선은 맞는 쪽으로 본다.
export const inRightHalf = (side, x, tol = RULES.CENTER_TOL) => (side < 0 ? x >= -tol : x <= tol);

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

// retoss: 토스한 공을 치지 못했을 때 true면 점수 없이 다시 토스(연습), false면 서브 실점 tossMiss(대전)
export function createRules({ firstServer = -1, bestOf = RULES.BEST_OF, retoss = true, doubles = false, firstSeats = { server: 0, receiver: 0 } } = {}) {
  return {
    doubles,                 // 복식 (9단계)
    firstSeats,              // 이번 게임 첫 서버·첫 리시버의 좌석 (복식)
    serverSeat: doubles ? firstSeats.server : 0,     // 지금 서브하는 사람의 좌석
    receiverSeat: doubles ? firstSeats.receiver : 0, // 지금 받는 사람의 좌석
    hits: 0,                 // 이 포인트의 타격 수 (서브 포함, 복식 순서 계산)
    score: [0, 0],
    games: [0, 0],
    bestOf,
    retoss,
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
  const info = serveInfo(state.score, state.firstServer);
  return {
    ...state, server: info.server, serveCount: info.serveCount, ...serveSeats(state, info), phase: 'waitingServe', lastHitter: 0, bounceSide: 0,
    bouncesOnSide: 0, netTouched: false, returnPending: false, rally: 0, hits: 0, lastResult: null,
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
    const info = serveInfo(score, state.firstServer);
    Object.assign(next, { server: info.server, serveCount: info.serveCount }, serveSeats(state, info)); // 다음 서브권
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
// 복식: 차례가 아닌 사람이 쳤는가 (e.seat가 있을 때만 검사. 서버·클라이언트는 미리 거르므로 방어용)
function wrongSeat(state, e) {
  if (!state.doubles || e.seat === undefined) return false;
  const exp = expectedHitter(state);
  return !!exp && e.seat !== exp.seat;
}

// 다음 서브(또는 다음 게임)를 준비한 상태
function nextServe(state) {
  const base = {
    ...state, phase: 'waitingServe', lastHitter: 0, bounceSide: 0, bouncesOnSide: 0,
    netTouched: false, returnPending: false, rally: 0, hits: 0,
  };
  if (state.lastResult?.gameOver) {
    // 다음 게임: 점수 초기화, 첫 서브권은 지난 게임의 반대
    // 복식(ITTF): 새 첫 서버는 지난 게임의 첫 리시버, 새 첫 리시버는 지난 게임에서 그에게 서브한 사람(= 지난 첫 서버)
    const firstServer = other(state.firstServer);
    const firstSeats = state.doubles ? { server: state.firstSeats.receiver, receiver: state.firstSeats.server } : state.firstSeats;
    return {
      ...base, score: [0, 0], firstServer, firstSeats, server: firstServer, serveCount: 0,
      serverSeat: state.doubles ? firstSeats.server : 0, receiverSeat: state.doubles ? firstSeats.receiver : 0,
    };
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
      if (wrongSeat(state, e)) return point(state, server, 'wrongPlayer');
      return same({ ...state, lastHitter: server, bounceSide: 0, bouncesOnSide: 0, netTouched: false, hits: 1 });
    }
    if (isBounce(e) || e.type === 'floor' || e.type === 'net' || e.type === 'timeout') {
      return state.retoss === false ? point(state, server, 'tossMiss') : noPoint(state, 'retoss');
    }
    return same(state);
  }
  const ownBounced = bouncedOn(state, server);
  switch (e.type) {
    case 'racket': {
      const h = hitterOf(e);
      if (h === server) return point(state, server, 'doubleHit');
      if (wrongSeat(state, e)) return point(state, receiver, 'wrongPlayer');
      // 받는 쪽 코트에 바운드하기 전에 침: 인플레이 공이면 발리(받는 쪽 실점),
      // 코트 밖으로 나가던 공(e.outside)이면 서브의 아웃(서버 실점)
      if (e.outside) return point(state, server, state.netTouched ? 'net' : ownBounced ? 'out' : 'serveNoBounce');
      return point(state, receiver, 'volley');
    }
    case 'bounce': case 'edge':
      if (e.side === server) {
        // 복식: 첫 바운드는 서버 자기 코트의 오른쪽 반이어야 한다
        if (state.doubles && !ownBounced && state.bounceSide === 0 && !inRightHalf(server, e.pos?.x ?? 0)) return point(state, server, 'serveHalf');
        if (!ownBounced && state.bounceSide === 0) return same({ ...state, bounceSide: server, bouncesOnSide: 1 });
        return point(state, server, state.netTouched ? 'net' : 'serveFault'); // 자기 코트에 두 번
      }
      if (!ownBounced) return point(state, server, 'serveNoBounce');
      // 복식: 대각선 — 받는 사람 쪽 코트의 오른쪽 반에 떨어져야 한다 (네트에 닿았어도 틀린 반이면 폴트)
      if (state.doubles && !inRightHalf(receiver, e.pos?.x ?? 0)) return point(state, server, 'serveHalf');
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
      if (wrongSeat(state, e)) return point(state, h, 'wrongPlayer');
      // 바운드 전에 침: 인플레이 공이면 발리(받는 쪽 실점), 코트 밖으로 나가던 공(e.outside)이면 친 쪽의 아웃
      if (!bounced) return e.outside ? point(state, H, state.netTouched ? 'net' : 'out') : point(state, R, 'volley');
      return same({ ...state, lastHitter: R, bounceSide: 0, bouncesOnSide: 0, netTouched: false, returnPending: true, hits: state.hits + 1 });
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
        return same({ ...state, phase: 'serving', lastHitter: 0, bounceSide: 0, bouncesOnSide: 0, netTouched: false, rally: 0, hits: 0, lastResult: null });
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
