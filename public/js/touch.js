// touch.js — 터치(손가락)를 마우스와 같은 라켓 샘플 { t, x, y, b, k }로 바꾸는 층 (6단계 모바일).
// DOM 없이 테스트할 수 있는 순수 함수다. classifyShot·checkHit은 그대로 쓰고, 이 파일은 샘플만 만든다.
//
// 규칙 (.claude/rules/input.md "터치 조작"):
// - 손가락이 닿아 있음 = 버튼 누름(b = true). 대고 멈추면 조준 블록, 쓸면 스윙 — 판정은 PC와 같다.
// - 라켓은 손가락보다 TOUCH_OFFSET_PX 위에 둔다 (손가락이 들어오는 공을 가리지 않게).
// - 손가락을 새로 대면 이전 샘플을 비운다: 뗐다가 다른 곳에 대면 라켓이 순간 이동하는데,
//   이 이동이 스윙 속도로 재지면 스매시로 오판되기 때문.
// - 손가락을 떼도 TOUCH_LIFT_HOLD 동안은 누름으로 본다 (튕기듯 쓸면 공에 닿기 전에 손이 먼저 떨어짐).
//   뗀 순간 "그 시각 + 유예"에 b = false 샘플을 미리 넣어 둔다 → 물리 스텝마다 정확히 그 시각에 바뀐다.
// - 두 번째 손가락은 무시한다 (확대 동작·오입력 방지).
import { SWING, TUNABLE, MOBILE } from '../shared/constants.js';
import { pruneSamples, tunableCamera } from './input.js';

// 모바일 시점: PC 시점(CAM_*)에서 시야각(MOB_CAM_FOV)과 바라보는 점 높이(MOB_CAM_TZ)만 바꾼다.
// 가로 휴대폰에서 타점을 화면 위쪽으로 올려, 손가락 위에 띄운 라켓 아래로 쓸어 올릴 자리를 만든다.
export function mobileCamera(params = TUNABLE) {
  const c = tunableCamera(params);
  return { pos: c.pos, target: { x: c.target.x, y: c.target.y, z: params.MOB_CAM_TZ }, fov: params.MOB_CAM_FOV };
}

// 터치 드래그 속도 배율: 판정 속도는 "화면 높이의 몇 %를 움직였나"에 비례하므로 화면 높이(px)로 CSS px 기준에 맞춘다.
// (가로 휴대폰 390 px → 0.43배, 태블릿 820 px → 0.91배). 시점 보정(dragScaleFor)과 곱해서 쓴다.
export const touchSpeedScale = (viewHeight, params = TUNABLE) => params.TOUCH_SPEED_GAIN * viewHeight / MOBILE.TOUCH_REF_H;

// samples: 라켓 샘플 배열 (마우스와 같은 배열을 함께 쓴다)
// opts.toPlane(clientX, clientY) → { x, z } | null : 화면 좌표 → 라켓 평면 (오프셋은 여기서 빼서 넘긴다)
// opts.params: 튜닝 값 (기본 TUNABLE), opts.button() → 지금 누른 구질 버튼 (7단계 화면 버튼, 샘플의 k)
export function createTouchTracker(samples, opts) {
  const params = () => opts.params ?? TUNABLE;
  let id = null;                          // 추적 중인 손가락 (pointerId)
  let last = { x: 0, z: SWING.HOME.z };   // 마지막 라켓 위치

  function locate(cx, cy) {
    const p = opts.toPlane(cx, cy - params().TOUCH_OFFSET_PX);
    if (p) last = p;
  }
  function push(t, b) {
    const prev = samples[samples.length - 1];
    const s = { t: prev && t < prev.t ? prev.t : t, x: last.x, y: last.z, b, k: opts.button?.() ?? null };
    samples.push(s);
    pruneSamples(samples, s.t);
  }

  return {
    get touching() { return id !== null; },
    // 손가락을 댐. 이미 다른 손가락을 추적 중이면 false
    down(pid, cx, cy, t) {
      if (id !== null) return false;
      id = pid;
      samples.length = 0; // 새 스트로크: 이전 위치와 이어서 속도를 재지 않는다
      locate(cx, cy);
      push(t, true);
      return true;
    },
    move(pid, cx, cy, t) {
      if (pid !== id) return;
      locate(cx, cy);
      push(t, true);
    },
    // 손가락을 뗌 (pointerup·pointercancel). 유예 뒤의 b = false 샘플을 미리 넣는다
    up(pid, cx, cy, t) {
      if (pid !== id) return false;
      if (cx != null) locate(cx, cy);
      push(t, true);
      id = null;
      push(t + params().TOUCH_LIFT_HOLD, false);
      return true;
    },
    // 구질 버튼을 누르거나 뗐을 때 지금 상태를 바로 남긴다 (7단계)
    mark(t) {
      const prev = samples[samples.length - 1];
      push(Math.max(t, prev?.t ?? t), id !== null);
    },
    // 프레임마다: 손가락이 멈춰 있어도 현재 위치를 남긴다 (라켓 평면 y가 바뀌었을 때 반영)
    refresh(t) {
      const prev = samples[samples.length - 1];
      if (!prev || t - prev.t > MOBILE.REFRESH) push(Math.max(t, prev?.t ?? t), id !== null);
    },
  };
}
