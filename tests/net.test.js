// 5단계 대전 클라이언트의 순수 함수: 시계 동기화(NTP), 화면 합류(빨리 감기), 토스 실패 규칙
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockSample, createClockSync, createBallLag, courtShare } from '../public/js/net.js';
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

test('[8] 화면 지연: 상대 쪽에서는 예상 지연만큼, 내 코트에서는 0. 지연은 정해진 속도 안에서만 변한다', () => {
  // 공 위치 → 비율: 내 코트(LAG_NEAR 안쪽) 0, 상대 엔드 쪽(LAG_FAR 바깥) 1, 사이는 단조 증가
  assert.equal(courtShare(-1.37), 0);
  assert.equal(courtShare(ONLINE.LAG_NEAR), 0);
  assert.equal(courtShare(ONLINE.LAG_FAR), 1);
  assert.equal(courtShare(1.6), 1);
  let prev = -1;
  for (let y = -1.5; y <= 1.6; y += 0.05) { const v = courtShare(y); assert.ok(v >= prev); prev = v; }

  // 예상 지연: 첫 추정은 핑, 상대 타격이 실제로 늦게 온 시간을 지수 평균 + 흔들림 여유로
  const lag = createBallLag();
  assert.equal(lag.expected, 0);
  lag.seed(0.12);
  assert.ok(Math.abs(lag.expected - 0.12) < 1e-12);
  lag.seed(0.5); // 이미 추정이 있으면 무시
  assert.ok(Math.abs(lag.expected - 0.12) < 1e-12);
  for (let i = 0; i < 40; i++) lag.observe(0.08);
  assert.ok(Math.abs(lag.expected - 0.08) < 0.005, `수렴 ${lag.expected}`);
  const steady = lag.expected;
  lag.observe(0.2); // 흔들림이 생기면 여유가 커진다
  assert.ok(lag.expected > steady + 0.024);
  for (let i = 0; i < 100; i++) lag.observe(5);
  assert.equal(lag.expected, ONLINE.LAG_MAX, '상한');

  // 지연은 목표(예상 × 비율)를 향해 LAG_RATE_UP/DOWN 이하의 속도로만 움직인다 → 화면 공 0.5~4배속
  const l2 = createBallLag();
  l2.seed(0.2);
  const dt = 1 / 60;
  let v = 0;
  for (let i = 0; i < 60; i++) {
    const nv = l2.advance(dt, 1);
    assert.ok(nv - v <= ONLINE.LAG_RATE_UP * dt + 1e-12);
    v = nv;
  }
  assert.ok(Math.abs(v - 0.2) < 1e-12, '상대 쪽: 예상 지연');
  for (let i = 0; i < 60; i++) {
    const nv = l2.advance(dt, 0);
    assert.ok(v - nv <= ONLINE.LAG_RATE_DOWN * dt + 1e-12);
    v = nv;
  }
  assert.equal(v, 0, '내 코트: 지연 0');
  assert.ok(Math.ceil(0.2 / (ONLINE.LAG_RATE_DOWN * dt)) <= 5, '0.2 s 지연도 5프레임 안에 0');
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
