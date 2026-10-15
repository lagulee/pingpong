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
import { createBall, makeLaunch, faceNormal, toWorld, toLocal } from '../shared/physics.js';
import {
  PHYSICS, PRACTICE, SWING, RENDER, TUNABLE, TUNABLE_DEFAULTS, TUNABLE_TOGGLES, NET, VERSION, SHOT_LABELS,
  DIFFICULTIES, DIFFICULTY_LABELS, DEMO, REASON_LABELS, RULES, SERVE, SERVE_GUIDE, PAUSE, ONLINE, ONLINE_ERRORS,
  REJECT_LABELS,
} from '../shared/constants.js';
import { canHit, bouncedOn, matchPointSide, idx } from '../shared/rules.js';
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
import { createOnlineClient, createBallLag, courtShare } from './net.js';

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
const popups = createPopupLayer($('popups'));
const ballLag = createBallLag();      // 대전: 공만 늦게 보여 주는 시간 (상대 쪽에서는 예상 지연만큼, 내 쪽에서는 0)
let shownY = 0;                       // 지난 프레임에 보여 준 공의 내 기준 y (화면 지연 계산용)
let viewT = 0;                        // 화면이 보여 주는 시각
let crowdRally = null;                // 관중 함성에 마지막으로 반영한 랠리 수
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// 음소거 버튼·음량 슬라이더 (이 브라우저에 기억)
const muteBtn = $('mute');
const volumeEl = $('volume');
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
pauseEl.addEventListener('click', () => setPaused(false));
document.addEventListener('visibilitychange', () => { if (document.hidden && PAUSE.AUTO_ON_HIDE && mode === 'practice') setPaused(true); });
for (const el of [muteBtn, volumeEl, pauseBtn, leaveBtn]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
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
  view.setSide(-1);
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
  me: () => me,
});
function setArrows(v) {
  ballView.setArrowsVisible(v);
  debug.syncArrows?.(v);
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return; // 닉네임·코드 입력 중
  if (e.code === 'KeyV') setArrows(!ballView.arrowsVisible);
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyG') TUNABLE.FX_SERVE_GUIDE = TUNABLE.FX_SERVE_GUIDE >= 0.5 ? 0 : 1;
  if (online() || mode === 'menu') return; // 아래는 연습 전용
  const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
  if (i >= 0) setDifficulty(DIFFICULTIES[i]);
  if (e.code === 'KeyR') newGame();
  if (e.code === 'KeyP' || e.code === 'Escape') setPaused(!paused);
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
(roomParam ? (nickEl.value ? codeEl : nickEl) : nickEl).focus();
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
function startOnline(code, create) {
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
  for (const [k, v] of Object.entries(TUNABLE_DEFAULTS)) if (!TUNABLE_TOGGLES.includes(k)) TUNABLE[k] = v;
  debug.setLocked(true);
  view.setSide(me);
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
    const dt = Number.isFinite(s.quality.dtApex) ? `${s.quality.dtApex >= 0 ? '+' : ''}${Math.round(s.quality.dtApex * 1000)} ms` : '정점 없음';
    const dir = s.quality.dragSin <= -TUNABLE.DIR_SIN ? '↓' : s.quality.dragSin >= TUNABLE.DIR_SIN ? '↑' : '↔';
    shotSubEl.textContent = `스윙 ${dir} ${s.quality.dragSpeed.toFixed(2)} m/s (스매시 ↓${TUNABLE.SMASH_SPEED}) · 세기 ${s.quality.strength.toFixed(2)} · 정점 대비 ${dt} · 공 ${e.speed.toFixed(1)} m/s`;
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
  const r = fx.onEvent(e, me);
  if (r.popups.length) popups.show(r.popups, view.worldToScreen(e.pos));
  if (e.type === 'racket') showShot(e);
}

// ── 서브 가이드라인: 라켓 x를 SERVE_GUIDE.QUANT_X 간격으로 반올림해 계산 결과를 재사용한다 ──
const guideCache = new Map();
let guideSig = '';
function guideFor(x) {
  const sig = JSON.stringify(TUNABLE) + me; // 디버그 패널에서 값이 바뀌거나 자리가 바뀌면 다시 계산
  if (sig !== guideSig) { guideCache.clear(); guideSig = sig; }
  const cx = Math.min(SERVE.TOSS_X_MAX, Math.max(-SERVE.TOSS_X_MAX, x));
  const q = Math.round(cx / SERVE_GUIDE.QUANT_X) * SERVE_GUIDE.QUANT_X;
  const key = q.toFixed(3);
  if (!guideCache.has(key)) guideCache.set(key, serveGuide(me, q));
  return guideCache.get(key);
}

// ── 그리기 ──
function racketNormal(player, t, side) {
  const d = analyzeDrag(player.samples, t);
  const tilt = d.speed > TUNABLE.BLOCK_SPEED ? -d.sin * RENDER.FACE_TILT : 0;
  return toWorld(faceNormal(tilt, 0), side);
}

// 대전 화면 안내: 핑, 상대 끊김 대기, 내 연결 끊김
function onlineHud(ms) {
  const p = client.ping;
  // 핑(왕복) · 상대 공 지연(상대 타격을 실제로 늦게 알게 되는 시간의 예상값)
  pingEl.textContent = p === null ? '핑 —' : `핑 ${Math.round(p)} ms · 상대 공 지연 ${Math.round(ballLag.expected * 1000)} ms`;
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
    const pts = history.trail(ballViewT, TUNABLE.TRAIL_TIME).map((q) => ({ pos: q.pos, color: TRAIL_COLORS[spinKind(q.vel, q.spin)] }));
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

  debug.onFrame(elapsed, ball);
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
          : rules.server === me ? '내 서브\n① 클릭: 공 띄우기  ② 공이 고리에 올 때 휘두르기\n↑ 드라이브 · ↓ 커트 · 곡선 = 사이드'
            : `${oppName} 서브`;
  }
  statusEl.textContent = online()
    ? `대전 · 방 ${client.code} (${RULES.POINTS_TO_WIN}점) · G 서브 가이드 · V 화살표 · M 음소거`
    : `연습 경기 (${RULES.POINTS_TO_WIN}점) · ${DIFFICULTY_LABELS[difficulty]} · `
      + `1/2/3 난이도(새 게임) · R 새 게임 · P 일시정지 · G 서브 가이드 · V 화살표${debugEnabled ? '' : ' · ?debug=1 패널'}`;
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
