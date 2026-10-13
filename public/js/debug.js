// debug.js — 디버그 패널(?debug=1).
// TUNABLE 슬라이더(즉시 반영), "현재 값 복사", 공 발사기, 화살표 표시, FPS, 최근 물리 이벤트.
// 순수 함수(changedTunables, launchParams)는 DOM 없이 테스트할 수 있도록 분리한다.
import { TUNABLE, TUNABLE_DEFAULTS, TUNABLE_RANGES, LAUNCHER } from '../shared/constants.js';

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
};

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

// 패널을 만든다. enabled가 아니면 아무것도 하지 않는 객체를 돌려준다.
// hooks: { onLaunch(cfg), onDrop(), onArrows(bool), arrowsVisible }
export function initDebug(enabled, hooks) {
  const noop = { onEvents() {}, onFrame() {}, launcherConfig: { ...LAUNCHER.DEFAULTS } };
  if (!enabled) return noop;

  const panel = el('div', { id: 'debug' });
  document.body.append(panel);

  // ── 물리 상수 ──
  panel.append(el('h3', { textContent: '물리 상수 (TUNABLE)' }));
  const tunableSliders = {};
  for (const k of Object.keys(TUNABLE_DEFAULTS)) {
    const s = slider(TUNABLE_LABELS[k] ?? k, TUNABLE_RANGES[k], TUNABLE[k], (v) => { TUNABLE[k] = v; });
    tunableSliders[k] = s;
    panel.append(s.row);
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
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && e.target.tagName !== 'BUTTON') hooks.onLaunch({ ...cfg }); // 버튼 포커스 시 중복 발사 방지
  });

  // ── 표시 ──
  panel.append(el('h3', { textContent: '표시' }));
  const arrowBox = el('input', { type: 'checkbox', checked: hooks.arrowsVisible });
  arrowBox.addEventListener('change', () => hooks.onArrows(arrowBox.checked));
  panel.append(el('label', { className: 'dbg-check' }, arrowBox, ' 속도(초록)·회전(분홍) 화살표 (V)'));
  const fpsEl = el('div', { className: 'dbg-info' });
  const ballEl = el('div', { className: 'dbg-info' });
  const logEl = el('div', { className: 'dbg-log' });
  panel.append(fpsEl, ballEl, el('h3', { textContent: '최근 이벤트' }), logEl);

  let frames = 0, fpsTime = 0;
  const log = [];
  const fmt = (n) => n.toFixed(2);

  return {
    launcherConfig: cfg,
    syncArrows(v) { arrowBox.checked = v; },
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
      frames++; fpsTime += dt;
      if (fpsTime >= 0.5) {
        fpsEl.textContent = `FPS ${Math.round(frames / fpsTime)}`;
        frames = 0; fpsTime = 0;
      }
      const v = ball.vel, w = ball.spin;
      const speed = Math.hypot(v.x, v.y, v.z);
      const rps = Math.hypot(w.x, w.y, w.z) / (2 * Math.PI);
      ballEl.textContent = `속도 ${fmt(speed)} m/s · 회전 ${fmt(rps)} rps · 높이 ${fmt(ball.pos.z)} m`;
    },
  };
}
