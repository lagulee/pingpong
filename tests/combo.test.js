// 퍼펙트 콤보 (v7.6): PERFECT 공격 스윙을 이어 치면 콤보가 쌓이고, 공의 회전·속도가 단계마다 세진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShot, comboAfter, createRng, COMBO_SHOTS } from '../public/js/input.js';
import { createAI, createRally, stepMatch } from '../public/js/ai.js';
import { popupsFor, popupText, comboHud } from '../public/js/effects.js';
import { createBall, vec, step } from '../public/shared/physics.js';
import { TUNABLE, PHYSICS, ONLINE } from '../public/shared/constants.js';

const R = 2 * Math.PI;
const norm = (v) => Math.hypot(v.x, v.y, v.z);

// 정점에서 위로(드라이브) 또는 아래로(커트·스매시) 휘두른 샘플
function swing(k, x, z, s, sin) {
  const speed = TUNABLE.BLOCK_SPEED + s * (TUNABLE.SPEED_FULL - TUNABLE.BLOCK_SPEED);
  const out = [];
  for (let i = 0; i <= 12; i++) out.push({ t: -0.1 + i / 120, x, y: z - sin * speed * 0.1 * (1 - i / 12), b: true, k });
  return out;
}

function hit(k, combo, { x = 0.2, y = -1.5, z = 0.3, s = 0.6, dt = 0, spin = vec(), sin } = {}) {
  const ball = createBall({ pos: vec(x, y, z), vel: vec(0, -4, -1), spin, t: 0 });
  const dir = sin ?? (k === 'cut' || k === 'smash' || k === 'sidecut' ? -0.9 : 0.9);
  return { ball, shot: classifyShot(swing(k, x, z, s, dir), ball, { t: 0, side: -1, apexT: -dt, rng: createRng(5), racketX: x, combo, ringZ: z }) };
}

// 상대 코트 첫 바운드까지: { in, t }
function fly(ball, shot) {
  const b = createBall({ pos: ball.pos, vel: shot.vel, spin: shot.spin, t: 0 });
  for (let i = 0; i < 240 * 4; i++) {
    const ev = step(b, PHYSICS.DT);
    if (!ev.length || (ev[0].type === 'net' && ev[0].over)) continue;
    return { in: (ev[0].type === 'bounce' || ev[0].type === 'edge') && ev[0].pos.y > 0, t: ev[0].t };
  }
  return { in: false, t: Infinity };
}

test('콤보 규칙: PERFECT 공격 스윙만 쌓이고, 그 밖의 타격은 끊고, 서브는 그대로 둔다', () => {
  const max = TUNABLE.COMBO_MAX;
  assert.deepEqual(comboAfter(0, 'drive', 'PERFECT'), { combo: 1, level: 0 }, '첫 PERFECT는 위력 그대로');
  assert.deepEqual(comboAfter(1, 'cut', 'PERFECT'), { combo: 2, level: 1 });
  assert.deepEqual(comboAfter(20, 'smash', 'PERFECT'), { combo: 21, level: max }, '단계는 COMBO_MAX에서 멈춘다');
  for (const t of COMBO_SHOTS) assert.equal(comboAfter(3, t, 'PERFECT').combo, 4, t);
  for (const timing of ['GOOD', 'OK', 'BAD']) assert.deepEqual(comboAfter(5, 'drive', timing), { combo: 0, level: 0 }, timing);
  for (const t of ['block', 'mishit']) assert.equal(comboAfter(5, t, 'PERFECT').combo, 0, t);
  assert.equal(comboAfter(5, 'drive', 'PERFECT', { pressed: false }).combo, 0, '버튼 없이 맞은 약한 블록');
  assert.deepEqual(comboAfter(5, 'drive', 'PERFECT', { serve: true }), { combo: 5, level: 0 }, '서브');
});

test('classifyShot: 콤보 0의 PERFECT는 콤보 기능 이전과 같은 공이고, 콤보 수·단계를 quality에 남긴다', () => {
  const off = { ...TUNABLE, COMBO_SPEED: 0, COMBO_SPIN: 0, COMBO_APEX: 0 };
  for (const k of ['drive', 'cut', 'side', 'smash', null]) {
    const z = k === 'smash' ? 0.9 : 0.3;
    const a = hit(k, 0, { z }).shot;
    const ball = createBall({ pos: vec(0.2, -1.5, z), vel: vec(0, -4, -1), t: 0 });
    const b = classifyShot(swing(k, 0.2, z, 0.6, k === 'cut' || k === 'smash' ? -0.9 : 0.9), ball,
      { t: 0, side: -1, apexT: 0, rng: createRng(5), racketX: 0.2, combo: 4, ringZ: z, params: off });
    assert.deepEqual(a.vel, b.vel, `${k}: 위력 배율 0이면 콤보 4도 같은 공`);
    assert.equal(a.quality.combo, 1);
    assert.equal(b.quality.combo, 5);
    assert.equal(b.quality.comboLevel, 4);
  }
  // PERFECT가 아니면 콤보가 끊기고 위력도 오르지 않는다
  const good = hit('drive', 4, { dt: TUNABLE.PERFECT_WINDOW + 0.03 }).shot;
  assert.equal(good.quality.timing, 'GOOD');
  assert.equal(good.quality.combo, 0);
  assert.equal(good.quality.comboLevel, 0);
});

test('콤보 단계가 오를수록 회전이 커지고, 드라이브·스매시는 빨라지며, 공은 계속 상대 코트에 들어간다', () => {
  const levels = [0, 1, 3, TUNABLE.COMBO_MAX];
  for (const [k, opt] of [['drive', {}], ['cut', {}], ['side', {}], ['smash', { z: 0.9 }], ['sidedrive', {}], ['sidecut', {}]]) {
    let prev = null;
    for (const L of levels) {
      const { ball, shot } = hit(k, L, opt);
      assert.equal(shot.quality.comboLevel, L);
      const f = fly(ball, shot);
      assert.ok(f.in, `${k} 단계 ${L}: 상대 코트`);
      const cur = { w: norm(shot.spin), v: norm(shot.vel), t: f.t };
      if (prev) {
        if (k !== 'smash') assert.ok(cur.w > prev.w, `${k} 단계 ${L}: 회전 ${(prev.w / R).toFixed(1)} → ${(cur.w / R).toFixed(1)} rps`);
        if (k === 'smash') assert.ok(cur.v > prev.v + 0.3, `스매시 단계 ${L}: 속도 ${prev.v.toFixed(2)} → ${cur.v.toFixed(2)}`);
        if (k === 'drive' || k === 'sidedrive') assert.ok(cur.t < prev.t, `${k} 단계 ${L}: 체공 ${prev.t.toFixed(3)} → ${cur.t.toFixed(3)} s`);
      }
      prev = cur;
    }
  }
  // 최고 단계 회전 = 기본 회전 × (1 + COMBO_SPIN·COMBO_MAX) (드라이브 세기 1, 무회전 공: 들어온 회전 효과 0)
  const base = hit('drive', 0, { s: 1, sin: 1 }).shot, top = hit('drive', TUNABLE.COMBO_MAX, { s: 1, sin: 1 }).shot;
  const k = 1 + TUNABLE.COMBO_SPIN * TUNABLE.COMBO_MAX;
  assert.ok(Math.abs(norm(top.spin) / norm(base.spin) - k) < 0.02, `회전 배율 ${(norm(top.spin) / norm(base.spin)).toFixed(3)}`);
});

test('최고 단계 + 회전 누적 상한이어도 서버 한도(MAX_V·MAX_SPIN) 안이다', () => {
  let vmax = 0, wmax = 0;
  for (const [k, spin] of [['drive', vec(R * 100, 0, 0)], ['cut', vec(-R * 70, 0, 0)], ['side', vec(0, 0, R * 70)], ['sidedrive', vec(R * 60, 0, R * 60)]]) {
    for (const z of [0.05, 0.3, 0.7]) {
      const { shot } = hit(k, 50, { s: 1, z, spin });
      vmax = Math.max(vmax, norm(shot.vel)); wmax = Math.max(wmax, norm(shot.spin) / R);
    }
  }
  for (const z of [0.7, 1.1]) vmax = Math.max(vmax, norm(hit('smash', 50, { s: 1, z }).shot.vel));
  assert.ok(vmax <= ONLINE.MAX_V, `속도 ${vmax.toFixed(2)} m/s`);
  assert.ok(wmax <= ONLINE.MAX_SPIN, `회전 ${wmax.toFixed(1)} rps`);
});

test('경기 안: 사람 쪽은 PERFECT를 이으면 콤보가 쌓이고 실점하면 끊긴다, 로봇은 쌓지 않는다', () => {
  // 어려움 로봇(타이밍 오차 ±0.02 s < PERFECT ±0.05 s)을 "사람"으로 둔다: robot 표시를 떼면 hitPhase가 사람처럼 콤보를 센다
  const a = createAI(-1, 'HARD', createRng(11)), b = createAI(1, 'NORMAL', createRng(12));
  const g = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(13) });
  a.player.robot = false;
  let maxLevel = 0, maxCombo = 0, resets = 0, lostWithCombo = 0, robotLevels = 0;
  let before = 0, lastResults = 0;
  for (let i = 0; i < 240 * 600 && g.rules.phase !== 'gameOver'; i++) {
    for (const e of stepMatch(g)) {
      if (e.type !== 'racket' || !e.shot) continue;
      const q = e.shot.quality;
      if (e.side === 1) { robotLevels += q.comboLevel; continue; }
      if (!q.serve) {
        const want = q.timing === 'PERFECT' && q.weak === false && ['block', 'mishit'].indexOf(e.shot.shotType) < 0 ? before + 1 : 0;
        assert.equal(q.combo, want, `콤보 ${before} → ${q.combo} (${q.timing} ${e.shot.shotType})`);
        if (want === 0 && before > 0) resets++;
      }
      maxLevel = Math.max(maxLevel, q.comboLevel); maxCombo = Math.max(maxCombo, q.combo);
      before = a.player.combo;
    }
    // 실점 뒤 다음 서브 대기에서 콤보가 0이 된다
    if (g.results.length > lastResults && g.holding) {
      const r = g.results.at(-1);
      if (r.loser === -1) { assert.equal(a.player.combo, 0, '실점하면 콤보 끊김'); if (before > 0) lostWithCombo++; before = 0; }
      lastResults = g.results.length;
    }
  }
  assert.equal(robotLevels, 0, '로봇 타격에는 콤보 위력이 붙지 않는다');
  assert.equal(b.player.combo, 0);
  assert.ok(maxCombo >= 3 && maxLevel >= 2, `최대 콤보 ${maxCombo}, 단계 ${maxLevel}`);
  assert.ok(resets + lostWithCombo > 0, '콤보가 끊기는 경우가 있다');
});

test('연출: 둘째 연속 PERFECT부터 "PERFECT ×N" 팝업, 단계가 오를수록 크고 붉어진다. HUD는 콤보 1 이상에서 보인다', () => {
  const ev = (combo, comboLevel, side = -1) => ({ type: 'racket', side, pos: vec(), shot: { shotType: 'drive', quality: { timing: 'PERFECT', combo, comboLevel } } });
  assert.deepEqual(popupsFor(ev(1, 0)), ['perfect']);
  assert.deepEqual(popupsFor(ev(3, 2)), ['combo']);
  assert.deepEqual(popupsFor(ev(3, 2, 1)), [], '상대 타격에는 띄우지 않는다');
  const lo = popupText('combo', ev(2, 1)), hi = popupText('combo', ev(9, TUNABLE.COMBO_MAX));
  assert.equal(lo.text, 'PERFECT ×2');
  assert.equal(hi.text, 'PERFECT ×9');
  assert.ok(hi.size > lo.size);
  assert.equal(hi.color, '#ff3b30');
  assert.equal(popupText('perfect', ev(1, 0)).text, 'PERFECT');
  assert.equal(comboHud(0), null);
  assert.match(comboHud(1).text, /×1 .*1\/5단계/);
  assert.match(comboHud(30).text, /×30 .*5\/5단계/);
});
