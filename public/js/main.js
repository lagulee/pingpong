// main.js — 게임 진입점. 2단계: 로봇과 연습 랠리 (서브·점수는 3단계).
// 흐름: 대기(클릭) → 로봇이 공을 보냄 → 내가 침 → 로봇이 받음 → … → 랠리 종료 → 잠시 뒤 다시 보냄
// 물리는 고정 스텝, 화면은 직전·현재 물리 위치를 보간해 그린다.
import { createRenderer, createBallView, createRacketView, createMarkerView } from './render.js';
import { createBall, makeLaunch, faceNormal, toWorld } from '../shared/physics.js';
import {
  PHYSICS, PRACTICE, SWING, RENDER, TUNABLE, SHOT_LABELS, DIFFICULTIES, DIFFICULTY_LABELS, DEMO,
} from '../shared/constants.js';
import { initDebug, launchParams } from './debug.js';
import { createMouseInput, rayPlaneY, analyzeDrag, createRng } from './input.js';
import { createAI, createPlayer, createRally, feedBall, serveBall, placeBall, stepRally, racketWorld } from './ai.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const shotEl = document.getElementById('shot');
const shotSubEl = document.getElementById('shot-sub');
const robotShotEl = document.getElementById('robot-shot');
const centerEl = document.getElementById('center');
const view = createRenderer(canvas);
const ballView = createBallView(view.scene);
const myRacket = createRacketView(view.scene, RENDER.COLOR_RACKET_ME, RENDER.RACKET_OPACITY_ME);
const robotRacket = createRacketView(view.scene, RENDER.COLOR_RACKET_AI);
const marker = createMarkerView(view.scene);
window.addEventListener('resize', view.resize);

// ── 게임 상태 ──
let difficulty = 'NORMAL';
let clock = 0;            // 게임 시각 (s), 고정 스텝마다 DT씩 증가
let acc = 0;              // 고정 스텝 누적기
let realAtFrame = 0;      // 마지막 프레임의 실제 시각 (s)
let mode = 'ready';       // ready → feeding → rally → ended → feeding …
let timer = 0;            // feeding·ended 남은 시간
let best = 0;
let endMsg = '';
let prevPos = null;       // 화면 보간용 직전 스텝 공 위치
let seed = 1;             // 판마다 다른 시드 (판정 오차·로봇 선택)
let freeStart = 0;        // 디버그 떨어뜨리기 시작 시각

const human = createPlayer(-1);
let robot, game;
function newGame() {
  robot = createAI(1, difficulty, createRng(seed * 31 + 7));
  game = createRally({ players: { [-1]: human, [1]: robot.player }, ais: [robot], rng: createRng(seed) });
  placeBall(game, createBall({ pos: toWorld(PRACTICE.FEED_POS, 1), t: clock }));
  prevPos = { ...game.ball.pos };
  seed++;
}

// 마우스: 화면 → 라켓 평면 (사람은 side −1이라 기준 좌표 = 세계 좌표)
const mouse = createMouseInput(canvas, {
  toPlane(cx, cy) {
    const r = view.screenRay(cx, cy);
    return rayPlaneY(r.origin, r.dir, human.yPlane);
  },
  now: () => clock + acc + (performance.now() / 1000 - realAtFrame),
  onPress() {
    if (mode === 'ready') startFeeding();
  },
});
human.samples = mouse.samples;

function startFeeding(delay = PRACTICE.FEED_DELAY) {
  mode = 'feeding';
  timer = delay;
  centerEl.textContent = '';
}

function setDifficulty(d) {
  difficulty = d;
  newGame();
  mode = 'ready';
}

// ── 디버그 패널 ──
const debugEnabled = new URLSearchParams(location.search).get('debug') === '1';
const debug = initDebug(debugEnabled, {
  // 발사기: 내 쪽에서 로봇에게 쏜다 (로봇이 받아친다)
  onLaunch: (cfg) => {
    serveBall(game, makeLaunch({ ...launchParams(cfg), t: clock }), -1);
    prevPos = { ...game.ball.pos };
    mode = 'rally';
    centerEl.textContent = '';
  },
  onDrop: () => {
    placeBall(game, createBall({ pos: DEMO.DROP_POS, t: clock }));
    prevPos = { ...game.ball.pos };
    mode = 'free';
    freeStart = clock;
  },
  onArrows: setArrows,
  arrowsVisible: ballView.arrowsVisible,
});
function setArrows(v) {
  ballView.setArrowsVisible(v);
  debug.syncArrows?.(v);
}

window.addEventListener('keydown', (e) => {
  const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
  if (i >= 0) setDifficulty(DIFFICULTIES[i]);
  if (e.code === 'Space') { e.preventDefault(); startFeeding(0); }
  if (e.code === 'KeyR') { best = 0; game.tracker.count = 0; }
  if (e.code === 'KeyV') setArrows(!ballView.arrowsVisible);
});

// ── 판정 표시 ──
function showShot(e) {
  const s = e.shot;
  const label = `${SHOT_LABELS[s.shotType]}${s.quality.weak ? ' (약)' : ''}`;
  if (e.side === -1) {
    shotEl.textContent = `${label} · ${s.quality.timing}`;
    shotEl.className = `shot-${s.quality.timing.toLowerCase()}`;
    const dt = Number.isFinite(s.quality.dtApex) ? `${s.quality.dtApex >= 0 ? '+' : ''}${Math.round(s.quality.dtApex * 1000)} ms` : '정점 없음';
    shotSubEl.textContent = `세기 ${s.quality.strength.toFixed(2)} · 정점 대비 ${dt} · ${e.speed.toFixed(1)} m/s`;
  } else {
    robotShotEl.textContent = `로봇: ${label} · ${s.quality.timing}`;
  }
  debug.onShot?.(e);
}

function endRally() {
  const tr = game.tracker;
  best = Math.max(best, tr.count);
  endMsg = `${tr.loser === -1 ? '실점' : '득점'} — ${tr.reason} · 랠리 ${tr.count}회`;
  centerEl.textContent = endMsg;
  mode = 'ended';
  timer = PRACTICE.END_DELAY;
}

// ── 고정 스텝 ──
function fixedStep() {
  const dt = PHYSICS.DT;
  if (mode === 'feeding') {
    timer -= dt;
    if (timer <= 0) {
      feedBall(game, 1, clock);
      prevPos = { ...game.ball.pos };
      mode = 'rally';
    }
  } else if (mode === 'rally' || mode === 'ended' || mode === 'free') {
    prevPos = { ...game.ball.pos };
    for (const e of stepRally(game, dt)) {
      if (e.type === 'racket') showShot(e);
      debug.onEvents([e]);
    }
    if (mode === 'rally' && game.tracker.phase === 'over') endRally();
    if (mode === 'ended') {
      timer -= dt;
      if (timer <= 0) startFeeding(PRACTICE.FEED_DELAY - PRACTICE.END_DELAY / 2);
    }
    if (mode === 'free' && clock - freeStart > DEMO.RESET_AFTER) mode = 'ready';
  }
  clock += dt;
  if (game.ball && (mode === 'rally' || mode === 'ended' || mode === 'free')) game.ball.t = clock;
}

// ── 그리기 ──
function racketNormal(player, t, side) {
  const d = analyzeDrag(player.samples, t);
  const tilt = d.speed > TUNABLE.BLOCK_SPEED ? -d.sin * RENDER.FACE_TILT : 0;
  return toWorld(faceNormal(tilt, 0), side);
}

let lastTime = null;
function frame(now) {
  const elapsed = lastTime === null ? 0 : (now - lastTime) / 1000;
  lastTime = now;
  acc += elapsed;
  let n = 0;
  while (acc >= PHYSICS.DT && n < PHYSICS.MAX_STEPS_PER_FRAME) {
    fixedStep();
    acc -= PHYSICS.DT;
    n++;
  }
  if (acc >= PHYSICS.DT) acc = 0; // 너무 밀린 시간은 버린다
  realAtFrame = now / 1000;
  mouse.refresh(clock);

  // 공 (두 스텝 사이 보간)
  const alpha = acc / PHYSICS.DT;
  const ball = game.ball;
  const p0 = prevPos ?? ball.pos;
  const pos = {
    x: p0.x + (ball.pos.x - p0.x) * alpha,
    y: p0.y + (ball.pos.y - p0.y) * alpha,
    z: p0.z + (ball.pos.z - p0.z) * alpha,
  };
  ballView.update(pos, ball.vel, ball.spin, elapsed);

  // 라켓
  const tr = game.tracker;
  const follow = (side) => (mode === 'rally' && tr.canHit(side) ? ball : null);
  myRacket.update(racketWorld(human, clock, follow(-1)), racketNormal(human, clock, -1));
  const rp = racketWorld(robot.player, clock, follow(1)) ?? toWorld({ x: SWING.HOME.x, y: SWING.HOME_Y, z: SWING.HOME.z }, 1);
  robotRacket.update(rp, racketNormal(robot.player, clock, 1));

  // 내가 칠 공의 예측 정점
  const waiting = mode === 'rally' && tr.receiver === -1 && (tr.phase === 'toward' || tr.phase === 'bounced');
  marker.update(waiting ? human.apexPos : null, TUNABLE.HIT_RADIUS);

  debug.onFrame(elapsed, ball);
  view.render();

  if (mode === 'ready') centerEl.textContent = '클릭해서 시작';
  statusEl.textContent = `연습 모드 · ${DIFFICULTY_LABELS[difficulty]} · 랠리 ${tr.count}회 (최고 ${best}) · `
    + `1/2/3 난이도 · Space 공 보내기 · R 기록 초기화 · V 화살표${debugEnabled ? '' : ' · ?debug=1 패널'}`;
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);

// 디버그 모드에서만: 콘솔·자동 점검용으로 상태를 노출한다
if (debugEnabled) {
  window.pingpong = {
    get game() { return game; }, get robot() { return robot; }, human,
    get clock() { return clock; }, get mode() { return mode; }, toScreen: view.worldToScreen,
  };
}
