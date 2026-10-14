// main.js — 게임 진입점. 3단계: 로봇과 11점 1게임 (서브·점수·듀스·서브 교대는 shared/rules.js).
// 흐름: 서브 대기 → (내 서브: 클릭으로 토스 → 드래그로 치기 / 로봇 서브: 자동) → 랠리 → 득점 사유 표시 → 다음 서브 … → 결과 화면
// 물리는 고정 스텝, 화면은 공 상태 기록을 "화면 시각"으로 보간해 그린다.
// 4단계: 화면 시각 = 물리 시각 − lag (히트스톱·슬로모션은 lag만 늘린다). 소리·연출·판정 표시는
// 물리 이벤트를 대기열에 넣었다가 화면이 그 순간을 보여 줄 때 낸다. 연출은 물리 상태를 바꾸지 않는다.
import {
  createRenderer, createBallView, createRacketView, createMarkerView, createTrailView, createGuideView,
} from './render.js';
import { createBall, makeLaunch, faceNormal, toWorld } from '../shared/physics.js';
import {
  PHYSICS, PRACTICE, SWING, RENDER, TUNABLE, NET, VERSION, SHOT_LABELS, DIFFICULTIES, DIFFICULTY_LABELS, DEMO,
  REASON_LABELS, RULES, SERVE, SERVE_GUIDE, PAUSE,
} from '../shared/constants.js';
import { canHit, bouncedOn, matchPointSide } from '../shared/rules.js';
import { createAudio, initSoundTest } from './audio.js';
import {
  createFx, createBallHistory, createDisplayQueue, createPopupLayer, spinKind, TRAIL_COLORS, frameSteps,
} from './effects.js';
import { initDebug, launchParams, SCENARIO_LABELS } from './debug.js';
import { createMouseInput, rayPlaneY, analyzeDrag, createRng } from './input.js';
import {
  createAI, createPlayer, createRally, stepMatch, serveBall, placeBall, endFree, tossBall, queueScenario,
  scoreState, racketWorld, serveGuide,
} from './ai.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const shotEl = document.getElementById('shot');
const shotSubEl = document.getElementById('shot-sub');
const robotShotEl = document.getElementById('robot-shot');
const centerEl = document.getElementById('center');
const scoreEls = { me: document.getElementById('score-me'), robot: document.getElementById('score-robot') };
const serveEls = { me: document.getElementById('serve-me'), robot: document.getElementById('serve-robot') };
const serveInfoEl = document.getElementById('serve-info');
const resultEl = document.getElementById('result');
const resultTitleEl = document.getElementById('result-title');
const resultScoreEl = document.getElementById('result-score');
document.getElementById('version').textContent = VERSION;
const view = createRenderer(canvas);
const ballView = createBallView(view.scene);
const myRacket = createRacketView(view.scene, RENDER.COLOR_RACKET_ME, RENDER.RACKET_OPACITY_ME);
const robotRacket = createRacketView(view.scene, RENDER.COLOR_RACKET_AI);
const marker = createMarkerView(view.scene);
const trail = createTrailView(view.scene);
const guideView = createGuideView(view.scene);
window.addEventListener('resize', view.resize);

// ── 연출·소리 ──
const params = new URLSearchParams(location.search);
const audio = createAudio();
const fx = createFx();
const history = createBallHistory();  // 물리 스텝마다 공 상태 복사본
const queue = createDisplayQueue();   // 화면 시각에 맞춰 낼 이벤트·득점 결과
const popups = createPopupLayer(document.getElementById('popups'));
let viewT = 0;                        // 화면이 보여 주는 시각
let crowdRally = null;                // 관중 함성에 마지막으로 반영한 랠리 수

// 시작 화면: 클릭하면 오디오를 켠다 (브라우저 정책상 첫 클릭 전에는 소리를 낼 수 없음)
const startEl = document.getElementById('start');
function unlockAudio() {
  audio.unlock();
  startEl.hidden = true;
}
startEl.addEventListener('click', unlockAudio);
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// 음소거 버튼·음량 슬라이더 (이 브라우저에 기억)
const muteBtn = document.getElementById('mute');
const volumeEl = document.getElementById('volume');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } },
};
const savedVol = Number(store.get('pp-volume'));
if (store.get('pp-volume') !== null && Number.isFinite(savedVol)) audio.setVolume(savedVol);
audio.setMuted(store.get('pp-muted') === '1');
volumeEl.value = audio.volume;
function syncMute() { muteBtn.textContent = audio.muted ? '🔇' : '🔊'; muteBtn.title = audio.muted ? '소리 켜기 (M)' : '음소거 (M)'; }
syncMute();
function toggleMute() {
  audio.setMuted(!audio.muted);
  store.set('pp-muted', audio.muted ? '1' : '0');
  syncMute();
}
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); toggleMute(); muteBtn.blur(); });
volumeEl.addEventListener('input', () => {
  audio.setVolume(Number(volumeEl.value));
  store.set('pp-volume', volumeEl.value);
  if (audio.muted) toggleMute();
});
// ── 일시정지: 물리 스텝·화면 시계·오디오를 모두 멈춘다 (P·Esc·⏸ 버튼, 탭을 옮기면 자동) ──
const pauseBtn = document.getElementById('pause-btn');
const pauseEl = document.getElementById('pause');
let paused = false;
function setPaused(v) {
  if (paused === v) return;
  paused = v;
  pauseEl.hidden = !v;
  pauseBtn.textContent = v ? '▶' : '⏸';
  pauseBtn.title = v ? '계속하기 (P)' : '일시정지 (P)';
  audio.setPaused(v);
}
pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); setPaused(!paused); pauseBtn.blur(); });
pauseEl.addEventListener('click', () => setPaused(false));
document.addEventListener('visibilitychange', () => { if (document.hidden && PAUSE.AUTO_ON_HIDE) setPaused(true); });
for (const el of [muteBtn, volumeEl, pauseBtn]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
if (params.get('sound') === '1') initSoundTest(audio, document.body);

// ── 게임 상태 ──
let difficulty = 'NORMAL';
let clock = 0;            // 게임 시각 (s), 고정 스텝마다 DT씩 증가
let acc = 0;              // 고정 스텝 누적기
let realAtFrame = 0;      // 마지막 프레임의 실제 시각 (s)
let seed = 1;             // 판마다 다른 시드 (판정 오차·로봇 선택)
let freeStart = 0;        // 디버그 떨어뜨리기 시작 시각
let shownResults = 0;     // 화면에 보여 준 득점 결과 수
let messageUntil = 0;     // 득점 사유 표시가 끝나는 시각

const human = createPlayer(-1);
let robot, game;
function newGame() {
  robot = createAI(1, difficulty, createRng(seed * 31 + 7));
  game = createRally({ players: { [-1]: human, [1]: robot.player }, ais: [robot], rng: createRng(seed), firstServer: -1 });
  game.ball.t = clock;
  shownResults = 0;
  messageUntil = 0;
  centerEl.textContent = '';
  shotEl.textContent = '';
  shotSubEl.textContent = '';
  robotShotEl.textContent = '';
  resultEl.hidden = true;
  history.clear();
  queue.clear();
  fx.clock.reset();
  viewT = clock;
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
    // 내 서브 차례: 클릭한 자리(라켓 x)에서 공을 띄운다
    const last = human.samples[human.samples.length - 1];
    tossBall(game, -1, last ? last.x : 0, clock);
  },
});
human.samples = mouse.samples;

function setDifficulty(d) {
  difficulty = d;
  newGame();
}
document.getElementById('again').addEventListener('click', () => newGame());

// ── 디버그 패널 ──
const debugEnabled = params.get('debug') === '1';
const debug = initDebug(debugEnabled, {
  // 발사기: 내 쪽에서 로봇에게 쏜다 (로봇이 받아친다)
  // 발사기·시험 공은 연습 공: 점수에 넣지 않고, 끝나면 원래 서브 대기로 돌아간다
  onLaunch: (cfg) => {
    serveBall(game, makeLaunch({ ...launchParams(cfg), t: clock }), -1);
  },
  onDrop: () => {
    placeBall(game, createBall({ pos: DEMO.DROP_POS, t: clock }));
    freeStart = clock;
  },
  onScenario: (kind) => {
    queueScenario(game, kind, clock);
    centerEl.textContent = `시험 공: ${SCENARIO_LABELS[kind] ?? kind} (${PRACTICE.SCENARIO_DELAY}초 뒤)`;
    messageUntil = clock + PRACTICE.SCENARIO_DELAY;
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
  if (e.code === 'KeyR') newGame();
  if (e.code === 'KeyV') setArrows(!ballView.arrowsVisible);
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyP' || e.code === 'Escape') setPaused(!paused);
  if (e.code === 'KeyG') TUNABLE.FX_SERVE_GUIDE = TUNABLE.FX_SERVE_GUIDE >= 0.5 ? 0 : 1;
});

// ── 판정 표시 ──
function showShot(e) {
  const s = e.shot;
  const label = `${SHOT_LABELS[s.shotType]}${s.quality.weak ? ' (약)' : ''}`;
  if (e.side === -1) {
    shotEl.textContent = `${label} · ${s.quality.timing}`;
    shotEl.className = `shot-${s.quality.timing.toLowerCase()}`;
    const dt = Number.isFinite(s.quality.dtApex) ? `${s.quality.dtApex >= 0 ? '+' : ''}${Math.round(s.quality.dtApex * 1000)} ms` : '정점 없음';
    const dir = s.quality.dragSin <= -TUNABLE.DIR_SIN ? '↓' : s.quality.dragSin >= TUNABLE.DIR_SIN ? '↑' : '↔';
    shotSubEl.textContent = `스윙 ${dir} ${s.quality.dragSpeed.toFixed(2)} m/s (스매시 ↓${TUNABLE.SMASH_SPEED}) · 세기 ${s.quality.strength.toFixed(2)} · 정점 대비 ${dt} · 공 ${e.speed.toFixed(1)} m/s`;
  } else {
    robotShotEl.textContent = `로봇: ${label} · ${s.quality.timing}`;
  }
  debug.onShot?.(e);
}

// ── 득점 사유·점수판·결과 화면 ──
function showResult(r) {
  const tag = r.practice ? '(연습 공) ' : '';
  if (r.type === 'let') centerEl.textContent = `${tag}렛 — 다시 서브`;
  else if (r.type === 'retoss') centerEl.textContent = `${tag}토스 다시`;
  else {
    const who = r.winner === -1 ? '득점' : '실점';
    centerEl.textContent = `${tag}${who} — ${REASON_LABELS[r.reason] ?? r.reason}`;
  }
  centerEl.className = r.type !== 'point' ? 'center-neutral' : r.winner === -1 ? 'center-win' : 'center-lose';
  messageUntil = clock + PRACTICE.POINT_DELAY;
  // 소리: 득점 효과음 + 랠리가 길었을수록 큰 함성. 경기가 끝나면 승리·패배 음악
  if (r.type === 'point') {
    if (r.matchOver && !r.practice) audio.playGameEnd(r.winner === -1);
    else audio.playPoint(r.winner === -1);
    audio.cheer(r.rally);
  }
  fx.onResult(r);
  if (r.matchOver && !r.practice) {
    const [me, rb] = r.score;
    resultTitleEl.textContent = r.winner === -1 ? '승리!' : '패배';
    resultTitleEl.className = r.winner === -1 ? 'result-win' : 'result-lose';
    resultScoreEl.textContent = `나 ${me} : ${rb} 로봇 · 마지막 점수: ${REASON_LABELS[r.reason] ?? r.reason}`;
    resultEl.hidden = false;
  }
}

function updateScoreboard() {
  const st = scoreState(game);
  scoreEls.me.textContent = st.score[0];
  scoreEls.robot.textContent = st.score[1];
  const over = st.phase === 'gameOver';
  serveEls.me.style.visibility = !over && st.server === -1 ? 'visible' : 'hidden';
  serveEls.robot.style.visibility = !over && st.server === 1 ? 'visible' : 'hidden';
  const deuce = Math.min(...st.score) >= RULES.DEUCE_AT;
  const who = st.server === -1 ? '나' : '로봇';
  serveInfoEl.textContent = over ? '게임 끝'
    : deuce ? `듀스 · ${who} 서브 (1점마다 교대)`
      : `${who} 서브 ${st.serveCount + 1}/${RULES.SERVE_TURN}`;
}

// ── 고정 스텝 ──
function fixedStep() {
  const dt = PHYSICS.DT;
  if (!history.length) history.push(clock, game.ball);
  const mp = matchPointSide(game.rules); // 이 랠리가 매치포인트였는지 (슬로모션)
  for (const e of stepMatch(game, dt)) {
    queue.push({ t: e.t, event: structuredClone(e) }); // 연출에는 복사본만 넘긴다
    debug.onEvents([e]);
  }
  while (shownResults < game.results.length) {
    const r = game.results[shownResults++];
    queue.push({ t: r.t, result: { ...r, matchPoint: mp !== 0 } });
  }
  if (game.free && clock - freeStart > DEMO.RESET_AFTER) endFree(game, clock);
  clock += dt;
  game.ball.t = clock;
  history.push(clock, game.ball);
}

// 화면 시각에 도달한 이벤트·득점 결과: 소리, 흔들림·히트스톱, 팝업, 판정 글자
function dispatch(item) {
  if (item.result) { showResult(item.result); return; }
  const e = item.event;
  audio.playImpact(e.type, e.speed, e.shot?.shotType);
  const r = fx.onEvent(e, -1);
  if (r.popups.length) popups.show(r.popups, view.worldToScreen(e.pos));
  if (e.type === 'racket') showShot(e);
}

// ── 서브 가이드라인: 라켓 x를 SERVE_GUIDE.QUANT_X 간격으로 반올림해 계산 결과를 재사용한다 ──
const guideCache = new Map();
let guideSig = '';
function guideFor(x) {
  const sig = JSON.stringify(TUNABLE); // 디버그 패널에서 값이 바뀌면 다시 계산
  if (sig !== guideSig) { guideCache.clear(); guideSig = sig; }
  const cx = Math.min(SERVE.TOSS_X_MAX, Math.max(-SERVE.TOSS_X_MAX, x));
  const q = Math.round(cx / SERVE_GUIDE.QUANT_X) * SERVE_GUIDE.QUANT_X;
  const key = q.toFixed(3);
  if (!guideCache.has(key)) guideCache.set(key, serveGuide(-1, q));
  return guideCache.get(key);
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
  const budget = frameSteps(acc, elapsed, paused); // 일시정지 중에는 0스텝
  for (let i = 0; i < budget.steps; i++) fixedStep();
  acc = budget.acc;
  realAtFrame = now / 1000;
  if (!paused) mouse.refresh(clock);

  // 화면 시각: 물리 시각에서 연출 지연(lag)을 뺀다. 히트스톱 중에는 멈추고, 슬로모션 중에는 느리게 흐른다.
  const out = fx.advance(paused ? 0 : elapsed);
  const prevView = viewT;
  viewT = Math.max(prevView, clock - PHYSICS.DT + acc - out.lag);
  for (const item of queue.popUntil(viewT)) dispatch(item);
  view.setShake(out.shake);

  // 공 (기록 사이 보간)
  const ball = game.ball;
  const shown = history.sample(viewT) ?? ball;
  ballView.update(shown.pos, shown.vel, shown.spin, viewT - prevView);
  if (TUNABLE.FX_TRAIL >= 0.5) {
    const pts = history.trail(viewT, TUNABLE.TRAIL_TIME).map((q) => ({ pos: q.pos, color: TRAIL_COLORS[spinKind(q.vel, q.spin)] }));
    if (pts.length) pts.push({ pos: shown.pos, color: pts[pts.length - 1].color });
    trail.update(pts);
  } else trail.update([]);

  // 라켓: 칠 수 있는(내 쪽에 바운드한) 공이 오면 도달 범위 안에서 앞뒤로 따라간다
  const rules = game.rules;
  const live = !game.free && (rules.phase === 'serving' || rules.phase === 'rally');
  const follow = (side) => (live && canHit(rules, side) && bouncedOn(rules, side) ? ball : null);
  myRacket.update(racketWorld(human, clock, follow(-1)), racketNormal(human, clock, -1));
  const rp = racketWorld(robot.player, viewT, follow(1) && shown) ?? toWorld({ x: SWING.HOME.x, y: SWING.HOME_Y, z: SWING.HOME.z }, 1);
  robotRacket.update(rp, racketNormal(robot.player, clock, 1));

  // 내가 칠 공의 예측 정점 (상대가 친 공이 나에게 오는 중) 또는 내 서브 타점
  // 내 서브 (공을 들고 있거나, 토스했지만 아직 치지 않음): 가이드라인과 넓은 서브 도달 범위 고리
  const mine = !game.free && !game.scenario && !game.practice && rules.server === -1;
  const holdingServe = mine && rules.phase === 'waitingServe';
  const tossed = mine && rules.phase === 'serving' && rules.lastHitter === 0;
  let guide = null;
  if (TUNABLE.FX_SERVE_GUIDE >= 0.5 && (holdingServe || tossed)) {
    const last = human.samples[human.samples.length - 1];
    guide = guideFor(tossed ? ball.pos.x : (last ? last.x : 0));
  }
  guideView.update(guide);
  const waiting = live && canHit(rules, -1);
  const smashable = !tossed && !!human.apexPos && human.apexPos.z >= NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT;
  const ringPos = waiting ? human.apexPos : holdingServe && guide ? guide.hit : null;
  marker.update(ringPos, tossed || holdingServe ? TUNABLE.SERVE_HIT_RADIUS : TUNABLE.HIT_RADIUS, smashable);

  debug.onFrame(elapsed, ball);
  view.render();

  // 관중 함성(랠리 수가 바뀔 때만 반영해 득점 함성을 덮지 않는다), 매치포인트 심장 박동
  const crowdNow = live && !game.practice ? rules.rally : 0;
  if (crowdNow !== crowdRally) { audio.setCrowd(crowdNow); crowdRally = crowdNow; }
  audio.setHeartbeat(live || rules.phase === 'waitingServe' ? matchPointSide(scoreState(game)) !== 0 && !game.practice : false);
  audio.tick();

  updateScoreboard();
  if (clock >= messageUntil) {
    centerEl.className = '';
    const waitServe = rules.phase === 'waitingServe' && !game.free && !game.scenario;
    centerEl.textContent = tossed ? '공이 고리까지 내려올 때 휘두르기!'
      : !waitServe ? ''
        : rules.server === -1 ? '내 서브\n① 클릭: 공 띄우기  ② 공이 고리에 올 때 휘두르기\n↑ 드라이브 · ↓ 커트 · 곡선 = 사이드'
          : '로봇 서브';
  }
  statusEl.textContent = `연습 경기 (${RULES.POINTS_TO_WIN}점) · ${DIFFICULTY_LABELS[difficulty]} · `
    + `1/2/3 난이도(새 게임) · R 새 게임 · P 일시정지 · G 서브 가이드 · V 화살표${debugEnabled ? '' : ' · ?debug=1 패널'}`;
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);

// 디버그 모드에서만: 콘솔·자동 점검용으로 상태를 노출한다
if (debugEnabled) {
  window.pingpong = {
    get game() { return game; }, get robot() { return robot; }, human,
    get clock() { return clock; }, toScreen: view.worldToScreen,
  };
}
