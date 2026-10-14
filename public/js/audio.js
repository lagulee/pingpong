// audio.js — Web Audio로 직접 합성하는 소리. 외부 음원 파일을 쓰지 않는다.
// 타격음 = 감쇠하는 사인파 + 필터 거친 짧은 노이즈를 층으로 섞는다 (레시피는 constants.js의 SOUND).
// 앞부분(impactParams, crowdLevel, beatInterval)은 DOM·AudioContext 없이 테스트하는 순수 함수다.
// 브라우저 정책상 첫 클릭(사용자 동작) 뒤에만 소리를 낼 수 있으므로 unlock()을 클릭 처리기에서 부른다.
import { TUNABLE, SOUND, SOUND_TEST } from '../shared/constants.js';

const on = (v) => v >= 0.5;

// 충돌 종류 → 음높이 배율 키
const PITCH_KEY = { racket: 'SND_PITCH_RACKET', bounce: 'SND_PITCH_TABLE', net: 'SND_PITCH_NET', edge: 'SND_PITCH_EDGE', floor: 'SND_PITCH_FLOOR' };

// 속도 → 세기 g (0~1, 단조 증가하며 포화)
export function speedLevel(speed, p = TUNABLE) {
  return 1 - Math.exp(-Math.max(0, speed) / p.SND_SPEED_REF);
}

// 레시피 층 목록 (racket은 구질별, 알 수 없는 구질은 드라이브)
export function recipeFor(type, shotType = null) {
  if (type === 'racket') return SOUND.RACKET_SHOTS[shotType] ?? SOUND.RACKET_SHOTS.drive;
  return SOUND.IMPACT[type] ?? null;
}

// playImpact(type, speed)의 소리 매개변수. 반환 { type, shotType, level, layers: [{ kind, filter, q, freq, freqEnd, decay, gain, delay }] }
// 모든 층의 음높이·감쇠 시간·음량이 속도에 대해 단조 증가한다.
export function impactParams(type, speed, shotType = null, p = TUNABLE) {
  const recipe = recipeFor(type, shotType);
  if (!recipe) return null;
  const g = speedLevel(speed, p);
  const pitch = p.SND_PITCH * (p[PITCH_KEY[type]] ?? 1);
  const layers = recipe.map((L) => {
    const freq = L.freq * pitch * (1 + (L.fGain ?? SOUND.FREQ_GAIN) * g);
    return {
      kind: L.kind, filter: L.filter ?? null, q: L.q ?? 1,
      freq, freqEnd: freq * L.sweep,
      decay: L.decay * p.SND_DECAY * (1 + (L.dGain ?? SOUND.DECAY_GAIN) * g),
      gain: L.gain * (SOUND.GAIN_FLOOR + (1 - SOUND.GAIN_FLOOR) * g),
      delay: L.delay,
    };
  });
  return { type, shotType: type === 'racket' ? (SOUND.RACKET_SHOTS[shotType] ? shotType : 'drive') : null, level: g, layers };
}

// 랠리 수 → 관중 함성 크기 (0~1, 단조 증가)
export function crowdLevel(rally, p = TUNABLE) {
  return 1 - Math.exp(-Math.max(0, rally) / p.CROWD_RALLY_FULL);
}

// 심장 박동 간격 (s)
export const beatInterval = (p = TUNABLE) => 60 / p.HEART_BPM;

// ── 오디오 엔진 (브라우저) ────────────────────────────────
// 반환 객체의 메서드는 unlock() 전에 불러도 조용히 무시된다.
export function createAudio(p = TUNABLE) {
  let ctx = null, master = null, out = null, noiseBuf = null;
  let crowdGain = null, crowdTarget = 0;
  let volume = SOUND.MASTER, muted = false;
  let heartOn = false, nextBeat = 0;
  let paused = false;

  function makeNoise() {
    const n = Math.floor(ctx.sampleRate * SOUND.NOISE_SECONDS);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 감쇠 포락선: ATTACK 동안 올라가 decay 동안 −60 dB까지 지수 감쇠
  function envelope(node, t, gain, decay) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.linearRampToValueAtTime(Math.max(gain, 0.0002), t + SOUND.ATTACK);
    node.gain.exponentialRampToValueAtTime(0.0001, t + SOUND.ATTACK + decay);
  }

  function playLayer(L, t0, dest) {
    const t = t0 + L.delay;
    const end = t + SOUND.ATTACK + L.decay + 0.02;
    const g = ctx.createGain();
    envelope(g, t, L.gain, L.decay);
    g.connect(dest);
    if (L.kind === 'tone') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(L.freq, t);
      if (L.freqEnd !== L.freq) o.frequency.exponentialRampToValueAtTime(L.freqEnd, t + L.decay);
      o.connect(g);
      o.start(t); o.stop(end);
    } else {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = L.filter;
      f.Q.value = L.q;
      f.frequency.setValueAtTime(L.freq, t);
      if (L.freqEnd !== L.freq) f.frequency.exponentialRampToValueAtTime(L.freqEnd, t + L.decay);
      s.connect(f); f.connect(g);
      s.start(t, Math.random() * (SOUND.NOISE_SECONDS - 0.3)); s.stop(end);
    }
  }

  function note(freq, t, len, gain, type = 'triangle') {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len * 1.8);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + len * 1.8 + 0.02);
  }

  function setupCrowd() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0;
    const mix = ctx.createGain();
    for (const c of SOUND.CROWD_FILTERS) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = c.freq; f.Q.value = c.q;
      src.connect(f); f.connect(mix);
    }
    // 출렁임: 느린 LFO로 음량을 조금씩 흔든다
    const wobble = ctx.createGain();
    wobble.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = SOUND.CROWD_LFO_HZ;
    const depth = ctx.createGain();
    depth.gain.value = SOUND.CROWD_LFO_DEPTH;
    lfo.connect(depth); depth.connect(wobble.gain);
    mix.connect(wobble); wobble.connect(crowdGain); crowdGain.connect(master);
    src.start(); lfo.start();
  }

  function heartbeat(t) {
    for (const [dt, k] of [[0, 1], [SOUND.HEART_SECOND, SOUND.HEART_SECOND_GAIN]]) {
      playLayer({
        kind: 'tone', freq: SOUND.HEART_FREQ, freqEnd: SOUND.HEART_FREQ * SOUND.HEART_SWEEP,
        decay: SOUND.HEART_DECAY, gain: p.HEART_GAIN * k, delay: dt,
      }, t, master);
    }
  }

  const applyVolume = () => {
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
  };

  const api = {
    get ready() { return !!ctx && ctx.state === 'running'; },
    get volume() { return volume; },
    get muted() { return muted; },
    // 첫 클릭에서 부른다 (브라우저 자동 재생 정책)
    unlock() {
      if (!ctx) {
        const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        noiseBuf = makeNoise();
        out = ctx.createDynamicsCompressor(); // 여러 소리가 겹쳐도 찢어지지 않게
        out.connect(ctx.destination);
        master = ctx.createGain();
        master.gain.value = muted ? 0 : volume;
        master.connect(out);
        setupCrowd();
      }
      if (ctx.state === 'suspended' && !paused) ctx.resume();
      return true;
    },
    // 일시정지: 오디오 시계를 멈춘다 (관중·심장 박동 예약도 함께 멈춤)
    setPaused(v) {
      paused = v;
      if (!ctx) return;
      if (v && ctx.state === 'running') ctx.suspend();
      else if (!v && ctx.state === 'suspended') ctx.resume();
    },
    setVolume(v) { volume = v; applyVolume(); },
    setMuted(m) { muted = m; applyVolume(); },
    // 충돌음. type = 물리 이벤트 type, shotType = 라켓 구질. 반환: 쓴 매개변수 (테스트 페이지 표시용)
    playImpact(type, speed, shotType = null) {
      const prm = impactParams(type, speed, shotType, p);
      if (!ctx || !prm) return prm;
      const t = ctx.currentTime;
      for (const L of prm.layers) playLayer(L, t, master);
      return prm;
    },
    // 관중: 랠리 수에 따라 커진다 (매 프레임 불러도 된다). null이면 조용히
    setCrowd(rally) {
      crowdTarget = rally !== null && on(p.SND_CROWD) ? p.CROWD_GAIN * (SOUND.CROWD_BASE + (1 - SOUND.CROWD_BASE) * crowdLevel(rally, p)) : 0;
      if (crowdGain) crowdGain.gain.setTargetAtTime(crowdTarget, ctx.currentTime, SOUND.CROWD_SMOOTH);
    },
    // 득점 순간 함성: 랠리가 길었을수록 크게 터졌다 가라앉는다
    cheer(rally) {
      if (!ctx || !on(p.SND_CROWD)) return;
      const t = ctx.currentTime;
      const peak = p.CROWD_GAIN * SOUND.CHEER_GAIN * (0.3 + 0.7 * crowdLevel(rally, p));
      crowdGain.gain.cancelScheduledValues(t);
      crowdGain.gain.setTargetAtTime(peak, t, 0.05);
      crowdGain.gain.setTargetAtTime(crowdTarget, t + 0.25, SOUND.CHEER_TIME / 3);
    },
    setHeartbeat(v) {
      v = v && on(p.SND_HEART);
      if (v && !heartOn && ctx) nextBeat = ctx.currentTime + 0.05;
      heartOn = v;
    },
    get heartbeat() { return heartOn; },
    // 매 프레임: 심장 박동 예약
    tick() {
      if (!ctx || !heartOn) return;
      while (nextBeat < ctx.currentTime + SOUND.SCHEDULE_AHEAD) {
        if (nextBeat >= ctx.currentTime - 0.05) heartbeat(Math.max(nextBeat, ctx.currentTime));
        nextBeat += beatInterval(p);
      }
    },
    playPoint(win) {
      if (!ctx || !on(p.SND_JINGLE)) return;
      const t = ctx.currentTime;
      (win ? SOUND.POINT_WIN : SOUND.POINT_LOSE).forEach((f, i) => note(f, t + i * SOUND.JINGLE_NOTE, SOUND.JINGLE_NOTE, SOUND.JINGLE_GAIN));
    },
    playGameEnd(win) {
      if (!ctx || !on(p.SND_JINGLE)) return;
      const t = ctx.currentTime;
      (win ? SOUND.GAME_WIN : SOUND.GAME_LOSE).forEach((f, i) => note(f, t + i * SOUND.GAME_NOTE, SOUND.GAME_NOTE, SOUND.JINGLE_GAIN, win ? 'triangle' : 'sine'));
    },
  };
  return api;
}

// ── 사운드 테스트 페이지 (?sound=1) ───────────────────────
// 각 소리를 약·중·강 속도로 재생하는 버튼. 마지막으로 재생한 소리의 매개변수를 보여 준다.
const TEST_ROWS = [
  ['racket', 'drive', '라켓 · 드라이브'], ['racket', 'smash', '라켓 · 스매시'], ['racket', 'cut', '라켓 · 커트'],
  ['racket', 'side', '라켓 · 사이드'], ['racket', 'block', '라켓 · 블록'], ['racket', 'mishit', '라켓 · 실타'],
  ['bounce', null, '테이블'], ['edge', null, '모서리'], ['net', null, '네트'], ['floor', null, '바닥'],
];

export function describeParams(prm, speed) {
  const lines = prm.layers.map((L, i) => {
    const what = L.kind === 'tone' ? '사인' : `노이즈(${L.filter})`;
    const sweep = Math.abs(L.freqEnd - L.freq) > 1 ? `→${Math.round(L.freqEnd)}` : '';
    return `${i + 1}. ${what} ${Math.round(L.freq)}${sweep} Hz · 감쇠 ${(L.decay * 1000).toFixed(0)} ms · 음량 ${L.gain.toFixed(2)}${L.delay ? ` · +${L.delay * 1000} ms` : ''}`;
  });
  return [`${prm.type}${prm.shotType ? `/${prm.shotType}` : ''} ${speed} m/s (세기 g=${prm.level.toFixed(2)})`, ...lines].join('\n');
}

export function initSoundTest(audio, container) {
  const panel = document.createElement('div');
  panel.id = 'soundtest';
  const h = document.createElement('h3');
  h.textContent = '사운드 테스트 (?sound=1)';
  panel.append(h);
  const info = document.createElement('pre');
  info.className = 'st-info';
  info.textContent = '버튼을 누르면 소리가 나고, 여기에 매개변수가 표시됩니다.\n?sound=1&debug=1로 열면 연출 슬라이더로 음높이·감쇠를 바꾸며 들을 수 있습니다.';
  const row = (label, buttons) => {
    const r = document.createElement('div');
    r.className = 'st-row';
    const name = document.createElement('span');
    name.textContent = label;
    r.append(name);
    for (const [text, fn] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); fn(); b.blur(); });
      r.append(b);
    }
    panel.append(r);
  };
  for (const [type, shot, label] of TEST_ROWS) {
    const speeds = SOUND_TEST.SPEEDS[shot ?? type];
    row(label, speeds.map((v, i) => [`${SOUND_TEST.LEVELS[i]} ${v}`, () => {
      const prm = audio.playImpact(type, v, shot);
      info.textContent = describeParams(prm, v);
    }]));
  }
  row('관중 (랠리 수)', SOUND_TEST.CROWD_RALLIES.map((n) => [`${n}회`, () => {
    audio.setCrowd(n);
    info.textContent = `관중 함성: 랠리 ${n}회 → 크기 ${crowdLevel(n).toFixed(2)}`;
  }]).concat([['함성 터짐', () => audio.cheer(10)], ['끄기', () => audio.setCrowd(null)]]));
  row('심장 박동', [['켜기/끄기', () => {
    audio.setHeartbeat(!audio.heartbeat);
    info.textContent = `심장 박동 ${audio.heartbeat ? '켜짐' : '꺼짐'} (${TUNABLE.HEART_BPM} BPM)`;
  }]]);
  row('효과음', [
    ['득점', () => audio.playPoint(true)], ['실점', () => audio.playPoint(false)],
    ['승리', () => audio.playGameEnd(true)], ['패배', () => audio.playGameEnd(false)],
  ]);
  panel.append(info);
  container.append(panel);
  return panel;
}
