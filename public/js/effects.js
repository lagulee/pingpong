// effects.js — 타격감 연출: 히트스톱, 화면 흔들림, 구질별 색 꼬리, 판정 팝업, 매치포인트 슬로모션.
// 연출은 물리 이벤트(bounce, racket, net, edge, floor)와 득점 결과를 "읽기만" 한다. 물리 상태를 바꾸지 않는다.
// 히트스톱·슬로모션은 화면 표시 시각(viewT = 물리 시각 − lag)만 늦춘다. 물리 시각은 그대로 흐른다(5단계 대전 대비).
// 이 파일은 'three'를 import하지 않는다. 맨 끝 createPopupLayer만 DOM을 쓰고, 나머지는 Node에서 테스트한다.
import { TUNABLE, FEEL, PHYSICS } from '../shared/constants.js';

const on = (v) => v >= 0.5; // 켜기/끄기 값 (1 = 켬)

// ── 화면 흔들림 ─────────────────────────────────────────
// 진폭은 타격 속도에 비례하고 SHAKE_MAX에서 멈춘다 (속도에 대해 단조 증가).
export function shakeAmplitude(speed, p = TUNABLE) {
  if (!on(p.FX_SHAKE)) return 0;
  return Math.min(p.SHAKE_MAX, p.SHAKE_GAIN * Math.max(0, speed));
}

// 흔들림 상태: kick(속도)로 시작, offset(경과 시간)이 카메라 이동량 { x, z } (m)
// 포락선 (1 − t/T)²로 SHAKE_DECAY 동안 0까지 줄어든다. 진동은 두 축 진동수를 달리한 사인파(결정론적).
export function createShake(p = TUNABLE) {
  let amp = 0, age = Infinity;
  return {
    kick(speed) {
      const a = shakeAmplitude(speed, p);
      const cur = this.envelope();
      if (a > amp * cur) { amp = a; age = 0; } // 지금 흔들림보다 셀 때만 새로 시작
    },
    envelope() {
      const T = p.SHAKE_DECAY;
      return age >= T ? 0 : (1 - age / T) ** 2;
    },
    advance(dt) {
      if (age < Infinity) age += dt;
      const k = amp * this.envelope();
      if (k <= 0) return { x: 0, z: 0 };
      return {
        x: k * Math.sin(2 * Math.PI * FEEL.SHAKE_FREQ_X * age),
        z: k * Math.cos(2 * Math.PI * FEEL.SHAKE_FREQ_Z * age),
      };
    },
  };
}

// ── 고정 스텝 예산 + 일시정지 ─────────────────────────────
// 한 화면 프레임에서 밟을 물리 스텝 수. 누적기(acc)에 실제 경과 시간을 더하고 DT씩 덜어 낸다.
// 일시정지 중에는 스텝 0, 누적기도 비운다(다시 시작할 때 밀린 시간이 한꺼번에 흐르지 않게).
// 반환: { steps, acc(남은 누적 시간) }
export function frameSteps(acc, elapsed, paused = false, dt = PHYSICS.DT, max = PHYSICS.MAX_STEPS_PER_FRAME) {
  if (paused) return { steps: 0, acc: 0 };
  let a = acc + Math.max(0, elapsed), steps = 0;
  while (a >= dt && steps < max) { a -= dt; steps++; }
  if (a >= dt) a = 0; // 너무 밀린 시간은 버린다
  return { steps, acc: a };
}

// ── 화면 시계: 히트스톱·슬로모션 ─────────────────────────
// lag = 물리 시각 − 화면 시각. 정지 중에는 lag가 실제 시간만큼, 슬로모션 중에는 (1 − 배율)만큼 늘고,
// 끝나면 CATCHUP_RATE 배속으로 따라잡아 0으로 돌아온다. 물리 진행에는 관여하지 않는다.
export function hitstopSeconds(p = TUNABLE) {
  return on(p.FX_HITSTOP) ? p.HITSTOP_FRAMES / FEEL.FRAME_RATE : 0;
}

export function createViewClock(p = TUNABLE) {
  let lag = 0, freeze = 0, slow = 0;
  return {
    get lag() { return lag; },
    get frozen() { return freeze > 0; },
    get slowing() { return slow > 0; },
    hitstop(sec = hitstopSeconds(p)) { freeze = Math.max(freeze, sec); },
    slowmo(sec = p.SLOWMO_TIME) { if (on(p.FX_SLOWMO)) slow = Math.max(slow, sec); },
    reset() { lag = 0; freeze = 0; slow = 0; },
    // 실제로 흐른 시간 dt → 새 lag
    advance(dt) {
      let rest = dt;
      if (freeze > 0) {
        const d = Math.min(rest, freeze);
        lag += d; freeze -= d; rest -= d;
        if (freeze < 1e-9) freeze = 0; // 부동소수 나머지로 한 프레임 더 멈추지 않게
      }
      if (rest > 0 && slow > 0) {
        const d = Math.min(rest, slow);
        lag += d * (1 - p.SLOWMO_RATE); slow -= d; rest -= d;
        if (slow < 1e-9) slow = 0;
      }
      if (rest > 0 && freeze <= 0 && slow <= 0) lag = Math.max(0, lag - rest * (p.CATCHUP_RATE - 1));
      lag = Math.min(lag, FEEL.VIEW_LAG_MAX);
      return lag;
    },
  };
}

// ── 공 상태 기록: 화면 시각으로 공을 보간하고 꼬리를 만든다 ──────
// push로 물리 스텝마다 상태를 복사해 둔다 (원본 공 객체는 붙잡지 않는다).
export function createBallHistory(maxTime = FEEL.HISTORY_TIME) {
  const buf = [];
  const copy = (v) => ({ x: v.x, y: v.y, z: v.z });
  return {
    get length() { return buf.length; },
    clear() { buf.length = 0; },
    // 시각 t 이후 기록을 버린다 (대전: 상대 타격으로 되감아 다시 계산할 때)
    truncate(t) {
      while (buf.length && buf[buf.length - 1].t > t + 1e-9) buf.pop();
    },
    push(t, ball) {
      const prev = buf[buf.length - 1];
      const jump = prev && Math.hypot(ball.pos.x - prev.pos.x, ball.pos.y - prev.pos.y, ball.pos.z - prev.pos.z) > FEEL.TELEPORT;
      buf.push({ t, pos: copy(ball.pos), vel: copy(ball.vel), spin: copy(ball.spin), cut: !prev || jump });
      while (buf.length > 2 && buf[0].t < t - maxTime) buf.shift();
    },
    // 시각 t의 공 상태 (앞뒤 기록 사이 선형 보간, 순간 이동 구간은 보간하지 않음)
    sample(t) {
      if (!buf.length) return null;
      if (t <= buf[0].t) return buf[0];
      for (let i = buf.length - 1; i >= 0; i--) {
        const a = buf[i];
        if (a.t <= t) {
          const b = buf[i + 1];
          if (!b || b.cut) return a;
          const f = (t - a.t) / (b.t - a.t);
          const lerp = (u, v) => ({ x: u.x + (v.x - u.x) * f, y: u.y + (v.y - u.y) * f, z: u.z + (v.z - u.z) * f });
          return { t, pos: lerp(a.pos, b.pos), vel: lerp(a.vel, b.vel), spin: a.spin };
        }
      }
      return buf[0];
    },
    // 꼬리: 시각 (t − duration, t]의 기록을 오래된 것부터. 순간 이동 이전은 버린다.
    trail(t, duration, maxPoints = FEEL.TRAIL_MAX_POINTS) {
      const pts = [];
      for (let i = buf.length - 1; i >= 0 && pts.length < maxPoints; i--) {
        const s = buf[i];
        if (s.t > t) continue;
        if (s.t < t - duration) break;
        pts.push(s);
        if (s.cut) break;
      }
      return pts.reverse();
    },
  };
}

// ── 구질 색 ─────────────────────────────────────────────
// 진행 방향 d(수평) 기준: 탑스핀 성분 = ω·(ẑ × d), 횡회전 성분 = ω_z. (physics.makeLaunch와 같은 정의)
// 반환 'top' | 'back' | 'side' | 'none'
export function spinKind(vel, spin, p = TUNABLE) {
  const h = Math.hypot(vel.x, vel.y);
  const top = h > 1e-6 ? (spin.x * -vel.y / h + spin.y * vel.x / h) / (2 * Math.PI) : 0;
  const side = spin.z / (2 * Math.PI);
  const min = p.TRAIL_SPIN_MIN;
  if (Math.abs(side) >= Math.abs(top) && Math.abs(side) >= min) return 'side';
  if (top >= min) return 'top';
  if (top <= -min) return 'back';
  return 'none';
}

export const TRAIL_COLORS = Object.freeze({
  top: FEEL.COLOR_TRAIL_TOP, back: FEEL.COLOR_TRAIL_BACK, side: FEEL.COLOR_TRAIL_SIDE, none: FEEL.COLOR_TRAIL_NONE,
});

// ── 회전 읽기 (7단계) ─────────────────────────────────────
// 판정용 회전(carriedSpin)의 종류와 세기. frac = 회전 / 그 종류의 상한(드라이브·커트·사이드 SPIN_CAP),
// level = 1~FEEL.SPIN_LEVELS 칸 (회전이 약하면 0). 화면의 회전 표지와 꼬리 진하기에 쓴다.
export function spinRead(vel, spin, p = TUNABLE) {
  const kind = spinKind(vel, spin, p);
  if (kind === 'none') return { kind, rps: 0, frac: 0, level: 0 };
  const h = Math.hypot(vel.x, vel.y);
  const top = h > 1e-6 ? (spin.x * -vel.y / h + spin.y * vel.x / h) / (2 * Math.PI) : 0;
  const rps = kind === 'side' ? Math.abs(spin.z / (2 * Math.PI)) : Math.abs(top);
  const cap = kind === 'top' ? p.DRIVE_SPIN_CAP : kind === 'back' ? p.CUT_SPIN_CAP : p.SIDE_SPIN_CAP;
  const frac = Math.min(1, rps / Math.max(cap, 1e-9));
  return { kind, rps, frac, level: Math.max(1, Math.min(FEEL.SPIN_LEVELS, Math.ceil(frac * FEEL.SPIN_LEVELS - 1e-9))) };
}

// 두 색(0xRRGGBB)을 f(0~1)만큼 섞는다
export function mixColor(a, b, f) {
  const ch = (c, k) => (c >> k) & 255;
  const m = (k) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * f) << k;
  return m(16) | m(8) | m(0);
}

// 꼬리 색: 회전 종류 색을 세기(frac)만큼 진하게 (약한 회전은 회색 쪽으로, TRAIL_MIX_MIN이 최소 진하기)
export function trailColor(vel, spin, p = TUNABLE) {
  const r = spinRead(vel, spin, p);
  if (r.kind === 'none') return TRAIL_COLORS.none;
  return mixColor(TRAIL_COLORS.none, TRAIL_COLORS[r.kind], FEEL.TRAIL_MIX_MIN + (1 - FEEL.TRAIL_MIX_MIN) * r.frac);
}

// ── 판정 팝업 ───────────────────────────────────────────
// me: 화면을 보는 플레이어 쪽. PERFECT·MAX SPIN은 내 타격에만, SMASH!는 누구의 스매시든, EDGE!는 모서리 바운드.
export function popupsFor(e, me = -1, p = TUNABLE) {
  if (!on(p.FX_POPUP)) return [];
  const out = [];
  if (e.type === 'racket' && e.shot) {
    if (e.shot.shotType === 'smash') out.push('smash');
    if (e.side === me && e.shot.quality?.timing === 'PERFECT') out.push('perfect');
    if (e.side === me && e.shot.quality?.stack?.capped) out.push('spinmax'); // 7단계: 회전 누적이 상한에 닿음
  }
  if (e.type === 'edge') out.push('edge');
  return out;
}

// ── 화면 시각에 맞춰 내보내는 대기열 ───────────────────────
// 물리 이벤트·득점 결과는 물리 시각에 생기지만, 소리·연출은 화면이 그 순간을 보여 줄 때 낸다.
export function createDisplayQueue() {
  const q = [];
  return {
    get length() { return q.length; },
    push(item) { q.push(item); },
    clear() { q.length = 0; },
    // 시각 t 이후 항목을 버린다 (대전: 되감기로 사라진 미래의 이벤트)
    dropAfter(t) {
      for (let i = q.length - 1; i >= 0; i--) if (q[i].t > t + 1e-9) q.splice(i, 1);
    },
    // t 이하인 항목을 시간 순서로 꺼낸다
    popUntil(t) {
      const out = [];
      while (q.length && q[0].t <= t) out.push(q.shift());
      return out;
    },
  };
}

// ── 묶음: 이벤트 하나 → 할 일 ────────────────────────────
// 반환 { hitstop(s), shake(속도), popups[] }. 상태를 바꾸지 않는 순수 함수.
export function reactTo(e, me = -1, p = TUNABLE) {
  const r = { hitstop: 0, shake: 0, popups: popupsFor(e, me, p) };
  if (e.type === 'racket') {
    r.shake = e.speed;
    if (e.shot?.shotType === 'smash') r.hitstop = hitstopSeconds(p);
  }
  return r;
}

// ── 진동 (6단계 모바일) ─────────────────────────────────
// 화면 시각에 도달한 물리 이벤트 → 진동 길이 (ms, 0 = 진동 없음).
// 내 라켓 타격: VIB_HIT_MIN~MAX를 소리 세기와 같은 g = 1 − e^(−속도/SND_SPEED_REF)로 (속도에 대해 단조 증가),
// 내 코트 바운드: VIB_BOUNCE. 상대 타격·상대 코트 바운드는 진동하지 않는다.
export function vibrationMs(e, me = -1, p = TUNABLE) {
  if (!on(p.FX_VIBRATE)) return 0;
  if (e.type === 'racket') {
    if (e.side !== me) return 0;
    const g = 1 - Math.exp(-Math.max(0, e.speed) / p.SND_SPEED_REF);
    return Math.round(p.VIB_HIT_MIN + (p.VIB_HIT_MAX - p.VIB_HIT_MIN) * g);
  }
  if ((e.type === 'bounce' || e.type === 'edge') && e.pos.y * me > 0) return Math.round(p.VIB_BOUNCE);
  return 0;
}

// 득점 결과에 슬로모션을 걸지: 매치포인트였던 랠리가 끝나는 순간(경기 끝 또는 매치포인트를 막아 낸 순간)
export function slowmoFor(result, p = TUNABLE) {
  return on(p.FX_SLOWMO) && !result.practice && result.type === 'point' && !!(result.matchPoint || result.matchOver);
}

// 연출 엔진: 화면 시각 기준 이벤트를 받아 흔들림·화면 시계를 움직인다.
export function createFx(p = TUNABLE) {
  const clock = createViewClock(p);
  const shake = createShake(p);
  return {
    clock, shake,
    onEvent(e, me = -1) {
      const r = reactTo(e, me, p);
      if (r.hitstop > 0) clock.hitstop(r.hitstop);
      if (r.shake > 0) shake.kick(r.shake);
      return r;
    },
    onResult(result) {
      const s = slowmoFor(result, p);
      if (s) clock.slowmo();
      return s;
    },
    // 실제 경과 시간 → { lag, shake: {x, z} }
    advance(dt) {
      return { lag: clock.advance(dt), shake: shake.advance(dt) };
    },
  };
}

// ── 팝업 (DOM) ───────────────────────────────────────────
// container 안에 글자를 띄워 POPUP_TIME 동안 떠오르며 사라지게 한다. CSS 애니메이션은 index.html.
export function createPopupLayer(container, p = TUNABLE) {
  return {
    show(kinds, screen) {
      kinds.forEach((kind, i) => {
        const def = FEEL.POPUPS[kind];
        if (!def) return;
        const el = document.createElement('div');
        el.className = `popup popup-${kind}`;
        el.textContent = def.text;
        el.style.left = `${screen.x}px`;
        el.style.top = `${screen.y + FEEL.POPUP_OFFSET_Y - i * FEEL.POPUP_STACK}px`;
        el.style.color = def.color;
        el.style.fontSize = `${def.size}px`;
        el.style.setProperty('--rise', `${-FEEL.POPUP_RISE}px`);
        el.style.animationDuration = `${p.POPUP_TIME}s`;
        container.append(el);
        setTimeout(() => el.remove(), p.POPUP_TIME * 1000 + 50);
      });
    },
  };
}
