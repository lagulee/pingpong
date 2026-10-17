// mobile.js — 모바일 모드 (6단계): 감지, 자동 품질, 화면 꺼짐 방지, 전체 화면, iOS 소리 설정, 진동.
// 앞부분(detectMobile, createQualityGovernor)은 DOM 없이 테스트하는 순수 함수, 나머지는 브라우저 API를 감싼다.
// 지원하지 않는 브라우저에서는 모두 조용히 아무것도 하지 않는다.
import { MOBILE, TUNABLE } from '../shared/constants.js';

// 모바일 모드인가: ?mobile=1/0이 우선, 아니면 손가락 화면(pointer: coarse)이면서 짧은 변이 MAX_SHORT_SIDE 이하
// env: { query(?mobile 값 또는 null), coarse(bool), width, height } (CSS px)
export function detectMobile({ query = null, coarse = false, width = 0, height = 0 } = {}) {
  if (query === '1') return true;
  if (query === '0') return false;
  return !!coarse && Math.min(width, height) <= MOBILE.MAX_SHORT_SIDE;
}

// 자동 품질: FPS_WINDOW 동안의 평균 FPS가 MOB_FPS_MIN보다 낮으면 픽셀 비율을 PIXEL_RATIO_STEP씩 낮춘다.
// start: 처음 픽셀 비율. update(dt)는 바뀐 픽셀 비율 또는 null. 상한(MOB_PIXEL_RATIO)이 바뀌면 그 값에서 다시 시작한다.
export function createQualityGovernor(start, p = TUNABLE, dpr = start) {
  let ratio = start, cap = p.MOB_PIXEL_RATIO, time = 0, frames = 0;
  return {
    get ratio() { return ratio; },
    update(dt) {
      if (p.MOB_PIXEL_RATIO !== cap) {
        cap = p.MOB_PIXEL_RATIO;
        ratio = Math.min(dpr, cap);
        time = 0; frames = 0;
        return ratio;
      }
      if (p.FX_AUTO_QUALITY < 0.5 || !(dt > 0) || dt > MOBILE.FPS_SKIP_DT) return null; // 탭 전환·일시정지 뒤 긴 프레임은 뺀다
      time += dt; frames++;
      if (time < MOBILE.FPS_WINDOW) return null;
      const fps = frames / time;
      time = 0; frames = 0;
      if (fps >= p.MOB_FPS_MIN || ratio <= MOBILE.PIXEL_RATIO_MIN + 1e-9) return null;
      ratio = Math.max(MOBILE.PIXEL_RATIO_MIN, ratio - MOBILE.PIXEL_RATIO_STEP);
      return ratio;
    },
  };
}

// ── 브라우저 API ──────────────────────────────────────────
// 화면 꺼짐 방지 (Screen Wake Lock). want(true)면 잡고, 화면을 다시 보면 다시 잡는다(숨기면 브라우저가 풀어 버림).
export function createWakeLock() {
  let wanted = false, lock = null, asking = false;
  function grab() {
    if (!wanted || lock || asking || document.hidden || !navigator.wakeLock?.request) return;
    asking = true;
    navigator.wakeLock.request('screen').then((l) => {
      asking = false;
      if (!wanted) { l.release().catch(() => {}); return; }
      lock = l;
      l.addEventListener('release', () => { lock = null; });
    }).catch(() => { asking = false; });
  }
  document.addEventListener('visibilitychange', grab);
  return {
    want(v) {
      if (v === wanted) return;
      wanted = v;
      if (v) grab();
      else if (lock) { lock.release().catch(() => {}); lock = null; }
    },
  };
}

// 전체 화면 + 가로 고정. 아이폰 사파리는 요소 전체 화면을 지원하지 않아 canFullscreen()이 false (버튼을 숨긴다)
const fsElement = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
export const canFullscreen = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
export function toggleFullscreen() {
  if (fsElement()) {
    (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
    return;
  }
  const el = document.documentElement;
  const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (!req) return;
  Promise.resolve(req.call(el, { navigationUI: 'hide' }))
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => { /* 거절되거나 가로 고정을 지원하지 않음 */ });
}

// iOS 무음 스위치: Web Audio는 기본(ambient)이면 무음 모드에서 소리가 안 난다. 'playback'이면 난다(다른 앱 음악은 멈출 수 있음).
export function applyAudioSession(p = TUNABLE) {
  const s = navigator.audioSession;
  if (!s) return;
  const want = p.SND_SILENT_SWITCH >= 0.5 ? 'playback' : 'auto';
  try { if (s.type !== want) s.type = want; } catch { /* 지원하지 않는 값 */ }
}

// 진동 (안드로이드 크롬 등). 아이폰 사파리는 navigator.vibrate가 없어 생략된다
export function vibrate(ms) {
  if (ms > 0 && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(ms); } catch { /* 사용자 동작 전 등 */ }
  }
}
