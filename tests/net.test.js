// 5단계 대전 클라이언트의 순수 함수: 시계 동기화(NTP), 화면 합류(빨리 감기), 토스 실패 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockSample, createClockSync, mergeLag, createBallLag } from '../public/js/net.js';
import { createRng } from '../public/js/input.js';
import { createRules, applyEvent } from '../public/shared/rules.js';
import { ONLINE, REASON_LABELS } from '../public/shared/constants.js';

// 실제 시각 τ에 핑을 보내는 상황을 흉내 낸다: 서버 시계 = τ + S, 내 시계 = τ + C, 편도 지연 = base + 대기열 지터(0~jitter)
function measure({ base, base2 = base, jitter = 10, S = 52_345.6, C = -1_234.5, seed = 1, n = ONLINE.SYNC_SAMPLES }) {
  const rng = createRng(seed);
  const sync = createClockSync();
  let tau = 0;
  for (let i = 0; i < n; i++) {
    const up = base + rng() * jitter, down = base2 + rng() * jitter;
    const t0 = tau + C, t1 = tau + up + S, t2 = t1 + 0.2 /* 서버 처리 */, t3 = tau + up + 0.2 + down + C;
    sync.add(clockSample(t0, t1, t2, t3));
    tau += 100;
  }
  return { error: sync.offset - (S - C), rtt: sync.rtt };
}

test('[1] 시계 동기화: 편도 30/50 ms(+대기열 지터 0~10 ms)에서 8회 측정 → offset 오차 5 ms 이내', () => {
  for (const base of [30, 50]) {
    for (let seed = 1; seed <= 50; seed++) {
      const { error, rtt } = measure({ base, seed });
      assert.ok(Math.abs(error) <= 5, `편도 ${base} ms, 시드 ${seed}: 오차 ${error.toFixed(2)} ms`);
      assert.ok(rtt >= 2 * base && rtt <= 2 * base + 20, `rtt ${rtt}`);
    }
  }
  // 지터가 없으면 정확하다
  assert.ok(Math.abs(measure({ base: 30, jitter: 0 }).error) < 1e-6);
  // 비대칭 지연(올라감 30, 내려옴 80)은 원리상 (80 − 30)/2 = 25 ms 오차가 남는다 (NTP의 한계: 그 이상은 아님)
  const asym = measure({ base: 30, base2: 80, jitter: 0 });
  assert.ok(Math.abs(Math.abs(asym.error) - 25) < 1e-6, `비대칭 오차 ${asym.error}`);
});

test('시계 동기화: 왕복 시간이 가장 짧은 표본을 쓰고, 최근 8개만 기억한다', () => {
  const s = createClockSync();
  s.add({ offset: 100, rtt: 90 });
  s.add({ offset: 40, rtt: 61 });
  s.add({ offset: 70, rtt: 75 });
  assert.equal(s.offset, 40);
  assert.equal(s.rtt, 61);
  assert.equal(s.lastRtt, 75);
  for (let i = 0; i < ONLINE.SYNC_SAMPLES; i++) s.add({ offset: 10, rtt: 80 });
  assert.equal(s.count, ONLINE.SYNC_SAMPLES);
  assert.equal(s.offset, 10, '오래된 표본은 버림');
});

test('[8] 화면 합류: 상대 타격 순간부터 MERGE_TIME(0.1 s)에 걸쳐 빨리 감아 지연 0으로 연속 합류', () => {
  const T = ONLINE.MERGE_TIME;
  assert.equal(T, 0.1);
  const L = 0.08;
  assert.equal(mergeLag(L, 0), L);
  assert.equal(mergeLag(L, T), 0);
  assert.equal(mergeLag(L, 1), 0);
  // 단조 감소, 화면 공 시계 배속 = 1 + L/T (예: 80 ms 늦게 받으면 1.8배속)
  let prev = L;
  for (let s = 0.001; s <= T; s += 0.001) {
    const v = mergeLag(L, s);
    assert.ok(v <= prev + 1e-12);
    assert.ok(Math.abs((prev - v) / 0.001 - L / T) < 1e-6, '일정한 배속');
    prev = v;
  }
  // 상대 타격을 기다리는 동안 늦추고(최대 HOLD_MAX), 타격이 오면 그 순간부터 합류
  const lag = createBallLag();
  for (let i = 0; i < 60; i++) lag.advance(1 / 60, true);
  assert.ok(Math.abs(lag.lag - ONLINE.HOLD_MAX) < 1e-9, `기다림 ${lag.lag}`);
  lag.start(0.09);
  assert.equal(lag.lag, 0.09);
  let frames = 0;
  while (lag.lag > 0 && frames < 100) { lag.advance(1 / 240, false); frames++; }
  assert.ok(Math.abs(frames / 240 - T) < 2 / 240, `${frames} 프레임`);
  // 타격 없이 기다림이 끝나면(상대가 놓침) 그때의 지연에서 같은 방식으로 합류
  const miss = createBallLag();
  for (let i = 0; i < 6; i++) miss.advance(1 / 60, true);
  const held = miss.lag;
  assert.ok(held > 0);
  miss.advance(1 / 60, false);
  assert.ok(miss.merging && miss.lag <= held);
  for (let i = 0; i < 12; i++) miss.advance(1 / 60, false);
  assert.equal(miss.lag, 0);
});

test('[9] 대전 규칙(retoss: false): 토스한 공을 치지 못하면 서브 실점 tossMiss, 연습은 토스 다시', () => {
  for (const [type, extra] of [['bounce', { side: -1 }], ['floor', {}], ['timeout', {}], ['net', {}]]) {
    let s = createRules({ firstServer: -1, retoss: false });
    s = applyEvent(s, { type: 'toss', side: -1 }).state;
    const r = applyEvent(s, { type, ...extra });
    assert.equal(r.result?.type, 'point', type);
    assert.equal(r.result.reason, 'tossMiss');
    assert.equal(r.result.loser, -1);
    assert.deepEqual(r.state.score, [0, 1]);
    // 연습 기본값은 점수 없이 다시 토스
    let p = createRules({ firstServer: -1 });
    p = applyEvent(p, { type: 'toss', side: -1 }).state;
    assert.equal(applyEvent(p, { type, ...extra }).result.type, 'retoss');
  }
  assert.equal(REASON_LABELS.tossMiss, '토스 실패');
});
