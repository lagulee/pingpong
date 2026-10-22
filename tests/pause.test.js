// 10단계 끊김 일시정지: 선수가 끊기면 기권 대신 기다렸다가(대기) 모두 돌아오면 3초 카운트다운 뒤 이어서 한다.
// 실제 server/room.js(Host)와 public/js/net.js를 가상 네트워크(net-harness)로 연결해 검사한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createFakeCtx } from './net-harness.js';
import { Room } from '../server/room.js';
import { ONLINE } from '../public/shared/constants.js';

function startedWorld({ lat = 40, seed = 1 } = {}) {
  const w = createWorld({ seed });
  w.code = 'PAUS';
  const A = w.addAI({ lat, clockOffset: 500, create: true, nickname: '가', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const B = w.addAI({ lat, clockOffset: -300, nickname: '나', aiSeed: 22 });
  w.run(() => A.client.status === 'playing' && B.client.status === 'playing', { maxMs: 5000 });
  return { w, A, B, host: w.room.host };
}
function fourWorld({ lat = 40, seed = 3 } = {}) {
  const w = createWorld({ seed });
  w.code = 'DBLP';
  const A = w.addAI({ lat, clockOffset: 300, create: true, mode: 'doubles', nickname: 'A', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const B = w.addAI({ lat, clockOffset: -100, nickname: 'B', aiSeed: 22 });
  const C = w.addAI({ lat, clockOffset: 50, nickname: 'C', aiSeed: 33 });
  const D = w.addAI({ lat, clockOffset: -20, nickname: 'D', aiSeed: 44 });
  const all = [A, B, C, D];
  w.run(() => all.every((x) => x.client.status === 'playing'), { maxMs: 10_000 });
  return { w, host: w.room.host, all, A, B, C, D };
}
// 네트워크 끊김: 다시 접속하려 해도 열리지 않는다 (reconnect()를 부르면 다시 열린다)
function cut(rec) {
  rec.blocked = true;
  rec.sockets.at(-1).drop();
}
const reconnect = (rec) => { rec.blocked = false; };
const playerOf = (host, rec) => host.playerAt(rec.client.me, rec.client.seat);
const wsOf = (w, p) => w.ctx.getWebSockets().find((x) => x.att.id === p.conn);
// 서버가 받은 토스를 (서버 시각, 일시정지 상태)와 함께 기록한다
function watchTosses(host) {
  const log = [];
  const orig = host.toss.bind(host);
  host.toss = (p, msg) => { log.push({ at: host.io.now(), pause: host.pause, resumeAt: host.resumeAt, side: p.side }); orig(p, msg); };
  return log;
}
const rejectsOf = (rec, reason) => rec.rejects.filter((m) => m.reason === reason);

test('[10] 랠리 중 끊김: 그 포인트는 평소대로 판정하고, 끝난 뒤부터 모두에게 일시정지(대기)를 알린다', () => {
  const { w, A, B, host } = startedWorld({ seed: 2 });
  w.run(() => host.game.results.length >= 1, { maxMs: 60_000 });
  // 다음 랠리가 시작될 때(첫 타격 뒤) 끊는다
  w.run(() => host.game.rules.phase === 'rally', { maxMs: 30_000 });
  const n = host.game.results.length;
  cut(B);
  w.run(() => A.opp === 'away', { maxMs: 1000 });
  assert.equal(host.pause, null, '랠리 중에는 아직 일시정지가 아니다');
  assert.notEqual(playerOf(host, B).awayAt, null);
  // 포인트가 끝나면(끊긴 쪽이 칠 차례면 보통 실점) 바로 일시정지
  w.run(() => host.game.results.length > n, { maxMs: 30_000 });
  assert.equal(host.game.results.length, n + 1, '그 포인트는 판정됐다');
  assert.equal(host.pause, 'wait');
  w.run(() => A.client.pause?.state === 'wait', { maxMs: 1000 });
  assert.deepEqual(A.client.pause.who.map((q) => [q.side, q.nick]), [[B.client.me, '나']]);
  assert.ok(A.client.pause.who[0].until > w.time, '남은 시간(마감)을 함께 알린다');
  const last = A.points.at(-1);
  assert.equal(last.matched, true, '남은 선수 화면의 판정 = 서버 판정');
  assert.deepEqual(A.client.serverRules.score, host.game.rules.score);
  assert.equal(A.client.status, 'playing', '기권이 아니다');
});

test('[10] 일시정지 중 토스는 away, 재개 카운트다운 중 토스는 countdown으로 거부, 대전 AI는 그동안 토스를 보내지 않는다', () => {
  const { w, A, B, host } = startedWorld({ seed: 3 });
  w.run(() => host.game.results.length >= 1, { maxMs: 60_000 });
  w.run(() => host.game.rules.phase === 'waitingServe', { maxMs: 30_000 });
  const tosses = watchTosses(host);
  cut(B);
  w.run(() => host.pause === 'wait', { maxMs: 1000 });
  // 남은 선수가 직접 토스를 보내 본다 (서브권과 상관없이 일시정지 검사가 먼저)
  const pa = playerOf(host, A);
  w.room.webSocketMessage(wsOf(w, pa), JSON.stringify({ type: 'toss', seq: 9001, t: host.matchT(), x: 0 }));
  w.run(() => false, { maxMs: 5000 });
  // 다시 연결 → 시계 맞추기 → ready → 카운트다운
  reconnect(B);
  w.run(() => host.pause === 'countdown', { maxMs: 10_000 });
  assert.equal(host.pause, 'countdown');
  w.room.webSocketMessage(wsOf(w, pa), JSON.stringify({ type: 'toss', seq: 9002, t: host.matchT(), x: 0 }));
  w.run(() => A.rejects.some((m) => m.seq === 9002), { maxMs: 1000 });
  assert.deepEqual(A.rejects.filter((m) => m.seq >= 9001).map((m) => [m.seq, m.reason]), [[9001, 'away'], [9002, 'countdown']]);
  // 재개 뒤 토스는 받는다
  const resumeAt = host.resumeAt;
  const n = host.game.results.length;
  w.run(() => host.game.results.length > n, { maxMs: 60_000 });
  const own = tosses.filter((x) => x.at >= 0);
  // 대전 AI가 보낸 토스는 모두 일시정지가 아닐 때(또는 재개 시각 뒤)에 도착했다
  const aiTosses = own.slice(0); // 위의 직접 토스 2개 포함
  const bad = aiTosses.filter((x) => (x.pause === 'wait' || (x.pause === 'countdown' && x.at < x.resumeAt)));
  assert.equal(bad.length, 2, `일시정지 중 서버에 도착한 토스는 직접 보낸 2개뿐 (${bad.length})`);
  assert.ok(own.some((x) => x.at >= resumeAt), '재개 뒤 토스');
  assert.equal(rejectsOf(A, 'away').length + rejectsOf(B, 'away').length, 1, '대전 AI 자신의 토스는 away로 거부되지 않는다');
  assert.equal(rejectsOf(A, 'countdown').length + rejectsOf(B, 'countdown').length, 1);
  assert.equal(host.pause, null);
});

test('[10] 30 s 안에 돌아오면 카운트다운 뒤 점수를 유지한 채 이어서 끝까지 (긴 공백 뒤 첫 토스가 T_PAST에 걸리지 않음)', () => {
  const { w, A, B, host } = startedWorld({ seed: 5 });
  w.run(() => host.game.results.length >= 3, { maxMs: 120_000 });
  w.run(() => host.game.rules.phase === 'waitingServe', { maxMs: 30_000 });
  cut(B);
  w.run(() => host.pause === 'wait', { maxMs: 30_000 }); // 오는 중이던 토스가 있었으면 그 포인트가 끝난 뒤
  const score = structuredClone(host.game.rules.score);
  // 거의 다 기다린 뒤 돌아온다 (서버 경기 시각은 그동안 흐른다)
  w.run(() => false, { maxMs: (ONLINE.RECONNECT_WAIT - 4) * 1000 });
  assert.equal(host.phase, 'playing');
  reconnect(B);
  w.run(() => host.pause === 'countdown', { maxMs: 4000 });
  assert.equal(host.pause, 'countdown');
  assert.deepEqual(host.game.rules.score, score, '점수 그대로');
  assert.ok(host.resumeAt - w.time > (ONLINE.RESUME_COUNTDOWN - 0.5) * 1000, '재개 시각 = 지금 + 카운트다운');
  // 카운트다운 시작 때 확정 상태를 지금까지 진행해 두어, 첫 토스 검증에서 긴 공백을 다시 계산하지 않는다
  assert.ok(host.matchT() - host.game.ball.t < ONLINE.GRACE + 0.1, `${(host.matchT() - host.game.ball.t).toFixed(2)} s`);
  for (const r of [A, B]) {
    w.run(() => r.client.pause?.state === 'countdown', { maxMs: 1000 });
    assert.ok(Math.abs(r.client.pause.at - r.client.serverToLocal(host.resumeAt)) < 1e-6);
  }
  assert.equal(playerOf(host, B).awayAt, null);
  const spent = playerOf(host, B).awaySpent;
  assert.ok(spent > (ONLINE.RECONNECT_WAIT - 4) * 1000 && spent < ONLINE.RECONNECT_WAIT * 1000, `누적 ${spent} ms`);
  w.run(() => A.client.status === 'over' && B.client.status === 'over');
  assert.equal(A.client.endMsg.by, 'normal');
  assert.deepEqual(A.client.game.rules.score, host.game.rules.score);
  assert.deepEqual(B.client.game.rules.score, host.game.rules.score);
  assert.deepEqual(B.client.endMsg.score, host.game.rules.score);
  assert.equal(A.rejects.length + B.rejects.length, 0, '거부 0 (T_PAST 포함)');
});

test('[10] 카운트다운 중 다시 끊기면 cancel로 대기로 돌아가고, 그 끊김도 누적에 센다', () => {
  const { w, A, B, host } = startedWorld({ seed: 6 });
  w.run(() => host.game.results.length >= 1, { maxMs: 60_000 });
  cut(B);
  w.run(() => false, { maxMs: 4000 });
  reconnect(B);
  w.run(() => host.pause === 'countdown', { maxMs: 10_000 });
  const spent1 = playerOf(host, B).awaySpent;
  w.run(() => A.client.pause?.state === 'countdown', { maxMs: 1000 });
  const states = [];
  const origTick = A.afterTick;
  A.afterTick = () => { states.push(A.client.pause?.state ?? null); origTick?.(); };
  cut(B);
  w.run(() => host.pause === 'wait', { maxMs: 1000 });
  assert.equal(host.pause, 'wait');
  assert.equal(host.resumeAt, null);
  w.run(() => A.client.pause?.state === 'wait', { maxMs: 1000 });
  assert.equal(A.client.pause.state, 'wait', '남은 선수 화면도 대기로');
  assert.ok(states.includes('wait'));
  w.run(() => false, { maxMs: 3000 });
  reconnect(B);
  w.run(() => host.pause === 'countdown', { maxMs: 10_000 });
  assert.ok(playerOf(host, B).awaySpent > spent1 + 2500, '두 번째 끊김도 누적');
  const n = host.game.results.length;
  w.run(() => host.game.results.length > n, { maxMs: 60_000 });
  assert.equal(host.phase, 'playing');
});

test('[10] 누적 한도: 한 경기에서 끊겨 있던 시간이 AWAY_BUDGET(90 s)을 넘으면 기권패, 끝난 뒤 돌아오면 결과를 받는다', () => {
  const { w, A, B, host } = startedWorld({ seed: 7 });
  w.run(() => host.game.results.length >= 1, { maxMs: 60_000 });
  const each = 25_000;
  for (let i = 0; i < 3; i++) {
    cut(B);
    w.run(() => false, { maxMs: each });
    assert.equal(host.phase, 'playing', `${i + 1}번째 끊김은 한도 안`);
    reconnect(B);
    w.run(() => host.pause === 'countdown' || host.pause === null, { maxMs: 5000 });
    w.run(() => host.pause === null && host.game.rules.phase === 'waitingServe', { maxMs: 60_000 });
  }
  const spent = playerOf(host, B).awaySpent;
  assert.ok(spent >= 3 * each && spent < 3 * each + 4000, `누적 ${spent} ms`);
  // 네 번째: 남은 한도(약 90 − 76 s)만 기다린다 (RECONNECT_WAIT 30 s보다 짧음)
  cut(B);
  const droppedAt = w.time;
  w.run(() => A.opp === 'away', { maxMs: 1000 });
  w.run(() => A.client.status === 'over', { maxMs: ONLINE.RECONNECT_WAIT * 1000, frameMs: 50 });
  assert.equal(A.client.endMsg.by, 'forfeit');
  assert.equal(A.client.endMsg.winner, A.client.me);
  const waited = w.time - droppedAt;
  const left = ONLINE.AWAY_BUDGET * 1000 - spent;
  assert.ok(waited >= left - 100 && waited < left + 1500, `기다린 ${waited} ms, 남은 한도 ${left} ms`);
  assert.ok(waited < ONLINE.RECONNECT_WAIT * 1000);
  // 끊긴 쪽은 아직 재접속을 시도하는 중 → 돌아오면 이미 끝난 경기의 결과(기권패)를 받는다
  assert.equal(B.client.status, 'playing');
  reconnect(B);
  w.run(() => B.client.status !== 'playing', { maxMs: 5000 });
  assert.equal(B.client.status, 'over');
  assert.equal(B.client.endMsg.by, 'forfeit');
  assert.equal(B.client.endMsg.winner, A.client.me);
});

test('[10] 한 번에 RECONNECT_WAIT(30 s)를 넘기면 기권패 (관전자도 대기 → 결과를 받는다)', () => {
  const { w, A, B, host } = startedWorld({ seed: 8 });
  const S = w.addSpectator({ lat: 30 });
  w.run(() => S.client.status === 'playing', { maxMs: 8000 });
  w.run(() => host.game.results.length >= 1, { maxMs: 60_000 });
  w.run(() => host.game.rules.phase === 'waitingServe', { maxMs: 30_000 });
  cut(B);
  const droppedAt = w.time;
  w.run(() => S.client.pause?.state === 'wait', { maxMs: 2000 });
  assert.deepEqual(S.client.pause.who.map((q) => q.side), [B.client.me]);
  w.run(() => A.client.status === 'over', { maxMs: (ONLINE.RECONNECT_WAIT + 3) * 1000, frameMs: 50 });
  const waited = w.time - droppedAt;
  assert.ok(waited >= ONLINE.RECONNECT_WAIT * 1000 - 100 && waited < ONLINE.RECONNECT_WAIT * 1000 + 1000, `${waited} ms`);
  assert.equal(A.client.endMsg.by, 'forfeit');
  w.run(() => S.client.status === 'over', { maxMs: 2000 });
  assert.equal(S.client.endMsg.by, 'forfeit');
  assert.equal(S.client.pause, null);
});

test('[10] 복식: 1명이 끊기면 네 선수·관전자 모두 일시정지, 2명이 끊기면 마지막 사람이 돌아온 뒤에 카운트다운', () => {
  const { w, host, all, A, B, C } = fourWorld({ seed: 6 });
  const S = w.addSpectator({ lat: 30 });
  w.run(() => S.client.status === 'playing', { maxMs: 8000 });
  w.run(() => host.game.results.length >= 1, { maxMs: 5 * 60_000 });
  w.run(() => host.game.rules.phase === 'waitingServe', { maxMs: 60_000 });
  // 1명
  cut(B);
  w.run(() => host.pause === 'wait', { maxMs: 30_000 });
  w.run(() => all.filter((x) => x !== B).every((x) => x.client.pause?.state === 'wait') && S.client.pause?.state === 'wait', { maxMs: 2000 });
  for (const x of [...all.filter((y) => y !== B), S]) assert.deepEqual(x.client.pause.who.map((q) => [q.side, q.seat]), [[B.client.me, B.client.seat]]);
  // 2명째 (상대 팀)
  cut(C);
  w.run(() => A.client.pause?.who.length === 2, { maxMs: 2000 });
  assert.equal(host.pause, 'wait');
  assert.equal(A.client.pause.who.length, 2, '끊긴 두 사람을 모두 보여 준다');
  // 한 명만 돌아오면 아직 대기
  reconnect(B);
  w.run(() => B.client.connected && playerOf(host, B).ready, { maxMs: 8000 });
  w.run(() => false, { maxMs: 1000 });
  assert.equal(host.pause, 'wait');
  assert.deepEqual(A.client.pause.who.map((q) => [q.side, q.seat]), [[C.client.me, C.client.seat]]);
  // 마지막 사람이 돌아오면 카운트다운 → 이어서
  reconnect(C);
  w.run(() => host.pause === 'countdown', { maxMs: 8000 });
  assert.equal(host.pause, 'countdown');
  w.run(() => all.every((x) => x.client.pause?.state === 'countdown') && S.client.pause?.state === 'countdown', { maxMs: 1000 });
  const n = host.game.results.length;
  w.run(() => host.game.results.length > n, { maxMs: 5 * 60_000 });
  assert.equal(host.phase, 'playing');
  for (const x of all) assert.equal(rejectsOf(x, 'away').length + rejectsOf(x, 'countdown').length, 0);
  w.run(() => all.every((x) => x.points.length >= host.game.results.length), { maxMs: 10_000 });
  for (const x of [...all, S]) assert.deepEqual(x.client.serverRules.score, host.game.rules.score);
});

test('[10] 잠들었다 깨어남: 일시정지(대기·카운트다운) 중 저장 → 새 Room이 상태와 누적을 그대로 되살린다', async () => {
  const { w, A, B, host } = startedWorld({ seed: 9 });
  w.run(() => host.game.results.length >= 1, { maxMs: 60_000 });
  w.run(() => host.game.rules.phase === 'waitingServe', { maxMs: 30_000 });
  cut(B);
  w.run(() => host.pause === 'wait', { maxMs: 1000 });
  const wake = async () => {
    const room2 = new Room(createFakeCtx(w.ctx.store), { CLOCK: { now: () => w.time } });
    await new Promise((r) => setImmediate(r));
    return room2.host;
  };
  let h2 = await wake();
  assert.equal(h2.pause, 'wait');
  assert.equal(h2.playerAt(B.client.me, 0).awayAt, playerOf(host, B).awayAt);
  assert.equal(h2.deadlineOf(h2.playerAt(B.client.me, 0)), host.deadlineOf(playerOf(host, B)));
  assert.deepEqual(h2.deadlines(), host.deadlines(), '알람 후보(마감)도 같다');
  w.run(() => false, { maxMs: 3000 });
  reconnect(B);
  w.run(() => host.pause === 'countdown', { maxMs: 10_000 });
  h2 = await wake();
  assert.equal(h2.pause, 'countdown');
  assert.equal(h2.resumeAt, host.resumeAt);
  assert.equal(h2.playerAt(B.client.me, 0).awaySpent, playerOf(host, B).awaySpent);
  assert.ok(h2.deadlines().includes(host.resumeAt), '재개 시각이 알람 후보');
  // 깨어난 방도 재개 시각이 지나면 토스를 받는다
  w.time = host.resumeAt + 10;
  h2.settlePause();
  assert.equal(h2.pause, null);
});

test('[10] 흔들리는 네트워크(편도 100 ms + 지터)에서 경기 중 두 번 끊겼다 돌아와도 점수 일치, 거부 0', () => {
  const lat = (rng) => 100 + rng() * 30;
  const { w, A, B, host } = startedWorld({ lat, seed: 4 });
  for (const [who, at] of [[B, 2], [A, 5]]) {
    w.run(() => host.game.results.length >= at, { maxMs: 5 * 60_000 });
    cut(who);
    w.run(() => false, { maxMs: 6000 });
    reconnect(who);
    w.run(() => host.pause === null && host.missing().length === 0, { maxMs: 20_000 });
  }
  w.run(() => A.client.status === 'over' && B.client.status === 'over');
  assert.equal(A.client.endMsg.by, 'normal');
  assert.deepEqual(A.client.game.rules.score, host.game.rules.score);
  assert.deepEqual(B.client.game.rules.score, host.game.rules.score);
  assert.equal(A.rejects.length + B.rejects.length, 0, A.rejects.concat(B.rejects).map((m) => m.reason).join(','));
});

test('[10] 일시정지 대기 중에는 라켓 위치를 보내지 않는다 (무료 한도)', () => {
  const { w, A, B, host } = startedWorld({ seed: 10 });
  w.run(() => host.game.results.length >= 1, { maxMs: 60_000 });
  w.run(() => host.game.rules.phase === 'waitingServe', { maxMs: 30_000 });
  const got = [];
  const orig = host.racket.bind(host);
  host.racket = (p, msg) => { got.push({ side: p.side, pause: host.pause }); orig(p, msg); };
  cut(B);
  w.run(() => A.client.pause?.state === 'wait', { maxMs: 2000 });
  w.run(() => false, { maxMs: 500 }); // 일시정지 소식보다 먼저 보낸(오는 중인) 것은 뺀다
  got.length = 0;
  w.run(() => false, { maxMs: 5000 });
  assert.equal(got.length, 0, `대기 중 받은 racket ${got.length}개`);
  reconnect(B);
  w.run(() => host.pause === null && host.game.rules.phase === 'rally', { maxMs: 30_000 });
  assert.ok(got.length > 0, '재개 뒤에는 다시 보낸다');
});
