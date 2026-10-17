// [6] 인위적 지연(편도 30·80 ms)에서 AI 대 AI 원격 경기 한 판: 서버·두 클라이언트의 점수와 득점 순서가 일치한다.
// 실제 server/room.js(Durable Object 클래스)와 public/js/net.js를 가상 네트워크(tests/net-harness.js)로 연결한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './net-harness.js';
import { RULES } from '../public/shared/constants.js';

function remoteGame({ latA, latB, seed }) {
  const w = createWorld({ seed });
  w.code = 'K7QM';
  // 두 컴퓨터의 시계는 서버와 다르다 (시계 동기화로 맞춘다)
  const A = w.addAI({ lat: latA, clockOffset: 61_234, create: true, nickname: '가', aiSeed: seed * 3 + 1 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const B = w.addAI({ lat: latB, clockOffset: -7_777, nickname: '나', aiSeed: seed * 5 + 2 });
  const done = w.run(() => A.client.status === 'over' && B.client.status === 'over');
  return { w, A, B, done, host: w.room.host };
}

const key = (p) => [p.type, p.winner, p.reason, p.score.join(':')].join('/');

for (const [latA, latB, seed] of [[30, 30, 1], [80, 80, 2], [30, 80, 3]]) {
  test(`[6] 원격 AI 경기 (편도 ${latA}/${latB} ms): 서버·두 클라이언트의 점수·득점 순서 일치, 거부 0`, () => {
    const { A, B, done, host, w } = remoteGame({ latA, latB, seed });
    assert.ok(done, '경기가 끝나야 함');
    // 시계 동기화가 각자의 시계 차이를 찾았다 (지연이 대칭이면 거의 정확)
    for (const [c, off] of [[A, 61_234], [B, -7_777]]) assert.ok(Math.abs(c.client.sync.offset + off) <= 5, `offset ${c.client.sync.offset}`);
    // 서버 최종 점수
    const score = host.game.rules.score;
    const [x, y] = score;
    assert.ok(Math.max(x, y) >= RULES.POINTS_TO_WIN && Math.abs(x - y) >= RULES.WIN_BY, `서버 ${x}:${y}`);
    assert.equal(host.phase, 'over');
    // 두 클라이언트의 경기 끝 메시지·규칙 상태가 서버와 같다
    for (const c of [A, B]) {
      assert.equal(c.client.status, 'over');
      assert.deepEqual(c.client.endMsg.score, score);
      assert.equal(c.client.endMsg.by, 'normal');
      assert.deepEqual(c.client.game.rules.score, score);
      assert.equal(c.client.game.rules.phase, 'gameOver');
    }
    // 득점 순서: 서버 기록 = A가 받은 것 = B가 받은 것
    const serverPts = host.game.results.map((r) => key(r));
    assert.ok(serverPts.length >= x + y);
    assert.deepEqual(A.points.map(key), serverPts);
    assert.deepEqual(B.points.map(key), serverPts);
    // 비정상 타격으로 거부된 것이 없다 (정상 클라이언트)
    assert.equal(A.rejects.length + B.rejects.length, 0, JSON.stringify([...A.rejects, ...B.rejects].slice(0, 3)));
    // 내 화면의 잠정 판정이 서버 판정과 같았던 비율 (정정이 드물어야 함)
    const matched = [...A.points, ...B.points].filter((p) => p.matched).length;
    const total = A.points.length + B.points.length;
    assert.ok(matched / total >= 0.9, `잠정 판정 일치 ${matched}/${total}`);
    // 공 위치는 매 프레임 보내지 않는다: 메시지 수가 적다 (라켓 15 Hz 제외하면 타격·득점 정도)
    assert.ok(w.ctx.puts < 200, `저장 ${w.ctx.puts}회`);
  });
}

// v5.1: 실제 인터넷처럼 편도 지연이 흔들리고 가끔 튀는 네트워크
const jittery = (base, j, p, spike) => (rng) => base + -Math.log(1 - rng()) * j + (rng() < p ? rng() * spike : 0);

test('[6] 원격 AI 경기 (편도 100 ms + 지터 30 ms + 3% 확률로 최대 300 ms 튐): 거부 0, 점수 일치', () => {
  const lat = jittery(100, 30, 0.03, 300);
  const { A, B, done, host } = remoteGame({ latA: lat, latB: lat, seed: 2 });
  assert.ok(done);
  const score = host.game.rules.score;
  for (const c of [A, B]) {
    assert.deepEqual(c.client.game.rules.score, score);
    assert.deepEqual(c.points.map(key), host.game.results.map(key));
  }
  assert.equal(A.rejects.length + B.rejects.length, 0, JSON.stringify([...A.rejects, ...B.rejects].slice(0, 3)));
});

// v6.2: 휴대폰 모바일 데이터(LTE·5G)처럼 기본 지연은 작지만 흔들림·가끔 튐이 큰 네트워크
// 거부 한도: PC ↔ 모바일은 0. 양쪽 모두 모바일이면 튐이 겹쳐 타격이 서버에 0.6 s(T_PAST) 넘게 늦게 닿는 일이
// 드물게 생긴다(실측: 이 조건 한 판 1건). 서버 값은 바꾸지 않고 1% 이하인지만 확인한다 — 점수는 그래도 일치해야 한다.
const lte = jittery(60, 40, 0.05, 400);
for (const [name, latA, latB, maxRate] of [
  ['PC 30 ms ↔ 모바일 데이터 60 ms + 지터 40 ms + 5% 확률로 최대 400 ms 튐', () => 30, lte, 0],
  ['양쪽 모바일 데이터', lte, lte, 0.01],
]) {
  test(`[6] 원격 AI 경기 (${name}): 점수 일치, 거부 ${maxRate ? '1% 이하' : '0'}`, () => {
    const { A, B, done, host } = remoteGame({ latA, latB, seed: 3 });
    assert.ok(done);
    const score = host.game.rules.score;
    for (const c of [A, B]) {
      assert.deepEqual(c.client.game.rules.score, score);
      assert.deepEqual(c.points.map(key), host.game.results.map(key));
    }
    const hits = host.game.results.reduce((n, r) => n + (r.rally ?? 0), 0);
    const rejects = [...A.rejects, ...B.rejects];
    assert.ok(rejects.length <= maxRate * hits, `거부 ${rejects.length} / 타격 ${hits}: ${JSON.stringify(rejects.slice(0, 3))}`);
  });
}

test('[8] 화면 지연 (편도 80 ms): 보이는 공의 시간이 거꾸로 가지 않고, 내가 칠 때는 화면 = 실제 물리', async () => {
  const { createBallHistory } = await import('../public/js/effects.js');
  const { createBallLag, courtShare } = await import('../public/js/net.js');
  const { toLocal } = await import('../public/shared/physics.js');
  const { createWorld } = await import('./net-harness.js');
  const w = createWorld({ seed: 4 });
  w.code = 'K7QM';
  const A = w.addAI({ lat: 80, create: true, aiSeed: 5 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  // B 화면을 main.js와 같은 방식으로 흉내 낸다: 공 기록·되감기·지연 관측
  const history = createBallHistory();
  const lag = createBallLag();
  let hitThisFrame = false;
  const B = w.addAI({
    lat: 80, aiSeed: 6,
    hooks: {
      onStep(events, replay) {
        history.push(B.client.game.ball.t, B.client.game.ball);
        if (!replay && events.some((e) => e.type === 'racket' && e.side === B.client.me)) hitThisFrame = true;
      },
      onRewind: (t) => history.truncate(t),
      onRemote: (m, L) => lag.observe(L),
    },
  });
  let myHits = 0, badHits = 0, lastView = -Infinity, backwards = 0, shownY = 0, maxLag = 0;
  B.afterTick = () => {
    const c = B.client;
    if (!c.game || c.matchTime() < 0) return; // 카운트다운 중에는 경기 시각이 멈춰 있다
    if (c.ping !== null) lag.seed(c.ping / 1000);
    const l = lag.advance(1 / 60, courtShare(shownY));
    maxLag = Math.max(maxLag, l);
    const viewT = c.game.ball.t - l;
    if (viewT < lastView - 1e-9) backwards++;
    lastView = viewT;
    const s = history.sample(viewT);
    if (s) shownY = toLocal(s.pos, c.me).y;
    if (hitThisFrame) { myHits++; if (l > 0.02) badHits++; hitThisFrame = false; }
  };
  w.run(() => B.client.status === 'over', { maxMs: 20 * 60 * 1000 });
  assert.equal(B.client.status, 'over');
  assert.equal(backwards, 0, '화면 시간이 거꾸로 감');
  assert.ok(maxLag > 0.1, `상대 쪽 지연이 실제로 쓰임 (최대 ${maxLag.toFixed(3)} s)`);
  assert.ok(myHits > 20, `내 타격 ${myHits}`);
  assert.ok(badHits / myHits <= 0.05, `칠 때 화면 지연 > 20 ms: ${badHits}/${myHits}`);
});
