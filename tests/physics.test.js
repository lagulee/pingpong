// 1단계 물리 검증 테스트 (.claude/rules/physics.md 검증 테스트 7개 + 보조 테스트)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBall, cloneBall, step, integrate, makeLaunch, createSim, advance,
  mechanicalEnergy, cross, dot,
} from '../public/shared/physics.js';
import { BALL, TABLE, NET, PHYSICS, RACKET, TUNABLE, TUNABLE_DEFAULTS } from '../public/shared/constants.js';

const R = BALL.RADIUS;
const DT = PHYSICS.DT;
// 엔진 검증은 실제 중력(9.8)으로 한다. 게임은 게임용 중력 TUNABLE.G_GAME(v6.0)을 쓰고, 그 스케일링은 physics-gravity.test.js에서 확인한다.
const REAL = { ...TUNABLE_DEFAULTS, G_GAME: PHYSICS.G };

// 이벤트가 maxEvents개 나올 때까지(또는 시간 초과) 진행하고 모든 이벤트를 모은다.
function simulate(b, { seconds = 3, opts = {}, until = () => false } = {}) {
  const events = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    for (const e of step(b, DT, { params: REAL, ...opts })) events.push({ ...e, vel: { ...b.vel }, spin: { ...b.spin } });
    if (until(b, events)) break;
  }
  return events;
}

test('[1] 30.5 cm에서 무회전 낙하한 공이 24~26 cm 튀어 오른다', () => {
  const h1 = 0.305;
  const b = createBall({ pos: { x: 0, y: -0.5, z: h1 + R } });
  let peak = 0, bounces = 0;
  simulate(b, {
    until: (s, ev) => {
      bounces = ev.length;
      if (bounces === 1) peak = Math.max(peak, s.pos.z - R); // 공 아랫면 높이
      return bounces >= 2;
    },
  });
  assert.equal(bounces, 2);
  assert.ok(peak >= 0.24 && peak <= 0.26, `튀어 오른 높이 ${peak.toFixed(4)} m`);
  const eEff = Math.sqrt(peak / h1);
  assert.ok(eEff >= 0.885 && eEff <= 0.925, `유효 반발계수 ${eEff.toFixed(3)}`);
});

test('[2] 같은 초기 속도에서 비행 거리: 탑스핀 < 무회전 < 백스핀', () => {
  // 탁구대 위 25 cm에서 앞(+y)으로 5 m/s, 15° 발사 → 첫 착지(테이블 또는 바닥 높이)까지 거리
  const range = (topspin) => {
    const b = makeLaunch({ pos: { x: 0, y: -1.2, z: 0.25 + R }, speed: 5, elevation: 15, topspin });
    // 테이블·바닥 충돌을 피해 같은 높이(z = R)로 돌아올 때까지만 자유 비행으로 비교한다.
    const y0 = b.pos.y;
    for (let i = 0; i < 2000 && !(b.vel.z < 0 && b.pos.z <= R); i++) integrate(b, DT, REAL);
    return b.pos.y - y0;
  };
  const top = range(60), none = range(0), back = range(-60);
  assert.ok(top < none && none < back, `탑 ${top.toFixed(3)} / 무 ${none.toFixed(3)} / 백 ${back.toFixed(3)}`);

  // 충돌 처리가 있는 step()으로도 첫 착지 지점 순서가 같다.
  const firstHitY = (topspin) => {
    const b = makeLaunch({ pos: { x: 0, y: -1.2, z: 0.25 + R }, speed: 5, elevation: 15, topspin });
    const ev = simulate(b, { until: (s, e) => e.length > 0 });
    return ev[0].pos.y + (ev[0].type === 'floor' ? 10 : 0); // 바닥은 테이블보다 멀리 간 것
  };
  assert.ok(firstHitY(60) < firstHitY(0) && firstHitY(0) < firstHitY(-60));
});

test('[3] 횡회전 공이 회전 방향과 맞는 쪽으로 휜다', () => {
  // 위에서 봐서 반시계(ω_z > 0)인 공이 +y로 날아가면, 왼쪽(−x) 표면이 공기를 거슬러 돌므로
  // 마그누스 힘 ω × v = (−ω_z v_y, 0, 0)이 −x(진행 방향 왼쪽)를 향한다.
  const curve = (sidespin) => {
    const b = makeLaunch({ pos: { x: 0, y: -1.2, z: 0.25 + R }, speed: 5, elevation: 15, sidespin });
    for (let i = 0; i < 60; i++) integrate(b, DT, REAL);
    return b.pos.x;
  };
  const ccw = curve(50), cw = curve(-50), none = curve(0);
  assert.equal(none, 0);
  assert.ok(ccw < -0.01, `반시계 회전 x = ${ccw}`);
  assert.ok(cw > 0.01, `시계 회전 x = ${cw}`);
  assert.ok(Math.abs(ccw + cw) < 1e-12, '좌우 대칭');
  // 부호 규약 확인: makeLaunch의 +sidespin은 ω_z > 0
  assert.ok(makeLaunch({ pos: { x: 0, y: 0, z: 1 }, speed: 1, sidespin: 1 }).spin.z > 0);
});

test('[4] 바운드 직후 수평 속도: 탑스핀 공 > 백스핀 공', () => {
  // 같은 속도로 테이블에 들어오는 공 (+y로 4 m/s, 아래로 3 m/s)
  const after = (topspin) => {
    const b = makeLaunch({ pos: { x: 0, y: 0.3, z: R + 0.02 }, speed: 5, elevation: -36.87, topspin });
    const ev = simulate(b, { until: (s, e) => e.length > 0 });
    assert.equal(ev[0].type, 'bounce');
    return ev[0].vel.y;
  };
  const top = after(80), none = after(0), back = after(-80);
  assert.ok(top > none && none > back, `탑 ${top.toFixed(3)} / 무 ${none.toFixed(3)} / 백 ${back.toFixed(3)}`);
  // 탑스핀 공 표기 확인: 공 윗면이 진행 방향(+y)으로 돈다 → (ω × r_top).y > 0
  const s = makeLaunch({ pos: { x: 0, y: 0, z: 1 }, speed: 1, topspin: 1 }).spin;
  assert.ok(cross(s, { x: 0, y: 0, z: R }).y > 0);
});

test('[5] 30 m/s로 라켓을 향해 날아가는 공이 라켓을 통과하지 않는다', () => {
  const speed = 30;
  // 테스트 전제: 한 스텝 이동 거리가 공 지름 + 라켓 두께보다 커서, 위치만 보는 검사로는 놓친다.
  assert.ok(speed * DT > 2 * R + RACKET.THICKNESS);

  const racketY = 0.6;
  const racket = { id: 'A', pos: { x: 0, y: racketY, z: 0.3 }, normal: { x: 0, y: -1, z: 0 } };
  for (const offset of [0, 0.013, 0.031, 0.077, 0.1]) { // 스텝 경계가 라켓과 어긋나는 여러 경우
    const b = createBall({ pos: { x: 0, y: -0.2 + offset, z: 0.3 }, vel: { x: 0, y: speed, z: 0 } });
    let maxY = -Infinity;
    const ev = simulate(b, {
      seconds: 0.1,
      opts: { rackets: [racket] },
      until: (s) => { maxY = Math.max(maxY, s.pos.y); return false; },
    });
    const hit = ev.find((e) => e.type === 'racket');
    assert.ok(hit, `offset ${offset}: 라켓 충돌 이벤트 없음`);
    assert.equal(hit.racket, 'A');
    assert.ok(maxY <= racketY - RACKET.THICKNESS / 2 - R + 1e-9, `offset ${offset}: 라켓 통과 (y = ${maxY})`);
    assert.ok(hit.vel.y < -0.5 * speed, '반대로 튕겨 나감');
  }
});

test('[5-추가] 움직이는 라켓에 맞은 공은 라켓 속도를 받아 나간다', () => {
  const racket = { pos: { x: 0, y: 0.6, z: 0.3 }, normal: { x: 0, y: -1, z: 0 }, vel: { x: 0, y: -5, z: 0 } };
  const b = createBall({ pos: { x: 0, y: 0, z: 0.3 }, vel: { x: 0, y: 10, z: 0 } });
  const params = { ...REAL, C_D: 0 }; // 공기저항을 빼고 충돌 응답만 확인
  const ev = simulate(b, { seconds: 0.2, opts: { rackets: [racket], params }, until: (s, e) => e.length > 0 });
  // 상대 속도 15 m/s → 반사 후 −5 − e·15
  assert.ok(Math.abs(ev[0].vel.y - (-5 - TUNABLE.E_RACKET * 15)) < 0.05, `${ev[0].vel.y}`);
});

test('[6] 같은 입력으로 두 번 시뮬레이션하면 결과가 완전히 같다 (결정론)', () => {
  const run = () => {
    const b = makeLaunch({ pos: { x: 0.1, y: -1.5, z: 0.3 }, speed: 9, elevation: 8, azimuth: 3, topspin: 70, sidespin: -25 });
    const racket = { id: 'B', pos: { x: 0.15, y: 1.6, z: 0.15 }, normal: { x: 0, y: -1, z: 0 }, vel: { x: 0, y: -3, z: 1 } };
    const events = simulate(b, { seconds: 2, opts: { rackets: [racket] } });
    return { ball: b, events };
  };
  const a = run(), b = run();
  assert.ok(a.events.length >= 3, `이벤트 ${a.events.map((e) => e.type)}`);
  assert.deepStrictEqual(a, b);
  // 비트 단위로도 동일
  assert.ok(Object.is(a.ball.pos.x, b.ball.pos.x) && Object.is(a.ball.spin.z, b.ball.spin.z));
});

test('[7] 공기 중 비행 동안 역학적 에너지가 증가하지 않는다', () => {
  const cases = [
    { speed: 12, elevation: 20, topspin: 120, sidespin: 0 },
    { speed: 6, elevation: 40, topspin: -150, sidespin: 80 },
    { speed: 25, elevation: 5, topspin: 30, sidespin: -150 },
    { speed: 0.5, elevation: 80, topspin: -150, sidespin: 150 }, // 느리고 회전이 큰 경우
  ];
  for (const c of cases) {
    const b = makeLaunch({ pos: { x: 0, y: 0, z: 3 }, ...c });
    let E = mechanicalEnergy(b, REAL);
    for (let i = 0; i < 240; i++) {
      integrate(b, DT, REAL);
      const E2 = mechanicalEnergy(b, REAL);
      assert.ok(E2 <= E + 1e-15, `${JSON.stringify(c)} 스텝 ${i}: ${E} → ${E2}`);
      E = E2;
    }
  }
  // 마그누스 힘 자체는 속도와 수직 → 일을 하지 않는다
  const w = { x: 3, y: -7, z: 11 }, v = { x: 2, y: 5, z: -1 };
  assert.equal(dot(cross(w, v), v), 0);
});

// ── 보조 테스트 ──────────────────────────────────────────

test('이벤트 형식: { type, t, pos, speed, side }', () => {
  const b = createBall({ pos: { x: 0, y: 0.5, z: 0.3 } });
  const [e] = simulate(b, { until: (s, ev) => ev.length > 0 });
  assert.equal(e.type, 'bounce');
  assert.equal(e.side, 1);
  assert.ok(e.t > 0 && e.t < 0.3);
  assert.ok(Math.abs(e.pos.z - R) < 1e-12);
  assert.ok(Math.abs(e.speed - Math.sqrt(2 * PHYSICS.G * (0.3 - R))) < 0.1);
});

test('탁구대 가장자리에 맞으면 edge, 밖으로 떨어지면 floor', () => {
  const edgeX = TABLE.WIDTH / 2 - PHYSICS.EDGE_ZONE / 2;
  const a = createBall({ pos: { x: edgeX, y: -0.5, z: 0.3 } });
  assert.equal(simulate(a, { until: (s, e) => e.length > 0 })[0].type, 'edge');
  const b = createBall({ pos: { x: TABLE.WIDTH / 2 + 0.01, y: -0.5, z: 0.3 } });
  const ev = simulate(b, { until: (s, e) => e.length > 0 });
  assert.equal(ev[0].type, 'floor');
  assert.ok(Math.abs(ev[0].pos.z - (-TABLE.HEIGHT + R)) < 1e-12);
});

test('네트에 걸리면 속도 대부분을 흡수하고 넘어가지 못한다', () => {
  const b = createBall({ pos: { x: 0, y: -0.5, z: 0.08 }, vel: { x: 0, y: 12, z: 0.3 } });
  let maxY = -Infinity;
  const ev = simulate(b, { seconds: 1, until: (s) => { maxY = Math.max(maxY, s.pos.y); return false; } });
  const net = ev.find((e) => e.type === 'net');
  assert.ok(net && net.over === false && net.side === -1);
  assert.ok(Math.abs(net.vel.y) < 0.2 * 12);
  assert.ok(maxY < 0, '네트를 넘어가지 않음');
});

test('네트 윗줄을 스치면 네트 인: 넘어가되 느려진다', () => {
  const z = NET.HEIGHT + R / 2;
  const b = createBall({ pos: { x: 0, y: -0.3, z }, vel: { x: 0, y: 30, z: 0 } }); // 빨라서 거의 수평
  const ev = simulate(b, { seconds: 0.03 });
  const net = ev.find((e) => e.type === 'net');
  assert.ok(net && net.over === true);
  assert.ok(b.pos.y > 0, '건너편으로 넘어감');
  assert.ok(net.vel.y < 30 * TUNABLE.NET_CORD_KEEP + 0.5);
});

test('공이 테이블 위에서 결국 멈춰 튀지 않는다 (무한 미세 바운드 방지)', () => {
  const b = createBall({ pos: { x: 0, y: -0.5, z: 0.3 } });
  const ev = simulate(b, { seconds: 10 }); // 유효 e ≈ 0.905 → 약 5 s 뒤 정지
  assert.ok(ev.length < 40, `바운드 ${ev.length}회`);
  assert.ok(Math.abs(b.pos.z - R) < 0.001 && Math.abs(b.vel.z) < 0.1);
});

test('누적기(advance): 프레임을 어떻게 나눠도 같은 고정 스텝 결과', () => {
  const init = () => createSim(makeLaunch({ pos: { x: 0, y: -1.5, z: 0.3 }, speed: 7, elevation: 12, topspin: 40 }));
  for (const fps of [60, 144, 37]) {
    const a = init();
    for (let i = 0; i < fps; i++) advance(a, 1 / fps);
    // 같은 스텝 수만큼 step()을 직접 부른 결과와 비트 단위로 같다
    const ref = cloneBall(init().ball);
    const steps = Math.round(a.ball.t / DT);
    assert.ok(Math.abs(steps - 240) <= 1, `${fps} fps: ${steps} 스텝`);
    for (let i = 0; i < steps; i++) step(ref, DT);
    assert.deepStrictEqual(a.ball, ref);
    assert.ok(a.alpha >= 0 && a.alpha < 1);
  }
  // 큰 지연은 잘라낸다
  const c = init();
  advance(c, 10);
  assert.ok(Math.round(c.ball.t / DT) <= PHYSICS.MAX_STEPS_PER_FRAME);
});

test('TUNABLE은 기본값으로 시작하고, 매개변수로 넘긴 값이 적용된다', () => {
  assert.deepStrictEqual({ ...TUNABLE }, { ...TUNABLE_DEFAULTS });
  const mk = () => makeLaunch({ pos: { x: 0, y: 0, z: 2 }, speed: 10, elevation: 0, topspin: 100 });
  const a = mk(), b = mk();
  integrate(a, DT);
  integrate(b, DT, { ...TUNABLE, K_M: 0 });
  assert.ok(a.vel.z < b.vel.z, '탑스핀 마그누스 힘은 아래쪽');
});

test('발사기 프리셋: 모두 네트를 넘어 건너편 코트에 먼저 떨어진다', async () => {
  const { LAUNCHER } = await import('../public/shared/constants.js');
  const { launchParams } = await import('../public/js/debug.js');
  const firstBounce = {};
  for (const [name, cfg] of Object.entries(LAUNCHER.PRESETS)) {
    const b = makeLaunch(launchParams(cfg));
    const [e] = simulate(b, { opts: { params: TUNABLE }, until: (s, ev) => ev.length > 0 }); // 발사기는 게임 중력
    assert.ok(e.type === 'bounce' && e.pos.y > 0, `${name}: 첫 이벤트 ${e.type} y=${e.pos.y.toFixed(2)}`);
    firstBounce[name] = e;
  }
  // 횡회전 프리셋은 회전 방향으로 휜다
  assert.ok(firstBounce.sideLeft.pos.x < LAUNCHER.PRESETS.sideLeft.x);
  assert.ok(firstBounce.sideRight.pos.x > LAUNCHER.PRESETS.sideRight.x);
});

test('인플레이 판정: 탁구대 위·코트로 오는 공은 인플레이, 엔드라인 밖으로 나가는 공은 아님', async () => {
  const { inPlayFor, createBall, vec } = await import('../public/shared/physics.js');
  // 내 코트(−y)로 내려오는 공: 아직 탁구대 밖(네트 위 높이)이 아니어도 코트에 떨어질 공
  const coming = createBall({ pos: vec(0, 0.3, 0.3), vel: vec(0, -5, 0), t: 0 });
  assert.equal(inPlayFor(coming, -1), true);
  // 탁구대 위에 있는 공은 길게 나가는 중이어도 인플레이 (오브스트럭션)
  const overTable = createBall({ pos: vec(0, -1.2, 0.3), vel: vec(0, -8, 1), t: 0 });
  assert.equal(inPlayFor(overTable, -1), true);
  // 엔드라인 밖에서 바닥으로 가는 공: 코트 밖
  const long = createBall({ pos: vec(0, -1.6, 0.3), vel: vec(0, -8, 0), t: 0 });
  assert.equal(inPlayFor(long, -1), false);
  // 옆줄 밖으로 지나가는 공
  const wide = createBall({ pos: vec(1.0, -1.0, 0.2), vel: vec(0.5, -6, 0), t: 0 });
  assert.equal(inPlayFor(wide, -1), false);
});
