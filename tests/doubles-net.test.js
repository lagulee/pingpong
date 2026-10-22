// 9단계 복식 대전: 4인 방(팀 선택·좌석), 서버의 차례·좌석 검증, 가상 클라이언트 4개로 한 게임, 기권·재접속·관전.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './net-harness.js';
import { cloneMatch, advanceMatch } from '../public/shared/host.js';
import { doublesRoles, serveInfo, expectedHitter } from '../public/shared/rules.js';
import { ballToLocal } from '../public/shared/physics.js';

function lobbyWorld({ lat = 40, seed = 3, code = 'DBLE' } = {}) {
  const w = createWorld({ seed });
  w.code = code;
  const A = w.addAI({ lat, clockOffset: 300, create: true, mode: 'doubles', nickname: 'A', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  return { w, A, host: w.room.host };
}
function fourWorld(opts = {}) {
  const { w, A, host } = lobbyWorld(opts);
  const lat = opts.lat ?? 40;
  const B = w.addAI({ lat, clockOffset: -100, nickname: 'B', aiSeed: 22 });
  const C = w.addAI({ lat, clockOffset: 50, nickname: 'C', aiSeed: 33 });
  const D = w.addAI({ lat, clockOffset: -20, nickname: 'D', aiSeed: 44 });
  const all = [A, B, C, D];
  w.run(() => all.every((x) => x.client.status === 'playing'), { maxMs: 10_000 });
  return { w, host, all, A, B, C, D };
}
const wsOf = (w, p) => w.ctx.getWebSockets().find((x) => x.att.id === p.conn);

test('[9] 복식 방: 만든 사람이 모드를 정하고, 들어온 순서로 왼쪽·오른쪽·왼쪽·오른쪽 팀에 앉고, 5번째는 full', () => {
  const { w, A, host } = lobbyWorld();
  assert.equal(host.mode, 'doubles');
  const B = w.addAI({ lat: 40, nickname: 'B', aiSeed: 22 });
  const C = w.addAI({ lat: 40, nickname: 'C', aiSeed: 33 });
  const D = w.addAI({ lat: 40, nickname: 'D', aiSeed: 44 });
  w.run(() => [B, C, D].every((x) => x.client.status === 'waiting'), { maxMs: 5000 });
  assert.deepEqual([A, B, C, D].map((x) => [x.client.me, x.client.seat, x.client.mode]), [[-1, 0, 'doubles'], [1, 0, 'doubles'], [-1, 1, 'doubles'], [1, 1, 'doubles']]);
  const E = w.addAI({ lat: 40, nickname: 'E', aiSeed: 55 });
  w.run(() => E.client.status === 'error', { maxMs: 3000 });
  assert.equal(E.client.errorCode, 'full');
});

test('[9] 단식 방은 그대로 2명, 셋째는 full (mode를 안 정하면 단식)', () => {
  const w = createWorld({ seed: 2 });
  w.code = 'SING';
  const A = w.addAI({ lat: 40, create: true, nickname: 'A', aiSeed: 1 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  w.addAI({ lat: 40, nickname: 'B', aiSeed: 2 });
  const C = w.addAI({ lat: 40, nickname: 'C', aiSeed: 3 });
  w.run(() => C.client.status === 'error', { maxMs: 3000 });
  assert.equal(C.client.errorCode, 'full');
  assert.equal(w.room.host.mode, 'singles');
});

test('[9] 대기실에서 팀 옮기기: 빈 자리가 있을 때만, 옮기면 자동으로 다시 준비하고, 4명이 모두 준비해야 시작한다', () => {
  const { w, A, host } = lobbyWorld({ seed: 5 });
  const B = w.addAI({ lat: 40, nickname: 'B', aiSeed: 22 });
  const C = w.addAI({ lat: 40, nickname: 'C', aiSeed: 33 });
  w.run(() => [B, C].every((x) => x.client.status === 'waiting'), { maxMs: 5000 });
  // A(−1 seat0), B(+1 seat0), C(−1 seat1) → C가 오른쪽으로
  C.client.setTeam(1);
  w.run(() => host.teamOf(1).length === 2, { maxMs: 2000 });
  assert.equal(host.teamOf(-1).length, 1);
  assert.deepEqual(host.teamOf(1).map((p) => [p.nick, p.seat]), [['B', 0], ['C', 1]]);
  w.run(() => C.client.me === 1 && C.client.seat === 1, { maxMs: 1000 });
  assert.deepEqual([C.client.me, C.client.seat], [1, 1], '옮긴 사람에게 새 자리를 알린다');
  // 가득 찬 쪽으로는 못 옮긴다
  A.client.setTeam(1);
  w.run(() => false, { maxMs: 500 });
  assert.equal(host.teamOf(-1).length, 1);
  assert.equal(A.client.me, -1);
  // 옮긴 사람은 알아서 다시 준비한다 (준비는 옮기면 풀린다)
  w.run(() => host.teamOf(1).find((p) => p.nick === 'C').ready, { maxMs: 2000 });
  // 3명으로는 시작하지 않고, 넷째가 들어와 준비하면 시작한다
  w.run(() => host.phase === 'playing', { maxMs: 2000 });
  assert.equal(host.phase, 'lobby');
  const D = w.addAI({ lat: 40, nickname: 'D', aiSeed: 44 });
  w.run(() => [A, B, C, D].every((x) => x.client.status === 'playing'), { maxMs: 10_000 });
  assert.equal(host.phase, 'playing');
  assert.deepEqual(host.teamOf(-1).map((p) => p.nick).sort(), ['A', 'D']);
  assert.deepEqual(host.teamOf(1).map((p) => p.nick).sort(), ['B', 'C']);
});

test('[9] 대기실에서 앞 좌석이 나가면 같은 팀의 남은 사람이 seat 0으로 당겨지고 본인에게 알려 준다', () => {
  const { w, A, host } = lobbyWorld({ seed: 8 });
  const B = w.addAI({ lat: 40, nickname: 'B', aiSeed: 22 });
  const C = w.addAI({ lat: 40, nickname: 'C', aiSeed: 33 });
  w.run(() => [B, C].every((x) => x.client.status === 'waiting'), { maxMs: 5000 });
  assert.equal(C.client.seat, 1);
  A.client.leave();
  w.run(() => host.teamOf(-1).length === 1 && host.teamOf(-1)[0].seat === 0, { maxMs: 3000 });
  assert.equal(host.teamOf(-1)[0].nick, 'C');
  w.run(() => C.client.seat === 0, { maxMs: 1000 });
  assert.equal(C.client.seat, 0);
  assert.equal(C.client.me, -1);
});

test('[9] 한 게임(11점 단판)을 4명이 끝까지: 서버·네 클라이언트 점수·득점 순서 일치, 서브 순서는 ITTF 4순환, 거부 0', () => {
  const { w, host, all } = fourWorld({ seed: 3 });
  const servers = []; // 토스 때 서버의 서브 좌석 기록
  let seen = 0;
  const proceed = () => all.every((x) => x.client.status === 'over');
  const origRun = w.run;
  // 한 판이 끝날 때까지, 토스 직전마다 서브권자(팀·좌석)와 점수를 기록
  w.run(() => {
    const r = host.game.rules;
    if (r.phase === 'serving' && r.lastHitter === 0 && host.game.results.length !== seen) {
      seen = host.game.results.length;
      servers.push({ n: serveInfo(r.score, r.firstServer).turns, side: r.server, seat: r.serverSeat, rec: r.receiverSeat });
    }
    return proceed();
  }, { maxMs: 40 * 60_000 });
  assert.ok(proceed(), '경기가 끝났다');
  assert.ok(host.game.rules.score.some((s) => s >= 11));
  const results = host.game.results;
  for (const x of all) {
    assert.equal(x.rejects.length, 0, `${x.client.me}:${x.client.seat} 거부 ${JSON.stringify(x.rejects[0])}`);
    assert.equal(x.client.stats.corrected, 0, '잠정 판정이 서버와 같다');
    assert.equal(x.points.length, results.length);
    x.points.forEach((p, i) => assert.ok(p.winner === results[i].winner && p.reason === results[i].reason && p.score.join() === results[i].score.join(), `득점 ${i}`));
    assert.deepEqual(x.client.serverRules.score, host.game.rules.score);
    assert.equal(x.client.endMsg.winner, host.game.rules.winner);
  }
  // 서브 순서: 토스 순간의 (서버 팀·좌석)이 서브 차례 번호의 4순환과 같다
  for (const s of servers) {
    const r = doublesRoles(host.firstServer, { server: 0, receiver: 0 }, s.n);
    assert.deepEqual([s.side, s.seat, s.rec], [r.server.side, r.server.seat, r.receiver.seat], `서브 차례 ${s.n}`);
  }
  assert.ok(new Set(servers.map((s) => `${s.side}:${s.seat}`)).size === 4, '네 사람이 모두 서브했다');
  console.log(`# 복식 한 게임: ${host.game.rules.score.join(':')}, 득점 ${results.length}, 서브한 사람 ${new Set(servers.map((s) => `${s.side}:${s.seat}`)).size}명`);
});

test('[9] 서버 검증: 차례가 아닌 좌석의 hit·toss는 turn으로 거부되고 경기 상태는 그대로', () => {
  const { w, host, all } = fourWorld({ seed: 4 });
  w.run(() => host.game.rules.phase === 'serving' && host.game.rules.lastHitter === 0, { maxMs: 10_000 });
  const r0 = host.game.rules;
  const server = host.playerAt(r0.server, r0.serverSeat);
  const mate = host.playerAt(r0.server, 1 - r0.serverSeat);
  const sim = cloneMatch(host.game);
  advanceMatch(sim, host.matchT());
  const loc = ballToLocal(sim.ball, r0.server);
  const good = (seq) => ({
    type: 'serve', seq, t: sim.ball.t, pos: { ...sim.ball.pos }, vel: { x: 0, y: r0.server * -4, z: 1 }, spin: { x: 10, y: 0, z: 0 },
    shotType: 'drive', racket: { x: loc.pos.x, z: loc.pos.z },
  });
  const before = JSON.stringify(host.game.rules);
  // 서브할 차례가 아닌 같은 팀 동료가 서브를 보냄
  w.room.webSocketMessage(wsOf(w, mate), JSON.stringify(good(701)));
  // 상대 팀 누구든 보냄
  const foes = [host.slots[-r0.server], host.mates[-r0.server]];
  for (const [i, f] of foes.entries()) w.room.webSocketMessage(wsOf(w, f), JSON.stringify(good(710 + i)));
  assert.equal(JSON.stringify(host.game.rules), before);
  w.run(() => false, { maxMs: 300 });
  const rejected = (p) => all.find((x) => x.client.me === p.side && x.client.seat === p.seat).rejects.map((m) => [m.seq, m.reason]);
  assert.deepEqual(rejected(mate), [[701, 'turn']]);
  assert.ok(rejected(foes[0]).some(([s, r]) => s === 710 && r === 'turn'));
  // 올바른 서버(좌석)의 서브는 통과한다
  const okMsg = good(720);
  w.room.webSocketMessage(wsOf(w, server), JSON.stringify(okMsg));
  assert.notEqual(JSON.stringify(host.game.rules), before, '서버 좌석의 서브는 받아들여졌다');
  // 랠리 중 순서: 리시버 → 서버의 짝 → 리시버의 짝
  assert.deepEqual(expectedHitter(host.game.rules), { side: -r0.server, seat: r0.receiverSeat });
  // 서브 토스도 서버 좌석만: 다음 서브의 서버가 아닌 좌석의 toss는 turn
  w.run(() => host.game.rules.phase === 'pointOver', { maxMs: 120_000 }); // 다음 서브권(서버 좌석)은 득점 직후 정해진다
  assert.equal(host.game.rules.phase, 'pointOver');
  const r1 = host.game.rules;
  const wrongSeat = host.playerAt(r1.server, 1 - r1.serverSeat);
  const t = host.matchT();
  w.room.webSocketMessage(wsOf(w, wrongSeat), JSON.stringify({ type: 'toss', seq: 730, t, x: 0.3 }));
  assert.equal(host.game.rules.phase, 'pointOver');
  w.run(() => false, { maxMs: 300 });
  assert.ok(rejected(wrongSeat).some(([s, r]) => s === 730 && r === 'turn'));
});

test('[9] 한 명이 나가면 그 팀이 기권하고, 끊겼다 재접속 대기 안에 돌아오면 같은 좌석에서 이어서 한다', () => {
  const { w, host, all, B } = fourWorld({ seed: 6 });
  w.run(() => all[0].points.length >= 1, { maxMs: 5 * 60_000 });
  // 재접속: B의 연결이 끊겼다가 돌아온다
  const sock = B.sockets.at(-1);
  sock.drop();
  w.run(() => all.filter((x) => x !== B).every((x) => x.opp === 'away'), { maxMs: 3000 });
  const away = all.find((x) => x !== B);
  assert.deepEqual(away.oppWho, { side: B.client.me, seat: B.client.seat }, '누가 끊겼는지 알린다');
  const n = host.game.results.length;
  w.run(() => B.client.connected && B.client.status === 'playing' && all.every((x) => x.opp === 'back' || x === B), { maxMs: 8000 });
  assert.equal(host.playerAt(B.client.me, B.client.seat).awayAt, null); // 10단계: away(마감) → awayAt(끊긴 시각)
  w.run(() => host.game.results.length >= n + 1, { maxMs: 5 * 60_000 });
  assert.equal(host.phase, 'playing');
  // 한 명이 나가면 그 팀의 기권패
  const leaver = all.find((x) => x.client.me === 1 && x.client.seat === 1);
  leaver.client.leave();
  w.run(() => all.filter((x) => x !== leaver).every((x) => x.client.status === 'over'), { maxMs: 5000 });
  for (const x of all.filter((y) => y !== leaver)) {
    assert.equal(x.client.endMsg.by, 'forfeit');
    assert.equal(x.client.endMsg.winner, -1, '나간 팀(+1)의 상대가 이긴다');
  }
});

test('[9] 관전자는 복식 네 선수의 라켓을 모두 받고 득점이 선수와 같다', () => {
  const { w, host, all } = fourWorld({ seed: 7 });
  const S = w.addSpectator({ lat: 40 });
  w.run(() => S.client.status === 'playing', { maxMs: 8000 });
  assert.equal(S.client.mode, 'doubles');
  w.run(() => all[0].points.length >= 2, { maxMs: 5 * 60_000 });
  const r = S.client.game.roster;
  assert.deepEqual(Object.keys(r).sort(), ['-1:0', '-1:1', '1:0', '1:1']);
  for (const k of Object.keys(r)) assert.ok(r[k].samples.length > 0, `${k} 라켓 위치를 받았다`);
  assert.equal(S.client.stats.corrected, 0);
  assert.equal(S.points.length, host.game.results.length);
});
