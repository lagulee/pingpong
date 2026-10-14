// host.js — 대전 방 하나의 관리·검증·득점 판정 (순수 클래스, network.md)
// 입출력은 모두 주입받은 io로만 한다. 그래서 같은 코드를 Cloudflare Durable Object(server/room.js),
// Node 서버, P2P 호스트 브라우저 어디서든 얇은 껍데기만 바꿔 돌릴 수 있다.
//   io.now() → 현재 시각 (ms)          io.rng() → [0, 1) 난수
//   io.send(id, msg)  msg는 객체        io.close(id, code, reason)
//   io.setTimer(atMs | null)           가장 이른 마감 시각 하나만 (Durable Object: storage alarm)
//   io.save(snapshot)                  잠들었다 깨어날 때 restore(snapshot)으로 되살린다
//   io.clear()                         방이 비면 저장된 상태를 지운다
// 서버는 실시간 루프 없이 이벤트로 움직인다: 타격이 오면 마지막 확정 상태에서 그 시각까지 물리를 돌려 검증하고,
// 아무도 치지 않으면 공이 어떻게 끝나는지(예정 결말) 미리 계산해 그 시각 + GRACE에 득점을 판정한다.
import { PHYSICS, PRACTICE, SERVE, TUNABLE, ONLINE, VERSION } from './constants.js';
import { createMatch, startToss, applyHit, stepGame, isServeHit } from './match.js';
import { canHit } from './rules.js';
import { cloneBall, ballToLocal } from './physics.js';

const SIDES = [-1, 1];
const DT = PHYSICS.DT;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v) => !!v && finite(v.x) && finite(v.y) && finite(v.z);
const norm = (v) => Math.hypot(v.x, v.y, v.z);
const vec3 = (v) => ({ x: v.x, y: v.y, z: v.z });
const isBounce = (e) => e.type === 'bounce' || e.type === 'edge';

// 4자리 방 코드 (혼동 문자 0/O, 1/I 제외)
export function makeCode(rng) {
  let s = '';
  for (let i = 0; i < ONLINE.CODE_LEN; i++) s += ONLINE.CODE_CHARS[Math.floor(rng() * ONLINE.CODE_CHARS.length)];
  return s;
}
export function validCode(code) {
  return typeof code === 'string' && code.length === ONLINE.CODE_LEN && [...code].every((c) => ONLINE.CODE_CHARS.includes(c));
}
function makeToken(rng) {
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(rng() * 16).toString(16);
  return s;
}
export function cleanNick(s) {
  const n = typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, ONLINE.NICK_MAX) : '';
  return n || '이름 없음';
}

// 경기 상태 복사 (검증·예측용 가상 진행). rules·lastToss는 바뀌지 않는 객체라 그대로 둔다.
export function cloneMatch(g) {
  return { ...g, ball: cloneBall(g.ball), results: g.results.slice() };
}

// 경기 상태 → 보낼 수 있는 객체 (재접속 resume·저장용)
export function matchSnapshot(g) {
  return {
    ball: cloneBall(g.ball), rules: g.rules, lastHitT: g.lastHitT, holding: g.holding,
    nextAt: g.nextAt, lastToss: g.lastToss, resultsLen: g.results.length,
  };
}
export function restoreMatch(g, s) {
  g.ball = cloneBall(s.ball);
  g.rules = s.rules;
  g.lastHitT = s.lastHitT;
  g.holding = s.holding;
  g.nextAt = s.nextAt;
  g.lastToss = s.lastToss;
  return g;
}

// 경기를 시각 t까지 진행 (서버: 훅 없음 = 타격은 메시지로만). 결과가 생길 때마다 onResult(result, game)
export function advanceMatch(g, t, params = TUNABLE, onResult = null) {
  while (g.ball.t < t - DT / 2) {
    const n = g.results.length;
    stepGame(g, DT, params);
    if (onResult) for (let i = n; i < g.results.length; i++) onResult(g.results[i], g);
  }
}

// 아무도 치지 않으면 어떻게 끝나는가: { endT(결과 시각 또는 null), corrects[바운드 직후 공 상태] }
export function predictEnd(g, params = TUNABLE) {
  const sim = cloneMatch(g);
  const n0 = sim.results.length;
  const corrects = [];
  const limit = sim.ball.t + PRACTICE.RALLY_TIMEOUT + 1;
  while (sim.results.length === n0 && sim.ball.t < limit) {
    const ev = stepGame(sim, DT, params);
    if (corrects.length < ONLINE.CORRECT_MAX && ev.some(isBounce)) {
      corrects.push({ t: sim.ball.t, pos: vec3(sim.ball.pos), vel: vec3(sim.ball.vel), spin: vec3(sim.ball.spin) });
    }
  }
  return { endT: sim.results.length > n0 ? sim.results[n0].t : null, corrects };
}

// hit·serve 검증. 반환: 거부 사유(문자열) 또는 null(통과)
// g: 타격 시각까지 진행한 경기 상태, side: 보낸 사람, msg: { type, pos, vel, spin, racket }
export function checkHitMsg(g, side, msg, params = TUNABLE) {
  if (!isVec(msg.pos) || !isVec(msg.vel) || !isVec(msg.spin) || !msg.racket || !finite(msg.racket.x) || !finite(msg.racket.z)) return 'bad';
  const rules = g.rules;
  if (!(rules.phase === 'serving' || rules.phase === 'rally') || !canHit(rules, side)) return 'turn';
  if ((msg.type === 'serve') !== isServeHit(rules)) return 'turn';
  if (norm(msg.vel) > ONLINE.MAX_V) return 'speed';
  if (norm(msg.spin) > ONLINE.MAX_SPIN * 2 * Math.PI) return 'spin';
  const b = ballToLocal(g.ball, side);
  const radius = (isServeHit(rules) ? params.SERVE_HIT_RADIUS : params.HIT_RADIUS) + ONLINE.RACKET_TOL;
  if (Math.abs(b.pos.x - msg.racket.x) > radius || Math.abs(b.pos.z - msg.racket.z) > radius) return 'far';
  const p = g.ball.pos;
  if (Math.hypot(p.x - msg.pos.x, p.y - msg.pos.y, p.z - msg.pos.z) > ONLINE.BALL_TOL) return 'pos';
  return null;
}

export class Host {
  constructor(io, { code = '', params = TUNABLE } = {}) {
    this.io = io;
    this.code = code;
    this.params = params;
    this.reset();
  }

  reset() {
    this.phase = 'lobby';            // lobby → playing → over
    this.slots = { [-1]: null, [1]: null }; // { side, nick, token, conn(id|null), ready, rtt, away(ms|null) }
    this.startAt = null;             // 경기 시각 0 = 서버 시각 startAt (ms)
    this.firstServer = -1;
    this.game = null;
    this.sent = 0;                   // 보낸 득점 결과 수
    this.endT = null;                // 예정 결말 시각 (경기 시각 s)
    this.lobbySince = this.io.now();
    this.lastRacket = { [-1]: -Infinity, [1]: -Infinity };
  }

  // ── 저장·복원 (Durable Object가 잠들었다 깨어날 때) ──
  snapshot() {
    return {
      code: this.code, phase: this.phase, slots: this.slots, startAt: this.startAt, firstServer: this.firstServer,
      sent: this.sent, endT: this.endT, lobbySince: this.lobbySince,
      game: this.game && matchSnapshot(this.game),
    };
  }
  restore(s) {
    Object.assign(this, {
      code: s.code ?? this.code, phase: s.phase, slots: s.slots, startAt: s.startAt, firstServer: s.firstServer,
      sent: s.sent, endT: s.endT, lobbySince: s.lobbySince,
    });
    if (s.game) {
      this.game = restoreMatch(createMatch({ firstServer: this.firstServer, retoss: false }), s.game);
      this.game.results.length = 0;
      this.sent = 0; // 결과 기록은 저장하지 않는다 (점수는 rules에 있음)
    }
  }
  save() { this.io.save(this.snapshot()); }

  // ── 보조 ──
  sideOf(id) {
    for (const s of SIDES) if (this.slots[s]?.conn === id) return s;
    return 0;
  }
  send(side, msg) {
    const c = this.slots[side]?.conn;
    if (c) this.io.send(c, msg);
  }
  broadcast(msg) { for (const s of SIDES) this.send(s, msg); }
  players() {
    return SIDES.filter((s) => this.slots[s]).map((s) => {
      const p = this.slots[s];
      return { side: s, nick: p.nick, ready: p.ready, online: !!p.conn };
    });
  }
  lobby() { this.broadcast({ type: 'lobby', players: this.players() }); }
  fail(id, code) {
    this.io.send(id, { type: 'error', code });
    this.io.close(id, 4000, code);
  }
  matchT(now = this.io.now()) { return (now - this.startAt) / 1000; }

  // ── 입력 ──
  connect(id) { /* join 메시지를 기다린다 */ }

  message(id, raw) {
    let msg = raw;
    if (typeof raw === 'string') {
      try { msg = JSON.parse(raw); } catch { return; }
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const now = this.io.now();
    if (msg.type === 'ping') { this.io.send(id, { type: 'pong', t0: msg.t0, t1: now, t2: this.io.now() }); return; }
    if (msg.type === 'join') { this.join(id, msg); return; }
    const side = this.sideOf(id);
    if (!side) return;
    switch (msg.type) {
      case 'leave': this.leave(id); break;
      case 'ready': this.ready(side, msg); break;
      case 'toss': this.toss(side, msg); break;
      case 'serve': case 'hit': this.hit(side, msg); break;
      case 'racket': this.racket(side, msg); break;
      default: break;
    }
  }

  join(id, msg) {
    if (this.sideOf(id)) return;
    if (msg.version !== VERSION) { this.fail(id, 'version'); return; }
    // 재접속: 토큰이 맞는 자리로 돌아온다
    if (typeof msg.token === 'string' && msg.token) {
      for (const s of SIDES) {
        const p = this.slots[s];
        if (p && p.token === msg.token) {
          if (p.conn) this.io.close(p.conn, 4001, 'replaced');
          p.conn = id;
          const back = p.away !== null;
          p.away = null;
          p.ready = this.phase === 'playing' ? false : p.ready;
          this.io.send(id, { type: 'joined', you: s, token: p.token, code: this.code, players: this.players(), resume: this.phase === 'playing' });
          if (back) this.send(-s, { type: 'opp', state: 'back' });
          this.lobby();
          this.save();
          this.schedule();
          return;
        }
      }
    }
    if (this.phase !== 'lobby') { this.fail(id, this.phase === 'over' ? 'noRoom' : 'full'); return; }
    const taken = SIDES.filter((s) => this.slots[s]);
    if (taken.length >= 2) { this.fail(id, 'full'); return; }
    if (msg.create && taken.length) { this.fail(id, 'inUse'); return; }
    if (!msg.create && !taken.length) { this.fail(id, 'noRoom'); return; }
    const s = this.slots[-1] ? 1 : -1; // 방을 만든 사람이 −1 쪽
    if (!taken.length) this.lobbySince = this.io.now();
    this.slots[s] = { side: s, nick: cleanNick(msg.nickname), token: makeToken(this.io.rng), conn: id, ready: false, rtt: null, away: null };
    this.io.send(id, { type: 'joined', you: s, token: this.slots[s].token, code: this.code, players: this.players(), resume: false });
    this.lobby();
    this.save();
    this.schedule();
  }

  ready(side, msg) {
    const p = this.slots[side];
    p.ready = true;
    p.rtt = finite(msg.rtt) ? msg.rtt : null;
    if (this.phase === 'playing') {
      // 재접속한 사람: 지금 경기 상태를 받아 이어서 진행
      this.send(side, {
        type: 'resume', startAt: this.startAt, firstServer: this.firstServer, players: this.players(),
        game: matchSnapshot(this.game), opp: this.slots[-side]?.away ? { state: 'away', until: this.slots[-side].away } : null,
      });
      return;
    }
    if (this.phase !== 'lobby') return;
    this.lobby();
    if (SIDES.every((s) => this.slots[s]?.ready && this.slots[s].conn)) this.start();
    else this.save();
  }

  start() {
    this.phase = 'playing';
    this.firstServer = this.io.rng() < 0.5 ? -1 : 1;
    this.startAt = this.io.now() + ONLINE.START_DELAY * 1000;
    this.game = createMatch({ firstServer: this.firstServer, retoss: false });
    this.sent = 0;
    this.endT = null;
    this.broadcast({ type: 'start', startAt: this.startAt, firstServer: this.firstServer, bestOf: this.game.rules.bestOf, players: this.players() });
    this.save();
    this.schedule();
  }

  // 시각 검사: 서버 시각 기준 과거 T_PAST ~ 미래 T_FUTURE, 그리고 이미 확정한 시각 이후
  timeOk(t) {
    if (!finite(t)) return false;
    const now = this.matchT();
    return t >= now - ONLINE.T_PAST && t <= now + ONLINE.T_FUTURE && t >= this.game.ball.t - DT / 2;
  }

  reject(side, msg, reason) {
    this.send(side, { type: 'reject', seq: msg.seq, t: msg.t, reason });
  }

  // 확정 상태에서 결과가 나오면 바로 알린다 (해당 순간의 규칙 상태·다음 서브 시각 포함)
  onResult(r, g) {
    this.sent = g.results.length;
    this.broadcast({
      type: 'point', kind: r.type, winner: r.winner, loser: r.loser, reason: r.reason, score: r.score,
      games: r.games ?? g.rules.games, rally: r.rally, t: r.t, gameOver: r.gameOver, matchOver: r.matchOver,
      nextAt: g.nextAt, rules: g.rules,
    });
    if (r.matchOver) this.finish(r.winner, 'normal');
    else this.save();
  }

  // 확정 상태를 t까지 진행 (결과는 바로 알림)
  commit(t) {
    if (this.phase !== 'playing') return;
    advanceMatch(this.game, t, this.params, (r, g) => { if (this.phase === 'playing') this.onResult(r, g); });
  }

  toss(side, msg) {
    if (this.phase !== 'playing') return;
    if (!this.timeOk(msg.t) || !finite(msg.x)) { this.reject(side, msg, finite(msg.x) ? 'time' : 'bad'); return; }
    if (this.slots[-side].away !== null) { this.reject(side, msg, 'away'); return; }
    const sim = cloneMatch(this.game);
    advanceMatch(sim, msg.t, this.params);
    const x = Math.max(-SERVE.TOSS_X_MAX, Math.min(SERVE.TOSS_X_MAX, msg.x));
    if (sim.results.length !== this.game.results.length || !startToss(sim, side, x, sim.ball.t)) { this.reject(side, msg, 'turn'); return; }
    this.commit(msg.t);
    startToss(this.game, side, x, this.game.ball.t);
    this.send(-side, { type: 'toss', seq: msg.seq, t: this.game.ball.t, x, side });
    this.endT = predictEnd(this.game, this.params).endT;
    this.schedule();
  }

  hit(side, msg) {
    if (this.phase !== 'playing') return;
    if (!this.timeOk(msg.t)) { this.reject(side, msg, 'time'); return; }
    const sim = cloneMatch(this.game);
    advanceMatch(sim, msg.t, this.params);
    const reason = sim.results.length !== this.game.results.length ? 'turn' : checkHitMsg(sim, side, msg, this.params);
    if (reason) { this.reject(side, msg, reason); return; }
    this.commit(msg.t);
    const shotType = typeof msg.shotType === 'string' ? msg.shotType.slice(0, 16) : 'drive';
    const e = applyHit(this.game, side, { vel: msg.vel, spin: msg.spin, shot: { shotType } }, this.params);
    this.send(-side, {
      type: msg.type, seq: msg.seq, t: e.t, pos: vec3(msg.pos), vel: vec3(msg.vel), spin: vec3(msg.spin), shotType,
      racket: { x: msg.racket.x, z: msg.racket.z }, side,
    });
    // 타격으로 바로 득점이 난 경우(발리·연속 타격 등)
    if (this.sent < this.game.results.length) {
      for (let i = this.sent; i < this.game.results.length; i++) this.onResult(this.game.results[i], this.game);
      if (this.phase !== 'playing') return;
    }
    // 다음 바운드 보정을 미리 계산해 양쪽에 보내고, 예정 결말 시각에 타이머를 건다
    const pred = predictEnd(this.game, this.params);
    for (const c of pred.corrects) this.broadcast({ type: 'correct', side, seq: msg.seq, ...c });
    this.endT = pred.endT;
    this.schedule();
  }

  racket(side, msg) {
    if (this.phase !== 'playing' || !finite(msg.t) || !finite(msg.x) || !finite(msg.z)) return;
    if (msg.t - this.lastRacket[side] < 0.5 / ONLINE.RACKET_HZ) return; // 너무 잦은 전송은 버린다
    this.lastRacket[side] = msg.t;
    this.send(-side, { type: 'racket', t: msg.t, x: msg.x, z: msg.z });
  }

  finish(winner, by) {
    this.phase = 'over';
    this.endT = null;
    this.lobbySince = this.io.now(); // 경기 끝난 방은 LOBBY_IDLE 뒤에 닫는다
    this.broadcast({ type: 'end', winner, score: this.game.rules.score, games: this.game.rules.games, by });
    this.save();
    this.schedule();
  }

  leave(id) {
    const side = this.sideOf(id);
    if (!side) return;
    if (this.phase === 'playing') {
      this.slots[side].conn = null;
      this.slots[side].away = this.io.now();
      this.finish(-side, 'forfeit'); // 경기 중 나가기 = 기권
    } else this.disconnect(id);
    this.io.close(id, 1000, 'leave');
    this.cleanupIfEmpty();
  }

  disconnect(id) {
    const side = this.sideOf(id);
    if (!side) return;
    const p = this.slots[side];
    p.conn = null;
    if (this.phase === 'lobby') {
      this.slots[side] = null;
      this.lobby();
    } else if (this.phase === 'playing') {
      p.away = this.io.now() + ONLINE.RECONNECT_WAIT * 1000;
      this.send(-side, { type: 'opp', state: 'away', until: p.away });
    }
    if (!this.cleanupIfEmpty()) {
      this.save();
      this.schedule();
    }
  }

  // 아무도 연결되어 있지 않으면 (대기실·경기 끝) 방을 지운다. 경기 중에는 재접속 대기 마감에 지운다.
  cleanupIfEmpty() {
    const anyone = SIDES.some((s) => this.slots[s]?.conn);
    if (anyone || this.phase === 'playing') return false;
    this.io.setTimer(null);
    this.io.clear();
    this.reset();
    return true;
  }

  // ── 타이머 ──
  deadlines() {
    const out = [];
    if (this.phase === 'playing') {
      const ph = this.game.rules.phase;
      if (this.endT !== null && (ph === 'serving' || ph === 'rally')) {
        out.push(this.startAt + (this.endT + ONLINE.GRACE + 2 * DT) * 1000);
      }
      for (const s of SIDES) if (this.slots[s]?.away) out.push(this.slots[s].away);
    } else out.push(this.lobbySince + ONLINE.LOBBY_IDLE * 1000); // 대기실·경기 끝: 오래 두면 닫는다
    return out;
  }
  schedule() {
    const d = this.deadlines();
    this.io.setTimer(d.length ? Math.min(...d) : null);
  }

  timer() {
    const now = this.io.now();
    if (this.phase === 'playing') {
      this.commit(this.matchT(now) - ONLINE.GRACE);
      if (this.phase === 'playing') {
        if (this.game.rules.phase !== 'serving' && this.game.rules.phase !== 'rally') this.endT = null;
        for (const s of SIDES) {
          const p = this.slots[s];
          if (p?.away && now >= p.away) {
            if (this.slots[-s]?.conn) { this.finish(-s, 'forfeit'); break; }
            // 둘 다 끊김: 방을 닫는다
            this.phase = 'over';
          }
        }
      }
    } else if (now >= this.lobbySince + ONLINE.LOBBY_IDLE * 1000) {
      for (const s of SIDES) if (this.slots[s]?.conn) this.io.close(this.slots[s].conn, 4002, 'idle');
      for (const s of SIDES) if (this.slots[s]) this.slots[s].conn = null;
    }
    if (!this.cleanupIfEmpty()) this.schedule();
  }
}
