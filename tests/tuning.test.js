// 6단계 튜닝 테스트: 새 시점(왼쪽 위)과 "느리지만 오래 나는 공"의 목표치 회귀 방지.
// 목표치는 6단계 첫 측정(CLAUDE.md 10장)에 여유를 둔 값이다. 상수를 바꿔 이 기준이 깨지면 의도한 변경인지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraFor, tunableCamera, screenToPlane, planeToScreen, dragGain, dragScaleFor, classifyShot, createRng, analyzeDrag,
} from '../public/js/input.js';
import { createAI, createRally, stepMatch } from '../public/js/ai.js';
import { createBall, vec, step } from '../public/shared/physics.js';
import { RENDER, TUNABLE, NET, PHYSICS, TABLE } from '../public/shared/constants.js';

const ASPECT = 16 / 9;
const NEW = tunableCamera();
const CLASSIC = RENDER.CAMERA_CLASSIC;

// 기준 타점에서 화면으로 (dx, dy)만큼 끌었을 때 라켓 평면 위 방향 → sinθ (위 +)
function dragSin(cam, dx, dy) {
  const p = RENDER.DRAG_REF_POINT;
  const c = planeToScreen(cam, ASPECT, p);
  const a = screenToPlane(cam, ASPECT, c.x, c.y, p.y), b = screenToPlane(cam, ASPECT, c.x + dx, c.y + dy, p.y);
  const ux = b.x - a.x, uz = b.z - a.z;
  return uz / Math.hypot(ux, uz);
}

test('시점: 새 시점은 내 엔드 왼쪽 위, 대전 상대(side +1)도 자기 기준 왼쪽 위 (180° 회전)', () => {
  assert.ok(NEW.pos.x < 0 && NEW.pos.y < -TABLE.LENGTH / 2 && NEW.pos.z > CLASSIC.pos.z, '왼쪽(−x)·뒤·기존보다 위');
  const opp = cameraFor(NEW, 1);
  assert.deepEqual(opp.pos, vec(-NEW.pos.x, -NEW.pos.y, NEW.pos.z));
  assert.deepEqual(opp.target, vec(-NEW.target.x, -NEW.target.y, NEW.target.z));
  // side +1은 −y 방향을 보므로 왼쪽이 +x
  assert.ok(opp.pos.x > 0 && opp.pos.y > TABLE.LENGTH / 2);
  assert.deepEqual(cameraFor(NEW, -1).pos, NEW.pos);
});

test('시점: 탁구대 전체와 높은 공(네트 위 1.3 m)이 화면 안에 들어온다', () => {
  const inside = (p) => { const s = planeToScreen(NEW, ASPECT, p); return Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1; };
  for (const x of [-TABLE.WIDTH / 2, TABLE.WIDTH / 2]) for (const y of [-TABLE.LENGTH / 2, TABLE.LENGTH / 2]) assert.ok(inside(vec(x, y, 0)), `${x}, ${y}`);
  assert.ok(inside(vec(0, 0, 1.3)), '네트 위 1.3 m');
  assert.ok(inside(vec(0, -1.2, 1.3)), '내 쪽 1.3 m');
  // 기존 시점은 네트 위 1.3 m가 화면 위로 잘렸다 (시점을 바꾼 이유)
  assert.ok(planeToScreen(CLASSIC, ASPECT, vec(0, 0, 1.35)).y > 1);
  // 비스듬한 시점: 공의 깊이가 화면 가로 이동으로도 보인다
  const near = planeToScreen(NEW, ASPECT, vec(0, -1.37, 0)), far = planeToScreen(NEW, ASPECT, vec(0, 1.37, 0));
  assert.ok(Math.abs(far.x - near.x) > 0.2);
});

test('시점: 비스듬히 봐도 드래그 방향이 구질 판정과 맞는다 (위 = 위, 옆 = 옆, 45° ≈ 45°)', () => {
  // sinθ는 높이 성분이라 자리(side)와 무관하다. 기존 시점도 같은 기준을 만족한다.
  for (const [name, cam] of [['새 시점', NEW], ['상대 자리', cameraFor(NEW, 1)], ['기존 시점', CLASSIC]]) {
    assert.ok(dragSin(cam, 0, 0.05) > 0.9, `${name}: 화면 위로 끌기 → 위쪽 드래그 (드라이브)`);
    assert.ok(dragSin(cam, 0, -0.05) < -0.9, `${name}: 화면 아래로 끌기 → 아래쪽 드래그 (커트·스매시)`);
    assert.ok(Math.abs(dragSin(cam, 0.05, 0)) < 0.2, `${name}: 옆으로 끌기 → 옆 (좌우 조준)`);
    const deg = (Math.asin(dragSin(cam, 0.05 / ASPECT, 0.05)) * 180) / Math.PI;
    assert.ok(deg > 40 && deg < 50, `${name}: 화면 45° → ${deg.toFixed(1)}°`);
  }
});

test('시점: 마우스 감도 보정 — 새 시점에서도 같은 손놀림이 기존 시점과 같은 스윙 속도로 판정된다', () => {
  assert.ok(Math.abs(dragScaleFor(CLASSIC, ASPECT) - 1) < 1e-12);
  const k = dragScaleFor(NEW, ASPECT);
  assert.ok(k < 0.9, `새 시점은 1 px가 더 길다 → 배율 ${k.toFixed(3)}`);
  assert.ok(Math.abs(dragGain(NEW, ASPECT) * k - dragGain(CLASSIC, ASPECT)) < 1e-12);
  // 같은 화면 드래그: 기존 시점 샘플과 새 시점 샘플(×보정)의 판정 속도가 같다
  const mk = (gain) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => ({ t: i / 120, x: 0, y: 0.2 + gain * i * 3, b: true }));
  const a = analyzeDrag(mk(dragGain(CLASSIC, ASPECT)), 0.1);
  const b = analyzeDrag(mk(dragGain(NEW, ASPECT)), 0.1, TUNABLE, k);
  assert.ok(Math.abs(a.speed - b.speed) < 1e-9 && Math.abs(a.sin - b.sin) < 1e-12);
});

// ── 느리지만 오래 나는 공 (AI 경기 측정) ──────────────────────────
function measure() {
  const games = [[1, 'NORMAL', 'NORMAL'], [2, 'NORMAL', 'NORMAL'], [3, 'HARD', 'EASY'], [4, 'HARD', 'NORMAL']];
  const shots = {};
  let contacts = 0, eligible = 0;
  for (const [seed, dA, dB] of games) {
    const a = createAI(-1, dA, createRng(seed * 7 + 1)), b = createAI(1, dB, createRng(seed * 13 + 5));
    const g = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(seed), firstServer: seed % 2 ? -1 : 1 });
    let cur = null;
    for (let i = 0; i < 240 * 3600 && g.rules.phase !== 'gameOver'; i++) {
      for (const e of stepMatch(g)) {
        if (e.type === 'racket' && e.shot) {
          contacts++;
          if (e.pos.z >= NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT) eligible++;
          // 7단계: 같은 회전으로 받아쳐 회전이 쌓인 공은 따로 센다 (드라이브 + 누적 = 'drive+')
          const k = e.shot.quality.serve ? 'serve' : e.shot.shotType + (e.shot.quality.stack?.add > 0.5 ? '+' : '');
          const s = (shots[k] ??= { n: 0, v: 0, ft: [] });
          s.n++; s.v += e.speed;
          cur = { s, t: e.t, side: e.side };
        } else if (cur && (e.type === 'bounce' || e.type === 'edge') && e.side !== cur.side) {
          cur.s.ft.push(e.t - cur.t); cur = null;
        } else if (cur && e.type !== 'bounce' && e.type !== 'edge') cur = null;
      }
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const r = { eligible: eligible / contacts };
  for (const [k, s] of Object.entries(shots)) r[k] = { n: s.n, v: s.v / s.n, ft: avg(s.ft) };
  return r;
}

// 7단계: 회전 누적이 생겨 드라이브끼리 주고받으면 탑스핀이 쌓이고(상한 100 rps), 센 탑스핀은 빨리 떨어지므로
// 같은 깊이에 보내려면 빠르게(최대 DRIVE_V_MAX) 쳐야 한다. 누적된 드라이브('drive+')는 의도적으로 빠르고 짧으므로
// v6.0의 "느린 드라이브" 기준은 누적되지 않은 드라이브에 적용하고, 누적 드라이브는 속도 한계 안인지만 본다.
test('느리지만 오래 나는 공: 드라이브·커트가 v5.2보다 느리고 오래 날며, 스매시는 확실히 빠르다', () => {
  const m = measure();
  if (m['drive+']) assert.ok(m['drive+'].v <= TUNABLE.DRIVE_V_MAX + 0.1, `누적 드라이브 ${m['drive+'].v.toFixed(2)} m/s`);
  // v5.2 측정: 드라이브 6.18 m/s·0.60 s, 커트 4.53 m/s·0.74 s, 스매시/드라이브 2.34
  assert.ok(m.drive.v <= 5.0 && m.drive.ft >= 0.72, `드라이브 ${m.drive.v.toFixed(2)} m/s, ${m.drive.ft.toFixed(3)} s`);
  assert.ok(m.cut.v <= 3.6 && m.cut.ft >= 1.0, `커트 ${m.cut.v.toFixed(2)} m/s, ${m.cut.ft.toFixed(3)} s`);
  assert.ok(m.smash && m.smash.n >= 3, `스매시 ${m.smash?.n ?? 0}회`);
  assert.ok(m.smash.v / m.drive.v >= 2.8, `스매시/드라이브 ${(m.smash.v / m.drive.v).toFixed(2)}`);
  // 스매시 높이 조건이 거의 모든 타격에서 걸리지 않는다 (v5.2: 91%)
  assert.ok(m.eligible <= 0.3, `스매시 가능 타점 ${(100 * m.eligible).toFixed(0)}%`);
});

test('사람 대역: 타점·세기·타이밍 오차를 섞어 쳐도 드라이브·커트는 98% 이상 상대 코트에 들어간다', () => {
  // 타점(y 4 × z 5 × x 2) × 세기 3 × 정점 대비 타이밍 4 × 난수 2 = 구질마다 960타 (v5.2: 드라이브 91.7%, 커트 92.7%)
  for (const [type, sin] of [['drive', 0.9], ['cut', -0.9]]) {
    let n = 0, ok = 0, seed = 1;
    for (const y of [-1.2, -1.5, -1.8, -2.0]) for (const z of [0.05, 0.15, 0.3, 0.5, 0.7]) for (const x of [0, 0.5]) {
      for (const s of [0.2, 0.5, 0.9]) for (const dt of [0, 0.1, 0.2, 0.3]) for (let r = 0; r < 2; r++) {
        // 7단계: 구질은 버튼(k)으로 고른다. v6.3까지는 커트가 스매시로 판정되지 않게 스윙 속도를 SMASH_SPEED 아래로 제한했지만,
        // 이제 방향·속도가 구질을 바꾸지 않으므로 세기 그대로 휘두른다
        const speed = TUNABLE.BLOCK_SPEED + s * (TUNABLE.SPEED_FULL - TUNABLE.BLOCK_SPEED);
        const samples = [];
        for (let i = 0; i <= 12; i++) samples.push({ t: -0.1 + i / 120, x, y: z - sin * speed * 0.1 * (1 - i / 12), b: true, k: type });
        const ball = createBall({ pos: vec(x, y, z), vel: vec(0, -4, -1), spin: vec(2 * Math.PI * 20, 0, 0), t: 0 });
        const shot = classifyShot(samples, ball, { t: 0, side: -1, apexT: -dt, rng: createRng(seed++), racketX: x });
        assert.equal(shot.shotType, type);
        const b = createBall({ pos: ball.pos, vel: shot.vel, spin: shot.spin, t: 0 });
        let res = false;
        for (let i = 0; i < 240 * 4; i++) {
          const ev = step(b, PHYSICS.DT);
          if (!ev.length || (ev[0].type === 'net' && ev[0].over)) continue;
          res = (ev[0].type === 'bounce' || ev[0].type === 'edge') && ev[0].pos.y > 0;
          break;
        }
        n++; if (res) ok++;
      }
    }
    assert.ok(ok / n >= 0.98, `${type}: ${ok}/${n}`);
  }
});
