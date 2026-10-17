// debug.js — 디버그 패널(?debug=1).
// TUNABLE 슬라이더(묶음별, 즉시 반영), "현재 값 복사", 공 발사기, 규칙 시험 공, 화살표 표시, FPS, 최근 구질 판정·물리 이벤트.
// 순수 함수(changedTunables, launchParams, tunableLabel)는 DOM 없이 테스트할 수 있도록 분리한다.
import {
  TUNABLE, TUNABLE_DEFAULTS, TUNABLE_RANGES, TUNABLE_GROUPS, TUNABLE_TOGGLES, TUNABLE_ONLINE_FREE, LAUNCHER, SHOT_LABELS,
} from '../shared/constants.js';

const TUNABLE_LABELS = {
  C_D: '항력계수 C_D',
  K_M: '마그누스 계수 K_M',
  SPIN_DECAY: '회전 감쇠 (1/s)',
  E_TABLE: '테이블 반발계수',
  MU_TABLE: '테이블 마찰계수',
  E_RACKET: '라켓 반발계수',
  MU_RACKET: '라켓 마찰계수',
  E_FLOOR: '바닥 반발계수',
  NET_KEEP: '네트 걸림 시 남는 속도',
  NET_CORD_KEEP: '네트 인 시 남는 속도',
  SWING_WINDOW: '드래그 방향 측정 창 (s)',
  PEAK_DT: '최고 속도 측정 구간 (s)',
  CURVE_WINDOW: '곡률 측정 창 (s)',
  BLOCK_SPEED: '블록 판정 속도 미만 (m/s)',
  SPEED_FULL: '세기 1이 되는 최고 속도 (m/s)',
  SMASH_SPEED: '스매시 버튼: 스윙 최고 속도 이상 (m/s)',
  BASIC_SMASH_SPEED: '기본 모드 · 스매시 기준 아래 스윙 속도 (m/s)',
  DIR_SIN: '기본 모드 · 아래쪽 드래그 기준 sinθ',
  CURVE_MIN: '기본 모드 · 사이드스핀 곡률 기준',
  SMASH_MIN_HEIGHT: '스매시 가능 높이: 네트 위 (m)',
  SMASH_RING_FLOOR: '빨간 고리일 때 스매시 최저 타점: 네트 위 (m)',
  BUTTON_WINDOW: '구질 버튼 인정 시간 (접촉 전, s)',
  SPIN_CARRY: '판정용 회전 비율 (상대가 친 회전 × 감쇠 × 이 값)',
  HIT_RADIUS: '라켓 도달 반경 좌우·높이 (m)',
  SERVE_HIT_RADIUS: '서브 · 라켓 도달 반경 (m)',
  REACH_Y: '라켓 도달 범위 앞뒤 (m)',
  PERFECT_WINDOW: 'PERFECT 범위 ± (s)',
  GOOD_WINDOW: 'GOOD 범위 ± (s)',
  OK_WINDOW: 'OK 범위 ± (s)',
  ACC_PERFECT: 'PERFECT 정확도',
  ACC_GOOD: 'GOOD 정확도',
  ACC_OK: 'OK 정확도',
  ACC_BAD: 'BAD 정확도',
  ERR_YAW: '좌우 방향 최대 오차 (°)',
  ERR_BIAS: '이름/늦음 치우침 (°)',
  ERR_PITCH: '위아래 최대 오차 (°)',
  ERR_SPEED: '속도 최대 오차 비율',
  AIM_X_POS: '목표 x: 라켓 위치 비율',
  AIM_X_DRAG: '목표 x: 드래그 좌우 비율',
  AIM_X_MAX: '목표 x 한계 (m)',
  NET_CLEAR: '네트 위 최소 여유 (m)',
  BLOCK_PUSH: '블록 미는 속도 (m/s)',
  WEAK_PITCH: '약한 블록 면 각도 (°)',
  MISHIT_SPEED: '실타 속도 (m/s)',
  MISHIT_AIM_Z: '실타 네트 높이 (m)',
  SERVE_V_MIN: '서브 · 속도 최소 (m/s)',
  SERVE_V_MAX: '서브 · 속도 최대 (m/s)',
  SERVE_DEPTH: '서브 · 목표 깊이 (m)',
  SERVE_SPIN_SCALE: '서브 · 회전 비율 (구질 회전 × 이 값)',
  SERVE_ASSIST_V: '서브 · 속도 보조 상한 (m/s)',
  SERVE_ERR_SCALE: '서브 · 방향·속도 오차 배율',
  // 연출 (4단계)
  FX_HITSTOP: '히트스톱 (스매시 순간 정지)',
  HITSTOP_FRAMES: '히트스톱 프레임 수 (60 fps 기준)',
  FX_SHAKE: '화면 흔들림',
  SHAKE_GAIN: '흔들림 진폭 / 타격 속도 (m per m/s)',
  SHAKE_MAX: '흔들림 최대 진폭 (m)',
  SHAKE_DECAY: '흔들림 감쇠 시간 (s)',
  FX_TRAIL: '구질 색 꼬리 (탑 빨강·백 파랑·횡 보라)',
  TRAIL_TIME: '꼬리 길이 (s)',
  TRAIL_SPIN_MIN: '꼬리 색을 입히는 최소 회전 (rps)',
  FX_POPUP: 'PERFECT / SMASH! / EDGE! 팝업',
  POPUP_TIME: '팝업 표시 시간 (s)',
  FX_SLOWMO: '매치포인트 슬로모션',
  SLOWMO_RATE: '슬로모션 재생 배율',
  SLOWMO_TIME: '슬로모션 길이 (s)',
  CATCHUP_RATE: '밀린 화면 따라잡기 배율',
  SND_PITCH: '소리 · 전체 음높이 배율',
  SND_DECAY: '소리 · 전체 감쇠 시간 배율',
  SND_SPEED_REF: '소리 · 세기 기준 속도 (m/s)',
  SND_PITCH_RACKET: '소리 · 라켓 음높이',
  SND_PITCH_TABLE: '소리 · 테이블 음높이',
  SND_PITCH_NET: '소리 · 네트 음높이',
  SND_PITCH_EDGE: '소리 · 모서리 음높이',
  SND_PITCH_FLOOR: '소리 · 바닥 음높이',
  SND_CROWD: '관중 함성',
  CROWD_GAIN: '관중 최대 음량',
  CROWD_RALLY_FULL: '함성이 커지는 랠리 수 기준',
  SND_HEART: '매치포인트 심장 박동',
  HEART_BPM: '심장 박동 빠르기 (BPM)',
  HEART_GAIN: '심장 박동 음량',
  SND_JINGLE: '득점·게임 종료 효과음',
  FX_SERVE_GUIDE: '내 서브 가이드라인 (점선 궤적·바운드 지점)',
  FX_VIBRATE: '모바일 · 진동 (타격·내 코트 바운드)',
  SND_SILENT_SWITCH: '모바일 · iOS 무음 스위치에서도 소리',
  FX_AUTO_QUALITY: '모바일 · 자동 품질 (프레임이 떨어지면 해상도↓)',
  TOUCH_OFFSET_PX: '터치 · 라켓을 손가락 위로 띄우는 거리 (px)',
  TOUCH_SPEED_GAIN: '터치 · 스윙 감도 배율',
  TOUCH_LIFT_HOLD: '터치 · 뗀 뒤 누름 유지 (s)',
  TOUCH_SMASH_SPEED: '터치 · 스매시 기준 스윙 속도 (m/s)',
  BASIC_TOUCH_SMASH_SPEED: '터치 · 기본 모드 스매시 기준 속도 (m/s)',
  MOB_CAM_FOV: '모바일 · 카메라 시야각 (°, 세로)',
  MOB_CAM_TZ: '모바일 · 카메라 바라보는 점 높이 (m)',
  MOB_PIXEL_RATIO: '모바일 · 픽셀 비율 상한',
  MOB_SHADOW_SIZE: '모바일 · 그림자 해상도',
  MOB_TRAIL_SCALE: '모바일 · 꼬리 점 개수 배율',
  MOB_FPS_MIN: '모바일 · 자동 품질 기준 FPS',
  VIB_HIT_MIN: '진동 · 약한 타격 (ms)',
  VIB_HIT_MAX: '진동 · 센 타격 (ms)',
  VIB_BOUNCE: '진동 · 내 코트 바운드 (ms)',
  MOB_BTN_SIZE: '모바일 · 구질 버튼 크기 (px)',
  COMBO_MIX: '조합 구질(사이드 커트·드라이브) 회전 비율',
  SMASH_ASSIST_V: '스매시 · 속도 보조 하한 (m/s)',
  MOB_BTN_LEFT: '모바일 · 구질 버튼 왼쪽(1) / 오른쪽(0)',
  G_GAME: '게임 중력 (m/s², 실제 9.8)',
  CAM_X: '카메라 위치 x (m, − 왼쪽)', CAM_Y: '카메라 위치 y (m, 내 엔드 뒤 −)', CAM_Z: '카메라 높이 (m)',
  CAM_TX: '카메라 바라보는 점 x (m)', CAM_TY: '카메라 바라보는 점 y (m)', CAM_TZ: '카메라 바라보는 점 높이 (m)',
  CAM_FOV: '카메라 시야각 (°, 세로)',
};

// 구질·AI 키는 규칙적으로 이름을 붙인다
const SHOT_NAMES = { NORMAL: '일반', DRIVE: '드라이브', SMASH: '스매시', CUT: '커트', SIDE: '사이드', BLOCK: '블록' };
const SHOT_KEYS = {
  V_MIN: '속도 최소 (m/s)', V_MAX: '속도 최대 (m/s)', SPIN_MIN: '회전 최소 (rps)', SPIN_MAX: '회전 최대 (rps)',
  TOP_MIN: '탑스핀 최소 (rps)', TOP_MAX: '탑스핀 최대 (rps)', DEPTH: '목표 깊이 (m)', PITCH: '면 각도 (°)',
  LAMBDA_TOP: '탑스핀 공 회전 영향', LAMBDA_BACK: '백스핀 공 회전 영향', LAMBDA_SIDE: '횡회전 공 회전 영향',
  SPIN_CAP: '회전 누적 상한 (rps)', STACK: '회전 누적 계수 (들어온 같은 회전 × 이 값)',
  APEX_WEAK: '목표 정점 · 약하게 (m)', APEX_STRONG: '목표 정점 · 세게 (m)',
};
const DIFF_NAMES = { EASY: '쉬움', NORMAL: '보통', HARD: '어려움' };
const AI_KEYS = {
  DELAY: '반응 지연 (s)', MOVE: '이동 속도 (m/s)', TIMING: '타이밍 오차 ± (s)', S_MIN: '세기 최소', S_MAX: '세기 최대',
  AIM_X: '목표 x 범위 ± (m)', JITTER: '샘플 떨림 (m)',
  W_DRIVE: '드라이브 비율', W_BLOCK: '블록 비율', W_CUT: '커트 비율', W_SIDE: '사이드 비율', W_SMASH: '스매시 비율',
  W_NORMAL: '일반 스윙 비율', READ: '회전 읽기 (1 = 항상 맞게)',
};
export function tunableLabel(k) {
  if (TUNABLE_LABELS[k]) return TUNABLE_LABELS[k];
  let m = k.match(/^AI_(EASY|NORMAL|HARD)_(.+)$/);
  if (m && AI_KEYS[m[2]]) return `${DIFF_NAMES[m[1]]} · ${AI_KEYS[m[2]]}`;
  m = k.match(/^(NORMAL|DRIVE|SMASH|CUT|SIDE|BLOCK)_(.+)$/);
  if (m && SHOT_KEYS[m[2]]) return `${SHOT_NAMES[m[1]]} · ${SHOT_KEYS[m[2]]}`;
  return k;
}

const LAUNCHER_LABELS = {
  speed: '속도 (m/s)',
  elevation: '발사각 (°, 위 +)',
  azimuth: '방향각 (°, 오른쪽 +)',
  topspin: '탑(+)/백(−) 스핀 (rps)',
  sidespin: '횡회전 (rps, + 왼쪽으로 휨)',
  height: '발사 높이 (m)',
  x: '좌우 위치 (m)',
};

const PRESET_LABELS = {
  none: '무회전', topspin: '탑스핀', backspin: '백스핀', sideLeft: '횡회전 ←', sideRight: '횡회전 →',
};

export const EVENT_LABELS = {
  bounce: '바운드', edge: '모서리', net: '네트', racket: '라켓', floor: '바닥',
};

// 규칙 시험 버튼 (ai.js SCENARIOS)
export const SCENARIO_LABELS = { let: '렛 서브', twoBounce: '투 바운드', volley: '코트 밖 긴 공' };

// 기본값과 다른 튜닝 값만 골라낸다 ("현재 값 복사"용)
export function changedTunables(current = TUNABLE, defaults = TUNABLE_DEFAULTS) {
  const out = {};
  for (const k of Object.keys(defaults)) if (current[k] !== defaults[k]) out[k] = current[k];
  return out;
}

// 발사기 입력값 → physics.makeLaunch 인자
export function launchParams(cfg) {
  return {
    pos: { x: cfg.x, y: LAUNCHER.START_Y, z: cfg.height },
    speed: cfg.speed,
    elevation: cfg.elevation,
    azimuth: cfg.azimuth,
    topspin: cfg.topspin,
    sidespin: cfg.sidespin,
  };
}

const decimals = (step) => (String(step).split('.')[1] ?? '').length;

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  for (const c of children) e.append(c);
  return e;
}

// 슬라이더 한 줄: 이름, 값 표시, range 입력
function slider(label, range, value, onInput) {
  const out = el('span', { className: 'dbg-val', textContent: Number(value).toFixed(decimals(range.step)) });
  const input = el('input', { type: 'range', min: range.min, max: range.max, step: range.step, value });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(decimals(range.step));
    onInput(v);
  });
  const row = el('label', { className: 'dbg-row' }, el('span', { className: 'dbg-name', textContent: label }), out, input);
  return {
    row,
    set(v) { input.value = v; out.textContent = Number(v).toFixed(decimals(range.step)); onInput(Number(v)); },
  };
}

// 켜기/끄기 한 줄 (값 1 = 켬, 0 = 끔). slider와 같은 { row, set } 모양
function toggle(label, value, onInput) {
  const box = el('input', { type: 'checkbox', checked: value >= 0.5 });
  box.addEventListener('change', () => onInput(box.checked ? 1 : 0));
  const row = el('label', { className: 'dbg-toggle' }, box, label);
  return {
    row,
    set(v) { box.checked = v >= 0.5; onInput(v >= 0.5 ? 1 : 0); },
  };
}

// 패널을 만든다. enabled가 아니면 아무것도 하지 않는 객체를 돌려준다.
// hooks: { onLaunch(cfg), onDrop(), onScenario(kind), onArrows(bool), arrowsVisible, collapsed(처음 접힘, 모바일), quality() → 표시 글자 }
export function initDebug(enabled, hooks) {
  const noop = { onEvents() {}, onFrame() {}, setLocked() {}, setPing() {}, launcherConfig: { ...LAUNCHER.DEFAULTS } };
  if (!enabled) return noop;

  const panel = el('div', { id: 'debug' });
  document.body.append(panel);
  // 접기/펼치기 (6단계 모바일: 휴대폰에서는 패널이 화면을 많이 가리므로 접은 채로 시작한다)
  const foldBtn = el('button', { type: 'button' });
  const setFolded = (v) => {
    panel.classList.toggle('collapsed', v);
    foldBtn.textContent = v ? '🛠 디버그' : '🛠 접기';
  };
  foldBtn.addEventListener('click', () => { setFolded(!panel.classList.contains('collapsed')); foldBtn.blur(); });
  panel.append(el('div', { className: 'dbg-head' }, foldBtn));
  setFolded(!!hooks.collapsed);
  const lockNote = el('div', { className: 'dbg-lock', hidden: true, textContent: '대전 중: 서버와 같은 기본값으로 고정 (연출 켜기/끄기·카메라·모바일 값만 바꿀 수 있음)' });
  const pingEl = el('div', { className: 'dbg-info' });
  panel.append(lockNote, pingEl);

  // ── 최근 판정 ──
  panel.append(el('h3', { textContent: '최근 구질 판정' }));
  const shotLog = el('div', { className: 'dbg-log', textContent: '(아직 없음)' });
  panel.append(shotLog);

  // ── 튜닝 값 (묶음별로 접기) ──
  panel.append(el('h3', { textContent: '튜닝 값 (TUNABLE)' }));
  const tunableSliders = {};
  const lockables = []; // 대전 중 잠그는 입력 (물리·판정 값, 발사기, 규칙 시험)
  for (const [group, keys] of Object.entries(TUNABLE_GROUPS)) {
    const box = el('details', { className: 'dbg-group', open: group === '물리' || group === '연출' || group === '카메라' || group === '모바일' }, el('summary', { textContent: `${group} (${keys.length})` }));
    for (const k of keys) {
      const set = (v) => { TUNABLE[k] = v; };
      const s = TUNABLE_TOGGLES.includes(k) ? toggle(tunableLabel(k), TUNABLE[k], set) : slider(tunableLabel(k), TUNABLE_RANGES[k], TUNABLE[k], set);
      tunableSliders[k] = s;
      box.append(s.row);
      if (!TUNABLE_ONLINE_FREE.includes(k)) lockables.push(s.row);
    }
    panel.append(box);
  }
  const copyMsg = el('span', { className: 'dbg-msg' });
  const copyBtn = el('button', { textContent: '현재 값 복사' });
  copyBtn.addEventListener('click', async () => {
    const text = JSON.stringify(changedTunables(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      copyMsg.textContent = '복사됨 (바뀐 값만)';
    } catch {
      window.prompt('복사해서 세션에 붙여 넣으세요', text);
    }
  });
  const resetBtn = el('button', { textContent: '기본값' });
  resetBtn.addEventListener('click', () => {
    for (const k of Object.keys(TUNABLE_DEFAULTS)) tunableSliders[k].set(TUNABLE_DEFAULTS[k]);
    copyMsg.textContent = '';
  });
  panel.append(el('div', { className: 'dbg-buttons' }, copyBtn, resetBtn, copyMsg));

  // ── 공 발사기 ──
  panel.append(el('h3', { textContent: '공 발사기' }));
  const cfg = { ...LAUNCHER.DEFAULTS };
  const launcherSliders = {};
  for (const k of Object.keys(LAUNCHER.DEFAULTS)) {
    const s = slider(LAUNCHER_LABELS[k] ?? k, LAUNCHER.RANGES[k], cfg[k], (v) => { cfg[k] = v; });
    launcherSliders[k] = s;
    panel.append(s.row);
  }
  const presets = el('div', { className: 'dbg-buttons' });
  for (const [name, p] of Object.entries(LAUNCHER.PRESETS)) {
    const b = el('button', { textContent: PRESET_LABELS[name] ?? name });
    b.addEventListener('click', () => {
      for (const k of Object.keys(p)) launcherSliders[k].set(p[k]);
      hooks.onLaunch({ ...cfg });
    });
    presets.append(b);
  }
  const fireBtn = el('button', { className: 'dbg-fire', textContent: '발사 (Enter)' });
  fireBtn.addEventListener('click', () => hooks.onLaunch({ ...cfg }));
  const dropBtn = el('button', { textContent: '떨어뜨리기' });
  dropBtn.addEventListener('click', () => hooks.onDrop());
  panel.append(el('div', { className: 'dbg-buttons' }, fireBtn, dropBtn), presets);
  lockables.push(resetBtn, fireBtn, dropBtn, presets);
  for (const r of Object.values(launcherSliders)) lockables.push(r.row);
  let locked = false;
  window.addEventListener('keydown', (e) => {
    if (locked) return;
    if (e.code === 'Enter' && e.target.tagName !== 'BUTTON') hooks.onLaunch({ ...cfg }); // 버튼 포커스 시 중복 발사 방지
  });

  // ── 규칙 시험: 로봇이 렛·투 바운드·발리 상황의 공을 보낸다 (점수에 넣지 않음) ──
  panel.append(el('h3', { textContent: '규칙 시험 (점수 안 바뀜)' }));
  const scen = el('div', { className: 'dbg-buttons' });
  for (const [kind, label] of Object.entries(SCENARIO_LABELS)) {
    const b = el('button', { textContent: label });
    b.addEventListener('click', () => { b.blur(); hooks.onScenario?.(kind); });
    scen.append(b);
  }
  lockables.push(scen);
  panel.append(scen, el('div', {
    className: 'dbg-info',
    textContent: '렛: 그냥 보기 · 투 바운드: 치지 말고 보기 · 발리: 버튼을 누른 채 노란 고리에 라켓을 대기(그냥 두면 아웃)',
  }));

  // ── 표시 ──
  panel.append(el('h3', { textContent: '표시' }));
  const arrowBox = el('input', { type: 'checkbox', checked: hooks.arrowsVisible });
  arrowBox.addEventListener('change', () => hooks.onArrows(arrowBox.checked));
  panel.append(el('label', { className: 'dbg-check' }, arrowBox, ' 속도(초록)·회전(분홍) 화살표 (V)'));
  const fpsEl = el('div', { className: 'dbg-info' });
  const ballEl = el('div', { className: 'dbg-info' });
  const logEl = el('div', { className: 'dbg-log' });
  panel.append(fpsEl, ballEl, el('h3', { textContent: '최근 이벤트' }), logEl);

  let frames = 0, fpsTime = 0, worst = 0;
  const log = [];
  const shots = [];
  const fmt = (n) => n.toFixed(2);

  return {
    launcherConfig: cfg,
    syncArrows(v) { arrowBox.checked = v; },
    // 대전 중에는 물리·판정 값과 발사기·규칙 시험을 잠근다 (서버는 기본값으로 판정)
    setLocked(v) {
      locked = v;
      lockNote.hidden = !v;
      for (const node of lockables) {
        for (const input of node.querySelectorAll ? [node, ...node.querySelectorAll('input, button')] : [node]) {
          if ('disabled' in input) input.disabled = v;
        }
      }
    },
    setPing(ms) { pingEl.textContent = ms === null ? '' : `핑 ${Math.round(ms)} ms`; },
    onShot(e) {
      const q = e.shot.quality;
      const who = e.side === (hooks.me?.() ?? -1) ? '나' : '상대';
      const dt = Number.isFinite(q.dtApex) ? `${Math.round(q.dtApex * 1000)}ms` : '-';
      shots.unshift(`${fmt(e.t)}s ${who} ${SHOT_LABELS[e.shot.shotType]}${q.weak ? '(약)' : ''} ${q.timing} Δt=${dt} 스윙=${fmt(q.dragSpeed)} 세기=${fmt(q.strength)} 공=${fmt(e.speed)}m/s`);
      shots.length = Math.min(shots.length, 6);
      shotLog.textContent = shots.join('\n');
    },
    onEvents(events) {
      for (const e of events) {
        const extra = e.type === 'net' ? (e.over ? ' (넘어감)' : ' (걸림)') : '';
        log.unshift(`${fmt(e.t)}s ${EVENT_LABELS[e.type] ?? e.type}${extra} ${fmt(e.speed)} m/s  y=${fmt(e.pos.y)}`);
      }
      if (events.length) {
        log.length = Math.min(log.length, 8);
        logEl.textContent = log.join('\n');
      }
    },
    onFrame(dt, ball) {
      frames++; fpsTime += dt; worst = Math.max(worst, dt);
      if (fpsTime >= 0.5) {
        const q = hooks.quality?.() ?? '';
        fpsEl.textContent = `FPS ${Math.round(frames / fpsTime)} · 프레임 평균 ${(1000 * fpsTime / frames).toFixed(1)} ms · 최대 ${Math.round(worst * 1000)} ms${q ? ` · ${q}` : ''}`;
        frames = 0; fpsTime = 0; worst = 0;
      }
      const v = ball.vel, w = ball.spin;
      const speed = Math.hypot(v.x, v.y, v.z);
      const rps = Math.hypot(w.x, w.y, w.z) / (2 * Math.PI);
      ballEl.textContent = `속도 ${fmt(speed)} m/s · 회전 ${fmt(rps)} rps · 높이 ${fmt(ball.pos.z)} m`;
    },
  };
}
