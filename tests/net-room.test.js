// 5단계 서버: Room(Durable Object 클래스)을 가짜 WebSocket·저장소로 직접 만들어 검사한다.
// [2] 한 랠리 득점 일치 · [3] 비정상 hit 거부 · [4] 3번째 접속 거절 · [7] 재접속·기권·잠들었다 깨어남 · 검증 한도 실측
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, createFakeCtx } from './net-harness.js';
import { Room } from '../server/room.js';
import { cloneMatch, advanceMatch, makeCode, validCode } from '../public/shared/host.js';
import { ballToLocal } from '../public/shared/physics.js';
import { createAI, createRally, stepMatch } from '../public/js/ai.js';
import { createRng } from '../public/js/input.js';
import { ONLINE, TUNABLE, DIFFICULTIES } from '../public/shared/constants.js';

function startedWorld({ lat = 50, seed = 1 } = {}) {
  const w = createWorld({ seed });
  w.code = 'ABCD';
  const A = w.addAI({ lat, clockOffset: 500, create: true, nickname: '가', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const B = w.addAI({ lat, clockOffset: -300, nickname: '나', aiSeed: 22 });
  w.run(() => A.client.status === 'playing' && B.client.status === 'playing', { maxMs: 5000 });
  return { w, A, B, host: w.room.host };
}
const serverWs = (w, side) => w.ctx.getWebSockets().find((ws) => ws.att.id === w.room.host.slots[side].conn);

test('방 코드: 4자리, 혼동 문자(0/O, 1/I) 없음', () => {
  const rng = createRng(3);
  for (let i = 0; i < 500; i++) {
    const c = makeCode(rng);
    assert.ok(validCode(c), c);
    assert.ok(!/[0O1I]/.test(c), c);
  }
  assert.ok(!validCode('AB0D') && !validCode('ABC') && !validCode('abcd'));
});

test('[2] Room + 가짜 WebSocket 2개: 한 랠리 뒤 서버와 두 클라이언트의 득점 판정이 일치한다', () => {
  const { w, A, B, host } = startedWorld({ lat: 50 });
  assert.equal(host.phase, 'playing');
  assert.notEqual(A.client.me, B.client.me);
  w.run(() => A.points.length >= 1 && B.points.length >= 1, { maxMs: 60_000 });
  const s = host.game.results[0];
  assert.ok(s, '서버 판정');
  for (const c of [A, B]) {
    const p = c.points[0];
    assert.equal(p.type, s.type);
    assert.equal(p.winner, s.winner);
    assert.equal(p.reason, s.reason);
    assert.deepEqual(p.score, s.score);
    assert.equal(p.matched, true, '내 화면의 잠정 판정 = 서버 판정');
    assert.deepEqual(c.client.game.rules.score, host.game.rules.score);
  }
});

test('[3] 비정상 hit 거부: 차례 아님 · 과속 · 과회전 · 라켓이 멂 · 시각 과거/미래 · 공 위치 불일치 · 서브 대신 hit', () => {
  const { w, A, B, host } = startedWorld({ lat: 40, seed: 2 });
  // 서브권자가 토스한 직후(아직 치지 않음)를 기다린다
  w.run(() => host.game.rules.phase === 'serving' && host.game.rules.lastHitter === 0, { maxMs: 10_000 });
  const server = host.game.rules.server, receiver = -server;
  const recOf = (side) => (A.client.me === side ? A : B);
  // 지금 서버 시각에서 공 상태 (정상 서브라면 이 값을 보낸다)
  const sim = cloneMatch(host.game);
  advanceMatch(sim, host.matchT());
  const t = sim.ball.t;
  const loc = ballToLocal(sim.ball, server);
  const good = {
    type: 'serve', t, pos: { ...sim.ball.pos }, vel: { x: 0, y: server * -4, z: 1 }, spin: { x: 10, y: 0, z: 0 },
    shotType: 'drive', racket: { x: loc.pos.x, z: loc.pos.z },
  };
  const before = { rules: host.game.rules, t: host.game.ball.t };
  const cases = [
    [receiver, { ...good, seq: 901 }, 'turn'],
    [server, { ...good, seq: 902, type: 'hit' }, 'turn'],
    [server, { ...good, seq: 903, vel: { x: 0, y: server * -(ONLINE.MAX_V + 1), z: 0 } }, 'speed'],
    [server, { ...good, seq: 904, spin: { x: (ONLINE.MAX_SPIN + 5) * 2 * Math.PI, y: 0, z: 0 } }, 'spin'],
    [server, { ...good, seq: 905, racket: { x: loc.pos.x + TUNABLE.SERVE_HIT_RADIUS + ONLINE.RACKET_TOL + 0.05, z: loc.pos.z } }, 'far'],
    [server, { ...good, seq: 906, t: host.matchT() - ONLINE.T_PAST - 0.2 }, 'time'],
    [server, { ...good, seq: 907, t: host.matchT() + ONLINE.T_FUTURE + 0.2 }, 'time'],
    [server, { ...good, seq: 908, pos: { ...good.pos, z: good.pos.z + ONLINE.BALL_TOL + 0.05 } }, 'pos'],
    [server, { ...good, seq: 909, vel: { x: 'NaN', y: 0, z: 0 } }, 'bad'],
  ];
  for (const [side, msg] of cases) w.room.webSocketMessage(serverWs(w, side), JSON.stringify(msg));
  // 거부는 상태를 바꾸지 않는다
  assert.equal(host.game.rules, before.rules);
  w.run(() => false, { maxMs: 200 });
  for (const [side, msg, reason] of cases) {
    const got = recOf(side).rejects.find((r) => r.seq === msg.seq);
    assert.ok(got, `seq ${msg.seq} 거부되어야 함`);
    assert.equal(got.reason, reason, `seq ${msg.seq}`);
  }
  // 이후 정상 서브로 경기가 계속된다
  w.run(() => A.points.length >= 2, { maxMs: 60_000 });
  assert.ok(host.game.results.length >= 2);
  assert.deepEqual(A.client.game.rules.score, host.game.rules.score);
});

test('[4] 3번째 접속은 full로 거절되고, 없는 방·쓰는 중인 방·버전 불일치도 거절된다', () => {
  const w = createWorld({ seed: 4 });
  w.code = 'WXYZ';
  // 없는 방에 입장
  const ghost = w.addAI({ lat: 20, nickname: '유령' });
  w.run(() => ghost.client.status === 'error', { maxMs: 2000 });
  assert.equal(ghost.client.errorCode, 'noRoom');
  const A = w.addAI({ lat: 20, create: true, nickname: '가' });
  w.run(() => A.client.status === 'waiting', { maxMs: 3000 });
  // 같은 코드로 또 만들기
  const dup = w.addAI({ lat: 20, create: true, nickname: '중복' });
  w.run(() => dup.client.status === 'error', { maxMs: 2000 });
  assert.equal(dup.client.errorCode, 'inUse');
  const B = w.addAI({ lat: 20, nickname: '나' });
  w.run(() => B.client.status === 'playing', { maxMs: 5000 });
  const C = w.addAI({ lat: 20, nickname: '셋째' });
  w.run(() => C.client.status === 'error', { maxMs: 2000 });
  assert.equal(C.client.errorCode, 'full');
  assert.equal(w.room.host.players().length, 2);
  // 버전이 다른 클라이언트
  const sock = w.open(20);
  let got = null;
  sock.onmessage = (ev) => { got = JSON.parse(ev.data); };
  sock.onopen = () => sock.send(JSON.stringify({ type: 'join', nickname: 'x', version: 'v0.0' }));
  w.run(() => got !== null, { maxMs: 1000 });
  assert.deepEqual(got, { type: 'error', code: 'version' });
});

test('[7] 끊김: 10초 안에 다시 접속하면 이어서 끝까지, 점수 일치', () => {
  const { w, A, B, host } = startedWorld({ lat: 40, seed: 5 });
  w.run(() => host.game.results.length >= 3, { maxMs: 120_000 });
  const droppedAt = w.time;
  B.sockets.at(-1).drop();
  w.run(() => A.opp === 'away', { maxMs: 1000 });
  assert.equal(A.opp, 'away');
  // B는 RECONNECT_RETRY 뒤 토큰으로 다시 들어와 resume을 받는다
  w.run(() => A.opp === 'back', { maxMs: ONLINE.RECONNECT_WAIT * 1000 });
  assert.equal(A.opp, 'back');
  assert.ok(w.time - droppedAt < ONLINE.RECONNECT_WAIT * 1000);
  assert.equal(B.sockets.length, 2, '한 번 다시 접속');
  w.run(() => A.client.status === 'over' && B.client.status === 'over');
  assert.equal(A.client.endMsg.by, 'normal');
  assert.deepEqual(A.client.game.rules.score, host.game.rules.score);
  assert.deepEqual(B.client.game.rules.score, host.game.rules.score);
  assert.deepEqual(B.client.endMsg.score, host.game.rules.score);
});

test('[7] 끊김: 10초가 지나도 돌아오지 않으면 남은 사람의 기권승, 방이 비면 정리된다', () => {
  const { w, A, B, host } = startedWorld({ lat: 40, seed: 6 });
  w.run(() => host.game.results.length >= 1, { maxMs: 60_000 });
  // 나가기 버튼이 아니라 네트워크 끊김: 다시 접속하려 해도 연결이 열리지 않는다
  B.blocked = true;
  const droppedAt = w.time;
  B.sockets.at(-1).drop();
  w.run(() => A.client.status === 'over', { maxMs: (ONLINE.RECONNECT_WAIT + 3) * 1000, frameMs: 50 });
  assert.equal(A.client.status, 'over');
  assert.equal(A.client.endMsg.by, 'forfeit');
  assert.equal(A.client.endMsg.winner, A.client.me);
  assert.ok(w.time - droppedAt >= ONLINE.RECONNECT_WAIT * 1000 - 100, `${w.time - droppedAt} ms`);
  // B 쪽 화면: 재접속을 포기하고 연결 끊김 안내
  w.run(() => B.client.status === 'error', { maxMs: 3000 });
  assert.equal(B.client.errorCode, 'lost');
  // A도 나가면 방(저장소)이 지워진다
  A.client.leave();
  w.run(() => false, { maxMs: 500 });
  assert.equal(w.ctx.store.size, 0, '저장소 정리');
  assert.equal(w.ctx.alarmAt, null, '알람 정리');
  assert.equal(host.phase, 'lobby');
});

test('[7] 잠들었다 깨어남(Hibernation): 저장된 상태로 새 Room이 방·점수·자리를 되살린다', async () => {
  const { w, host } = startedWorld({ lat: 30, seed: 7 });
  w.run(() => host.game.results.length >= 2, { maxMs: 120_000 });
  const room2 = new Room(createFakeCtx(w.ctx.store), { CLOCK: { now: () => w.time } });
  await new Promise((r) => setImmediate(r));
  const h2 = room2.host;
  assert.equal(h2.phase, 'playing');
  assert.equal(h2.code, 'ABCD');
  assert.equal(h2.startAt, host.startAt);
  assert.deepEqual(h2.game.rules.score, host.game.rules.score);
  for (const s of [-1, 1]) {
    assert.equal(h2.slots[s].token, host.slots[s].token);
    assert.equal(h2.slots[s].nick, host.slots[s].nick);
  }
});

test('[5단계] 서버 검증 한도 실측: AI 경기 타구가 모두 한도 안이고, 한도는 실측 최댓값의 1.2배 이상', () => {
  let n = 0, vmax = 0, wmax = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const a = createAI(-1, DIFFICULTIES[seed % 3], createRng(seed * 7 + 1));
    const b = createAI(1, DIFFICULTIES[(seed + 1) % 3], createRng(seed * 13 + 5));
    const g = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(seed), firstServer: seed % 2 ? -1 : 1 });
    for (let i = 0; i < 240 * 3600 && g.rules.phase !== 'gameOver'; i++) {
      for (const e of stepMatch(g)) {
        if (e.type !== 'racket') continue;
        n++;
        vmax = Math.max(vmax, Math.hypot(e.shot.vel.x, e.shot.vel.y, e.shot.vel.z));
        wmax = Math.max(wmax, Math.hypot(e.shot.spin.x, e.shot.spin.y, e.shot.spin.z) / (2 * Math.PI));
      }
    }
  }
  assert.ok(n > 1000, `타구 ${n}개`);
  assert.ok(ONLINE.MAX_V >= 1.2 * vmax, `속도 최댓값 ${vmax.toFixed(2)} m/s`);
  assert.ok(ONLINE.MAX_SPIN >= 1.2 * wmax, `회전 최댓값 ${wmax.toFixed(1)} rps`);
  // 사람만 낼 수 있는 실타(낮은 공 내려치기)도 한도 안
  assert.ok(ONLINE.MAX_V >= 1.2 * TUNABLE.MISHIT_SPEED);
});
