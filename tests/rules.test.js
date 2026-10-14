// 3단계 규칙 테스트 (.claude/rules/game-rules.md 검증 테스트 7개 + 보조 테스트)
// 물리 이벤트 형식 { type, side, ... }를 그대로 만들어 rules.js 상태 기계에 넣는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRules, applyEvent, applyEvents, serverFor, gameWinner, startRally, canHit, idx,
} from '../public/shared/rules.js';

// 물리 이벤트 흉내 (physics.js와 같은 형식: { type, t, pos, speed, side })
const ev = (type, side, extra = {}) => ({ type, t: 0, pos: { x: 0, y: 0.5 * side, z: 0 }, speed: 3, side, ...extra });
const bounce = (side) => ev('bounce', side);
const edge = (side) => ev('edge', side);
const net = (side, over = true) => ev('net', side, { over });
const floor = (side) => ev('floor', side);
const hit = (side) => ({ type: 'racket', t: 0, pos: { x: 0, y: 1.5 * side, z: 0.2 }, speed: 8, side, racket: side });
const toss = (side) => ({ type: 'toss', side });
const NEXT = { type: 'next' };

// 정상 서브: 서버 토스 → 침 → 자기 코트 → 네트 넘어 상대 코트
const goodServe = (s) => [toss(s), hit(s), bounce(s), bounce(-s)];
// 서버(server)가 1점을 얻는 포인트: 받는 쪽이 리턴을 못 함 (두 번째 바운드)
const serverWins = (s) => [...goodServe(s), bounce(-s), NEXT];
// 받는 쪽이 1점을 얻는 포인트: 서브가 바로 바닥으로 아웃(자기 코트 바운드 없음)
const receiverWins = (s) => [toss(s), hit(s), floor(-s), NEXT];

// 승자 side가 1점을 얻는 이벤트 목록 (현재 서버 기준)
const pointFor = (state, side) => (state.server === side ? serverWins(side) : receiverWins(state.server));

function play(state, winners) {
  for (const w of winners) state = applyEvents(state, pointFor(state, w)).state;
  return state;
}

// 점수를 a:b로 만든다 (서로 번갈아 득점해 게임이 중간에 끝나지 않게)
function reach(a, b, firstServer = -1) {
  let s = createRules({ firstServer });
  const seq = [];
  let x = 0, y = 0;
  while (x < a || y < b) {
    if (x < a && (x <= y || y >= b)) { seq.push(-1); x++; } else { seq.push(1); y++; }
  }
  s = play(s, seq);
  assert.deepEqual(s.score, [a, b]);
  return s;
}

test('[1] 0:0에서 서브권이 2점마다 정확히 교대한다', () => {
  for (const first of [-1, 1]) {
    let s = createRules({ firstServer: first });
    const servers = [];
    // 득점자를 섞어도 서브권은 총점으로만 정해져야 한다
    const winners = [-1, 1, 1, -1, -1, -1, 1, 1, 1, -1, 1, -1, -1, 1];
    for (const w of winners) {
      assert.equal(s.phase, 'waitingServe');
      servers.push([s.server, s.serveCount]);
      s = play(s, [w]);
    }
    const expected = winners.map((_, i) => [Math.floor(i / 2) % 2 === 0 ? first : -first, i % 2]);
    assert.deepEqual(servers, expected);
    // 서브권자가 아닌 쪽의 토스는 무시된다
    const t = applyEvent(createRules({ firstServer: first }), toss(-first));
    assert.equal(t.state.phase, 'waitingServe');
  }
});

test('[2] 10:10 이후 1점마다 서브권이 교대하고, 2점 차가 나야 게임이 끝난다', () => {
  let s = reach(10, 10);
  assert.equal(s.phase, 'waitingServe');
  const servers = [s.server];
  // 듀스에서 번갈아 득점: 11:10, 11:11, 12:11, 12:12 … 끝나지 않는다
  for (const w of [-1, 1, -1, 1, 1, -1, -1, 1]) {
    s = play(s, [w]);
    assert.equal(s.phase, 'waitingServe', `${s.score} 에서 끝나면 안 됨`);
    assert.equal(s.winner, 0);
    assert.equal(s.serveCount, 0);
    servers.push(s.server);
  }
  for (let i = 1; i < servers.length; i++) assert.equal(servers[i], -servers[i - 1], `듀스 ${i}번째 점수 뒤 서브 교대`);
  assert.deepEqual(s.score, [14, 14]);
  // 한쪽이 연속 2점 → 16:14로 끝
  s = play(s, [1]);
  assert.equal(s.phase, 'waitingServe');
  const r = applyEvents(s, pointFor(s, 1).slice(0, -1)); // next 없이 결과만
  assert.deepEqual(r.state.score, [14, 16]);
  assert.equal(r.state.phase, 'gameOver');
  assert.equal(r.state.winner, 1);
  assert.equal(r.results.at(-1).gameOver, true);
  assert.equal(r.results.at(-1).matchOver, true);
});

test('[3] 11:9에서 게임이 끝나고, 11:10에서는 끝나지 않는다', () => {
  const s = reach(10, 9);
  const end = applyEvents(s, pointFor(s, -1).slice(0, -1));
  assert.deepEqual(end.state.score, [11, 9]);
  assert.equal(end.state.phase, 'gameOver');
  assert.equal(end.state.winner, -1);
  assert.equal(gameWinner([11, 9]), -1);

  const d = reach(10, 10);
  const no = applyEvents(d, pointFor(d, -1).slice(0, -1));
  assert.deepEqual(no.state.score, [11, 10]);
  assert.equal(no.state.phase, 'pointOver');
  assert.equal(no.state.winner, 0);
  assert.equal(gameWinner([11, 10]), 0);
  assert.equal(gameWinner([9, 11]), 1);
  assert.equal(gameWinner([12, 10]), -1);
  // 게임이 끝난 뒤에는 어떤 이벤트에도 상태가 바뀌지 않는다
  const after = applyEvents(end.state, [NEXT, toss(-1), hit(-1), bounce(1)]);
  assert.deepEqual(after.state, end.state);
  assert.equal(after.results.length, 0);
});

test('[4] 네트 맞고 들어간 서브는 렛이 되어 점수가 그대로이다', () => {
  const s0 = reach(3, 2);
  const server = s0.server;
  const { state, results } = applyEvents(s0, [toss(server), hit(server), bounce(server), net(server, true), bounce(-server)]);
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'let');
  assert.equal(results[0].reason, 'let');
  assert.deepEqual(state.score, [3, 2]);
  const again = applyEvent(state, NEXT).state;
  assert.equal(again.phase, 'waitingServe');
  assert.equal(again.server, server, '렛 뒤에도 같은 사람이 다시 서브');
  assert.equal(again.serveCount, s0.serveCount);

  // 네트에 닿고 들어가지 않은 서브는 실점
  const out = applyEvents(s0, [toss(server), hit(server), bounce(server), net(server, false), bounce(server)]);
  assert.equal(out.results[0].loser, server);
  assert.equal(out.results[0].reason, 'net');
  const out2 = applyEvents(s0, [toss(server), hit(server), bounce(server), net(server, true), floor(-server)]);
  assert.equal(out2.results[0].loser, server);
  assert.equal(out2.results[0].reason, 'net');
  // 네트 없이 정상으로 들어간 서브는 랠리로 이어진다
  const ok = applyEvents(s0, goodServe(server));
  assert.equal(ok.results.length, 0);
  assert.equal(ok.state.phase, 'rally');
});

test('[5] 자기 코트 바운드 없는 서브는 실점이다', () => {
  for (const server of [-1, 1]) {
    const s = createRules({ firstServer: server });
    // 바로 상대 코트에 떨어짐
    const a = applyEvents(s, [toss(server), hit(server), bounce(-server)]);
    assert.equal(a.results[0].loser, server);
    assert.equal(a.results[0].reason, 'serveNoBounce');
    assert.deepEqual(a.state.score[idx(-server)], 1);
    // 아무 데도 닿지 않고 바닥으로
    const b = applyEvents(s, [toss(server), hit(server), floor(-server)]);
    assert.equal(b.results[0].loser, server);
    // 자기 코트에 두 번 (넘어가지 못함)
    const c = applyEvents(s, [toss(server), hit(server), bounce(server), bounce(server)]);
    assert.equal(c.results[0].loser, server);
    // 토스한 공을 못 치고 떨어뜨리면 점수 없이 다시 토스
    const d = applyEvents(s, [toss(server), floor(server)]);
    assert.equal(d.results[0].type, 'retoss');
    assert.deepEqual(d.state.score, [0, 0]);
  }
});

test('[6] 투 바운드, 발리, 아웃, 연속 타격이 각각 올바른 쪽의 실점이 된다', () => {
  for (const server of [-1, 1]) {
    const R = -server;
    const base = applyEvents(createRules({ firstServer: server }), goodServe(server)).state;
    assert.equal(base.phase, 'rally');
    const check = (events, loser, reason) => {
      const { results, state } = applyEvents(base, events);
      assert.equal(results.length, 1, `${reason}: 결과 1개`);
      assert.equal(results[0].loser, loser, `${reason}: 실점자`);
      assert.equal(results[0].winner, -loser);
      assert.equal(results[0].reason, reason);
      assert.equal(state.score[idx(-loser)], 1);
      assert.equal(state.score[idx(loser)], 0);
    };
    // 투 바운드: 받는 쪽 코트에 두 번 → 받는 쪽 실점
    check([bounce(R)], R, 'twoBounce');
    // 받은 쪽이 리턴 → 서버 쪽 코트에 두 번 → 서버 실점
    check([hit(R), bounce(server), bounce(server)], server, 'twoBounce');
    // 발리: 리턴이 서버 코트에 바운드하기 전에 서버가 침 → 서버 실점
    check([hit(R), net(R, true), hit(server)], server, 'volley');
    // 서브를 받는 쪽 코트에 바운드하기 전에 침 → 받는 쪽 실점
    const v = applyEvents(createRules({ firstServer: server }), [toss(server), hit(server), bounce(server), hit(R)]);
    assert.equal(v.results[0].loser, R);
    assert.equal(v.results[0].reason, 'volley');
    // 코트 밖 공(나가던 공)을 바운드 전에 건드림 → 발리가 아니라 보낸 쪽의 아웃
    check([hit(R), { ...hit(server), outside: true }], R, 'out');
    check([hit(R), net(R, true), { ...hit(server), outside: true }], R, 'net');
    const vo = applyEvents(createRules({ firstServer: server }), [toss(server), hit(server), bounce(server), { ...hit(R), outside: true }]);
    assert.equal(vo.results[0].loser, server, '나가던 서브를 건드려도 서버 실점');
    assert.equal(vo.results[0].reason, 'out');
    // 아웃: 리턴이 상대 코트에 닿지 않고 바닥 → 친 쪽(R) 실점
    check([hit(R), floor(server)], R, 'out');
    // 리턴이 네트에 걸려 자기 코트로 → 친 쪽 실점 (네트)
    check([hit(R), net(R, false), bounce(R)], R, 'net');
    // 리턴이 자기 코트에 떨어짐 → 친 쪽 실점
    check([hit(R), bounce(R)], R, 'ownCourt');
    // 정상 바운드한 공을 못 받아 바닥 → 받을 쪽 실점
    check([hit(R), bounce(server), floor(server)], server, 'miss');
    // 연속 타격: 같은 사람이 두 번
    check([hit(R), hit(R)], R, 'doubleHit');
    // 서브한 사람이 자기 서브를 다시 침
    const dh = applyEvents(createRules({ firstServer: server }), [toss(server), hit(server), hit(server)]);
    assert.equal(dh.results[0].loser, server);
    assert.equal(dh.results[0].reason, 'doubleHit');
  }
});

test('[7] 모서리에 맞은 공은 유효하다', () => {
  const server = -1, R = 1;
  // 서브가 상대 모서리에 맞음 → 랠리 계속
  const a = applyEvents(createRules({ firstServer: server }), [toss(server), hit(server), bounce(server), edge(R)]);
  assert.equal(a.results.length, 0);
  assert.equal(a.state.phase, 'rally');
  // 랠리 중 모서리 → 받을 쪽이 못 받으면 친 쪽 득점
  const base = applyEvents(createRules({ firstServer: server }), goodServe(server)).state;
  const b = applyEvents(base, [hit(R), edge(server), floor(server)]);
  assert.equal(b.results[0].winner, R);
  assert.equal(b.results[0].reason, 'miss');
  // 모서리 뒤 리턴도 정상 진행
  const c = applyEvents(base, [hit(R), edge(server), hit(server), bounce(R)]);
  assert.equal(c.results.length, 0);
  assert.equal(c.state.rally, 2);
  // 같은 쪽 모서리에 두 번째로 맞으면 투 바운드
  const d = applyEvents(base, [hit(R), bounce(server), edge(server)]);
  assert.equal(d.results[0].reason, 'twoBounce');
  assert.equal(d.results[0].loser, server);
});

test('보조: 상태 기계는 이전 상태를 바꾸지 않는다 (순수 함수)', () => {
  const s = createRules();
  const copy = JSON.parse(JSON.stringify(s));
  applyEvents(s, serverWins(-1));
  assert.deepEqual(s, copy);
});

test('보조: 칠 수 있는 사람 (canHit)과 연습용 랠리 시작', () => {
  let s = createRules({ firstServer: 1 });
  assert.equal(canHit(s, 1), false);
  s = applyEvent(s, toss(1)).state;
  assert.equal(canHit(s, 1), true);
  assert.equal(canHit(s, -1), false);
  s = applyEvent(s, hit(1)).state;
  assert.equal(canHit(s, 1), false);
  assert.equal(canHit(s, -1), true);
  const r = startRally(createRules(), 1);
  assert.equal(r.phase, 'rally');
  assert.equal(canHit(r, -1), true);
  const lost = applyEvents(r, [bounce(-1), floor(-1)]);
  assert.equal(lost.results[0].loser, -1);
  assert.equal(lost.results[0].reason, 'miss');
});

test('보조: 서브권 공식 serverFor', () => {
  assert.deepEqual(serverFor([0, 0], -1), { server: -1, serveCount: 0 });
  assert.deepEqual(serverFor([1, 0], -1), { server: -1, serveCount: 1 });
  assert.deepEqual(serverFor([1, 1], -1), { server: 1, serveCount: 0 });
  assert.deepEqual(serverFor([10, 10], -1), { server: -1, serveCount: 0 });
  assert.deepEqual(serverFor([11, 10], -1), { server: 1, serveCount: 0 });
  assert.deepEqual(serverFor([11, 11], -1), { server: -1, serveCount: 0 });
});

test('보조: 3게임 2선승제 구조 (bestOf = 3)', () => {
  let s = createRules({ firstServer: -1, bestOf: 3 });
  const win = (st, side) => {
    for (let i = 0; i < 11; i++) {
      const r = applyEvents(st, pointFor(st, side).slice(0, -1));
      st = r.state;
      if (st.phase === 'pointOver') st = applyEvent(st, NEXT).state;
    }
    return st;
  };
  s = win(s, -1);
  assert.deepEqual(s.games, [1, 0]);
  assert.deepEqual(s.score, [0, 0], '다음 게임은 0:0');
  assert.equal(s.server, 1, '다음 게임 첫 서브는 반대쪽');
  assert.equal(s.phase, 'waitingServe');
  s = win(s, 1);
  assert.deepEqual(s.games, [1, 1]);
  s = win(s, -1);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.winner, -1);
});
