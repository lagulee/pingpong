// 11단계 경기 요약: shared/stats.js 집계(순수 함수)와 원격 AI 경기에서 모든 클라이언트의 집계 일치.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStats, addHit, removeHit, addPoint, hitFromEvent, summary, summaryTable, playerKey } from '../public/shared/stats.js';
import { STATS, PHYSICS } from '../public/shared/constants.js';
import { createAI, createRally, stepMatch } from '../public/js/ai.js';
import { createRng } from '../public/js/input.js';
import { createWorld } from './net-harness.js';

const v = (speed) => ({ x: 0, y: speed, z: 0 });               // 크기 = speed
const rps = (n) => ({ x: n * 2 * Math.PI, y: 0, z: 0 });         // 크기 = n rps
let k = 0;
const hit = (side, t, shotType, o = {}) => ({ key: `k${k++}`, side, seat: o.seat ?? 0, t, shotType, serve: !!o.serve, vel: v(o.speed ?? 5), spin: rps(o.rps ?? 30), perfect: o.perfect ?? null, combo: o.combo ?? null });
const point = (winner, t, rally) => ({ type: 'point', winner, loser: -winner, t, rally });

test('[11] 정해진 이벤트 열 → 구질별 타격·득점, 서브 득점, 최고 속도(km/h)·최대 회전(rps), 최장 랠리', () => {
  const s = createStats({ mine: playerKey(-1, 0) });
  // 1점: −1 드라이브 서브 → +1 커트 → −1 스매시 → +1 못 받음  ⇒ −1 스매시 득점
  addHit(s, hit(-1, 1.0, 'drive', { serve: true, speed: 4, rps: 20, perfect: true, combo: 0 }));
  addHit(s, hit(1, 1.8, 'cut', { speed: 3, rps: 40 }));
  addHit(s, hit(-1, 2.6, 'smash', { speed: 15, rps: 10, perfect: true, combo: 1 }));
  addPoint(s, point(-1, 3.5, 3));
  // 2점: −1 서브(일반) 그대로 득점 (서브 에이스)
  addHit(s, hit(-1, 6.0, 'normal', { serve: true, speed: 3, perfect: false, combo: 0 }));
  addPoint(s, point(-1, 7.2, 1));
  // 3점: −1 서브 → +1 사이드 → −1 아웃  ⇒ +1 사이드 득점
  addHit(s, hit(-1, 10.0, 'cut', { serve: true, perfect: false, combo: 0 }));
  addHit(s, hit(1, 10.8, 'side', { speed: 6, rps: 65 }));
  addPoint(s, point(1, 12.0, 2));
  // 4점: −1 토스 실패(타격 없음) ⇒ +1 득점, 구질별 득점에는 넣지 않는다
  addPoint(s, point(1, 15.0, 0));
  const sum = summary(s);
  const [a, b] = sum.players;
  assert.equal(sum.longest, 3);
  assert.equal(sum.rallies, 4);
  assert.deepEqual([a.points, a.servePoints, a.hits], [2, 1, 4]);
  assert.deepEqual([b.points, b.servePoints, b.hits], [2, 0, 2]);
  assert.deepEqual(a.byType.smash, { hits: 1, points: 1 });
  assert.deepEqual(a.byType.normal, { hits: 1, points: 1 });
  assert.deepEqual(a.byType.drive, { hits: 1, points: 0 });
  assert.deepEqual(b.byType.side, { hits: 1, points: 1 });
  assert.equal(Object.values(b.byType).reduce((n, x) => n + x.points, 0), 1, '타격 없이 얻은 점수는 구질별 득점에 없다');
  assert.ok(Math.abs(a.maxSpeed - 15 * STATS.KMH_PER_MS) < 1e-9);
  assert.ok(Math.abs(b.maxSpin - 65) < 1e-9);
  assert.deepEqual([a.perfect, a.maxCombo], [2, 1], '내 칸만 PERFECT·콤보');
  assert.deepEqual([b.perfect, b.maxCombo], [null, null]);
  assert.deepEqual([sum.teams[-1].points, sum.teams[1].points], [2, 2], '팀 득점 = 실제 점수');
  assert.deepEqual(sum.shotTypes, ['normal', 'drive', 'cut', 'side', 'smash'], '나온 구질만, 정해진 순서');
});

test('[11] 같은 key는 한 번만 세고(되감기 재적용), 거부된 타격은 뺀다, 렛은 포인트 경계만 된다', () => {
  const s = createStats();
  const h = hit(-1, 1.0, 'drive');
  assert.equal(addHit(s, h), true);
  assert.equal(addHit(s, { ...h, t: 1.0 }), false, '같은 key 다시 적용');
  assert.equal(addHit(s, { ...h }), false);
  const bad = hit(1, 1.6, 'smash', { speed: 20 });
  addHit(s, bad);
  assert.equal(removeHit(s, bad.key), true, '서버가 거부');
  assert.equal(removeHit(s, bad.key), false);
  addPoint(s, { type: 'let', t: 2.0, rally: 1 });   // 렛: −1 드라이브는 이 경계 안에서 끝
  addHit(s, hit(1, 3.0, 'cut', { serve: true }));
  addPoint(s, point(1, 4.0, 1));
  const sum = summary(s);
  assert.equal(sum.players[0].hits, 1);
  assert.equal(sum.players[1].hits, 1);
  assert.equal(sum.players[1].maxSpeed, 5 * STATS.KMH_PER_MS, '거부된 20 m/s 스매시는 최고 속도에도 없다');
  assert.equal(sum.players[0].points, 0, '렛 앞 타격은 다음 포인트의 득점이 아니다');
  assert.deepEqual([sum.players[1].points, sum.players[1].servePoints], [1, 1]);
  assert.equal(sum.rallies, 1, '렛은 포인트로 세지 않는다');
});

test('[11] 복식: 네 사람 각자 + 팀 합계, 득점은 이긴 팀의 마지막 타자', () => {
  const s = createStats({ doubles: true, mine: playerKey(1, 1) });
  addHit(s, hit(-1, 1, 'drive', { serve: true, seat: 0 }));
  addHit(s, hit(1, 2, 'cut', { seat: 0 }));
  addHit(s, hit(-1, 3, 'side', { seat: 1, speed: 8 }));
  addHit(s, hit(1, 4, 'drive', { seat: 1, perfect: true, combo: 1 }));
  addPoint(s, point(1, 5, 4));           // +1 seat 1 드라이브 득점
  addHit(s, hit(-1, 7, 'cut', { serve: true, seat: 0 }));
  addPoint(s, point(-1, 8, 1));          // −1 seat 0 서브 득점
  addPoint(s, point(-1, 11, 0));         // 상대 서브 실수: 팀 합계에만
  const sum = summary(s);
  assert.equal(sum.players.length, 4);
  const at = (side, seat) => sum.players.find((r) => r.side === side && r.seat === seat);
  assert.deepEqual([at(1, 1).points, at(1, 1).byType.drive.points], [1, 1]);
  assert.deepEqual([at(-1, 0).points, at(-1, 0).servePoints], [1, 1]);
  assert.equal(at(-1, 1).points, 0);
  assert.deepEqual([sum.teams[-1].points, sum.teams[1].points], [2, 1], '팀 득점 = 실제 점수 (타격 없는 점수 포함)');
  assert.equal(sum.teams[-1].hits, 3);
  assert.equal(sum.teams[-1].maxSpeed, 8 * STATS.KMH_PER_MS);
  assert.equal(sum.teams[-1].byType.cut.hits, 1);
  assert.deepEqual([at(1, 1).perfect, at(1, 0).perfect, sum.teams[1].perfect], [1, null, null], 'PERFECT는 내 칸만, 팀 합계는 "-"');
  // 표: 내 쪽(+1) 먼저, 팀마다 두 사람 + 팀
  const tb = summaryTable(sum, { names: (side, seat) => `${side}/${seat}`, first: 1, mine: s.mine });
  assert.deepEqual(tb.head.map((h) => h.text), ['1/0', '1/1', '팀', '-1/0', '-1/1', '팀']);
  assert.deepEqual(tb.head.map((h) => h.mine), [false, true, false, false, false, false]);
  const row = (name) => tb.rows.find((r) => r[0] === name);
  assert.deepEqual(row('득점'), ['득점', '0', '1', '1', '1', '0', '2']);
  assert.deepEqual(row('PERFECT'), ['PERFECT', '-', '1', '-', '-', '-', '-']);
  assert.ok(row('드라이브 타격/득점'));
  assert.equal(tb.rows.find((r) => r[0].startsWith('스매시')), undefined, '나오지 않은 구질은 행이 없다');
});

test('[11] 연습 경기(로봇 대 로봇)의 racket 이벤트를 그대로 넣으면 득점 합 = 점수, 타격 수 = 이벤트 수 (key 충돌 없음)', () => {
  const a = createAI(-1, 'NORMAL', createRng(8));
  const b = createAI(1, 'HARD', createRng(9));
  const g = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(3), firstServer: -1 });
  const s = createStats({ mine: playerKey(-1, 0) });
  let n = 0, seen = 0;
  for (let i = 0; i < 240 * 3600 && g.rules.phase !== 'gameOver'; i++) {
    for (const e of stepMatch(g)) if (e.type === 'racket' && e.shot) { n++; addHit(s, hitFromEvent(e, { mineKey: playerKey(-1, 0), dt: PHYSICS.DT })); }
    for (; seen < g.results.length; seen++) if (!g.results[seen].practice) addPoint(s, g.results[seen]);
  }
  assert.equal(g.rules.phase, 'gameOver');
  const sum = summary(s);
  assert.equal(sum.players[0].hits + sum.players[1].hits, n);
  assert.deepEqual([sum.players[0].points, sum.players[1].points], g.rules.score);
  assert.equal(sum.longest, Math.max(...g.results.filter((r) => r.type === 'point').map((r) => r.rally)));
  assert.ok(sum.players[0].servePoints + sum.players[1].servePoints >= 0);
  assert.ok(sum.players[0].perfect !== null && sum.players[1].perfect === null);
});

// PERFECT·콤보(내 클라이언트만 아는 값)와 입장 표시를 뺀 비교
const strip = (sum) => JSON.stringify(sum, (key, val) => (key === 'perfect' || key === 'maxCombo' || key === 'partial' ? undefined : val));

test('[11] 원격 AI 경기: 두 선수·처음부터 본 관전자의 집계가 모두 같고 점수와 맞으며, 중간에 들어온 관전자는 "입장 이후"', () => {
  const w = createWorld({ seed: 4 });
  w.code = 'STAT';
  const lat = (rng) => 60 + rng() * 30;
  const A = w.addAI({ lat, clockOffset: 400, create: true, nickname: '가', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const B = w.addAI({ lat, clockOffset: -200, nickname: '나', aiSeed: 22 });
  const S = w.addSpectator({ lat: 40 });
  w.run(() => A.client.status === 'playing' && B.client.status === 'playing', { maxMs: 8000 });
  const host = w.room.host;
  w.run(() => host.game.results.length >= 4, { maxMs: 5 * 60_000 });
  const L = w.addSpectator({ lat: 40, nickname: '늦게' });
  w.run(() => [A, B, S, L].every((x) => x.client.status === 'over'));
  const [a, b, s, l] = [A, B, S, L].map((x) => summary(x.client.matchStats));
  assert.equal(strip(a), strip(b), '두 선수 일치');
  assert.equal(strip(a), strip(s), '처음부터 본 관전자 일치');
  assert.deepEqual([a.partial, b.partial, s.partial, l.partial], [false, false, false, true]);
  const score = host.game.rules.score;
  assert.deepEqual(a.players.map((r) => r.points), score);
  assert.ok(a.players.every((r) => r.hits > 10));
  assert.ok(a.longest >= 1);
  assert.ok(l.players[0].hits < a.players[0].hits, '늦게 온 관전자는 입장 전 타격이 없다');
  // PERFECT·콤보는 자기 칸만
  const ia = a.players.findIndex((r) => r.side === A.client.me);
  assert.ok(a.players[ia].perfect !== null && a.players[1 - ia].perfect === null);
  assert.ok(s.players.every((r) => r.perfect === null), '관전자는 PERFECT를 모른다');
  assert.equal(A.rejects.length + B.rejects.length, 0);
});

test('[11] 복식 원격 경기: 네 선수 클라이언트의 집계가 같고 팀 득점 = 점수', () => {
  const w = createWorld({ seed: 3 });
  w.code = 'DSTA';
  const A = w.addAI({ lat: 40, clockOffset: 300, create: true, mode: 'doubles', nickname: 'A', aiSeed: 11 });
  w.run(() => A.client.status === 'waiting', { maxMs: 5000 });
  const others = [['B', 22, -100], ['C', 33, 50], ['D', 44, -20]].map(([nickname, aiSeed, clockOffset]) => w.addAI({ lat: 40, clockOffset, nickname, aiSeed }));
  const all = [A, ...others];
  w.run(() => all.every((x) => x.client.status === 'playing'), { maxMs: 10_000 });
  w.run(() => all.every((x) => x.client.status === 'over'), { maxMs: 30 * 60_000 });
  const sums = all.map((x) => summary(x.client.matchStats));
  for (const s of sums.slice(1)) assert.equal(strip(s), strip(sums[0]));
  const score = w.room.host.game.rules.score;
  assert.deepEqual([sums[0].teams[-1].points, sums[0].teams[1].points], score);
  assert.equal(sums[0].players.length, 4);
  assert.ok(sums[0].players.every((r) => r.hits > 0), '네 사람 모두 쳤다');
});
