// main.js — 게임 진입점. 1단계: 공 하나가 탁구대 위로 떨어지고 튀는 물리 시연.
// 물리는 고정 스텝(advance), 화면은 직전·현재 물리 위치를 보간해 그린다.
import { createRenderer, createBallView } from './render.js';
import { createBall, createSim, advance, makeLaunch } from '../shared/physics.js';
import { DEMO } from '../shared/constants.js';
import { initDebug, launchParams, EVENT_LABELS } from './debug.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const view = createRenderer(canvas);
const ballView = createBallView(view.scene);
window.addEventListener('resize', view.resize);

let sim = null;
let restart = null;   // 마지막으로 쓴 시작 방법 (다시 하기·자동 반복용)
let lastEvent = '';

function start(makeBall) {
  restart = makeBall;
  sim = createSim(makeBall());
  lastEvent = '';
}
const drop = () => start(() => createBall({ pos: DEMO.DROP_POS }));
const launch = (cfg) => start(() => makeLaunch(launchParams(cfg)));
function setArrows(v) {
  ballView.setArrowsVisible(v);
  debug.syncArrows?.(v);
}

const debugEnabled = new URLSearchParams(location.search).get('debug') === '1';
const debug = initDebug(debugEnabled, {
  onLaunch: launch,
  onDrop: drop,
  onArrows: setArrows,
  arrowsVisible: ballView.arrowsVisible,
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') start(restart);
  if (e.code === 'KeyV') setArrows(!ballView.arrowsVisible);
});

drop();

let lastTime = null;
function frame(now) {
  const dt = lastTime === null ? 0 : (now - lastTime) / 1000;
  lastTime = now;

  const events = advance(sim, dt);
  if (events.length) {
    const e = events[events.length - 1];
    lastEvent = `${EVENT_LABELS[e.type] ?? e.type} ${e.speed.toFixed(1)} m/s`;
  }
  debug.onEvents(events);
  if (sim.ball.t > DEMO.RESET_AFTER) start(restart);

  // 두 물리 상태 사이 보간
  const { prev, ball, alpha } = sim;
  const pos = {
    x: prev.x + (ball.pos.x - prev.x) * alpha,
    y: prev.y + (ball.pos.y - prev.y) * alpha,
    z: prev.z + (ball.pos.z - prev.z) * alpha,
  };
  ballView.update(pos, ball.vel, ball.spin, dt);
  debug.onFrame(dt, ball);
  view.render();

  statusEl.textContent = `1단계: 물리 · R 다시 · V 화살표${debugEnabled ? ' · Enter 발사' : ' · ?debug=1 로 패널 열기'}${lastEvent ? ' · ' + lastEvent : ''}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
