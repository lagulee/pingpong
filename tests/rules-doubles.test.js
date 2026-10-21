// 9단계 복식 규칙: 서브 4순환(ITTF), 타격 순서, 대각선 서브 코트, 듀스, 다음 게임 좌석, 단식 불변.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRules, applyEvent, serverFor, serveInfo, doublesRoles, hitOrder, expectedHitter, canHitSeat, canHit, inRightHalf,
} from '../public/shared/rules.js';

const ev = (type, o = {}) => ({ type, ...o });
const racket = (side, seat) => ev('racket', { side, racket: side, seat });
const bounce = (side, x = 0.3) => ev('bounce', { side, pos: { x, y: 0, z: 0 } });
const run = (state, events) => {
  let result = null;
  for (const e of events) { const r = applyEvent(state, e); state = r.state; if (r.result) result = r.result; }
  return { state, result };
};
// 정상 서브 한 번 (서버 side의 오른쪽 반 → 받는 쪽 오른쪽 반). 서브 코트 x: side −1 오른쪽 = +x, side +1 오른쪽 = −x
const serveOk = (s) => [
  ev('toss', { side: s.server }), racket(s.server, s.serverSeat),
  bounce(s.server, s.server < 0 ? 0.3 : -0.3), bounce(-s.server, -s.server < 0 ? 0.3 : -0.3),
];
const dbl = (o = {}) => createRules({ doubles: true, retoss: false, ...o });

test('[9] 서브 4순환: s0→r0, r0→s0의 짝, s0의 짝→r0의 짝, r0의 짝→s0 (2점마다)', () => {
  const roles = [0, 1, 2, 3, 4].map((n) => doublesRoles(-1, { server: 0, receiver: 0 }, n));
  assert.deepEqual(roles[0], { server: { side: -1, seat: 0 }, receiver: { side: 1, seat: 0 } });
  assert.deepEqual(roles[1], { server: { side: 1, seat: 0 }, receiver: { side: -1, seat: 1 } });
  assert.deepEqual(roles[2], { server: { side: -1, seat: 1 }, receiver: { side: 1, seat: 1 } });
  assert.deepEqual(roles[3], { server: { side: 1, seat: 1 }, receiver: { side: -1, seat: 0 } });
  assert.deepEqual(roles[4], roles[0]);
  // 좌석을 바꿔 시작해도 같은 규칙
  const r = doublesRoles(1, { server: 1, receiver: 0 }, 1);
  assert.deepEqual(r, { server: { side: -1, seat: 0 }, receiver: { side: 1, seat: 0 } });
});

test('[9] 점수가 나는 대로 서버·리시버가 2점마다 바뀌고 팀은 번갈아 서브한다', () => {
  let s = dbl();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push([s.server, s.serverSeat, s.receiverSeat]);
    // 서버가 실점하는 서브 폴트로 점수를 낸다 (받는 팀 득점)
    const r = run(s, [ev('toss', { side: s.server }), racket(s.server, s.serverSeat), ev('floor')]);
    s = applyEvent(r.state, ev('next')).state;
  }
  // 점수: 서버 팀이 계속 실점 → 서브권은 2점마다 팀이 바뀐다
  assert.equal(seen[0][0], -1);
  assert.deepEqual(seen.slice(0, 4).map((x) => x[0]), [-1, -1, 1, 1]);
  // 서브 차례(2점 단위)마다 4순환 좌석
  const turns = [0, 2, 4, 6].map((i) => seen[i]);
  const expect = [0, 1, 2, 3].map((n) => doublesRoles(-1, { server: 0, receiver: 0 }, n));
  turns.forEach((t, k) => assert.deepEqual([t[0], t[1], t[2]], [expect[k].server.side, expect[k].server.seat, expect[k].receiver.seat]));
  // 같은 2점 안에서는 같은 서버·리시버
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(seen[2], seen[3]);
});

test('[9] 타격 순서: 서버 → 리시버 → 서버의 짝 → 리시버의 짝 → 서버 …, 차례가 아닌 사람은 못 친다', () => {
  let s = dbl();
  s = applyEvent(s, ev('toss', { side: -1 })).state;
  const order = hitOrder(s);
  assert.deepEqual(order.map((o) => [o.side, o.seat]), [[-1, 0], [1, 0], [-1, 1], [1, 1]]);
  assert.deepEqual(expectedHitter(s), { side: -1, seat: 0 });
  assert.ok(canHitSeat(s, -1, 0));
  assert.ok(!canHitSeat(s, -1, 1), '서버의 짝은 아직 아님');
  assert.ok(!canHitSeat(s, 1, 0), '아직 서브 전');
  // 서브 → 리시버 차례
  s = run(s, [racket(-1, 0), bounce(-1, 0.3), bounce(1, -0.3)]).state;
  assert.equal(s.phase, 'rally');
  assert.ok(canHitSeat(s, 1, 0) && !canHitSeat(s, 1, 1));
  // 리턴 → 서버의 짝 차례
  s = run(s, [racket(1, 0), bounce(-1, 0.2)]).state;
  assert.deepEqual(expectedHitter(s), { side: -1, seat: 1 });
  assert.ok(canHitSeat(s, -1, 1) && !canHitSeat(s, -1, 0));
  s = run(s, [racket(-1, 1), bounce(1, 0)]).state;
  assert.deepEqual(expectedHitter(s), { side: 1, seat: 1 });
  s = run(s, [racket(1, 1), bounce(-1, 0)]).state;
  assert.deepEqual(expectedHitter(s), { side: -1, seat: 0 }, '한 바퀴 돌아 서버');
  // 단식 규칙에는 영향 없음
  assert.equal(expectedHitter(createRules()), null);
});

test('[9] 틀린 사람이 치면 그 팀의 실점 (wrongPlayer)', () => {
  let s = dbl();
  let r = run(s, [ev('toss', { side: -1 }), racket(-1, 1)]); // 서버는 seat 0
  assert.equal(r.result.reason, 'wrongPlayer');
  assert.equal(r.result.winner, 1);
  s = run(dbl(), [ev('toss', { side: -1 }), ...[racket(-1, 0), bounce(-1, 0.3), bounce(1, -0.3)]]).state;
  r = run(s, [racket(1, 1)]); // 리시버는 seat 0
  assert.equal(r.result.reason, 'wrongPlayer');
  assert.equal(r.result.winner, -1);
});

test('[9] 서브는 대각선: 서버 코트 오른쪽 반 → 받는 쪽 오른쪽 반, 틀리면 폴트(serveHalf)', () => {
  assert.ok(inRightHalf(-1, 0.5) && !inRightHalf(-1, -0.5));
  assert.ok(inRightHalf(1, -0.5) && !inRightHalf(1, 0.5));
  assert.ok(inRightHalf(-1, 0) && inRightHalf(1, 0) && inRightHalf(-1, -0.002), '가운데 선은 맞는 쪽');
  const start = (extra) => run(dbl(), [ev('toss', { side: -1 }), racket(-1, 0), ...extra]);
  // 정상
  let r = start([bounce(-1, 0.3), bounce(1, -0.3)]);
  assert.equal(r.state.phase, 'rally');
  assert.equal(r.result, null);
  // 자기 코트 왼쪽 반 → 폴트
  r = start([bounce(-1, -0.3)]);
  assert.equal(r.result.reason, 'serveHalf');
  assert.equal(r.result.winner, 1);
  // 받는 쪽 코트 같은 쪽(대각선이 아님) → 폴트
  r = start([bounce(-1, 0.3), bounce(1, 0.3)]);
  assert.equal(r.result.reason, 'serveHalf');
  // 네트에 닿고 틀린 반 → 렛이 아니라 폴트
  r = start([bounce(-1, 0.3), ev('net'), bounce(1, 0.3)]);
  assert.equal(r.result.reason, 'serveHalf');
  // 네트에 닿고 맞는 반 → 렛
  r = start([bounce(-1, 0.3), ev('net'), bounce(1, -0.3)]);
  assert.equal(r.result.type, 'let');
  // 서버가 +1 쪽이면 거울 반대
  let s = dbl({ firstServer: 1 });
  r = run(s, [ev('toss', { side: 1 }), racket(1, 0), bounce(1, -0.3), bounce(-1, 0.3)]);
  assert.equal(r.state.phase, 'rally');
  // 랠리 중에는 어느 반이든 상관없다
  r = run(r.state, [racket(-1, 0), bounce(1, 0.6), racket(1, 1), bounce(-1, -0.6)]);
  assert.equal(r.result, null);
});

test('[9] 단식 규칙은 그대로: 서브 반 검사·좌석 검사 없음', () => {
  const s = createRules({ retoss: false });
  const r = run(s, [ev('toss', { side: -1 }), racket(-1, 0), bounce(-1, -0.5), bounce(1, 0.5)]);
  assert.equal(r.state.phase, 'rally');
  assert.equal(r.result, null);
  assert.ok(canHit(r.state, 1));
  assert.equal(canHitSeat(r.state, 1, 1), true, '단식은 좌석을 보지 않는다');
  assert.deepEqual(serverFor([3, 2], -1), { server: -1, serveCount: 1 });
});

test('[9] 듀스(10:10 이후)에는 1점마다 서브 차례가 넘어가 서버가 4명을 차례로 돈다', () => {
  const seats = [];
  for (const score of [[10, 10], [11, 10], [11, 11], [12, 11], [12, 12], [13, 12]]) {
    const info = serveInfo(score, -1);
    seats.push({ ...doublesRoles(-1, { server: 0, receiver: 0 }, info.turns), turns: info.turns });
  }
  // 10:10 이전(0~19점)은 2점마다 한 차례(최대 9번째), 듀스부터는 점수마다 한 차례씩 늘어난다
  assert.deepEqual(seats.map((x) => x.turns), [10, 11, 12, 13, 14, 15]);
  // 연속한 4번의 서브 차례는 서버가 4명 모두 다르다
  const four = seats.slice(0, 4).map((x) => `${x.server.side}:${x.server.seat}`);
  assert.equal(new Set(four).size, 4);
  // 서버 팀은 매번 바뀐다
  for (let i = 1; i < seats.length; i++) assert.notEqual(seats[i].server.side, seats[i - 1].server.side);
  // 서버의 다음 리시버도 4순환(리시버도 4명 모두)
  assert.equal(new Set(seats.slice(0, 4).map((x) => `${x.receiver.side}:${x.receiver.seat}`)).size, 4);
});

test('[9] 다음 게임: 첫 서브는 상대 팀, 첫 서버 = 지난 게임의 첫 리시버, 첫 리시버 = 지난 첫 서버', () => {
  let s = dbl({ bestOf: 3, firstSeats: { server: 1, receiver: 0 } });
  assert.equal(s.serverSeat, 1);
  // 상대 팀(+1)이 10점인 상태에서 서버 팀(−1)이 친 공이 아웃 → +1이 11점으로 게임을 딴다
  s = run({ ...s, score: [4, 10], phase: 'rally', lastHitter: -1, bounceSide: 0, hits: 4 }, [ev('floor')]).state;
  assert.equal(s.lastResult.gameOver, true);
  s = applyEvent(s, ev('next')).state;
  assert.equal(s.firstServer, 1);
  assert.deepEqual(s.firstSeats, { server: 0, receiver: 1 });
  assert.equal(s.server, 1);
  assert.equal(s.serverSeat, 0);
  assert.equal(s.receiverSeat, 1);
  assert.deepEqual(s.score, [0, 0]);
  assert.deepEqual(s.games, [0, 1]);
});

// ── 복식 서브 조준: 서버 기준으로 자기 코트 오른쪽(x ≥ 0)에 튀고 상대 코트 왼쪽(x ≤ 0)에 떨어진다 ──
import { createAI, createRally, createPlayer, stepMatch, tossBall, serveGuide } from '../public/js/ai.js';
import { createRng } from '../public/js/input.js';
import { toLocal } from '../public/shared/physics.js';
import { SERVE, SERVE_GUIDE, TUNABLE } from '../public/shared/constants.js';

test('[9] 복식 서브 가이드·조준: 오른쪽 반에서 토스하면 어느 쪽 서버든 대각선으로 들어간다', () => {
  for (const side of [-1, 1]) for (const button of [null, 'drive', 'cut', 'side']) {
    for (const x of [0.2, 0.3, 0.4, SERVE.TOSS_X_MAX]) {
      const g = serveGuide(side, x, TUNABLE, button, undefined, true);
      assert.ok(g, `side ${side} ${button} x ${x}: 대각선 서브가 가능하다`);
      const own = toLocal(g.bounces[0], side), land = toLocal(g.bounces[1], side);
      assert.ok(own.x >= 0, `첫 바운드는 내 코트 오른쪽 (x ${own.x.toFixed(2)})`);
      assert.ok(land.x <= 0, `착지는 상대 코트의 받는 사람 오른쪽 = 서버 기준 왼쪽 (x ${land.x.toFixed(2)})`);
    }
  }
});

test('[9] 왼쪽 반에서 토스하면 첫 바운드가 왼쪽 반이라 서브 폴트다 (서버 기준 x < 0에서 시작하는 서브는 대각선이 안 된다)', () => {
  const g = serveGuide(-1, -0.5, TUNABLE, 'drive', undefined, true);
  // 가이드가 없거나(조준 실패), 있더라도 첫 바운드가 왼쪽 반이어서 규칙상 폴트다
  assert.ok(!g || toLocal(g.bounces[0], -1).x < SERVE.DIAG_OWN_MIN);
});

test('[9] 복식 로봇 서브: 토스 x는 오른쪽 반, 규칙 판정에서 서브 폴트(serveHalf) 없이 랠리가 시작된다', () => {
  let bad = 0, n = 0;
  for (let seed = 1; seed <= 12; seed++) for (const side of [-1, 1]) {
    const robot = createAI(side, 'NORMAL', createRng(seed + 4), 0);
    const other = createAI(-side, 'NORMAL', createRng(seed + 40), 0);
    const mates = { [side]: createPlayer(side, 1), [-side]: createPlayer(-side, 1) };
    const roster = { [`${side}:0`]: robot.player, [`${-side}:0`]: other.player, [`${side}:1`]: mates[side], [`${-side}:1`]: mates[-side] };
    const game = createRally({
      players: { [side]: robot.player, [-side]: other.player }, ais: [robot, other], rng: createRng(seed), firstServer: side,
      local: [side, -side], retoss: false, doubles: true, roster,
    });
    for (let i = 0; i < 240 * 12 && !game.results.length && game.rules.phase !== 'rally'; i++) stepMatch(game);
    n++;
    if (game.results.some((r) => r.reason === 'serveHalf' || r.reason === 'serveFault' || r.reason === 'serveNoBounce')) bad++;
    else assert.equal(game.rules.phase === 'rally' || game.results.length > 0, true);
  }
  assert.ok(bad <= 2, `서브 폴트 ${bad}/${n}`); // 타이밍 오차로 첫 바운드가 가운데 선 근처에서 틀리는 서브는 사람처럼 가끔 있다
});
