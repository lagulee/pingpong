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
