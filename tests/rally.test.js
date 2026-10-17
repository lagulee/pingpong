// 2단계 AI 자동 랠리 테스트 (.claude/rules/input.md 검증 4 + AI 보조 테스트)
// 로봇 둘이 가상 마우스 샘플 → checkHit → classifyShot 경로로 사람과 똑같이 친다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAI, createRally, feedBall, stepRally, createPlayer } from '../public/js/ai.js';
import { createRules, startRally, applyEvent, bouncedOn, canHit } from '../public/shared/rules.js';
import { createRng } from '../public/js/input.js';
import { PRACTICE, TUNABLE, DIFFICULTIES } from '../public/shared/constants.js';

// 시드 하나로 랠리 한 번: 로봇(+1)이 공을 보내고 끝날 때까지 진행
function playRally(seed, diffA, diffB = diffA, params = TUNABLE, onEvent = () => {}) {
  const a = createAI(-1, diffA, createRng(seed * 7 + 1));
  const b = createAI(1, diffB, createRng(seed * 13 + 5));
  const game = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(seed) });
  feedBall(game, 1, 0, params);
  for (let i = 0; i < 240 * 300 && game.rules.phase === 'rally' && game.rules.rally < PRACTICE.MAX_RALLY; i++) {
    for (const e of stepRally(game, undefined, params)) onEvent(e, game);
  }
  // count: 정상 리턴 수 (로봇이 보낸 첫 공은 세지 않음), reason: 랠리를 끝낸 사유
  return { count: game.rules.rally, reason: game.results.at(-1)?.reason ?? null, phase: game.rules.phase };
}

test('[4] AI 대 AI가 보통 난이도에서 평균 10회 이상 랠리한다', () => {
  const N = 20;
  const counts = [];
  for (let seed = 1; seed <= N; seed++) counts.push(playRally(seed, 'NORMAL').count);
  const avg = counts.reduce((a, c) => a + c, 0) / N;
  assert.ok(avg >= 10, `평균 ${avg} (${counts.join(', ')})`);
});

test('자동 랠리는 같은 시드면 완전히 같게 흘러간다 (결정론)', () => {
  const run = () => {
    const log = [];
    const tr = playRally(3, 'NORMAL', 'NORMAL', TUNABLE, (e) => log.push([e.type, e.t, e.pos.x, e.shot?.shotType]));
    return { count: tr.count, reason: tr.reason, log };
  };
  assert.deepStrictEqual(run(), run());
});

// 7단계: 로봇은 들어온 회전에 맞는 구질 안에서 비율대로 고르므로(회전 읽기), 비율을 한 구질만 남겨도 그 구질만 치지 않는다.
// 그래서 "모든 타격이 그 구질"이 아니라 "로봇이 그 구질을 고른 타격이 그 구질로 판정되는가"를 본다 (블록·스매시와 같은 방식).
test('로봇이 만든 가상 샘플(구질 버튼 포함)이 의도한 구질로 판정된다', () => {
  // 구질 하나만 고르도록 비율을 바꾸고, 회전을 자주 잘못 읽게 해(READ 0) 맞지 않는 구질(사이드·일반 등)도 나오게 한다
  const only = (type) => {
    const p = { ...TUNABLE, AI_HARD_READ: 0 };
    for (const s of ['DRIVE', 'BLOCK', 'CUT', 'SIDE', 'SMASH', 'NORMAL']) p[`AI_HARD_W_${s}`] = s === type ? 1 : 0;
    return p;
  };
  const expect = { DRIVE: 'drive', CUT: 'cut', SIDE: 'side', NORMAL: 'normal' };
  for (const [type, shot] of Object.entries(expect)) {
    let picked = 0, match = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const params = only(type);
      playRally(seed, 'HARD', 'HARD', params, (e, game) => {
        if (e.type !== 'racket') return;
        const ai = game.ais.find((x) => x.player.side === e.side);
        if (ai.lastPlanType === type) { picked++; if (e.shot.shotType === shot) match++; }
      });
    }
    assert.ok(picked >= 10 && match / picked >= 0.9, `${type}: ${match}/${picked}`);
  }
  // 블록·스매시는 공 상황(빠른 공·높은 공)에서만 고르므로, 고른 경우만 판정을 확인한다
  for (const [type, shot] of [['BLOCK', 'block'], ['SMASH', 'smash']]) {
    let picked = 0, match = 0;
    for (let seed = 1; seed <= (type === 'SMASH' ? 200 : 20); seed++) {
      // 블록·스매시는 맞는 대응으로만 고른다. 상대(쉬움)도 회전을 바르게 읽게 해 랠리가 이어져 높은 공이 나오게 한다
      const params = { ...only(type), AI_HARD_READ: 1, AI_EASY_READ: 1 };
      params.AI_HARD_W_DRIVE = 1e-6; // 고를 수 없을 때만 드라이브
      // v6.0: 세게 친 공은 낮게 날아 바운드도 낮다. 스매시 기회(높은 공)는 약하게 높이 친 공에서 나오므로
      // 스매시는 쉬움 로봇(약한 공)을 상대로 확인한다. 쉬움 로봇은 스매시를 고르지 않는다(W_SMASH 0).
      playRally(seed, 'HARD', type === 'SMASH' ? 'EASY' : 'HARD', params, (e, game) => {
        if (e.type !== 'racket') return;
        const ai = game.ais.find((x) => x.player.side === e.side);
        if (ai.lastPlanType === type) { picked++; if (e.shot.shotType === shot) match++; }
      });
    }
    assert.ok(picked >= 3 && match / picked >= 0.8, `${type}: ${match}/${picked}`);
  }
});

// 7단계: 쉬움 로봇도 공에는 거의 다 닿지만 회전을 잘못 읽어 아웃·네트를 낸다. 그래서 "라켓에 맞힌 비율"이 아니라
// "상대 코트에 넘긴 비율"(내 타격 뒤 상대 코트 바운드)로 받아낸 정도를 잰다.
test('난이도: 어려움 로봇은 쉬움 로봇보다 많이 받아낸다', () => {
  // 같은 상대(보통)에게서 온 공을 받아 상대 코트에 넘긴 비율
  const returnRate = (diff) => {
    let chances = 0, returns = 0, mine = false;
    for (let seed = 1; seed <= 15; seed++) {
      playRally(seed, diff, 'NORMAL', TUNABLE, (e, game) => {
        if (e.type === 'bounce' && e.side === -1 && game.rules.phase === 'rally' && bouncedOn(game.rules, -1)) chances++;
        if (e.type === 'racket') mine = e.side === -1;
        if (mine && (e.type === 'bounce' || e.type === 'edge') && e.side === 1) { returns++; mine = false; }
      });
    }
    return returns / chances;
  };
  const easy = returnRate('EASY'), hard = returnRate('HARD');
  assert.ok(hard > easy, `쉬움 ${easy.toFixed(2)} / 어려움 ${hard.toFixed(2)}`);
  assert.deepEqual(DIFFICULTIES, ['EASY', 'NORMAL', 'HARD']);
});

test('랠리 판정 (rules.js): 정상 바운드만 세고, 두 번 바운드·자기 코트·바닥은 끝', () => {
  // 2단계 임시 판정(createRallyTracker)과 같은 시나리오를 3단계 규칙 상태 기계로 확인한다
  const ev = (type, side, extra = {}) => ({ type, side, t: 0, pos: { x: 0, y: side, z: 0 }, speed: 1, ...extra });
  const hit = (side) => ({ type: 'racket', side, racket: side, t: 0 });
  const run = (s, list) => { let r = null; for (const e of list) { const o = applyEvent(s, e); s = o.state; r = o.result ?? r; } return { s, r }; };
  let s = startRally(createRules(), 1);          // 로봇(+1)이 보냄
  assert.equal(canHit(s, -1), true);
  ({ s } = run(s, [ev('bounce', -1)]));          // 내 코트 바운드 (보낸 공은 세지 않음)
  assert.equal(s.rally, 0);
  assert.equal(bouncedOn(s, -1), true);
  ({ s } = run(s, [hit(-1), ev('net', 0, { over: true }), ev('bounce', 1)])); // 상대 코트 정상 바운드 → 1회
  assert.equal(s.rally, 1);
  let r;
  ({ s, r } = run(s, [ev('bounce', 1)]));        // 두 번 바운드 → 받을 쪽(+1) 실점
  assert.equal(s.phase, 'pointOver');
  assert.equal(r.loser, 1);

  ({ s, r } = run(startRally(createRules(), 1), [ev('bounce', -1), hit(-1), ev('bounce', -1)])); // 친 공이 자기 코트
  assert.equal(s.phase, 'pointOver');
  assert.equal(r.loser, -1);

  ({ r } = run(startRally(createRules(), 1), [ev('floor', -1)])); // 보낸 공이 바로 아웃
  assert.equal(r.loser, 1);
  ({ s } = run(startRally(createRules(), 1), [{ type: 'timeout' }]));
  assert.equal(s.phase, 'pointOver');
  assert.equal(createPlayer(-1).side, -1);
});
