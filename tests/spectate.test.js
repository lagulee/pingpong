// 8단계 관전: 방에 관전자를 들이고(최대 SPECTATOR_MAX), 선수의 타격·득점을 방송으로 받아 같은 경기를 본다.
// 관전자는 입력을 보낼 수 없고, 나가도 경기에 영향이 없으며, 선수가 모두 떠나면 관전도 끝난다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './net-harness.js';
import { Host } from '../public/shared/host.js';
import { ONLINE, VERSION, FREE_VIEW } from '../public/shared/constants.js';
import { orbitCamera, dragOrbit, wheelOrbit, cameraBasis } from '../public/js/input.js';

function playingWorld({ lat = 50, seed = 3 } = {}) {
  const w = createWorld({ seed });
  w.code = 'WXYZ';
  const A = w.addAI({ lat, clockOffset: 400, create: true, nickname: '가', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const B = w.addAI({ lat, clockOffset: -200, nickname: '나', aiSeed: 22 });
  w.run(() => A.client.status === 'playing' && B.client.status === 'playing', { maxMs: 5000 });
  return { w, A, B, host: w.room.host };
}
const sameResult = (a, b) => a.type === b.type && a.winner === b.winner && a.reason === b.reason && a.rally === b.rally
  && a.score[0] === b.score[0] && a.score[1] === b.score[1];

test('[8] 관전자 3명(대기실·경기 중 입장): 선수와 같은 득점 순서·점수, 내 화면의 잠정 판정이 서버와 일치한다', () => {
  const w = createWorld({ seed: 5 });
  w.code = 'QRST';
  const A = w.addAI({ lat: 40, clockOffset: 300, create: true, nickname: '가', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const S1 = w.addSpectator({ lat: 60, clockOffset: -150, nickname: '구경1' }); // 대기실에서 입장
  w.run(() => S1.client.status === 'waiting', { maxMs: 5000 });
  assert.equal(S1.client.spectator, true);
  assert.equal(S1.client.me, 0);
  const B = w.addAI({ lat: 40, clockOffset: -100, nickname: '나', aiSeed: 22 });
  w.run(() => A.client.status === 'playing' && S1.client.status === 'playing', { maxMs: 8000 });
  w.run(() => A.points.length >= 1, { maxMs: 90_000 });
  const S2 = w.addSpectator({ lat: 80, clockOffset: 250, nickname: '구경2' }); // 경기 중 입장
  const S3 = w.addSpectator({ lat: 30, clockOffset: 0, nickname: '구경3' });
  w.run(() => S2.client.status === 'playing' && S3.client.status === 'playing', { maxMs: 8000 });
  assert.equal(w.room.host.specCount(), 3);
  w.run(() => A.points.length >= 6, { maxMs: 10 * 60_000 });
  const host = w.room.host;
  w.run(() => false, { maxMs: 3000 }); // 마지막 득점 방송이 모두 도착하도록
  const results = host.game.results;
  assert.ok(results.length >= 5, '서버 득점');
  for (const S of [S1, S2, S3]) {
    assert.ok(S.client.stats.rewinds >= 0);
    assert.equal(S.client.stats.corrected, 0, '관전자의 잠정 판정이 서버와 다른 일이 없다');
    // 경기 중 들어온 관전자는 입장 전 득점을 못 받으므로, 마지막 몇 개를 서버 기록과 맞춘다
    const n = Math.min(S.points.length, 4);
    assert.ok(n >= 3, `${S.client.players.length}명 관전자 득점 ${S.points.length}`);
    const tail = results.slice(results.length - n);
    S.points.slice(S.points.length - n).forEach((p, i) => assert.ok(sameResult(p, tail[i]), `득점 ${i} 일치`));
    assert.deepEqual(S.client.serverRules.score, host.game.rules.score);
    assert.equal(S.rejects.length, 0);
  }
  // 대기실에서 입장한 관전자는 처음부터 모든 득점을 같은 순서로 받는다
  S1.points.forEach((p, i) => assert.ok(sameResult(p, results[i]), `S1 득점 ${i}`));
  assert.ok(A.client.spectators >= 3, '선수 화면에서도 관전자 수가 보인다');
  assert.equal(B.client.status, 'playing');
});

test('[8] 관전자의 toss·serve·hit은 거부되고 경기 상태가 바뀌지 않는다', () => {
  const { w, host } = playingWorld();
  const S = w.addSpectator({ lat: 30 });
  w.run(() => S.client.status === 'playing', { maxMs: 8000 });
  const ws = w.ctx.getWebSockets().find((x) => host.isSpec(x.att.id));
  const before = JSON.stringify(host.game.rules);
  const nResults = host.game.results.length;
  const t = host.matchT();
  for (const type of ['toss', 'serve', 'hit']) {
    w.room.webSocketMessage(ws, JSON.stringify({ type, seq: 77, t, x: 0, pos: { x: 0, y: 0, z: 1 }, vel: { x: 0, y: 1, z: 1 }, spin: { x: 0, y: 0, z: 0 }, racket: { x: 0, z: 1 } }));
  }
  w.room.webSocketMessage(ws, JSON.stringify({ type: 'racket', t, x: 0, z: 0 }));
  const sent = [];
  const orig = ws.send.bind(ws);
  ws.send = (str) => { sent.push(JSON.parse(str)); orig(str); };
  w.room.webSocketMessage(ws, JSON.stringify({ type: 'hit', seq: 78, t }));
  assert.deepEqual(sent.map((m) => [m.type, m.reason]), [['reject', 'spectator']]);
  assert.equal(JSON.stringify(host.game.rules), before, '관전자 입력은 경기 상태를 바꾸지 않는다');
  assert.equal(host.game.results.length, nResults);
  assert.equal(host.phase, 'playing');
  // 관전 클라이언트의 toss()도 항상 false
  assert.equal(S.client.toss(0), false);
});

test(`[8] 관전자 ${ONLINE.SPECTATOR_MAX}명까지, 다음은 specFull · 없는 방은 noRoom`, () => {
  const { w, host } = playingWorld();
  const specs = [];
  for (let i = 0; i < ONLINE.SPECTATOR_MAX; i++) specs.push(w.addSpectator({ lat: 20 + i, nickname: `구경${i}` }));
  w.run(() => specs.every((s) => s.client.status === 'playing'), { maxMs: 10_000 });
  assert.equal(host.specCount(), ONLINE.SPECTATOR_MAX);
  const extra = w.addSpectator({ lat: 20 });
  w.run(() => extra.errors.length > 0, { maxMs: 3000 });
  assert.deepEqual(extra.errors, ['specFull']);
  assert.equal(host.specCount(), ONLINE.SPECTATOR_MAX);
  // 선수 자리와는 따로 센다: 선수 3번째는 여전히 full
  const third = w.addAI({ lat: 20, nickname: '셋째' });
  w.run(() => third.client.status === 'error', { maxMs: 3000 });
  assert.equal(third.client.errorCode, 'full');

  const w2 = createWorld({ seed: 9 });
  w2.code = 'NONE';
  const lost = w2.addSpectator({ lat: 20 });
  w2.run(() => lost.errors.length > 0, { maxMs: 3000 });
  assert.deepEqual(lost.errors, ['noRoom']);
});

test('[8] 관전자가 나가고 들어와도 경기는 이어진다 · 버전이 다르면 거절', () => {
  const { w, A, B, host } = playingWorld({ seed: 4 });
  const S1 = w.addSpectator({ lat: 30 });
  const S2 = w.addSpectator({ lat: 30 });
  w.run(() => S1.client.status === 'playing' && S2.client.status === 'playing', { maxMs: 8000 });
  w.run(() => A.points.length >= 1, { maxMs: 90_000 });
  const n = host.game.results.length;
  S1.client.leave();
  w.run(() => host.specCount() === 1, { maxMs: 3000 });
  const S3 = w.addSpectator({ lat: 30 });
  w.run(() => S3.client.status === 'playing', { maxMs: 8000 });
  assert.equal(host.specCount(), 2);
  w.run(() => host.game.results.length >= n + 2, { maxMs: 5 * 60_000 });
  assert.equal(host.phase, 'playing');
  assert.equal(A.client.status, 'playing');
  assert.equal(B.client.status, 'playing');
  assert.equal(A.rejects.length + B.rejects.length, 0);

  // 버전 불일치
  const sent = [];
  const host2 = new Host({ now: () => 0, rng: () => 0.1, send: (id, m) => sent.push([id, m]), close() {}, setTimer() {}, save() {}, clear() {} }, { code: 'AAAA' });
  host2.message('p', { type: 'join', nickname: 'x', version: VERSION, create: true });
  host2.message('s', { type: 'join', nickname: 'y', version: 'v0.0', spectate: true });
  assert.equal(sent.at(-1)[1].code, 'version');
  host2.message('s', { type: 'join', nickname: 'y', version: VERSION, spectate: true });
  assert.equal(host2.specCount(), 1);
  assert.equal(sent.find(([id, m]) => id === 's' && m.type === 'joined').at(1).spectator, true);
});

test('[8] 선수가 모두 떠나면 관전도 끝나고, 선수 연결이 끊기면 관전자에게도 알린다', () => {
  const { w, A, B, host } = playingWorld({ seed: 6 });
  const S = w.addSpectator({ lat: 30 });
  w.run(() => S.client.status === 'playing', { maxMs: 8000 });
  w.run(() => A.points.length >= 1, { maxMs: 90_000 });
  // 선수 B가 끊김 → 관전자에게 away
  const bSock = B.sockets.at(-1);
  B.blocked = true;
  bSock.drop();
  w.run(() => S.opp?.state === 'away', { maxMs: 3000 });
  assert.equal(S.opp.side, B.client.me);
  // 재접속 대기(RECONNECT_WAIT) 안에 돌아오지 않으면 기권 → 관전자도 end를 받는다 (10단계: 10 → 30 s라 상수로 기다린다)
  w.run(() => S.client.status === 'over', { maxMs: (ONLINE.RECONNECT_WAIT + 10) * 1000 });
  assert.equal(S.client.endMsg.by, 'forfeit');
  assert.equal(S.client.endMsg.winner, A.client.me);
  // 남은 선수가 나가면 관전 연결도 닫혀 방이 정리된다
  A.client.leave();
  w.run(() => host.specCount() === 0, { maxMs: 5000 });
  assert.equal(w.ctx.store.size, 0, '저장 상태도 지워진다');
});

test('[8] 관전자 목록은 저장·복원된다 (잠들었다 깨어나도 방송을 받는다)', () => {
  const { w, host } = playingWorld({ seed: 7 });
  const S = w.addSpectator({ lat: 30 });
  w.run(() => S.client.status === 'playing', { maxMs: 8000 });
  const snap = host.snapshot();
  assert.equal(Object.keys(snap.specs).length, 1);
  const h2 = new Host({ now: () => w.time, rng: () => 0.5, send() {}, close() {}, setTimer() {}, save() {}, clear() {} });
  h2.restore(structuredClone(snap));
  assert.deepEqual(h2.specs, host.specs);
});

test('[8] 자유 시점: 늘 탁구대 가운데를 보고, 거리·각도는 제한 안에서만 움직이고, 프리셋은 서로 다르다', () => {
  const dist = (c) => Math.hypot(c.pos.x - c.target.x, c.pos.y - c.target.y, c.pos.z - c.target.z);
  for (const yaw of [0, 1, Math.PI / 2, 3, Math.PI, -2]) {
    for (const pitch of [0.1, 0.5, 1.2]) {
      const c = orbitCamera({ yaw, pitch, dist: 4 });
      assert.ok(Math.abs(dist(c) - 4) < 1e-9, '거리 유지');
      assert.deepEqual(c.target, FREE_VIEW.TARGET);
      assert.ok(c.pos.z > FREE_VIEW.TARGET.z, '바닥 아래로 가지 않는다');
      const b = cameraBasis(c);
      const toT = { x: c.target.x - c.pos.x, y: c.target.y - c.pos.y, z: c.target.z - c.pos.z };
      assert.ok(Math.abs(b.f.x * toT.x + b.f.y * toT.y + b.f.z * toT.z - 4) < 1e-9, '바라보는 방향이 가운데');
    }
  }
  // yaw 0 = 왼쪽 선수(−1) 뒤, π = 오른쪽 선수(+1) 뒤, π/2 = 옆
  assert.ok(orbitCamera({ yaw: 0 }).pos.y < -1);
  assert.ok(orbitCamera({ yaw: Math.PI }).pos.y > 1);
  assert.ok(orbitCamera({ yaw: Math.PI / 2 }).pos.x > 1);
  // 제한
  assert.ok(Math.abs(dist(orbitCamera({ dist: 100 })) - FREE_VIEW.DIST_MAX) < 1e-9);
  assert.ok(Math.abs(dist(orbitCamera({ dist: 0.1 })) - FREE_VIEW.DIST_MIN) < 1e-9);
  const low = orbitCamera({ pitch: -3, dist: 4 });
  assert.ok(low.pos.z > FREE_VIEW.TARGET.z + 0.1, '너무 낮은 각은 올려 준다');
  let v = { yaw: 0, pitch: 0.5, dist: 4 };
  for (let i = 0; i < 1000; i++) v = dragOrbit(v, 0, 50);
  assert.equal(v.pitch, FREE_VIEW.PITCH_MAX);
  for (let i = 0; i < 1000; i++) v = dragOrbit(v, 0, -50);
  assert.equal(v.pitch, FREE_VIEW.PITCH_MIN);
  assert.ok(dragOrbit({ yaw: 0, pitch: 0.5, dist: 4 }, 100, 0).yaw < 0, '오른쪽으로 끌면 카메라가 왼쪽으로 돈다');
  for (let i = 0; i < 100; i++) v = wheelOrbit(v, -1);
  assert.equal(v.dist, FREE_VIEW.DIST_MIN);
  for (let i = 0; i < 100; i++) v = wheelOrbit(v, 1);
  assert.equal(v.dist, FREE_VIEW.DIST_MAX);
  // 프리셋: 서로 다른 시점, 모두 제한 안
  const keys = FREE_VIEW.PRESETS.map((p) => JSON.stringify(orbitCamera(p)));
  assert.equal(new Set(keys).size, FREE_VIEW.PRESETS.length);
  for (const p of FREE_VIEW.PRESETS) assert.ok(p.pitch >= FREE_VIEW.PITCH_MIN && p.pitch <= FREE_VIEW.PITCH_MAX && p.dist >= FREE_VIEW.DIST_MIN && p.dist <= FREE_VIEW.DIST_MAX);
});

test('[8] 관전 화면은 SPECTATOR_DELAY만큼 늦게 그려 되감기·보정 없이 매끈하다 (선수 편도 80 ms, 관전자 60 ms)', () => {
  const w = createWorld({ seed: 5 });
  w.code = 'QRST';
  const A = w.addAI({ lat: 80, clockOffset: 300, create: true, nickname: '가', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const S = w.addSpectator({ lat: 60 });
  w.addAI({ lat: 80, clockOffset: -100, nickname: '나', aiSeed: 22 });
  w.run(() => A.points.length >= 6, { maxMs: 10 * 60_000 });
  assert.equal(S.client.stats.rewinds, 0, '상대 타격이 제때 도착해 되감지 않는다');
  assert.equal(S.client.stats.corrections, 0);
  assert.equal(S.client.stats.corrected, 0);
  assert.ok(S.client.stats.remote > 40, '타격을 많이 받았다');
  // 관전 시각은 선수 시각보다 SPECTATOR_DELAY 안팎으로 늦다
  const lag = A.client.game.ball.t - S.client.game.ball.t;
  assert.ok(Math.abs(lag - ONLINE.SPECTATOR_DELAY) < 0.15, `지연 ${lag.toFixed(3)} s`);
});
