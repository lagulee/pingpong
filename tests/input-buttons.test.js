// 7단계 구질 버튼 테스트: 버튼 판정, 판정용 회전(carriedSpin), 회전 누적과 상한, 일반 스윙의 회전 영향,
// 스매시(높은 공 / 노란 고리), 서브 버튼, 로봇의 회전 읽기, 서버 구질 허용 목록, 회전 표시, 키·화면 버튼.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyShot, buttonAt, createShotKeys, judgeType, stackSpin, spinParts, createRng, resolveShotKeys, shotKeysOf,
} from '../public/js/input.js';
import { createTouchTracker } from '../public/js/touch.js';
import { createAI, createRally, stepMatch, readSpin, misreadChance } from '../public/js/ai.js';
import { trailColor, spinRead, popupsFor, TRAIL_COLORS } from '../public/js/effects.js';
import { createBall, step, cloneBall, carriedSpin, toWorld, vec, scale } from '../public/shared/physics.js';
import { createMatch } from '../public/shared/match.js';
import { checkHitMsg } from '../public/shared/host.js';
import {
  TUNABLE, NET, PHYSICS, SWING, SHOT_KEYS, SHOT_BUTTONS, SHOT_TYPES, FEEL, ONLINE, SHOT_LABELS, SHOT_COMBOS,
} from '../public/shared/constants.js';

const RPS = 2 * Math.PI;
const DT = PHYSICS.DT;
const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

// 내 쪽(side −1, 기준 좌표 = 세계 좌표)으로 오는 공. 바운드 뒤 정점 부근처럼 느린 공이 기본 (실제 경기의 타점)
// topspin·sidespin: 들어오는 방향 기준 rps (탑 +, 백 −, 횡 + = 위에서 봐서 반시계)
function incoming({ x = 0, y = -1.4, z = 0.35, vy = -2.5, vz = 0, topspin = 0, sidespin = 0, t = 1 } = {}) {
  return createBall({ pos: { x, y, z }, vel: { x: 0, y: vy, z: vz }, spin: { x: topspin * RPS, y: 0, z: sidespin * RPS }, t });
}

// 버튼 k를 누른 채 (x1, z1)에 도착하는 직선 스윙 (120 Hz, 0.15 s). dir: 위(+1)·아래(−1)
function swing({ k = null, speed = 2.0, dir = 1, x1 = 0, z1 = 0.35, t1 = 1, ux = 0.1 }) {
  const out = [];
  const n = 18, T = 0.15;
  const uy = dir * Math.sqrt(1 - ux * ux);
  for (let i = 0; i <= n; i++) {
    const back = T * (1 - i / n);
    out.push({ t: t1 - back, x: x1 - ux * speed * back, y: z1 - uy * speed * back, b: true, k });
  }
  return out;
}

// 친 공의 첫 결과: 'in'(상대 코트) · 'net'(내 쪽으로 떨어짐·그물) · 'out'(바닥 등)
function outcome(ball, r) {
  const b = createBall({ pos: ball.pos, vel: r.vel, spin: r.spin, t: ball.t });
  for (let i = 0; i < 240 * 4; i++) {
    const ev = step(b, DT);
    if (!ev.length || (ev[0].type === 'net' && ev[0].over)) continue;
    const e = ev[0];
    if (e.type === 'bounce' || e.type === 'edge') return { kind: e.pos.y > 0 ? 'in' : 'net', pos: e.pos };
    return { kind: e.type === 'net' ? 'net' : 'out', pos: e.pos };
  }
  return { kind: 'out', pos: b.pos };
}

// ── 버튼 ───────────────────────────────────────────────
test('구질 버튼: 나중에 누른 버튼이 이기고, 떼면 앞서 누른 버튼으로 돌아간다', () => {
  const k = createShotKeys();
  assert.equal(k.current, null);
  k.press('drive');
  k.press('cut');
  assert.equal(k.current, 'cut', '두 개를 누르면 나중 것');
  k.release('cut');
  assert.equal(k.current, 'drive');
  // v7.3: 같은 버튼을 두 곳(모바일 단일·조합 버튼)에서 누르면, 둘 다 뗄 때까지 눌린 상태
  k.press('drive');
  k.release('drive');
  assert.equal(k.current, 'drive', '아직 한 곳에서 누르고 있음');
  k.release('drive');
  assert.equal(k.current, null);
  k.press('nope');
  assert.equal(k.current, null, '모르는 버튼은 무시');
  k.press('side'); k.press('smash'); k.clear();
  assert.equal(k.current, null);
  // PC 키 배치
  assert.deepEqual(SHOT_KEYS, { KeyQ: 'drive', KeyW: 'cut', KeyE: 'side', KeyR: 'smash' });
  assert.deepEqual([...SHOT_BUTTONS].sort(), ['cut', 'drive', 'side', 'smash']);
});

test('구질 버튼 인정 시간: 접촉 직전 BUTTON_WINDOW 안에 눌려 있던 버튼만 인정한다 (조금 일찍 떼도 인정)', () => {
  const W = TUNABLE.BUTTON_WINDOW;
  const mk = (list) => list.map(([t, k]) => ({ t, x: 0, y: 0.3, b: true, k }));
  assert.equal(buttonAt(mk([[0.9, null], [0.95, 'cut'], [1.0, 'cut']]), 1.0), 'cut');
  // 접촉 0.03 s 전에 뗌 → 인정
  assert.equal(buttonAt(mk([[0.9, 'drive'], [1 - 0.03, null], [1.0, null]]), 1.0), 'drive');
  // 창보다 오래전에 뗌 → 일반
  assert.equal(buttonAt(mk([[0.5, 'drive'], [1 - W - 0.05, null], [1 - W / 2, null], [1.0, null]]), 1.0), null);
  // 마우스가 멈춰 있어 창 안에 샘플이 없어도, 창 시작 순간 눌려 있던 버튼은 인정
  assert.equal(buttonAt(mk([[0.5, 'side']]), 1.0), 'side');
  // 접촉 뒤 샘플은 보지 않는다
  assert.equal(buttonAt(mk([[0.9, null], [1.05, 'smash']]), 1.0), null);
  // 같은 창 안에서 바꿔 누르면 가장 최근 버튼
  assert.equal(buttonAt(mk([[0.95, 'drive'], [0.98, 'cut']]), 1.0), 'cut');
});

test('버튼을 누른 채 라켓을 멈추면 버튼과 상관없이 블록, 버튼 없이 휘두르면 일반 스윙', () => {
  const still = { speed: 0, u: { x: 0, y: 0 }, sin: 0, kappa: 0 };
  const fast = { speed: 3, u: { x: 0, y: 3 }, sin: 1, kappa: 0 };
  for (const k of [null, ...SHOT_BUTTONS]) assert.equal(judgeType(still, 0.3, TUNABLE, true, k), 'block', `${k} + 멈춤`);
  assert.equal(judgeType(fast, 0.3, TUNABLE, true, null), 'normal');
  assert.equal(judgeType(fast, 0.3, TUNABLE, false, 'drive'), 'block', '마우스 버튼 없음 = 약한 블록');
  // 스매시 기준 속도: 넘겨 준 기준보다 느리면 일반 (v7.3 기본값 0 = 휘두르기만 하면 스매시)
  assert.equal(judgeType({ ...fast, speed: 1.99 }, 0.9, TUNABLE, true, 'smash', 2.0), 'normal', '느린 스매시');
  assert.equal(judgeType({ ...fast, speed: TUNABLE.BLOCK_SPEED + 0.01 }, 0.9, TUNABLE, true, 'smash'), 'smash', '기본값: 느려도 스매시');
  assert.equal(judgeType(fast, NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT, TUNABLE, true, 'smash'), 'smash');
  assert.equal(judgeType(fast, NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT - 0.01, TUNABLE, true, 'smash'), 'mishit', '노란 고리');
  assert.ok(SHOT_TYPES.includes('normal'));
});

// ── 판정용 회전 ─────────────────────────────────────────
test('판정용 회전: 친 회전에 공기 중 감쇠(스텝마다 1 − SPIN_DECAY·dt)만 곱하고 테이블 마찰은 빼고 센다', () => {
  const hit = { t: 0, spin: vec(10, -20, 30) };
  const w = carriedSpin(hit, 1.0);
  const k = Math.pow(1 - TUNABLE.SPIN_DECAY * DT, 240) * TUNABLE.SPIN_CARRY;
  for (const c of ['x', 'y', 'z']) assert.ok(Math.abs(w[c] - hit.spin[c] * k) < 1e-9);
  // 바운드 없이 날아가는 공의 실제 회전과 같다 (공중 감쇠는 물리와 같은 식)
  const b = createBall({ pos: vec(0, 0, 3), vel: vec(0, 0.1, 0), spin: hit.spin, t: 0 });
  for (let i = 0; i < 240; i++) step(b, DT);
  for (const c of ['x', 'y', 'z']) assert.ok(Math.abs(b.spin[c] - w[c] / TUNABLE.SPIN_CARRY) < 1e-9);
  assert.equal(carriedSpin(null, 1), null, '토스한 공은 판정용 회전 없음');
  const half = carriedSpin(hit, 1.0, { ...TUNABLE, SPIN_CARRY: 0.5 });
  assert.ok(Math.abs(half.z - w.z * 0.5 / TUNABLE.SPIN_CARRY) < 1e-9);
  // 물리 바운드는 백스핀을 거의 지우지만 판정용 회전은 남는다 (그래서 커트를 읽고 쌓을 수 있다):
  // 실제 커트(무회전 공을 커트 버튼으로)를 상대 코트 바운드 뒤 정점까지 날려 비교한다
  const src = incoming();
  const r = classifyShot(swing({ k: 'cut', dir: -1 }), src, { apexT: 1 });
  const cut = createBall({ pos: src.pos, vel: r.vel, spin: r.spin, t: 1 });
  let bounced = false;
  for (let i = 0; i < 240 * 3 && !(bounced && cut.vel.z <= 0); i++) bounced = step(cut, DT).some((e) => e.type === 'bounce') || bounced;
  assert.ok(bounced);
  const carried = carriedSpin({ t: 1, spin: r.spin }, cut.t);
  assert.ok(Math.abs(cut.spin.x) < 0.5 * Math.abs(carried.x), `물리 ${(cut.spin.x / RPS).toFixed(1)} / 판정용 ${(carried.x / RPS).toFixed(1)} rps`);
});

test('classifyShot은 spinIn(판정용 회전)을 공의 물리 회전 대신 들어온 회전으로 읽는다', () => {
  const b = incoming({ topspin: 0 });
  const withIn = classifyShot(swing({}), b, { apexT: 1, spinIn: vec(-30 * RPS, 0, 0) }); // 백스핀 30 rps를 읽음
  const asBall = classifyShot(swing({}), incoming({ topspin: -30 }), { apexT: 1 });
  assert.deepStrictEqual(withIn.vel, asBall.vel);
  assert.ok(withIn.quality.spinIn.top < -29);
});

// ── 일반 스윙: 들어온 회전을 그대로 받는다 ────────────────────────
test('일반 스윙: 무회전 공은 들어가고, 백스핀은 네트, 탑스핀은 떠서 아웃, 횡회전은 옆으로 나간다', () => {
  const normal = (o) => { const b = incoming(o); return outcome(b, classifyShot(swing({}), b, { apexT: 1 })); };
  for (const z of [0.25, 0.4]) {
    assert.equal(normal({ z }).kind, 'in', `무회전 z ${z}`);
    assert.equal(normal({ z, topspin: -30 }).kind, 'net', `백스핀 30 z ${z}`);
    assert.equal(normal({ z, topspin: 45 }).kind, 'out', `탑스핀 45 z ${z}`);
    const sd = normal({ z, sidespin: 40 });
    assert.ok(sd.kind !== 'in' || Math.abs(sd.pos.x) > 0.6, `횡회전 40 z ${z}: ${sd.kind} x=${sd.pos.x.toFixed(2)}`);
  }
  // 같은 공을 맞는 버튼으로 치면 넘어간다
  const right = (k, o, dir = 1) => { const b = incoming(o); return outcome(b, classifyShot(swing({ k, dir }), b, { apexT: 1 })).kind; };
  assert.equal(right('drive', { topspin: -30 }), 'in', '백스핀 → 드라이브');
  assert.equal(right('cut', { topspin: -30 }, -1), 'in', '백스핀 → 커트');
  assert.equal(right('drive', { topspin: 45 }), 'in', '탑스핀 → 드라이브');
  assert.equal(right('cut', { topspin: 45 }, -1), 'in', '탑스핀 → 커트(백스핀으로 바꿈)');
  assert.equal(right('side', { sidespin: 40 }), 'in', '횡회전 → 사이드');
});

test('회전이 쌓일수록 일반 스윙의 실수가 커진다 (들어온 회전의 효과가 회전량에 따라 증가)', () => {
  const dvz = (back) => {
    const b = incoming({ topspin: -back });
    return classifyShot(swing({}), b, { apexT: 1 }).vel.z - classifyShot(swing({}), incoming(), { apexT: 1 }).vel.z;
  };
  const a = dvz(15), c = dvz(35), d = dvz(60);
  assert.ok(a < 0 && c < a && d < c, `백스핀 15/35/60 rps → 위아래 속도 변화 ${a.toFixed(2)} / ${c.toFixed(2)} / ${d.toFixed(2)} m/s`);
  // 사이드 버튼은 센 탑·백 공에 약하다: 회전이 커지면 실패
  const sideVs = (top) => { const b = incoming({ topspin: top }); return outcome(b, classifyShot(swing({ k: 'side', ux: 0.9 }), b, { apexT: 1 })).kind; };
  assert.notEqual(sideVs(100), 'in', '탑 100 rps에 사이드');
  assert.notEqual(sideVs(-70), 'in', '백 70 rps에 사이드');
});

// ── 스매시 ─────────────────────────────────────────────
test('스매시: 높은 공이면 들어온 회전과 상관없이 넘어가고, 노란 고리(낮은 공)면 무조건 네트', () => {
  const zHi = NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT + 0.1;
  for (const [top, side] of [[0, 0], [100, 0], [-70, 0], [0, 70], [60, -50]]) {
    const b = incoming({ z: zHi, topspin: top, sidespin: side, vy: -3 });
    const r = classifyShot(swing({ k: 'smash', speed: 4, dir: -1, z1: zHi }), b, { apexT: 1 });
    assert.equal(r.shotType, 'smash');
    assert.equal(outcome(b, r).kind, 'in', `탑 ${top} 횡 ${side}`);
  }
  for (const z of [0.1, 0.3, NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT - 0.01]) {
    for (const top of [0, 60, -60]) {
      const b = incoming({ z, topspin: top });
      const r = classifyShot(swing({ k: 'smash', speed: 4, dir: -1, z1: z }), b, { apexT: 1 });
      assert.equal(r.shotType, 'mishit');
      assert.equal(outcome(b, r).kind, 'net', `z ${z} 탑 ${top}`);
    }
  }
});

// ── 회전 누적 ───────────────────────────────────────────
// 같은 구질로 n번 주고받는다 (양쪽이 번갈아, 비행 1 s, 세기 1). 반환: 타마다 quality.stack
function chain(type, n, { dir = 1, ux = 0.1, speed = 3.6 } = {}) {
  let side = -1, inSpin = vec();
  const stacks = [];
  for (let i = 0; i < n; i++) {
    const ball = createBall({ pos: toWorld(vec(0, -1.4, 0.35), side), vel: toWorld(vec(0, -2.5, 0), side), spin: inSpin, t: 1 });
    const r = classifyShot(swing({ k: type, dir, ux, speed }), ball, { side, apexT: 1 });
    assert.equal(r.shotType, type);
    stacks.push(r.quality.stack);
    inSpin = carriedSpin({ t: 0, spin: r.spin }, 1.0);
    side = -side;
  }
  return stacks;
}

test('회전 누적: 같은 구질로 주고받을수록 회전이 커지고 상한에서 멈춘다 (커트·드라이브·사이드)', () => {
  for (const [type, dir, ux] of [['cut', -1, 0.1], ['drive', 1, 0.1], ['side', 0.2, 0.95]]) {
    const st = chain(type, 6, { dir, ux });
    const cap = TUNABLE[`${type.toUpperCase()}_SPIN_CAP`];
    assert.equal(st[0].add, 0, `${type}: 첫 타는 누적 없음`);
    assert.ok(st[1].spin > st[0].spin + 5, `${type}: 두 번째 타에 회전 증가 ${st[0].spin.toFixed(1)} → ${st[1].spin.toFixed(1)}`);
    for (let i = 1; i < st.length; i++) assert.ok(st[i].spin >= st[i - 1].spin - 1e-9, `${type}: 줄지 않음`);
    for (const s of st) assert.ok(s.spin <= cap + 1e-9, `${type}: 상한 ${cap}`);
    const capAt = st.findIndex((s) => s.capped);
    assert.ok(capAt >= 1 && capAt <= 3, `${type}: 상한 도달 ${capAt + 1}번째 타 (${st.map((s) => s.spin.toFixed(0)).join(' → ')})`);
  }
});

test('회전 누적: 다른 종류 회전으로 받으면 쌓이지 않는다 (커트 → 드라이브, 드라이브 → 커트, 탑·백 → 사이드)', () => {
  const b = (o) => incoming(o);
  const base = (type, o, dir) => classifyShot(swing({ k: type, dir }), b(o), { apexT: 1 }).quality.stack;
  assert.equal(base('drive', { topspin: -50 }, 1).add, 0);
  assert.equal(base('cut', { topspin: 50 }, -1).add, 0);
  assert.equal(base('side', { topspin: 50 }, 1).add, 0);
  assert.ok(base('drive', { topspin: 50 }, 1).add > 0);
  assert.ok(base('cut', { topspin: -50 }, -1).add > 0);
  // 공식: min(상한, 기본 + STACK × 들어온 같은 회전)
  const s = stackSpin('cut', 40, incoming({ topspin: -20 }));
  assert.ok(Math.abs(s.spin - Math.min(TUNABLE.CUT_SPIN_CAP, 40 + TUNABLE.CUT_STACK * 20)) < 1e-9);
  assert.equal(stackSpin('cut', 40, incoming({ topspin: -100 })).spin, TUNABLE.CUT_SPIN_CAP);
  assert.ok(Math.abs(spinParts(incoming({ topspin: 12, sidespin: -7 })).side + 7) < 1e-9);
});

test('회전 누적 상한은 서버 검증 한도(MAX_SPIN) 안이다', () => {
  for (const P of ['DRIVE', 'CUT', 'SIDE']) assert.ok(TUNABLE[`${P}_SPIN_CAP`] <= ONLINE.MAX_SPIN / 1.2, P);
  assert.ok(Math.hypot(TUNABLE.SIDE_SPIN_CAP, TUNABLE.SIDE_TOP_MAX) <= ONLINE.MAX_SPIN / 1.2);
});

// ── 서브 ───────────────────────────────────────────────
test('서브: 버튼 없음 = 무회전, Q 탑·W 백·E 횡, R(스매시)은 막아 일반 서브', () => {
  const toss = createBall({ pos: { x: 0, y: -1.55, z: 0.3 }, vel: { x: 0, y: 0, z: -1 }, t: 1 });
  const serve = (k, dir = 1, ux = 0.1) => classifyShot(swing({ k, dir, ux, z1: 0.3, speed: 2 }), toss, { serve: true, apexT: 1 });
  const n = serve(null);
  assert.equal(n.shotType, 'normal');
  assert.ok(Math.hypot(n.spin.x, n.spin.y, n.spin.z) < 1e-9, '무회전 서브');
  assert.ok(serve('drive').spin.x < 0, '탑스핀 서브 (+y로 칠 때 탑스핀 축 −x)');
  assert.ok(serve('cut', -1).spin.x > 0, '백스핀 서브');
  assert.ok(Math.abs(serve('side', 0.2, 0.95).spin.z) > 5 * RPS, '횡회전 서브');
  const sm = serve('smash', -1);
  assert.equal(sm.shotType, 'normal');
  assert.equal(sm.quality.smashNoServe, true);
});

// ── 로봇 ───────────────────────────────────────────────
test('로봇 회전 읽기: 종류·세기를 읽고, 쉬울수록·회전이 셀수록 자주 잘못 고른다', () => {
  assert.equal(readSpin(incoming({ topspin: 3 })).kind, 'none');
  assert.equal(readSpin(incoming({ topspin: 50 })).kind, 'top');
  assert.equal(readSpin(incoming({ topspin: -50 })).kind, 'back');
  assert.equal(readSpin(incoming({ sidespin: 60, topspin: 20 })).kind, 'side');
  assert.equal(readSpin(incoming({ topspin: -TUNABLE.CUT_SPIN_CAP * 2 })).level, 1);
  // 잘못 읽을 확률: 쉬울수록, 회전이 셀수록 크다 (계획: 상한 회전에서 쉬움 40%·보통 10%·어려움 3%)
  for (const L of [0, 0.5, 1]) {
    assert.ok(misreadChance('EASY', L) > misreadChance('NORMAL', L) && misreadChance('NORMAL', L) > misreadChance('HARD', L));
  }
  for (const d of ['EASY', 'NORMAL', 'HARD']) assert.ok(misreadChance(d, 1) > misreadChance(d, 0.3) && misreadChance(d, 0.3) > misreadChance(d, 0));
  // 난이도별로 실제 경기에서 잘못 고른 비율
  const rate = {};
  for (const d of ['EASY', 'NORMAL', 'HARD']) {
    let n = 0, wrong = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const a = createAI(-1, d, createRng(seed * 7 + 1)), b = createAI(1, d, createRng(seed * 13 + 5));
      const g = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(seed) });
      for (let i = 0; i < 240 * 1800 && g.rules.phase !== 'gameOver'; i++) {
        for (const e of stepMatch(g)) {
          if (e.type !== 'racket' || e.shot.quality.serve) continue;
          const r = (e.side === -1 ? a : b).lastRead;
          if (!r || r.kind === 'none') continue;
          n++; if (r.wrong) wrong++;
        }
      }
    }
    rate[d] = wrong / n;
  }
  assert.ok(rate.EASY > rate.NORMAL && rate.NORMAL > rate.HARD, JSON.stringify(rate));
});

// ── 서버 ───────────────────────────────────────────────
test('서버: 구질 이름은 허용 목록(일반 포함)만 받고, 그 밖은 bad로 거부한다', () => {
  const g = createMatch();
  const msg = (shotType) => ({ type: 'hit', pos: vec(), vel: vec(0, 1, 0), spin: vec(), racket: { x: 0, z: 0 }, shotType });
  assert.equal(checkHitMsg(g, -1, msg('superdrive')), 'bad');
  assert.equal(checkHitMsg(g, -1, msg(42)), 'bad');
  for (const t of SHOT_TYPES) assert.notEqual(checkHitMsg(g, -1, msg(t)), 'bad', t);
  const host = read('shared/host.js');
  assert.match(host, /SHOT_TYPES\.includes\(msg\.shotType\)/);
});

test('대전 되감기: 경기 상태 기록에 판정용 회전의 출발점(inSpin)이 들어간다', () => {
  const host = read('shared/host.js');
  assert.match(host, /inSpin: g\.inSpin/);
  assert.match(host, /g\.inSpin = s\.inSpin/);
  assert.match(read('shared/match.js'), /game\.inSpin = \{ t, spin/);
});

// ── 회전 표시 ───────────────────────────────────────────
test('회전 표시: 꼬리 색은 회전이 셀수록 진하고, 세기 칸은 1~SPIN_LEVELS, MAX SPIN 팝업은 내 상한 타격만', () => {
  const vel = vec(0, -3, 0);
  const dist = (c) => { const n = TRAIL_COLORS.none; return Math.hypot(((c >> 16) & 255) - ((n >> 16) & 255), ((c >> 8) & 255) - ((n >> 8) & 255), (c & 255) - (n & 255)); };
  const back = (rps) => trailColor(vel, vec(rps * RPS, 0, 0)); // −y로 가는 공의 탑스핀 축은 +x → 음수 = 백스핀
  assert.ok(dist(back(-60)) > dist(back(-20)) && dist(back(-20)) > 0);
  assert.equal(back(-TUNABLE.CUT_SPIN_CAP), TRAIL_COLORS.back, '상한이면 원래 색 그대로');
  assert.equal(trailColor(vel, vec()), TRAIL_COLORS.none);
  assert.equal(spinRead(vel, vec(-TUNABLE.CUT_SPIN_CAP * RPS, 0, 0)).level, FEEL.SPIN_LEVELS);
  assert.equal(spinRead(vel, vec(-(TUNABLE.TRAIL_SPIN_MIN + 1) * RPS, 0, 0)).level, 1);
  assert.equal(spinRead(vel, vec(0, 0, 50 * RPS)).kind, 'side');
  const hit = (side, capped) => ({ type: 'racket', side, shot: { shotType: 'cut', quality: { timing: 'OK', stack: { capped } } } });
  assert.deepEqual(popupsFor(hit(-1, true)), ['spinmax']);
  assert.deepEqual(popupsFor(hit(1, true)), []);
  assert.deepEqual(popupsFor(hit(-1, false)), []);
});

// ── 키·화면 버튼 ─────────────────────────────────────────
test('키: Space = 시점(기본 동작 막음), N = 새 게임, R은 새 게임이 아니다. 일시정지 화면에 메인화면 버튼', () => {
  const main = read('js/main.js');
  assert.match(main, /e\.code === 'Space'\) \{\s*e\.preventDefault\(\)/);
  assert.match(main, /e\.code === 'KeyN'.*newGame\(\)/);
  assert.doesNotMatch(main, /'KeyR'\) newGame/);
  assert.doesNotMatch(main, /'KeyC'/);
  assert.match(main, /typing\(e\)\) return/, '입력창에서는 무시');
  assert.match(main, /tap\(\$\('pause-menu'\), \(\) => \{ setPaused\(false\); toMenu\(\); \}\)/);
  const html = read('index.html');
  assert.match(html, /id="pause-menu"/);
  const btns = html.match(/<div id="shot-btns"[\s\S]*?<\/div>/)[0];
  for (const k of SHOT_BUTTONS) assert.match(btns, new RegExp(`data-k="${k}"`));
});

test('모바일: 화면 버튼(왼손)은 손가락 샘플의 k가 되고, 버튼을 바꾸면 바로 기록된다 (두 번째 손가락 규칙과 별개)', () => {
  const samples = [];
  let btn = null;
  const tr = createTouchTracker(samples, { toPlane: (x, y) => ({ x: x / 1000, z: 0.3 - y / 1000 }), button: () => btn });
  tr.down(1, 100, 100, 1);
  btn = 'cut';
  tr.mark(1.01);
  tr.move(1, 100, 140, 1.02);
  assert.deepEqual(samples.map((s) => s.k), [null, 'cut', 'cut']);
  assert.equal(buttonAt(samples, 1.02), 'cut');
  assert.equal(tr.down(2, 300, 300, 1.03), false, '캔버스 위 두 번째 손가락은 여전히 무시');
});

// v7.2 사용자 피드백: 빨간 고리에서 스매시를 해도 네트에 걸림. 고리 색은 예측 정점 높이로 정하는데 판정은 맞은 순간 높이로 해서,
// 정점보다 일찍·늦게 치면 기준 아래에서 맞아 실타가 됐다 → 사람은 고리 높이(ringZ)로 판정, 맞은 높이 하한 SMASH_RING_FLOOR
test('빨간 고리 스매시: 정점보다 일찍·늦게 쳐 맞은 높이가 기준보다 낮아도 스매시로 들어가고, 노란 고리는 그대로 실타', () => {
  const H = NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT;
  const floor = NET.HEIGHT + TUNABLE.SMASH_RING_FLOOR;
  const smash = (z, ringZ, top = 0) => {
    const b = incoming({ z, vz: -1.5, topspin: top });
    const r = classifyShot(swing({ k: 'smash', speed: 3.5, dir: -1, z1: z }), b, { apexT: 1.1, ringZ });
    return { r, out: outcome(b, r).kind };
  };
  for (const z of [floor, (floor + H) / 2, H - 0.01]) for (const top of [0, 60, -50]) {
    const { r, out } = smash(z, H + 0.1, top);
    assert.equal(r.shotType, 'smash', `빨간 고리, 맞은 높이 ${z.toFixed(2)}`);
    assert.equal(out, 'in', `빨간 고리, 맞은 높이 ${z.toFixed(2)}, 탑 ${top}`);
  }
  assert.equal(smash(H - 0.1, H - 0.05).r.shotType, 'mishit', '노란 고리는 실타');
  assert.equal(smash(H - 0.1).r.shotType, 'mishit', '고리 정보 없음(로봇)은 맞은 높이로');
  const late = smash(floor - 0.03, H + 0.1);
  assert.equal(late.r.shotType, 'mishit', '빨간 고리라도 너무 늦게(하한 아래) 치면 실타');
  assert.equal(late.out, 'net');
  // 사람 타격은 화면 고리 높이를 넘긴다 (ai.js hitPhase)
  assert.match(read('js/ai.js'), /ringZ: serveHit \|\| p\.robot \? undefined : p\.apexPos\?\.z/);
});

// ── v7.3 사용자 요청: 빨간 고리 스매시 성공률↑, 버튼 동시 누름(조합 구질) ──────────────────

// 빨간 고리 사람 대역: 맞은 높이 × 위치 × 스윙 속도·방향 × 타이밍 오차 × 들어온 회전
test('빨간 고리 스매시: 느린 스윙·늦은 타이밍·낮은 타점(0.2 m까지)이 섞여도 99% 이상 상대 코트에 들어간다', () => {
  const H = NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT;
  let n = 0, ok = 0, seed = 1;
  const fails = {};
  for (const z of [0.21, 0.3, 0.4, 0.6, 0.9]) for (const y of [-0.8, -1.3, -1.6]) for (const x of [0, -0.6]) {
    for (const speed of [0.6, 1.5, 3.5]) for (const dir of [-1, 1]) for (const dt of [0, 0.15, 0.25]) for (const top of [0, 60, -50]) {
      const b = incoming({ x, y, z, vz: -1, topspin: top });
      const r = classifyShot(swing({ k: 'smash', speed, dir, z1: z, x1: x }), b, { apexT: 1 - dt, rng: createRng(seed++), ringZ: H + 0.1, racketX: x });
      const res = r.shotType === 'smash' ? outcome(b, r).kind : r.shotType;
      n++; if (res === 'in') ok++; else fails[`${res} z${z}`] = (fails[`${res} z${z}`] ?? 0) + 1;
    }
  }
  assert.ok(ok / n >= 0.99, `${ok}/${n} ${JSON.stringify(fails)}`);
  // 낮은 타점은 속도 보조로 늦춰서 넣는다 (SMASH_ASSIST_V 이상), 높은 타점은 보조 없이 빠르게
  const low = incoming({ z: 0.22, vz: -1 }), high = incoming({ z: 0.9, vz: -1 });
  const sp = (b) => { const r = classifyShot(swing({ k: 'smash', speed: 3.5, dir: -1, z1: b.pos.z }), b, { apexT: 1, ringZ: H + 0.1 }); return Math.hypot(r.vel.x, r.vel.y, r.vel.z); };
  assert.ok(sp(high) >= TUNABLE.SMASH_V_MIN, `높은 타점 ${sp(high).toFixed(1)} m/s`);
  assert.ok(sp(low) < sp(high) && sp(low) >= TUNABLE.SMASH_ASSIST_V - 0.5, `낮은 타점 ${sp(low).toFixed(1)} m/s`);
  // 하한(네트 + SMASH_RING_FLOOR)보다 낮으면 여전히 실타
  const tooLow = incoming({ z: NET.HEIGHT + TUNABLE.SMASH_RING_FLOOR - 0.02 });
  assert.equal(classifyShot(swing({ k: 'smash', speed: 3.5, dir: -1, z1: tooLow.pos.z }), tooLow, { apexT: 1, ringZ: H + 0.1 }).shotType, 'mishit');
});

test('버튼 동시 누름: W+E = 사이드 커트(횡+백), Q+E = 사이드 드라이브(횡+탑), R은 섞이지 않음, Q+W는 나중 것', () => {
  assert.equal(resolveShotKeys(['cut', 'side']), 'sidecut');
  assert.equal(resolveShotKeys(['side', 'cut']), 'sidecut');
  assert.equal(resolveShotKeys(['drive', 'side']), 'sidedrive');
  assert.equal(resolveShotKeys(['side', 'smash']), 'smash');
  assert.equal(resolveShotKeys(['cut', 'side', 'smash']), 'smash');
  assert.equal(resolveShotKeys(['drive', 'cut']), 'cut');
  assert.equal(resolveShotKeys(['cut', 'drive', 'side']), 'sidedrive', '드라이브·커트 중 나중 것 + 사이드');
  assert.equal(resolveShotKeys([]), null);
  const k = createShotKeys();
  k.press('cut'); k.press('side');
  assert.equal(k.current, 'sidecut');
  k.release('cut');
  assert.equal(k.current, 'side', '하나를 떼면 남은 버튼');
  assert.deepEqual(shotKeysOf('sidecut'), ['cut', 'side']);
  assert.deepEqual(shotKeysOf('drive'), ['drive']);
  for (const t of Object.keys(SHOT_COMBOS)) {
    assert.ok(SHOT_TYPES.includes(t) && SHOT_LABELS[t], `${t}: 서버 허용 목록·표시 이름`);
    assert.equal(judgeType({ speed: 2, u: { x: 0, y: 2 }, sin: 1, kappa: 0 }, 0.3, TUNABLE, true, t), t);
  }
});

test('조합 구질: 사이드 커트는 백스핀 + 횡회전, 사이드 드라이브는 탑스핀 + 횡회전이 함께 걸린다', () => {
  for (const [type, sign] of [['sidecut', -1], ['sidedrive', 1]]) {
    const b = incoming();
    const r = classifyShot(swing({ k: type, ux: 0.8, dir: sign }), b, { apexT: 1 });
    assert.equal(r.shotType, type);
    const local = { vel: r.vel, spin: r.spin };
    const parts = spinParts({ vel: { x: -local.vel.x, y: -local.vel.y }, spin: { x: -local.spin.x, y: -local.spin.y, z: local.spin.z } });
    // 친 공(+y로 감)의 탑스핀 축은 −x: 백스핀이면 spin.x > 0, 탑스핀이면 < 0
    assert.ok(sign < 0 ? r.spin.x > 5 * RPS : r.spin.x < -5 * RPS, `${type}: 탑/백 ${(r.spin.x / RPS).toFixed(1)}`);
    assert.ok(Math.abs(r.spin.z) > 5 * RPS, `${type}: 횡 ${(r.spin.z / RPS).toFixed(1)}`);
    assert.ok(Number.isFinite(parts.top));
    assert.equal(outcome(b, r).kind, 'in', `${type}: 무회전 공`);
  }
  // 각 성분이 같은 종류로 쌓인다: 사이드 커트는 들어온 백스핀·횡회전 모두로 커진다
  const base = classifyShot(swing({ k: 'sidecut', ux: 0.8, dir: -1 }), incoming(), { apexT: 1 }).quality.stack;
  const back = classifyShot(swing({ k: 'sidecut', ux: 0.8, dir: -1 }), incoming({ topspin: -40 }), { apexT: 1 }).quality.stack;
  const side = classifyShot(swing({ k: 'sidecut', ux: 0.8, dir: -1 }), incoming({ sidespin: 40 }), { apexT: 1 }).quality.stack;
  assert.ok(back.spin > base.spin + 5 && side.spin > base.spin + 5, `${base.spin.toFixed(1)} / 백 ${back.spin.toFixed(1)} / 횡 ${side.spin.toFixed(1)}`);
  // 맞는 상대: 사이드 커트는 백스핀 공, 사이드 드라이브는 탑스핀 공을 넘긴다
  const vs = (type, o, dir) => { const b = incoming(o); return outcome(b, classifyShot(swing({ k: type, ux: 0.8, dir }), b, { apexT: 1 })).kind; };
  assert.equal(vs('sidecut', { topspin: -40 }, -1), 'in');
  assert.equal(vs('sidedrive', { topspin: 45 }, 1), 'in');
  assert.equal(vs('sidecut', { sidespin: 40 }, -1), 'in');
});

test('조합 서브: 사이드 커트·사이드 드라이브 서브가 회전 두 가지를 함께 걸고 들어간다', () => {
  const toss = createBall({ pos: { x: 0, y: -1.55, z: 0.3 }, vel: { x: 0, y: 0, z: -1 }, t: 1 });
  for (const [type, sign] of [['sidecut', 1], ['sidedrive', -1]]) {
    const r = classifyShot(swing({ k: type, ux: 0.8, z1: 0.3, speed: 2 }), toss, { serve: true, apexT: 1 });
    assert.equal(r.shotType, type);
    assert.ok(Math.sign(r.spin.x) === sign && Math.abs(r.spin.z) > 2 * RPS, `${type} 서브 ${(r.spin.x / RPS).toFixed(1)}/${(r.spin.z / RPS).toFixed(1)}`);
  }
});

test('화면: 모바일에 조합 버튼(사이드 커트·사이드 드라이브), 조작표에 동시 누름 안내', () => {
  const html = read('index.html');
  assert.match(html, /data-k="cut side"/);
  assert.match(html, /data-k="drive side"/);
  assert.match(read('js/main.js'), /<kbd>W<\/kbd>\+<kbd>E<\/kbd>/);
});
