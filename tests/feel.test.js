// 4단계: 타격감 연출·소리 테스트 (.claude/rules/feel.md 검증)
// - 소리 매개변수와 흔들림 진폭이 속도에 따라 단조 증가한다
// - 연출은 물리 상태를 바꾸지 않는다: 연출을 모두 켜고 돌린 AI 자동 경기가 연출 없이 돌린 것과 완전히 같다
// - 히트스톱·슬로모션은 화면 시각만 늦춘다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shakeAmplitude, createShake, createViewClock, hitstopSeconds, createBallHistory, spinKind, popupsFor,
  createDisplayQueue, reactTo, slowmoFor, createFx, frameSteps,
} from '../public/js/effects.js';
import { impactParams, speedLevel, crowdLevel, beatInterval, recipeFor, describeParams } from '../public/js/audio.js';
import { changedTunables, tunableLabel } from '../public/js/debug.js';
import { createAI, createRally, stepMatch } from '../public/js/ai.js';
import { createRng } from '../public/js/input.js';
import { makeLaunch, toWorld, ballToWorld } from '../public/shared/physics.js';
import { matchPointSide, createRules } from '../public/shared/rules.js';
import {
  TUNABLE, TUNABLE_DEFAULTS, TUNABLE_RANGES, TUNABLE_GROUPS, TUNABLE_TOGGLES, FEEL, SOUND, SOUND_TEST, LAUNCHER, PHYSICS,
} from '../public/shared/constants.js';

const SPEEDS = Array.from({ length: 50 }, (_, i) => 0.5 + i * 0.5); // 0.5 ~ 25 m/s
const IMPACTS = [
  ...Object.keys(SOUND.RACKET_SHOTS).map((s) => ['racket', s]),
  ...Object.keys(SOUND.IMPACT).map((t) => [t, null]),
];
const strictlyUp = (xs) => xs.every((v, i) => i === 0 || v > xs[i - 1]);

// ── 단조 증가 ──────────────────────────────────────────────
test('흔들림 진폭이 타격 속도에 따라 단조 증가하고, 끄면 0이다', () => {
  const amps = SPEEDS.map((v) => shakeAmplitude(v));
  assert.ok(strictlyUp(amps), amps.join(', '));
  assert.ok(amps.at(-1) <= TUNABLE.SHAKE_MAX);
  // 실제 구질 속도 범위: 드라이브 6~10, 스매시 12~18 m/s에서 스매시가 더 크게 흔든다
  assert.ok(shakeAmplitude(TUNABLE.SMASH_V_MIN) > shakeAmplitude(TUNABLE.DRIVE_V_MAX));
  // 상한 이상에서는 더 커지지 않는다 (감소하지도 않는다)
  const p = { ...TUNABLE, SHAKE_MAX: 0.01 };
  const capped = SPEEDS.map((v) => shakeAmplitude(v, p));
  assert.ok(capped.every((v, i) => i === 0 || v >= capped[i - 1]));
  assert.equal(Math.max(...capped), 0.01);
  assert.equal(shakeAmplitude(20, { ...TUNABLE, FX_SHAKE: 0 }), 0);
});

test('흔들림은 SHAKE_DECAY 동안 줄어 0이 되고, 결정론적이다', () => {
  const run = () => {
    const s = createShake();
    s.kick(15);
    const out = [];
    for (let i = 0; i < 20; i++) out.push(s.advance(1 / 60));
    return out;
  };
  const a = run();
  assert.deepEqual(a, run());
  const env = (n) => { const s = createShake(); s.kick(15); for (let i = 0; i < n; i++) s.advance(1 / 60); return s.envelope(); };
  assert.ok(env(1) > env(4) && env(4) > env(7));
  assert.equal(env(Math.ceil(TUNABLE.SHAKE_DECAY * 60) + 1), 0);
  assert.deepEqual(a.at(-1), { x: 0, z: 0 });
  const peak = Math.max(...a.map((o) => Math.hypot(o.x, o.z)));
  assert.ok(peak <= shakeAmplitude(15) * Math.SQRT2 + 1e-12);
});

test('소리 매개변수(세기·음높이·감쇠·음량)가 모든 충돌 종류·구질에서 속도에 따라 단조 증가한다', () => {
  assert.ok(strictlyUp(SPEEDS.map((v) => speedLevel(v))));
  for (const [type, shot] of IMPACTS) {
    const ps = SPEEDS.map((v) => impactParams(type, v, shot));
    const tag = `${type}/${shot}`;
    assert.ok(strictlyUp(ps.map((p) => p.level)), tag);
    for (let i = 0; i < ps[0].layers.length; i++) {
      for (const key of ['freq', 'freqEnd', 'decay', 'gain']) {
        const xs = ps.map((p) => p.layers[i][key]);
        assert.ok(strictlyUp(xs), `${tag} 층 ${i + 1} ${key}: ${xs.slice(0, 4).join(', ')}…`);
      }
    }
  }
});

test('소리가 충돌 종류마다 다르다 (라켓·테이블·네트·모서리·바닥)', () => {
  const sig = (type, shot) => JSON.stringify(impactParams(type, 8, shot).layers);
  const all = IMPACTS.map(([t, s]) => sig(t, s));
  assert.equal(new Set(all).size, all.length, '모든 소리가 서로 달라야 함');
  const main = (type) => impactParams(type, 8).layers[0];
  // 바닥은 테이블보다 낮고 길게, 모서리는 테이블보다 높게, 네트는 먹먹하게(저역 통과 노이즈)
  assert.ok(main('floor').freq < main('bounce').freq);
  assert.ok(main('floor').decay > main('bounce').decay);
  assert.ok(main('edge').freq > main('bounce').freq);
  assert.equal(main('net').kind, 'noise');
  assert.equal(main('net').filter, 'lowpass');
  assert.equal(impactParams('unknown', 5), null);
  assert.equal(impactParams('racket', 5, '없는 구질').shotType, 'drive');
});

test('구질별 라켓 소리 특징: 스매시 묵직·날카롭게, 커트 짧고 사각, 드라이브 감기는 소리', () => {
  const L = (shot) => impactParams('racket', 10, shot).layers;
  const smash = L('smash'), cut = L('cut'), drive = L('drive');
  const tones = (ls) => ls.filter((l) => l.kind === 'tone');
  const longest = (ls) => Math.max(...ls.map((l) => l.decay));
  // 스매시: 가장 낮은 음(묵직)이 아래로 떨어지고, 매우 짧은 고역 노이즈(날카로움)가 가장 크다
  const low = Math.min(...tones(smash).map((l) => l.freq));
  for (const s of ['drive', 'cut', 'side', 'block']) assert.ok(low < Math.min(...tones(L(s)).map((l) => l.freq)), s);
  assert.ok(tones(smash).some((l) => l.freqEnd < l.freq));
  const crack = smash.find((l) => l.kind === 'noise' && l.filter === 'highpass');
  assert.ok(crack && crack.decay < 0.04 && crack.gain >= Math.max(...smash.map((l) => l.gain)));
  // 커트: 모든 층이 드라이브의 가장 긴 층보다 짧고, 높은 노이즈 알갱이가 두 개(두 번째는 늦게)
  assert.ok(longest(cut) < longest(drive));
  const grains = cut.filter((l) => l.kind === 'noise' && l.filter === 'highpass');
  assert.equal(grains.length, 2);
  assert.ok(grains[1].delay > 0 && Math.min(...grains.map((g) => g.freq)) > 4000);
  // 드라이브: 노이즈 대역이 위로 미끄러진다("착" 감김), 사이드는 아래로
  assert.ok(drive.some((l) => l.kind === 'noise' && l.freqEnd > l.freq * 1.5));
  assert.ok(L('side').some((l) => l.kind === 'noise' && l.freqEnd < l.freq));
  // 같은 속도라도 스매시 소리가 드라이브보다 크다
  assert.ok(Math.max(...smash.map((l) => l.gain)) > Math.max(...drive.map((l) => l.gain)));
});

test('소리 튜닝 값: 음높이·감쇠 배율이 그대로 곱해진다', () => {
  const base = impactParams('bounce', 7);
  const hi = impactParams('bounce', 7, null, { ...TUNABLE, SND_PITCH: 2 });
  const tbl = impactParams('bounce', 7, null, { ...TUNABLE, SND_PITCH_TABLE: 0.5 });
  const long = impactParams('bounce', 7, null, { ...TUNABLE, SND_DECAY: 3 });
  base.layers.forEach((l, i) => {
    assert.ok(Math.abs(hi.layers[i].freq - 2 * l.freq) < 1e-9);
    assert.ok(Math.abs(tbl.layers[i].freq - 0.5 * l.freq) < 1e-9);
    assert.ok(Math.abs(long.layers[i].decay - 3 * l.decay) < 1e-9);
  });
  // 라켓 음높이 배율은 테이블 소리에 영향이 없다
  assert.deepEqual(impactParams('bounce', 7, null, { ...TUNABLE, SND_PITCH_RACKET: 2 }), base);
  assert.match(describeParams(base, 7), /Hz/);
});

test('관중 함성은 랠리가 길수록 커지고, 심장 박동 간격은 BPM에 맞다', () => {
  const xs = Array.from({ length: 30 }, (_, i) => crowdLevel(i));
  assert.equal(xs[0], 0);
  assert.ok(strictlyUp(xs) && xs.at(-1) < 1);
  assert.ok(Math.abs(beatInterval({ HEART_BPM: 120 }) - 0.5) < 1e-12);
});

test('사운드 테스트 페이지: 모든 소리에 약·중·강 속도가 있고 약 < 중 < 강이다', () => {
  for (const [type, shot] of IMPACTS) {
    const v = SOUND_TEST.SPEEDS[shot ?? type];
    assert.ok(v && v.length === 3 && strictlyUp(v), `${type}/${shot}`);
    assert.ok(recipeFor(type, shot));
    const g = v.map((s) => impactParams(type, s, shot).layers[0].gain);
    assert.ok(strictlyUp(g), `${type}/${shot} 음량`);
  }
});

// ── 화면 시계 (히트스톱·슬로모션) ─────────────────────────────
test('히트스톱: 설정한 프레임 수만큼 화면만 멈추고, 끝나면 따라잡아 지연이 0으로 돌아온다', () => {
  const c = createViewClock();
  const sec = hitstopSeconds();
  assert.ok(Math.abs(sec - TUNABLE.HITSTOP_FRAMES / FEEL.FRAME_RATE) < 1e-12);
  assert.ok(TUNABLE.HITSTOP_FRAMES >= 3 && TUNABLE.HITSTOP_FRAMES <= 5, 'feel.md: 3~5 프레임');
  c.hitstop();
  for (let i = 0; i < TUNABLE.HITSTOP_FRAMES; i++) c.advance(1 / 60);
  assert.ok(Math.abs(c.lag - sec) < 1e-9, `lag ${c.lag}`);
  assert.ok(!c.frozen);
  let frames = 0;
  while (c.advance(1 / 60) > 0) frames++;
  // 따라잡기 시간 = 지연 / (배율 − 1)
  assert.ok(frames <= Math.ceil(sec / (TUNABLE.CATCHUP_RATE - 1) * 60) + 1);
  assert.equal(hitstopSeconds({ ...TUNABLE, FX_HITSTOP: 0 }), 0);
});

test('슬로모션: 화면 시간이 SLOWMO_RATE 배로 흐르고, 지연은 VIEW_LAG_MAX를 넘지 않는다', () => {
  const c = createViewClock();
  c.slowmo(0.5);
  c.advance(0.5);
  assert.ok(Math.abs(c.lag - 0.5 * (1 - TUNABLE.SLOWMO_RATE)) < 1e-9);
  const long = createViewClock({ ...TUNABLE, SLOWMO_RATE: 0.05 });
  long.slowmo(10);
  for (let i = 0; i < 600; i++) long.advance(1 / 60);
  assert.equal(long.lag, FEEL.VIEW_LAG_MAX);
  const off = createViewClock({ ...TUNABLE, FX_SLOWMO: 0 });
  off.slowmo(1);
  off.advance(0.5);
  assert.equal(off.lag, 0);
});

test('공 상태 기록: 화면 시각으로 보간하고, 순간 이동은 보간·꼬리를 끊는다', () => {
  const h = createBallHistory();
  const ball = (y) => ({ pos: { x: 0, y, z: 0.2 }, vel: { x: 0, y: 5, z: 0 }, spin: { x: 0, y: 0, z: 0 } });
  h.push(0, ball(0));
  h.push(0.1, ball(0.5));
  assert.ok(Math.abs(h.sample(0.05).pos.y - 0.25) < 1e-12);
  h.push(0.2, ball(5)); // 순간 이동
  assert.equal(h.sample(0.15).pos.y, 0.5);
  assert.deepEqual(h.trail(0.2, 1).map((s) => s.pos.y), [5]);
  assert.deepEqual(h.trail(0.1, 1).map((s) => s.pos.y), [0, 0.5]);
  // 기록한 공을 나중에 바꿔도 기록은 그대로 (복사본)
  const b = ball(5.1);
  h.push(0.3, b);
  b.pos.y = 99;
  assert.equal(h.sample(0.3).pos.y, 5.1);
});

// ── 꼬리 색·팝업 ───────────────────────────────────────────
test('꼬리 색: 발사기 프리셋의 구질이 탑스핀 빨강 / 백스핀 파랑 / 횡회전 보라로 분류된다 (양쪽 방향)', () => {
  const expect = { none: 'none', topspin: 'top', backspin: 'back', sideLeft: 'side', sideRight: 'side' };
  for (const [name, kind] of Object.entries(expect)) {
    const p = LAUNCHER.PRESETS[name];
    const b = makeLaunch({ pos: { x: p.x, y: -1.5, z: p.height }, speed: p.speed, elevation: p.elevation, azimuth: p.azimuth, topspin: p.topspin, sidespin: p.sidespin });
    assert.equal(spinKind(b.vel, b.spin), kind, name);
    const w = ballToWorld(b, 1); // 반대쪽(+1) 플레이어가 친 같은 공
    assert.equal(spinKind(w.vel, w.spin), kind, `${name} (반대쪽)`);
  }
});

test('팝업: PERFECT는 내 타격만, SMASH!는 스매시, EDGE!는 모서리. 끄면 없음', () => {
  const hit = (side, shotType, timing) => ({ type: 'racket', side, speed: 10, pos: { x: 0, y: 0, z: 0 }, shot: { shotType, quality: { timing } } });
  assert.deepEqual(popupsFor(hit(-1, 'drive', 'PERFECT')), ['perfect']);
  assert.deepEqual(popupsFor(hit(1, 'drive', 'PERFECT')), []);
  assert.deepEqual(popupsFor(hit(1, 'drive', 'PERFECT'), 1), ['perfect']);
  assert.deepEqual(popupsFor(hit(-1, 'smash', 'PERFECT')), ['smash', 'perfect']);
  assert.deepEqual(popupsFor(hit(1, 'smash', 'GOOD')), ['smash']);
  assert.deepEqual(popupsFor({ type: 'edge', speed: 5 }), ['edge']);
  assert.deepEqual(popupsFor({ type: 'bounce', speed: 5 }), []);
  assert.deepEqual(popupsFor({ type: 'edge' }, -1, { ...TUNABLE, FX_POPUP: 0 }), []);
  for (const k of ['perfect', 'smash', 'edge']) assert.ok(FEEL.POPUPS[k].text);
  assert.deepEqual(FEEL.POPUPS.perfect.text, 'PERFECT');
  assert.deepEqual(FEEL.POPUPS.smash.text, 'SMASH!');
  assert.deepEqual(FEEL.POPUPS.edge.text, 'EDGE!');
  // 히트스톱은 스매시에만
  assert.ok(reactTo(hit(1, 'smash', 'OK')).hitstop > 0);
  assert.equal(reactTo(hit(1, 'drive', 'OK')).hitstop, 0);
});

test('화면 대기열은 화면 시각에 도달한 것만 순서대로 내보낸다', () => {
  const q = createDisplayQueue();
  for (const t of [0.1, 0.2, 0.3]) q.push({ t });
  assert.deepEqual(q.popUntil(0.2).map((i) => i.t), [0.1, 0.2]);
  assert.equal(q.length, 1);
  assert.deepEqual(q.popUntil(0.25), []);
});

// ── 매치포인트 ─────────────────────────────────────────────
test('매치포인트 판정: 10점(2점 이상 앞섬)·듀스 어드밴티지·3게임 2선승제', () => {
  const st = (score, games = [0, 0], bestOf = 1) => ({ ...createRules({ bestOf }), score, games });
  assert.equal(matchPointSide(st([10, 5])), -1);
  assert.equal(matchPointSide(st([3, 10])), 1);
  assert.equal(matchPointSide(st([9, 9])), 0);
  assert.equal(matchPointSide(st([10, 10])), 0);
  assert.equal(matchPointSide(st([12, 11])), -1);
  // 3게임 2선승제: 첫 게임의 게임포인트는 매치포인트가 아니다
  assert.equal(matchPointSide(st([10, 3], [0, 0], 3)), 0);
  assert.equal(matchPointSide(st([10, 3], [1, 0], 3)), -1);
  assert.ok(slowmoFor({ type: 'point', matchPoint: true, practice: false }));
  assert.ok(!slowmoFor({ type: 'point', matchPoint: false, matchOver: false, practice: false }));
  assert.ok(!slowmoFor({ type: 'let', matchPoint: true, practice: false }));
  assert.ok(!slowmoFor({ type: 'point', matchPoint: true, practice: true }));
});

// ── 연출이 물리를 바꾸지 않는다 ─────────────────────────────
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// AI 대 AI 한 게임. withFx면 main.js와 같은 흐름(대기열 → 화면 시각 → 연출)으로 모든 연출을 최대한 세게 켠다.
function playGame(seed, withFx) {
  const a = createAI(-1, 'HARD', createRng(seed * 7 + 1)); // 어려움은 스매시도 친다 (히트스톱)
  const b = createAI(1, 'NORMAL', createRng(seed * 13 + 5));
  const game = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(seed) });
  const fxParams = { ...TUNABLE };
  for (const k of TUNABLE_TOGGLES) fxParams[k] = 1;
  Object.assign(fxParams, { HITSTOP_FRAMES: 12, SHAKE_GAIN: 0.01, SHAKE_MAX: 0.2, SLOWMO_RATE: 0.05, SLOWMO_TIME: 3 });
  const fx = createFx(fxParams);
  const history = createBallHistory();
  const queue = createDisplayQueue();
  const stats = { events: 0, hitstops: 0, slowmos: 0, popups: 0, sounds: 0, maxLag: 0 };
  const log = [];
  let clock = 0, shown = 0, after = 0;
  const STEPS_PER_FRAME = Math.round(1 / 60 / PHYSICS.DT);
  // 게임이 끝난 뒤에도 3초 더 그린다 (마지막 득점의 슬로모션은 화면이 그 순간에 도달해야 시작된다)
  for (let frame = 0; frame < 60 * 3600 && after < 180; frame++) {
    if (game.rules.phase === 'gameOver') after++;
    for (let k = 0; k < STEPS_PER_FRAME; k++) {
      const mp = matchPointSide(game.rules);
      for (const e of stepMatch(game)) {
        log.push([e.type, e.t, e.pos.x, e.pos.y, e.pos.z, e.speed, e.shot?.shotType]);
        if (withFx) queue.push({ t: e.t, event: deepFreeze(structuredClone(e)) });
      }
      while (shown < game.results.length) {
        const r = game.results[shown++];
        if (withFx) queue.push({ t: r.t, result: deepFreeze({ ...r, matchPoint: mp !== 0 }) });
      }
      clock += PHYSICS.DT;
      if (withFx) history.push(clock, game.ball);
    }
    if (!withFx) continue;
    const out = fx.advance(1 / 60);
    stats.maxLag = Math.max(stats.maxLag, out.lag);
    const viewT = clock - out.lag;
    for (const item of queue.popUntil(viewT)) {
      if (item.result) { if (fx.onResult(item.result)) stats.slowmos++; continue; }
      const r = fx.onEvent(item.event, -1);
      stats.events++;
      if (r.hitstop) stats.hitstops++;
      stats.popups += r.popups.length;
      if (impactParams(item.event.type, item.event.speed, item.event.shot?.shotType, fxParams)) stats.sounds++;
    }
    history.sample(viewT);
    history.trail(viewT, fxParams.TRAIL_TIME).forEach((q) => spinKind(q.vel, q.spin, fxParams));
  }
  return { results: game.results, score: game.rules.score, winner: game.rules.winner, log, stats };
}

test('연출을 모두 세게 켠 AI 자동 경기가 연출 없이 돌린 경기와 완전히 같다 (물리·규칙 불변)', () => {
  for (const seed of [1, 4]) {
    const plain = playGame(seed, false);
    const fx = playGame(seed, true);
    assert.deepStrictEqual(fx.results, plain.results, `시드 ${seed}: 득점 기록`);
    assert.deepStrictEqual(fx.log, plain.log, `시드 ${seed}: 물리 이벤트`);
    assert.deepEqual(fx.score, plain.score);
    assert.ok(plain.winner !== 0, '경기가 끝나야 함');
    // 연출이 실제로 동작했다: 모든 이벤트에 소리, 히트스톱·슬로모션으로 화면이 물리보다 늦었던 순간이 있다
    const s = fx.stats;
    assert.ok(s.events > 50 && s.sounds === s.events, JSON.stringify(s));
    assert.ok(s.slowmos >= 1, `슬로모션 ${s.slowmos}`);
    assert.ok(s.hitstops >= 1 && s.popups >= 1, `히트스톱 ${s.hitstops}, 팝업 ${s.popups}`);
    assert.ok(s.maxLag > 0.1, `최대 지연 ${s.maxLag}`);
  }
});

test('연출을 켜도 경기는 결정론적이고, 화면 지연은 VIEW_LAG_MAX를 넘지 않는다', () => {
  const a = playGame(2, true), b = playGame(2, true);
  assert.deepStrictEqual(a.stats, b.stats);
  assert.ok(a.stats.maxLag <= FEEL.VIEW_LAG_MAX + 1e-12);
});

// ── 디버그 패널 "연출" 묶음 ───────────────────────────────────
test('연출 튜닝 값이 TUNABLE의 "연출" 묶음에 있고, 이름·범위가 있으며 "현재 값 복사"에 포함된다', () => {
  const feel = TUNABLE_GROUPS['연출'];
  assert.ok(feel && feel.length >= 20);
  for (const k of ['FX_HITSTOP', 'HITSTOP_FRAMES', 'FX_SHAKE', 'SHAKE_GAIN', 'SHAKE_DECAY', 'FX_TRAIL', 'FX_POPUP', 'FX_SLOWMO',
    'SND_PITCH', 'SND_DECAY', 'SND_CROWD', 'SND_HEART', 'SND_JINGLE']) assert.ok(feel.includes(k), k);
  for (const k of TUNABLE_TOGGLES) {
    assert.ok(feel.includes(k));
    assert.deepEqual({ ...TUNABLE_RANGES[k] }, { min: 0, max: 1, step: 1 });
    assert.equal(TUNABLE_DEFAULTS[k], 1, `${k} 기본 켜짐`);
  }
  // 모든 TUNABLE에 한국어 이름이 있다 (키 그대로 보이지 않음)
  for (const k of Object.keys(TUNABLE_DEFAULTS)) assert.notEqual(tunableLabel(k), k, `${k} 이름 없음`);
  assert.deepEqual(changedTunables({ ...TUNABLE_DEFAULTS, SHAKE_GAIN: 0.003, FX_TRAIL: 0 }), { SHAKE_GAIN: 0.003, FX_TRAIL: 0 });
});

test('effects.js·audio.js는 three 없이 Node에서 불러와진다 (순수 함수 분리)', async () => {
  await assert.doesNotReject(import('../public/js/effects.js'));
  await assert.doesNotReject(import('../public/js/audio.js'));
  assert.equal(typeof toWorld, 'function');
});

test('일시정지: 멈춘 동안 물리 스텝이 0이고, 다시 시작해도 밀린 시간이 한꺼번에 흐르지 않는다', () => {
  const DT = 1 / 240;
  // 평소: 1/60 s 프레임마다 4스텝, 누적기 나머지 보존
  let r = frameSteps(0, 1 / 60, false, DT, 24);
  assert.equal(r.steps, 4);
  r = frameSteps(DT / 2, DT, false, DT, 24);
  assert.equal(r.steps, 1);
  assert.ok(Math.abs(r.acc - DT / 2) < 1e-12);
  // 일시정지: 몇 초가 흘러도 0스텝, 누적기는 비운다
  for (const el of [1 / 60, 5, 120]) assert.deepEqual(frameSteps(DT * 0.9, el, true, DT, 24), { steps: 0, acc: 0 });
  // 다시 시작한 첫 프레임은 평소와 같다
  assert.equal(frameSteps(0, 1 / 60, false, DT, 24).steps, 4);
  // 너무 밀린 시간(탭 전환)은 상한까지만 밟고 버린다
  assert.deepEqual(frameSteps(0, 3, false, DT, 24), { steps: 24, acc: 0 });
});

test('일시정지: 멈춘 프레임을 건너뛴 AI 경기는 멈추지 않은 경기와 같은 결과다 (게임 상태가 멈춰 있음)', () => {
  const run = (pauseEvery) => {
    const a = createAI(-1, 'NORMAL', createRng(11)), b = createAI(1, 'NORMAL', createRng(12));
    const game = createRally({ players: { [-1]: a.player, [1]: b.player }, ais: [a, b], rng: createRng(13) });
    let acc = 0;
    for (let f = 0; f < 60 * 20; f++) {
      const paused = pauseEvery > 0 && f % pauseEvery < pauseEvery / 2;
      const r = frameSteps(acc, 1 / 60, paused);
      acc = r.acc;
      for (let i = 0; i < r.steps; i++) stepMatch(game);
    }
    return game;
  };
  const plain = run(0);
  const withPause = run(10);
  assert.ok(withPause.ball.t < plain.ball.t, '멈춘 동안 시간이 흐르지 않음');
  // 멈춘 만큼 덜 진행했을 뿐, 같은 시각까지의 기록은 같다
  const until = withPause.ball.t;
  const pick = (g) => g.results.filter((x) => x.t <= until - 1e-9).map((x) => [x.reason, x.winner, x.t]);
  assert.deepEqual(pick(withPause), pick(plain));
});
