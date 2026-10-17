// main.js — 게임 진입점.
// 첫 화면: 연습(로봇과 11점 1게임) / 방 만들기 / 코드로 입장(대전, 5단계).
// 흐름: 서브 대기 → (내 서브: 클릭으로 토스 → 드래그로 치기 / 상대 서브) → 랠리 → 득점 사유 표시 → 다음 서브 … → 결과 화면
// 물리는 고정 스텝, 화면은 공 상태 기록을 "화면 시각"으로 보간해 그린다.
// 4단계: 화면 시각 = 물리 시각 − lag (히트스톱·슬로모션은 lag만 늘린다). 소리·연출·판정 표시는
// 물리 이벤트를 대기열에 넣었다가 화면이 그 순간을 보여 줄 때 낸다. 연출은 물리 상태를 바꾸지 않는다.
// 5단계 대전: 물리 시각 = 서버 시각에 맞춘 경기 시각 (net.js). 상대 타격은 되감아 다시 계산하고,
// 화면의 공은 그 타격 순간부터 0.1 s에 걸쳐 빨리 감아 합류한다. 점수판은 서버 판정만 보여 준다.
import {
  createRenderer, createBallView, createRacketView, createMarkerView, createTrailView, createGuideView,
} from './render.js';
import { createBall, makeLaunch, faceNormal, toWorld, toLocal, carriedSpin } from '../shared/physics.js';
import {
  PHYSICS, PRACTICE, SWING, RENDER, TUNABLE, TUNABLE_DEFAULTS, TUNABLE_RANGES, TUNABLE_ONLINE_FREE, NET, VERSION, SHOT_LABELS,
  DIFFICULTIES, DIFFICULTY_LABELS, DEMO, REASON_LABELS, RULES, SERVE, SERVE_GUIDE, PAUSE, ONLINE, ONLINE_ERRORS,
  REJECT_LABELS, MOBILE, FEEL, SHOT_KEYS, SHOT_BUTTONS,
} from '../shared/constants.js';
import { canHit, bouncedOn, matchPointSide, idx } from '../shared/rules.js';
import { createAudio, initSoundTest } from './audio.js';
import {
  createFx, createBallHistory, createDisplayQueue, createPopupLayer, frameSteps, vibrationMs, trailColor, spinRead,
} from './effects.js';
import { initDebug, launchParams, SCENARIO_LABELS } from './debug.js';
import {
  createMouseInput, rayPlaneY, analyzeDrag, createRng, cameraFor, tunableCamera, zoomCamera, dragScaleFor, createShotKeys, shotKeysOf,
  controlMode,
} from './input.js';
import {
  createAI, createPlayer, createRally, stepMatch, serveBall, placeBall, endFree, tossBall, queueScenario,
  scoreState, racketWorld, serveGuide,
} from './ai.js';
import { createOnlineClient, createBallLag, courtShare } from './net.js';
import { touchSpeedScale, mobileCamera } from './touch.js';
import {
  detectMobile, createQualityGovernor, createWakeLock, canFullscreen, toggleFullscreen, applyAudioSession, vibrate,
} from './mobile.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const statusEl = $('status');
const shotEl = $('shot');
const shotSubEl = $('shot-sub');
const robotShotEl = $('robot-shot');
const centerEl = $('center');
const scoreEls = { me: $('score-me'), robot: $('score-robot') };
const serveEls = { me: $('serve-me'), robot: $('serve-robot') };
const nameEls = { me: $('name-me'), robot: $('name-robot') };
const serveInfoEl = $('serve-info');
const resultEl = $('result');
const resultTitleEl = $('result-title');
const resultScoreEl = $('result-score');
const againBtn = $('again');
const pingEl = $('ping');
const netMsgEl = $('net-msg');
const leaveBtn = $('leave-btn');
document.getElementById('version').textContent = VERSION;
const params = new URLSearchParams(location.search);

// ── 모바일 모드 (6단계): 화면·품질·진동·화면 꺼짐 방지. 터치 입력 자체는 모드와 무관하게 작동한다 (input.js) ──
const mobile = detectMobile({
  query: params.get('mobile'), coarse: !!window.matchMedia?.('(pointer: coarse)').matches,
  width: screen.width, height: screen.height,
});
if (mobile) document.body.classList.add('mobile');
const dpr = window.devicePixelRatio || 1;
const view = createRenderer(canvas, mobile ? {
  pixelRatio: Math.min(dpr, TUNABLE.MOB_PIXEL_RATIO), shadowSize: TUNABLE.MOB_SHADOW_SIZE,
  antialias: dpr < MOBILE.NO_AA_DPR, softShadow: false,
} : {});
const quality = mobile ? createQualityGovernor(Math.min(dpr, TUNABLE.MOB_PIXEL_RATIO), TUNABLE, dpr) : null;
const wakeLock = mobile ? createWakeLock() : null;
if (mobile) {
  applyAudioSession(); // AudioContext를 만들기 전에 정해 둔다 (iOS 무음 스위치)
  document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS 두 손가락 확대
}
const ballView = createBallView(view.scene);
const myRacket = createRacketView(view.scene, RENDER.COLOR_RACKET_ME, RENDER.RACKET_OPACITY_ME);
const robotRacket = createRacketView(view.scene, RENDER.COLOR_RACKET_AI);
const marker = createMarkerView(view.scene);
const trail = createTrailView(view.scene);
const guideView = createGuideView(view.scene);
window.addEventListener('resize', view.resize);

// ── 연출·소리 ──
const audio = createAudio();
const fx = createFx();
const history = createBallHistory();  // 물리 스텝마다 공 상태 복사본
const queue = createDisplayQueue();   // 화면 시각에 맞춰 낼 이벤트·득점 결과
const popups = createPopupLayer($('popups'));
const ballLag = createBallLag();      // 대전: 공만 늦게 보여 주는 시간 (상대 쪽에서는 예상 지연만큼, 내 쪽에서는 0)
let shownY = 0;                       // 지난 프레임에 보여 준 공의 내 기준 y (화면 지연 계산용)
let viewT = 0;                        // 화면이 보여 주는 시각
let crowdRally = null;                // 관중 함성에 마지막으로 반영한 랠리 수
// 소리 잠금 해제: 사용자 동작마다 다시 시도한다 (iOS는 터치를 뗄 때·다른 앱에서 돌아온 뒤 다시 켜야 할 때가 있다)
for (const type of ['pointerdown', 'touchend', 'click']) window.addEventListener(type, () => audio.unlock(), { passive: true });

// 음소거·음량 (설정 패널, 이 브라우저에 기억)
const soundEl = $('set-sound');
const volumeEl = $('volume');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 동작에는 지장 없음 */ } },
};
const savedVol = Number(store.get('pp-volume'));
if (store.get('pp-volume') !== null && Number.isFinite(savedVol)) audio.setVolume(savedVol);
audio.setMuted(store.get('pp-muted') === '1');
volumeEl.value = audio.volume;
function syncMute() { soundEl.checked = !audio.muted; }
syncMute();
function toggleMute() {
  audio.setMuted(!audio.muted);
  store.set('pp-muted', audio.muted ? '1' : '0');
  syncMute();
}
soundEl.addEventListener('change', () => { audio.unlock(); if (audio.muted === soundEl.checked) toggleMute(); soundEl.blur(); });
volumeEl.addEventListener('input', () => {
  audio.setVolume(Number(volumeEl.value));
  store.set('pp-volume', volumeEl.value);
  if (audio.muted) toggleMute();
});

// ── 모드: 'menu'(첫 화면, 뒤에서 연습 경기가 돈다) | 'practice' | 'online' ──
let mode = 'menu';
let me = -1;              // 내 자리 (연습: −1, 대전: 서버가 정함)
let client = null;        // 대전 클라이언트 (net.js)
const online = () => mode === 'online';

// ── 일시정지: 물리 스텝·화면 시계·오디오를 모두 멈춘다 (P·Esc·⏸ 버튼, 탭을 옮기면 자동). 연습 전용 ──
const pauseBtn = $('pause-btn');
const pauseEl = $('pause');
let paused = false;
function setPaused(v) {
  if (online()) v = false; // 대전에서는 물리 시간을 멈출 수 없다
  if (paused === v) return;
  paused = v;
  pauseEl.hidden = !v;
  pauseBtn.textContent = v ? '▶' : '⏸';
  pauseBtn.title = v ? '계속하기 (P)' : '일시정지 (P)';
  audio.setPaused(v);
}
pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); setPaused(!paused); pauseBtn.blur(); });
pauseEl.addEventListener('click', () => { setSettingsOpen(false); setPaused(false); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && PAUSE.AUTO_ON_HIDE && mode === 'practice') setPaused(true);
  if (!document.hidden) client?.wake(); // 모바일 백그라운드 복귀: 끊겼으면 바로 다시 접속, 아니면 시계를 바로 다시 잰다
});
// 모바일 화면 버튼: 전체 화면, 일시정지 화면의 난이도·새 게임·화살표 (시점·서브 가이드는 7단계 수정부터 설정 ⚙ 안)
const fsBtn = $('fs-btn');
const tap = (el, fn) => el.addEventListener('click', (e) => { e.stopPropagation(); fn(); el.blur(); });
tap(fsBtn, toggleFullscreen);
fsBtn.hidden = !canFullscreen();
for (const b of document.querySelectorAll('#pause-actions [data-diff]')) tap(b, () => { setDifficulty(b.dataset.diff); setPaused(false); });
tap($('pause-new'), () => { newGame(); setPaused(false); });
tap($('pause-menu'), () => { setPaused(false); toMenu(); }); // 7단계: 일시정지 화면에서 메인화면으로
tap($('pause-arrows'), () => setArrows(!ballView.arrowsVisible));
for (const el of [pauseBtn, leaveBtn, fsBtn]) el.addEventListener('pointerdown', (e) => e.stopPropagation());

// ── 구질 버튼 (7단계): PC Q·W·E·R, 모바일 화면 버튼. 나중에 누른 버튼이 이긴다 ──
const shotKeys = createShotKeys();
const shotKeysEl = $('shot-keys');
const shotBtnsEl = $('shot-btns');
function markKeys() { mouse?.mark(mouse.now?.() ?? simT()); }
// 모바일 버튼 하나가 버튼 여러 개를 누른다 (조합 버튼 data-k="cut side" = 커트 + 사이드). 뗄 때 한 번만 뗀다
for (const btn of shotBtnsEl.querySelectorAll('button')) {
  const keys = btn.dataset.k.split(' ');
  let down = false;
  const up = (e) => {
    e.stopPropagation();
    if (!down) return;
    down = false;
    for (const k of keys) shotKeys.release(k);
    markKeys();
  };
  btn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 손가락 */ }
    if (down) return;
    down = true;
    for (const k of keys) shotKeys.press(k);
    markKeys();
  });
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
window.addEventListener('blur', () => { shotKeys.clear(); markKeys(); }); // 창을 떠나면 눌린 키가 남지 않게
let keysShown = '';
let btnLayout = '';
// 화면의 구질 버튼 표시: PC는 아래 가운데 키 칩, 모바일은 화면 버튼 (첫 화면에서는 숨김)
function updateShotButtons() {
  const playing = mode !== 'menu' && control === 'advanced'; // 기본 모드는 구질 버튼이 없다 (7단계 수정)
  shotKeysEl.hidden = mobile || !playing;
  shotBtnsEl.hidden = !mobile || !playing;
  const cur = shotKeys.current ?? '';
  if (cur !== keysShown) {
    keysShown = cur;
    const on = shotKeysOf(cur || null); // 조합 구질이면 두 버튼이 함께 빛난다
    for (const el of shotKeysEl.children) el.classList.toggle('on', on.includes(el.dataset.k));
    for (const el of shotBtnsEl.children) el.classList.toggle('on', el.dataset.k.split(' ').every((k) => on.includes(k)) && el.dataset.k.split(' ').length === on.length);
  }
  const layout = `${TUNABLE.MOB_BTN_SIZE}|${TUNABLE.MOB_BTN_LEFT}`;
  if (layout !== btnLayout) {
    btnLayout = layout;
    shotBtnsEl.style.setProperty('--btn', `${TUNABLE.MOB_BTN_SIZE}px`);
    shotBtnsEl.classList.toggle('right', TUNABLE.MOB_BTN_LEFT < 0.5);
  }
}
if (mobile) {
  $('pause-hint').textContent = '화면을 누르면 이어서 합니다.';
  $('pause-hint2').textContent = '다른 앱으로 가면 자동으로 멈춥니다.';
}

// ── 조작표 (7단계, 7단계 수정 조작 모드별): 일시정지 화면·첫 경기 안내판·첫 화면 안내 ──
const COMMON_KEYS = mobile ? [] : [
  ['<kbd>Space</kbd>', '시점 · <kbd>N</kbd> 새 게임 · <kbd>P</kbd>/<kbd>Esc</kbd> 일시정지 · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 난이도'],
  ['<kbd>G</kbd>', '서브 가이드 · <kbd>V</kbd> 화살표 · <kbd>M</kbd> 음소거 · ⚙ 설정'],
];
const CONTROLS = {
  // 기본: 스윙 방향·곡률·속도로 구질 (v6.3 방식)
  basic: [
    [mobile ? '쓸기' : '드래그', `라켓 휘두르기 (빠를수록 세게, 좌우로 조준)${mobile ? '' : ' · 클릭 = 서브 토스'}`],
    ['위로 쓸어 올리기', '<span class="k-drive">드라이브</span> · 탑스핀, 커트 공을 들어 올린다'],
    ['아래로 내리기', '<span class="k-cut">커트</span> · 백스핀, 탑스핀 공을 백스핀으로'],
    ['휘어지게 (곡선)', '<span class="k-side">사이드</span> · 횡회전'],
    ['아래로 빠르게', '<span class="k-smash">스매시</span> · 빨간 고리(높은 공)에서, 노란 고리면 센 커트'],
    [mobile ? '대고 멈춤' : '누른 채 멈춤', '블록'],
    ['같은 회전', '같은 구질로 받아칠수록 회전이 쌓인다 (꼬리가 진해짐)'],
    ['⚙ 설정', '고급 모드: 버튼으로 구질 고르기 (무회전·조합 구질)'],
    ...COMMON_KEYS,
  ],
  // 고급: 구질 버튼 (7단계)
  advanced: mobile ? [
    ['쓸기', '라켓 휘두르기 (빠를수록 세게, 좌우로 조준)'],
    ['버튼 없이', '일반 스윙 · 무회전 (들어온 회전을 그대로 받음)'],
    ['<span class="k-drive">드라이브</span>', '강한 탑스핀 · 커트·무회전 공을 들어 올린다'],
    ['<span class="k-cut">커트</span>', '강한 백스핀 · 커트 공을 커트로, 탑스핀을 백스핀으로'],
    ['<span class="k-side">사이드</span>', '강한 횡회전 · 센 탑·백 공에는 위험'],
    ['<span class="k-side">사이드</span> + <span class="k-cut">커트</span>', '횡+백회전 (사이드 드라이브 버튼은 횡+탑)'],
    ['<span class="k-smash">스매시</span>', '빨간 고리(높은 공)에서 휘두르기 · 노란 고리면 네트'],
    ['대고 멈춤', '블록'],
    ['같은 회전', '같은 구질로 받아칠수록 회전이 쌓인다 (꼬리가 진해짐)'],
  ] : [
    ['드래그', '라켓 휘두르기 (빠를수록 세게, 좌우로 조준) · 클릭 = 서브 토스'],
    ['버튼 없이', '일반 스윙 · 무회전 (들어온 회전을 그대로 받음)'],
    ['<kbd>Q</kbd>', '<span class="k-drive">드라이브</span> · 강한 탑스핀, 커트·무회전 공을 들어 올린다'],
    ['<kbd>W</kbd>', '<span class="k-cut">커트</span> · 강한 백스핀, 커트 공을 커트로, 탑스핀을 백스핀으로'],
    ['<kbd>E</kbd>', '<span class="k-side">사이드</span> · 강한 횡회전, 센 탑·백 공에는 위험'],
    ['<kbd>W</kbd>+<kbd>E</kbd>', '<span class="k-cut">커트</span>+<span class="k-side">사이드</span> · 횡+백회전 (<kbd>Q</kbd>+<kbd>E</kbd>는 횡+탑)'],
    ['<kbd>R</kbd>', '<span class="k-smash">스매시</span> · 빨간 고리(높은 공)에서 휘두르기, 노란 고리면 네트'],
    ['누른 채 멈춤', '블록'],
    ['같은 회전', '같은 구질로 받아칠수록 회전이 쌓인다 (꼬리가 진해짐)'],
    ...COMMON_KEYS,
  ],
};
const MENU_HINT = {
  basic: mobile ? '쓰는 방향으로 구질 · ⚙ 설정에서 고급(구질 버튼) · 가로 화면 권장 · ⛶ 전체 화면'
    : '드래그 방향으로 구질 · ⚙ 설정에서 고급(Q/W/E/R) · Space 시점 바꾸기',
  advanced: mobile ? '오른손으로 쓸어 치기 · 왼손으로 구질 버튼 · 가로 화면 권장 · ⛶ 전체 화면'
    : '드래그로 치기 · Q/W/E/R 구질 · M 음소거 · Space 시점 바꾸기',
};
// 내 서브 안내 (가운데 글자)와 PC 위쪽 상태 줄의 구질 안내
const SERVE_HINT = {
  basic: mobile ? '내 서브\n① 화면 터치: 공 띄우기  ② 공이 고리에 올 때 쓸기\n위로 = 탑 · 아래로 = 백 · 곡선 = 사이드'
    : '내 서브\n① 클릭: 공 띄우기  ② 공이 고리에 올 때 휘두르기\n위로 = 탑 · 아래로 = 백 · 곡선 = 사이드',
  advanced: mobile ? '내 서브\n① 화면 터치: 공 띄우기  ② 공이 고리에 올 때 쓸기\n버튼 없이 = 무회전 · 드라이브 · 커트 · 사이드 버튼'
    : '내 서브\n① 클릭: 공 띄우기  ② 공이 고리에 올 때 휘두르기\n버튼 없이 = 무회전 · Q 탑 · W 백 · E 사이드',
};
const STATUS_SHOT = { basic: '기본 조작(방향으로 구질)', advanced: 'Q/W/E/R 구질' };
const CONTROL_DESC = {
  basic: '위로 = 드라이브, 아래로 = 커트, 곡선 = 사이드, 높은 공을 아래로 빠르게 = 스매시. 버튼이 필요 없습니다.',
  advanced: mobile ? '왼손 화면 버튼으로 구질(드라이브·커트·사이드·스매시·조합)을 고르고 오른손으로 쓸어 칩니다. 버튼 없이 치면 무회전.'
    : 'Q 드라이브 · W 커트 · E 사이드 · R 스매시를 누른 채 드래그. W+E·Q+E 조합, 버튼 없이 치면 무회전.',
};
function renderControls() {
  for (const id of ['pause-controls', 'intro-controls']) {
    $(id).innerHTML = CONTROLS[control].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  }
  $('menu-hint').textContent = MENU_HINT[control];
}

// ── 설정 (7단계 수정, 오른쪽 위 ⚙): 조작 모드(기본/고급), 소리, 화면. 이 브라우저에 기억한다 (조작 모드·소리) ──
// 조작 모드는 내 타격 판정에만 쓰여(서버는 결과 공만 검증) 대전 중에도 바꿀 수 있고, 상대와 달라도 된다
let control = controlMode(store.get('pp-control'));
const settingsEl = $('settings');
const settingsBtn = $('settings-btn');
let settingsPaused = false; // 설정을 열면서 연습 경기를 멈췄는가 (닫으면 이어서 한다)
function setControl(v) {
  control = controlMode(v);
  store.set('pp-control', control);
  shotKeys.clear();
  markKeys();
  renderControls();
  syncSettings();
}
// 체크박스 → 연출 켜기/끄기 (TUNABLE_TOGGLES라 대전 중에도 바꿀 수 있다)
const TOGGLE_INPUTS = {
  'set-crowd': 'SND_CROWD', 'set-heart': 'SND_HEART', 'set-guide': 'FX_SERVE_GUIDE', 'set-shake': 'FX_SHAKE', 'set-vibrate': 'FX_VIBRATE',
};
function syncSettings() {
  for (const b of $('set-control').children) b.classList.toggle('on', b.dataset.v === control);
  $('set-control-desc').textContent = CONTROL_DESC[control];
  syncMute();
  volumeEl.value = audio.volume;
  $('set-view').checked = classicView;
  syncDist();
  for (const [id, key] of Object.entries(TOGGLE_INPUTS)) $(id).checked = TUNABLE[key] >= 0.5;
}
function setSettingsOpen(v) {
  if (settingsEl.hidden === !v) return;
  settingsEl.hidden = !v;
  settingsBtn.classList.toggle('on', v);
  if (v) {
    syncSettings();
    settingsPaused = mode === 'practice' && !paused;
    if (settingsPaused) setPaused(true);
  } else if (settingsPaused) {
    settingsPaused = false;
    if (mode === 'practice') setPaused(false);
  }
}
if (mobile) $('set-adv-sub').textContent = '화면 구질 버튼';
tap(settingsBtn, () => setSettingsOpen(settingsEl.hidden));
tap($('settings-close'), () => setSettingsOpen(false));
for (const b of $('set-control').children) tap(b, () => setControl(b.dataset.v));
$('set-view').addEventListener('change', () => { classicView = $('set-view').checked; });
// 시점 거리 (7단계 수정): 설정 슬라이더 · 게임 화면 위 마우스 휠. 이 브라우저에 기억한다 (화면 전용 값이라 대전 중에도 바뀜)
function syncDist() {
  $('set-dist').value = TUNABLE.CAM_DIST;
  $('set-dist-val').textContent = `${TUNABLE.CAM_DIST.toFixed(2)}×`;
}
function setCamDist(v) {
  const { min, max, step } = TUNABLE_RANGES.CAM_DIST;
  TUNABLE.CAM_DIST = Number(Math.min(max, Math.max(min, Math.round(v / step) * step)).toFixed(2));
  store.set('pp-camdist', String(TUNABLE.CAM_DIST));
  syncDist();
}
Object.assign($('set-dist'), TUNABLE_RANGES.CAM_DIST);
const savedDist = Number(store.get('pp-camdist'));
if (store.get('pp-camdist') !== null && Number.isFinite(savedDist)) setCamDist(savedDist);
$('set-dist').addEventListener('input', () => setCamDist(Number($('set-dist').value)));
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  setCamDist(TUNABLE.CAM_DIST + Math.sign(e.deltaY) * TUNABLE_RANGES.CAM_DIST.step);
}, { passive: false });
for (const [id, key] of Object.entries(TOGGLE_INPUTS)) $(id).addEventListener('change', () => { TUNABLE[key] = $(id).checked ? 1 : 0; });
for (const el of [settingsBtn, settingsEl]) {
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => e.stopPropagation()); // 일시정지 화면 클릭(이어 하기)으로 번지지 않게
}
renderControls();

// 첫 경기 안내판: 처음 시작할 때 (다시 보지 않기를 고르면 이 브라우저에서는 생략)
const introEl = $('intro');
let introUntil = 0;
function showIntro() {
  if (store.get('pp-intro') === '1') return;
  introEl.hidden = false;
  introUntil = performance.now() / 1000 + FEEL.INTRO_TIME;
}
function hideIntro() {
  if (introEl.hidden) return;
  introEl.hidden = true;
  if ($('intro-never').checked) store.set('pp-intro', '1');
}
$('intro-ok').addEventListener('click', (e) => { e.stopPropagation(); hideIntro(); });
introEl.addEventListener('pointerdown', (e) => e.stopPropagation());
if (params.get('sound') === '1') initSoundTest(audio, document.body);

// ── 게임 상태 ──
let difficulty = 'NORMAL';
let clock = 0;            // 연습: 게임 시각 (s), 고정 스텝마다 DT씩 증가
let acc = 0;              // 고정 스텝 누적기
let realAtFrame = 0;      // 마지막 프레임의 실제 시각 (s)
let seed = 1;             // 판마다 다른 시드 (판정 오차·로봇 선택)
let freeStart = 0;        // 디버그 떨어뜨리기 시작 시각
let shownResults = 0;     // 화면에 보여 준 득점 결과 수
let messageUntil = 0;     // 득점 사유 표시가 끝나는 시각
let practiceTunables = null; // 대전에 들어가기 전 TUNABLE (돌아오면 되살린다)

let human = createPlayer(-1);
let robot, game;
let mouse = null;
const simT = () => (online() ? game.ball.t : clock);           // 물리 시각
const opp = () => game.players[-me];                             // 상대 플레이어 (연습: 로봇)
const nowMs = () => performance.timeOrigin + performance.now();

function resetView(t) {
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
  ballLag.reset();
  viewT = t;
}

function newGame() {
  me = -1;
  human = createPlayer(-1);
  if (mouse) {
    mouse.samples.length = 0; // 시계가 바뀌므로(대전 ↔ 연습) 이전 샘플은 버린다
    human.samples = mouse.samples;
  }
  robot = createAI(1, difficulty, createRng(seed * 31 + 7));
  game = createRally({ players: { [-1]: human, [1]: robot.player }, ais: [robot], rng: createRng(seed), firstServer: -1 });
  game.ball.t = clock;
  resetView(clock);
  nameEls.me.textContent = '나';
  nameEls.robot.textContent = '로봇';
  againBtn.textContent = '다시 하기';
  seed++;
}

// 마우스: 화면 → 내 라켓 평면 (광선을 내 기준 좌표로 돌려 평면 y = yPlane과 만나는 점)
mouse = createMouseInput(canvas, {
  toPlane(cx, cy) {
    const r = view.screenRay(cx, cy);
    return rayPlaneY(toLocal(r.origin, me), toLocal(r.dir, me), human.yPlane);
  },
  now: () => (online() ? client.matchTime(nowMs()) : clock + acc + (performance.now() / 1000 - realAtFrame)),
  button: () => (control === 'advanced' ? shotKeys.current : null), // 기본 모드는 구질 버튼을 남기지 않는다
  onPress() {
    if (mode === 'menu') return;
    // 내 서브 차례: 클릭한 자리(라켓 x)에서 공을 띄운다
    const last = human.samples[human.samples.length - 1];
    const x = last ? last.x : 0;
    if (online()) client.toss(x);
    else tossBall(game, -1, x, clock);
  },
});
human.samples = mouse.samples;
mouse.now = () => (online() ? client.matchTime(nowMs()) : clock + acc + (performance.now() / 1000 - realAtFrame));

function setDifficulty(d) {
  difficulty = d;
  newGame();
}
againBtn.addEventListener('click', () => { if (online() || mode === 'menu') toMenu(); else newGame(); });

// ── 디버그 패널 ──
const debugEnabled = params.get('debug') === '1';
const debug = initDebug(debugEnabled, {
  // 발사기: 내 쪽에서 로봇에게 쏜다 (로봇이 받아친다)
  // 발사기·시험 공은 연습 공: 점수에 넣지 않고, 끝나면 원래 서브 대기로 돌아간다
  onLaunch: (cfg) => {
    if (online()) return;
    serveBall(game, makeLaunch({ ...launchParams(cfg), t: clock }), -1);
  },
  onDrop: () => {
    if (online()) return;
    placeBall(game, createBall({ pos: DEMO.DROP_POS, t: clock }));
    freeStart = clock;
  },
  onScenario: (kind) => {
    if (online()) return;
    queueScenario(game, kind, clock);
    centerEl.textContent = `시험 공: ${SCENARIO_LABELS[kind] ?? kind} (${PRACTICE.SCENARIO_DELAY}초 뒤)`;
    messageUntil = clock + PRACTICE.SCENARIO_DELAY;
  },
  onArrows: setArrows,
  arrowsVisible: ballView.arrowsVisible,
  collapsed: mobile, // 모바일은 접은 채로 시작 (⚙ 버튼으로 펼침)
  quality: () => (mobile ? `픽셀 비율 ${quality.ratio.toFixed(2)}` : ''),
  me: () => me,
});
function setArrows(v) {
  ballView.setArrowsVisible(v);
  debug.syncArrows?.(v);
}

const typing = (e) => e.target.tagName === 'INPUT' && e.target.type === 'text'; // 닉네임·코드 입력 중
const modified = (e) => e.ctrlKey || e.metaKey || e.altKey; // Ctrl+R(새로고침)·Ctrl+W 등 브라우저 단축키는 건드리지 않는다
window.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  if (e.code === 'Space') {
    e.preventDefault(); // 페이지 스크롤·포커스된 버튼 누르기 막기
    if (!e.repeat) classicView = !classicView; // 새 시점 ↔ 기존 시점 (대전에서도 가능)
    return;
  }
  const k = SHOT_KEYS[e.code];
  if (k && !modified(e)) {
    if (!e.repeat && control === 'advanced') { shotKeys.press(k); markKeys(); }
    return;
  }
  if (e.code === 'KeyV') setArrows(!ballView.arrowsVisible);
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyG') TUNABLE.FX_SERVE_GUIDE = TUNABLE.FX_SERVE_GUIDE >= 0.5 ? 0 : 1;
  if (online() || mode === 'menu') return; // 아래는 연습 전용
  const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
  if (i >= 0) setDifficulty(DIFFICULTIES[i]);
  if (e.code === 'KeyN' && !modified(e)) newGame();
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (!settingsEl.hidden) setSettingsOpen(false);
    else setPaused(!paused);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !typing(e)) e.preventDefault();
  const k = SHOT_KEYS[e.code];
  if (k) { shotKeys.release(k); markKeys(); }
});

// ── 첫 화면 ──
const menuEl = $('menu');
const nickEl = $('menu-nick');
const codeEl = $('menu-code');
const menuErr = $('menu-error');
const lobbyEl = $('lobby');
const netErrEl = $('neterror');
nickEl.value = store.get('pp-nick') ?? '';
const roomParam = (params.get('room') ?? '').toUpperCase();
if (roomParam) codeEl.value = roomParam;
if (!mobile) (roomParam ? (nickEl.value ? codeEl : nickEl) : nickEl).focus(); // 모바일은 화면 키보드가 바로 뜨지 않게
const nickname = () => {
  const n = nickEl.value.trim().slice(0, ONLINE.NICK_MAX);
  store.set('pp-nick', n);
  return n || '이름 없음';
};

$('menu-practice').addEventListener('click', () => {
  audio.unlock();
  nickname();
  menuEl.hidden = true;
  mode = 'practice';
  newGame();
  showIntro();
});
$('menu-create').addEventListener('click', async () => {
  audio.unlock();
  menuErr.textContent = '';
  for (let tries = 0; tries < 3; tries++) {
    let code;
    try {
      const res = await fetch('/api/new', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      ({ code } = await res.json());
    } catch {
      menuErr.textContent = ONLINE_ERRORS.limit;
      return;
    }
    const r = await startOnline(code, true);
    if (r !== 'inUse') return;
  }
});
$('menu-join').addEventListener('click', () => {
  audio.unlock();
  const code = codeEl.value.trim().toUpperCase();
  if (code.length !== ONLINE.CODE_LEN) { menuErr.textContent = '4자리 방 코드를 입력하세요.'; return; }
  menuErr.textContent = '';
  startOnline(code, false);
});
codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('menu-join').click(); });
$('lobby-copy').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${client?.code ?? ''}`;
  try {
    await navigator.clipboard.writeText(link);
    $('lobby-copy').textContent = '복사됨!';
  } catch {
    window.prompt('이 링크를 친구에게 보내세요', link);
  }
});
$('lobby-leave').addEventListener('click', () => toMenu());
$('neterror-back').addEventListener('click', () => toMenu());
leaveBtn.addEventListener('click', () => {
  if (window.confirm('나가면 기권패가 됩니다. 나갈까요?')) toMenu();
});

function toMenu() {
  if (client) { client.leave(); client = null; }
  if (practiceTunables) { Object.assign(TUNABLE, practiceTunables); practiceTunables = null; }
  debug.setLocked(false);
  debug.setPing(null);
  mode = 'menu';
  hideIntro();
  lobbyEl.hidden = true;
  netErrEl.hidden = true;
  pingEl.hidden = true;
  netMsgEl.hidden = true;
  leaveBtn.hidden = true;
  pauseBtn.hidden = false;
  menuEl.hidden = false;
  window.history.replaceState(null, '', location.pathname + (debugEnabled ? '?debug=1' : ''));
  newGame();
}

// ── 대전 ──
function lobbyText(players, status) {
  const lines = players.map((p) => `${p.side === me ? '▶ ' : '　'}${p.nick}${p.side === me ? ' (나)' : ''} · ${p.ready ? '준비 완료' : '준비 중'}`);
  $('lobby-players').textContent = '';
  for (const l of lines) $('lobby-players').append(Object.assign(document.createElement('div'), { textContent: l }));
  $('lobby-status').textContent = status === 'connecting' ? '연결 중…'
    : status === 'syncing' ? '시계 맞추는 중…'
      : players.length < 2 ? '상대를 기다리는 중… 코드나 링크를 친구에게 보내세요'
        : '곧 시작합니다';
}

function showNetError(code) {
  lobbyEl.hidden = true;
  menuEl.hidden = true;
  netErrEl.hidden = false;
  $('neterror-text').textContent = ONLINE_ERRORS[code] ?? ONLINE_ERRORS.limit;
}

// 반환: 첫 화면 단계의 결과 ('inUse'면 다른 코드로 다시 시도)
// 내가 접속한 Cloudflare 데이터센터 코드 (/api/where, 대전 시작 때 한 번)
let myColo = null;
function fetchWhere() {
  fetch('/api/where').then((r) => r.json()).then((w) => { myColo = w.colo ?? null; }).catch(() => {});
}

function startOnline(code, create) {
  fetchWhere();
  return new Promise((resolve) => {
    menuEl.hidden = true;
    lobbyEl.hidden = false;
    $('lobby-code').textContent = code;
    $('lobby-copy').textContent = '초대 링크 복사';
    lobbyText([], 'connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    client = createOnlineClient({
      open: () => new WebSocket(`${proto}//${location.host}/ws/${code}`),
      now: nowMs,
      nickname: nickname(), code, create, seed: seed++,
      makePlayer(side) {
        human = createPlayer(side);
        mouse.samples.length = 0; // 경기 시각으로 새로 기록한다
        human.samples = mouse.samples;
        return { player: human };
      },
      hooks: {
        onStatus(s) { if (s === 'syncing' || s === 'waiting') lobbyText(client.players, s); },
        onLobby(players) { me = client.me; lobbyText(players, client.status); done('ok'); },
        onStart: () => beginOnline(),
        onStep(events) {
          for (const e of events) queue.push({ t: e.t, event: structuredClone(e) });
          history.push(game.ball.t, game.ball);
        },
        onRewind(t) {
          history.truncate(t);
          queue.dropAfter(t);
          if (shownResults > game.results.length) shownResults = game.results.length;
        },
        onRemote(msg, lag) { ballLag.observe(lag); },
        onServerResult: (r, matched) => onServerResult(r, matched),
        onReject(msg) {
          shotSubEl.textContent = `타격 무효 (${REJECT_LABELS[msg.reason] ?? msg.reason})`;
        },
        onEnd: (msg) => showOnlineEnd(msg),
        onError(code2) {
          if (code2 === 'inUse' && create && !settled) { client = null; done('inUse'); return; }
          done('error');
          showNetError(code2);
        },
      },
    });
    client.connect();
  });
}

function beginOnline() {
  me = client.me;
  game = client.game;
  mode = 'online';
  setPaused(false);
  // 대전 중에는 물리·판정 값을 서버와 같은 기본값으로 고정한다 (연출 켜기/끄기는 그대로)
  if (!practiceTunables) practiceTunables = { ...TUNABLE }; // 재접속(resume) 때 다시 덮어쓰지 않게
  for (const [k, v] of Object.entries(TUNABLE_DEFAULTS)) if (!TUNABLE_ONLINE_FREE.includes(k)) TUNABLE[k] = v;
  debug.setLocked(true);
  guideCache.clear();
  resetView(0);
  lobbyEl.hidden = true;
  pingEl.hidden = false;
  leaveBtn.hidden = false;
  pauseBtn.hidden = true;
  const oppP = client.players.find((p) => p.side === -me);
  nameEls.me.textContent = client.players.find((p) => p.side === me)?.nick ?? '나';
  nameEls.robot.textContent = oppP?.nick ?? '상대';
  againBtn.textContent = '첫 화면으로';
  showIntro();
}

function onServerResult(r, matched) {
  if (matched) {
    // 이미 보여 준 잠정 판정이면 확정 표시로 바꾼다 (소리·연출은 이때 낸다)
    if (r.shown) finalizeResult(r);
  } else if (r.corrected) {
    // 정정된 판정: 서버 결과가 결과 목록에 들어갔다 (대기열로 곧바로 표시된다)
  }
}

function showOnlineEnd(msg) {
  const win = msg.winner === me;
  const [a, b] = [msg.score[idx(me)], msg.score[idx(-me)]];
  resultTitleEl.textContent = win ? '승리!' : '패배';
  resultTitleEl.className = win ? 'result-win' : 'result-lose';
  resultScoreEl.textContent = `${nameEls.me.textContent} ${a} : ${b} ${nameEls.robot.textContent}`
    + (msg.by === 'forfeit' ? (win ? ' · 상대 연결 끊김(기권)' : ' · 기권') : '');
  resultEl.hidden = false;
  netMsgEl.hidden = true;
  leaveBtn.hidden = true;
}

// ── 판정 표시 ──
function showShot(e) {
  const s = e.shot;
  if (!s) return;
  const label = `${SHOT_LABELS[s.shotType] ?? s.shotType}${s.quality?.weak ? ' (약)' : ''}`;
  if (e.side === me) {
    shotEl.textContent = `${label} · ${s.quality.timing}`;
    shotEl.className = `shot-${s.quality.timing.toLowerCase()}`;
    const q = s.quality;
    const dt = Number.isFinite(q.dtApex) ? `${q.dtApex >= 0 ? '+' : ''}${Math.round(q.dtApex * 1000)} ms` : '정점 없음';
    // 회전 누적(7단계): 같은 회전으로 받아쳐 더해진 몫과 상한
    const st = q.stack && q.stack.add > 0.5 ? ` · 회전 ${Math.round(q.stack.base)}+${Math.round(q.stack.add)}${q.stack.capped ? ' MAX' : ''} rps` : '';
    const note = q.smashSlow ? ` · 스매시는 ${q.smashSpeed} m/s 이상으로 (느려서 일반)` : q.smashNoServe ? ' · 서브는 스매시 불가 (일반 서브)' : '';
    shotSubEl.textContent = `스윙 ${q.dragSpeed.toFixed(2)} m/s · 세기 ${q.strength.toFixed(2)} · 정점 대비 ${dt} · 공 ${e.speed.toFixed(1)} m/s${st}${note}`;
  } else {
    const who = online() ? nameEls.robot.textContent : '로봇';
    robotShotEl.textContent = `${who}: ${label}${s.quality?.timing ? ` · ${s.quality.timing}` : ''}`;
  }
  if (s.quality) debug.onShot?.(e);
}

// ── 득점 사유·점수판·결과 화면 ──
// 대전: 내 화면의 판정은 잠정(회색 "?"), 서버 판정이 오면 확정(소리·연출) 또는 정정(노란색)
function resultText(r) {
  const tag = r.practice ? '(연습 공) ' : r.corrected ? '판정 정정: ' : '';
  if (r.type === 'let') return `${tag}렛 — 다시 서브`;
  if (r.type === 'retoss') return `${tag}토스 다시`;
  const who = r.winner === me ? '득점' : '실점';
  return `${tag}${who} — ${REASON_LABELS[r.reason] ?? r.reason}`;
}

function showResult(r) {
  r.shown = true;
  const tentative = online() && r.tentative && !r.confirmed && !r.overruled;
  if (r.overruled) return; // 서버가 다르게 판정한 잠정 결과는 정정 결과가 대신 보여 준다
  centerEl.textContent = tentative ? `${resultText(r)} ?` : resultText(r);
  centerEl.className = tentative ? 'center-tentative' : r.corrected ? 'center-corrected'
    : r.type !== 'point' ? 'center-neutral' : r.winner === me ? 'center-win' : 'center-lose';
  messageUntil = simT() + PRACTICE.POINT_DELAY;
  if (!tentative) finalizeResult(r);
}

// 확정된 결과: 소리(득점·함성·경기 끝), 슬로모션, 연습 결과 화면
function finalizeResult(r) {
  if (r.finalized) return;
  r.finalized = true;
  if (online() && r.shown && !r.corrected) {
    centerEl.textContent = resultText(r);
    centerEl.className = r.type !== 'point' ? 'center-neutral' : r.winner === me ? 'center-win' : 'center-lose';
  }
  if (r.type === 'point') {
    if (r.matchOver && !r.practice) audio.playGameEnd(r.winner === me);
    else audio.playPoint(r.winner === me);
    audio.cheer(r.rally);
  }
  fx.onResult(r);
  if (r.matchOver && !r.practice && !online()) {
    const [mine, rb] = r.score;
    resultTitleEl.textContent = r.winner === -1 ? '승리!' : '패배';
    resultTitleEl.className = r.winner === -1 ? 'result-win' : 'result-lose';
    resultScoreEl.textContent = `나 ${mine} : ${rb} 로봇 · 마지막 점수: ${REASON_LABELS[r.reason] ?? r.reason}`;
    resultEl.hidden = false;
  }
}

function boardState() {
  return online() ? client.serverRules : scoreState(game);
}

function updateScoreboard() {
  const st = boardState();
  scoreEls.me.textContent = st.score[idx(me)];
  scoreEls.robot.textContent = st.score[idx(-me)];
  const over = st.phase === 'gameOver';
  serveEls.me.style.visibility = !over && st.server === me ? 'visible' : 'hidden';
  serveEls.robot.style.visibility = !over && st.server === -me ? 'visible' : 'hidden';
  const deuce = Math.min(...st.score) >= RULES.DEUCE_AT;
  const who = st.server === me ? '나' : nameEls.robot.textContent;
  serveInfoEl.textContent = over ? '게임 끝'
    : deuce ? `듀스 · ${who} 서브 (1점마다 교대)`
      : `${who} 서브 ${st.serveCount + 1}/${RULES.SERVE_TURN}`;
}

// ── 고정 스텝 (연습) ──
function fixedStep() {
  const dt = PHYSICS.DT;
  if (!history.length) history.push(clock, game.ball);
  for (const e of stepMatch(game, dt)) {
    queue.push({ t: e.t, event: structuredClone(e) }); // 연출에는 복사본만 넘긴다
    debug.onEvents([e]);
  }
  if (game.free && clock - freeStart > DEMO.RESET_AFTER) endFree(game, clock);
  clock += dt;
  game.ball.t = clock;
  history.push(clock, game.ball);
}

// 새 득점 결과를 대기열에 (매치포인트 여부 표시: 슬로모션)
function queueResults() {
  if (shownResults > game.results.length) shownResults = game.results.length;
  const mp = matchPointSide(boardState());
  while (shownResults < game.results.length) {
    const r = game.results[shownResults++];
    r.matchPoint = mp !== 0;
    queue.push({ t: r.t, result: r });
  }
}

// 화면 시각에 도달한 이벤트·득점 결과: 소리, 흔들림·히트스톱, 팝업, 판정 글자
function dispatch(item) {
  if (item.result) { showResult(item.result); return; }
  const e = item.event;
  audio.playImpact(e.type, e.speed, e.shot?.shotType);
  if (mobile) vibrate(vibrationMs(e, me));
  const r = fx.onEvent(e, me);
  if (r.popups.length) popups.show(r.popups, view.worldToScreen(e.pos));
  if (e.type === 'racket') showShot(e);
}

// ── 서브 가이드라인: 라켓 x를 SERVE_GUIDE.QUANT_X 간격으로 반올림해 계산 결과를 재사용한다 ──
const guideCache = new Map();
let guideSig = '';
function guideFor(x) {
  // 지금 누른 구질 버튼의 서브 (스매시는 일반 서브). 기본 모드는 버튼 없이 위로 휘두른 드라이브 서브
  const btn = control !== 'advanced' || shotKeys.current === 'smash' ? null : shotKeys.current;
  const sig = JSON.stringify(TUNABLE) + me + btn + control; // 디버그 패널에서 값이 바뀌거나 자리·버튼·조작 모드가 바뀌면 다시 계산
  if (sig !== guideSig) { guideCache.clear(); guideSig = sig; }
  const cx = Math.min(SERVE.TOSS_X_MAX, Math.max(-SERVE.TOSS_X_MAX, x));
  const q = Math.round(cx / SERVE_GUIDE.QUANT_X) * SERVE_GUIDE.QUANT_X;
  const key = q.toFixed(3);
  if (!guideCache.has(key)) guideCache.set(key, serveGuide(me, q, TUNABLE, btn, control));
  return guideCache.get(key);
}

// ── 회전 표지 (7단계): 내가 받을 공의 판정용 회전 종류·세기를 예측 정점 고리 위에 ──
const spinBadgeEl = $('spin-badge');
const SPIN_BADGE = { top: ['↻ 탑', 'c-drive'], back: ['↺ 백', 'c-cut'], side: ['⟲ 횡', 'c-side'] };
let badgeText = '';
function updateSpinBadge(pos, t) {
  const w = pos && game.inSpin ? carriedSpin(game.inSpin, t) : null;
  const r = w ? spinRead(game.ball.vel, w) : null;
  if (!r || r.kind === 'none') { spinBadgeEl.hidden = true; return; }
  const [label, cls] = SPIN_BADGE[r.kind];
  const text = `${label} ${'▮'.repeat(r.level)}${'▯'.repeat(FEEL.SPIN_LEVELS - r.level)}${debugEnabled ? ` ${Math.round(r.rps)}` : ''}`;
  if (text !== badgeText) { badgeText = text; spinBadgeEl.textContent = text; spinBadgeEl.className = cls; }
  const sp = view.worldToScreen({ x: pos.x, y: pos.y, z: pos.z + TUNABLE.HIT_RADIUS + 0.04 });
  spinBadgeEl.style.left = `${sp.x}px`;
  spinBadgeEl.style.top = `${sp.y}px`;
  spinBadgeEl.hidden = false;
}

// ── 그리기 ──
function racketNormal(player, t, side) {
  const d = analyzeDrag(player.samples, t, TUNABLE, player.dragScale ?? 1);
  const tilt = d.speed > TUNABLE.BLOCK_SPEED ? -d.sin * RENDER.FACE_TILT : 0;
  return toWorld(faceNormal(tilt, 0), side);
}

// 대전 화면 안내: 핑, 상대 끊김 대기, 내 연결 끊김
function onlineHud(ms) {
  const p = client.ping;
  // 핑(왕복) · 상대 공 지연(상대 타격을 실제로 늦게 알게 되는 시간의 예상값)
  // 접속 지점(내가 붙은 Cloudflare 데이터센터) → 방 서버 위치: 핑이 높을 때 경로가 멀리 돌아가는지 확인용
  const route = myColo || client.serverColo ? ` · 경로 ${myColo ?? '?'} → 서버 ${client.serverColo ?? '?'}` : '';
  pingEl.textContent = (p === null ? '핑 —' : `핑 ${Math.round(p)} ms · 상대 공 지연 ${Math.round(ballLag.expected * 1000)} ms`) + route;
  pingEl.className = p === null ? '' : p < ONLINE.PING_GOOD ? 'good' : p < ONLINE.PING_OK ? 'ok' : 'bad';
  debug.setPing(p);
  let msg = '';
  if (client.status === 'playing' && !client.connected) msg = '연결이 끊겼습니다 — 다시 연결하는 중…';
  else if (client.oppAway !== null && client.status === 'playing') {
    msg = `상대 연결이 끊겼습니다 — 기다리는 중 (${Math.max(0, Math.ceil((client.oppAway - ms) / 1000))}초)`;
  }
  netMsgEl.textContent = msg;
  netMsgEl.hidden = !msg;
  if (client.status === 'error') showNetError(client.errorCode);
}

// ── 시점 (6단계) ──
// 새 시점(TUNABLE CAM_*, 왼쪽 위) / 기존 시점(Space 키). 내 자리(me)에 맞게 돌리고, 바뀌었을 때만 카메라를 다시 놓는다.
// 시점에 따라 마우스 1 px가 라켓 평면에서 움직이는 거리가 달라지므로, 내 드래그 속도를 기존 시점 기준으로 맞춘다(dragScale).
// 모바일(6단계): 시점은 mobileCamera(시야각·바라보는 높이만 다름), 터치로 치면 화면 높이로 CSS px 기준에 맞추는 배율(touchSpeedScale)을 더 곱한다.
let classicView = false;
let camKey = '';
let dragScale = 1;
function updateCamera() {
  // 시점 거리(CAM_DIST, 7단계 수정)는 판정 보정(dragScaleFor)보다 먼저 적용해 멀리서 봐도 같은 손놀림 = 같은 스윙
  const base = zoomCamera(classicView ? RENDER.CAMERA_CLASSIC : mobile ? mobileCamera() : tunableCamera(), TUNABLE.CAM_DIST);
  const cam = cameraFor(base, me);
  const key = JSON.stringify([cam, view.aspect()]);
  if (key !== camKey) {
    camKey = key;
    view.setCamera(cam);
    const k = dragScaleFor(base, view.aspect());
    dragScale = Number.isFinite(k) && k > 0 ? k : 1; // 캔버스 크기가 0인 순간 등
  }
  human.dragScale = mouse.touchActive ? dragScale * touchSpeedScale(canvas.clientHeight) : dragScale;
  human.control = control; // 조작 모드 (설정 ⚙)
  // 터치 스매시 기준 (7단계 수정, 기본 모드는 7단계 수정 BASIC_TOUCH_SMASH_SPEED). 마우스는 classifyShot이 모드별 기본값을 쓴다
  human.smashSpeed = !mouse.touchActive ? undefined : control === 'basic' ? TUNABLE.BASIC_TOUCH_SMASH_SPEED : TUNABLE.TOUCH_SMASH_SPEED;
}

let lastTime = null;
function frame(now) {
  const elapsed = lastTime === null ? 0 : (now - lastTime) / 1000;
  lastTime = now;
  let prevView = viewT;
  let ballViewT;

  if (online()) {
    const ms = nowMs();
    client.tick(ms); // 서버 시각까지 물리를 진행 (되감기·내 타격 전송 포함)
    mouse.refresh(simT());
    queueResults();
    const out = fx.advance(elapsed);
    const target = simT();
    viewT = Math.max(prevView, target - out.lag);
    view.setShake(out.shake);
    // 공은 상대 쪽에서 예상 지연만큼 늦게, 내 쪽으로 오며 지연 0으로 (상대 타격이 늦게 와도 멈칫·튐 없음)
    if (client.ping !== null) ballLag.seed(client.ping / 1000);
    const started = client.matchTime(ms) >= 0; // 카운트다운 중에는 경기 시각이 멈춰 있으므로 지연을 키우지 않는다
    ballViewT = viewT - (started ? ballLag.advance(elapsed, courtShare(shownY)) : ballLag.lag);
    onlineHud(ms);
    const t = client.matchTime(ms);
    if (t < 0 && client.status === 'playing') { centerEl.className = 'center-neutral'; centerEl.textContent = `${Math.ceil(-t)}`; messageUntil = 0; }
  } else {
    const budget = frameSteps(acc, elapsed, paused); // 일시정지 중에는 0스텝
    for (let i = 0; i < budget.steps; i++) fixedStep();
    queueResults();
    acc = budget.acc;
    realAtFrame = now / 1000;
    if (!paused) mouse.refresh(clock);
    // 화면 시각: 물리 시각에서 연출 지연(lag)을 뺀다. 히트스톱 중에는 멈추고, 슬로모션 중에는 느리게 흐른다.
    const out = fx.advance(paused ? 0 : elapsed);
    prevView = viewT;
    viewT = Math.max(prevView, clock - PHYSICS.DT + acc - out.lag);
    view.setShake(out.shake);
    ballViewT = viewT;
  }
  // 소리·연출·판정 글자는 보이는 공에 맞춘다 (연습에서는 ballViewT = viewT)
  for (const item of queue.popUntil(ballViewT)) dispatch(item);

  // 공 (기록 사이 보간)
  const ball = game.ball;
  const shown = history.sample(ballViewT) ?? ball;
  shownY = toLocal(shown.pos, me).y;
  ballView.update(shown.pos, shown.vel, shown.spin, viewT - prevView);
  if (TUNABLE.FX_TRAIL >= 0.5) {
    const maxPts = mobile ? Math.max(2, Math.round(FEEL.TRAIL_MAX_POINTS * TUNABLE.MOB_TRAIL_SCALE)) : FEEL.TRAIL_MAX_POINTS;
    // 꼬리 색은 판정용 회전(7단계, 바운드 마찰을 빼고 센 회전)으로: 종류 색, 세기만큼 진하게
    const inSpin = game.inSpin;
    const pts = history.trail(ballViewT, TUNABLE.TRAIL_TIME, maxPts).map((q) => ({
      pos: q.pos, color: trailColor(q.vel, inSpin && q.t >= inSpin.t - 1e-9 ? carriedSpin(inSpin, q.t) : q.spin),
    }));
    if (pts.length) pts.push({ pos: shown.pos, color: pts[pts.length - 1].color });
    trail.update(pts);
  } else trail.update([]);

  // 라켓: 칠 수 있는(내 쪽에 바운드한) 공이 오면 도달 범위 안에서 앞뒤로 따라간다
  const t = simT();
  const rules = game.rules;
  const live = !game.free && (rules.phase === 'serving' || rules.phase === 'rally');
  const follow = (side) => (live && canHit(rules, side) && bouncedOn(rules, side) ? ball : null);
  myRacket.update(racketWorld(human, t, follow(me)), racketNormal(human, t, me));
  const op = opp();
  // 상대 라켓은 상대 쪽 공과 같은 지연으로 그린다 (라켓 위치도 같은 경로로 늦게 오므로 공과 맞아떨어진다)
  const opT = online() ? viewT - ballLag.expected : viewT;
  const rp = racketWorld(op, opT, follow(-me) && shown) ?? toWorld({ x: SWING.HOME.x, y: SWING.HOME_Y, z: SWING.HOME.z }, -me);
  robotRacket.update(rp, racketNormal(op, opT, -me));

  // 내가 칠 공의 예측 정점 (상대가 친 공이 나에게 오는 중) 또는 내 서브 타점
  // 내 서브 (공을 들고 있거나, 토스했지만 아직 치지 않음): 가이드라인과 넓은 서브 도달 범위 고리
  const mine = mode !== 'menu' && !game.free && !game.scenario && !game.practice && rules.server === me;
  const holdingServe = mine && rules.phase === 'waitingServe';
  const tossed = mine && rules.phase === 'serving' && rules.lastHitter === 0;
  let guide = null;
  if (TUNABLE.FX_SERVE_GUIDE >= 0.5 && (holdingServe || tossed)) {
    const last = human.samples[human.samples.length - 1];
    guide = guideFor(tossed ? toLocal(ball.pos, me).x : (last ? last.x : 0));
  }
  guideView.update(guide);
  const waiting = live && canHit(rules, me);
  const smashable = !tossed && !!human.apexPos && human.apexPos.z >= NET.HEIGHT + TUNABLE.SMASH_MIN_HEIGHT;
  const ringPos = waiting ? human.apexPos : holdingServe && guide ? guide.hit : null;
  marker.update(ringPos, tossed || holdingServe ? TUNABLE.SERVE_HIT_RADIUS : TUNABLE.HIT_RADIUS, smashable);
  updateSpinBadge(mode !== 'menu' && waiting && !tossed ? human.apexPos : null, t);
  updateShotButtons();
  if (!settingsEl.hidden && volumeEl !== document.activeElement) syncSettings(); // 키(M·G·Space)로 바꾼 값도 보이게
  if (!introEl.hidden && performance.now() / 1000 > introUntil) hideIntro();

  debug.onFrame(elapsed, ball);
  if (mobile) {
    const r = quality.update(elapsed);
    if (r !== null) view.setPixelRatio(r);
    view.setShadowSize(TUNABLE.MOB_SHADOW_SIZE);
    wakeLock.want(mode !== 'menu' && !paused);
    applyAudioSession();
  }
  updateCamera();
  view.render();

  // 관중 함성(랠리 수가 바뀔 때만 반영해 득점 함성을 덮지 않는다), 매치포인트 심장 박동
  const crowdNow = live && !game.practice ? rules.rally : 0;
  if (crowdNow !== crowdRally) { audio.setCrowd(crowdNow); crowdRally = crowdNow; }
  const board = boardState();
  audio.setHeartbeat(live || rules.phase === 'waitingServe' ? matchPointSide(board) !== 0 && !game.practice : false);
  audio.tick();

  updateScoreboard();
  if (t >= messageUntil && !(online() && client.matchTime(nowMs()) < 0)) {
    centerEl.className = '';
    const waitServe = rules.phase === 'waitingServe' && !game.free && !game.scenario;
    const oppName = online() ? nameEls.robot.textContent : '로봇';
    centerEl.textContent = mode === 'menu' ? ''
      : tossed ? '공이 고리까지 내려올 때 휘두르기!'
        : !waitServe ? ''
          : rules.server === me ? SERVE_HINT[control]
            : `${oppName} 서브`;
  }
  statusEl.textContent = mobile
    ? (online() ? `대전 · 방 ${client.code}` : `연습 · ${DIFFICULTY_LABELS[difficulty]} (⏸에서 난이도·새 게임)`)
    : online()
    ? `대전 · 방 ${client.code} (${RULES.POINTS_TO_WIN}점) · ${STATUS_SHOT[control]} · Space 시점 · G 서브 가이드 · M 음소거`
    : `연습 경기 (${RULES.POINTS_TO_WIN}점) · ${DIFFICULTY_LABELS[difficulty]} · ${STATUS_SHOT[control]} · `
      + `1/2/3 난이도 · N 새 게임 · P 일시정지(조작표) · Space 시점${debugEnabled ? '' : ' · ?debug=1 패널'}`;
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);

// 디버그 모드에서만: 콘솔·자동 점검용으로 상태를 노출한다
if (debugEnabled) {
  window.pingpong = {
    get game() { return game; }, get robot() { return robot; }, get human() { return human; },
    get clock() { return simT(); }, get client() { return client; }, get mode() { return mode; },
    toScreen: view.worldToScreen,
  };
}
