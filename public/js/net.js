// net.js — 대전 클라이언트 (network.md)
// 연결·입장·시계 동기화(NTP) → 경기: 내 쪽 타격은 바로 내 화면에 적용하고 서버로 보낸다.
// 상대 타격(toss·serve·hit)은 받은 시각으로 되감아 적용한 뒤 지금까지 다시 계산한다(물리가 결정론적).
// 득점은 서버 point가 기준이다: 내 화면의 판정은 잠정(tentative)이고, 서버 결과가 다르면 정정한다.
// 이 파일은 'three'·DOM을 쓰지 않는다. 소켓·시계·플레이어는 인자로 받아 Node 테스트에서도 그대로 돌린다.
import { PHYSICS, TUNABLE, ONLINE, VERSION, FEEL } from '../shared/constants.js';
import { toLocal } from '../shared/physics.js';
import { applyHit } from '../shared/match.js';
import { canHit, bouncedOn, toServe } from '../shared/rules.js';
import { matchSnapshot, restoreMatch } from '../shared/host.js';
import { createRally, stepMatch, replayStep, tossBall, holdServe, incoming, createPlayer } from './ai.js';
import { racketPointAt, pruneSamples, createRng } from './input.js';

const DT = PHYSICS.DT;
const vec3 = (v) => ({ x: v.x, y: v.y, z: v.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ── 시계 동기화 (NTP 방식) ───────────────────────────────────
// t0 클라이언트 송신, t1 서버 수신, t2 서버 송신, t3 클라이언트 수신 (ms)
// offset = ((t1 − t0) + (t2 − t3)) / 2 → 서버 시각 ≈ 내 시각 + offset, rtt = (t3 − t0) − (t2 − t1)
export function clockSample(t0, t1, t2, t3) {
  return { offset: ((t1 - t0) + (t2 - t3)) / 2, rtt: (t3 - t0) - (t2 - t1) };
}

// 최근 keep개 표본 중 왕복 시간이 가장 짧은 표본의 offset을 쓴다 (대기열 지연이 가장 적게 섞인 표본)
export function createClockSync(keep = ONLINE.SYNC_SAMPLES) {
  const samples = [];
  let last = null;
  const best = () => samples.reduce((a, s) => (!a || s.rtt < a.rtt ? s : a), null);
  return {
    add(s) {
      samples.push(s);
      last = s;
      if (samples.length > keep) samples.shift();
    },
    get count() { return samples.length; },
    get offset() { return best()?.offset ?? 0; },
    get rtt() { return best()?.rtt ?? null; },
    get lastRtt() { return last?.rtt ?? null; },
    clear() { samples.length = 0; last = null; },
  };
}

// ── 화면 합류: 공만 늦게 보여 주는 시간(lag, s) ───────────────────
// 상대 타격 도착: 그 타격 순간(lag = 지금 − 타격 시각)부터 MERGE_TIME에 걸쳐 빨리 감아 lag 0으로 합류한다.
// 상대 타격을 기다리는 중(공이 상대 도달 범위 안): 화면의 공 시계를 HOLD_RATE 배속으로 늦춘다(최대 HOLD_MAX).
// 기다림이 타격 없이 끝나면(상대가 놓침) 그때의 lag에서 같은 방식으로 합류한다.
export function mergeLag(L, since, mergeTime = ONLINE.MERGE_TIME) {
  return since >= mergeTime ? 0 : L * (1 - since / mergeTime);
}

export function createBallLag(p = ONLINE) {
  let lag = 0, merge = null;
  return {
    get lag() { return lag; },
    get merging() { return !!merge; },
    reset() { lag = 0; merge = null; },
    start(L) {
      merge = { L: Math.max(0, Math.min(L, FEEL.VIEW_LAG_MAX)), since: 0 };
      lag = merge.L;
    },
    // 실제 경과 시간 dt, holding: 상대 타격을 기다리는 중인가
    advance(dt, holding) {
      if (merge) {
        merge.since += dt;
        lag = mergeLag(merge.L, merge.since, p.MERGE_TIME);
        if (merge.since >= p.MERGE_TIME) merge = null;
      } else if (holding) {
        lag = Math.min(p.HOLD_MAX, lag + dt * (1 - p.HOLD_RATE));
      } else if (lag > 0) {
        merge = { L: lag, since: 0 };
      }
      return lag;
    },
  };
}

// ── 대전 클라이언트 ──────────────────────────────────────────
// opts:
//   open() → 소켓 { send(str), close(), onopen, onmessage({data}), onclose, onerror } (브라우저 WebSocket 그대로)
//   now() → 내 시각 (ms)
//   nickname, code, create(방 만들기)
//   makePlayer(side) → { player, ai? }  내 자리가 정해지면 내 플레이어(사람: 마우스 샘플, 로봇: createAI)를 만든다
//   seed: 판정 오차 난수 시드, params: TUNABLE (대전 중에는 바꾸지 않는다)
//   hooks: onStatus(status), onLobby(players), onStart(), onStep(events, replay), onRewind(t),
//          onRemote(msg, lag), onServerResult(result, matched), onReject(msg), onOpp(state, untilMs),
//          onEnd(msg), onError(code), onConnection(connected)
export function createOnlineClient(opts) {
  const params = opts.params ?? TUNABLE;
  const hooks = opts.hooks ?? {};
  const now = opts.now;
  const sync = createClockSync();

  const c = {
    status: 'connecting',    // connecting → syncing → waiting(준비 보냄) → playing → over | error
    me: 0, token: null, code: opts.code ?? '', players: [],
    startAt: null, game: null, ai: null,
    serverRules: null,       // 서버가 마지막으로 확정한 규칙 상태 (점수판은 이것만 보여 준다)
    oppAway: null,           // 상대 재접속 마감 (내 시각 ms) 또는 null
    connected: false, errorCode: null, endMsg: null,
    stats: { rejects: 0, corrected: 0, confirmed: 0, corrections: 0, rewinds: 0, remote: 0 },
    sync,
    get ping() { return sync.lastRtt; },
  };

  let socket = null;
  let left = false;
  let seq = 0;
  let lastHit = null;          // 지금 날아가는 공을 친 타격 { side, seq } (보정 대상 확인용)
  let sentToss = null, tossSeq = -1;
  let snaps = [];              // 되감기용 경기 상태 { t, s }
  let remoteQueue = [];        // 아직 그 시각이 오지 않은 상대 타격
  let pending = [];            // 바운드 보정(correct)
  let seen = 0;                // 확인한 결과 수
  let replaying = false;
  let lastPingAt = -Infinity, lastRacketT = -Infinity;
  let lostAt = null, retryAt = null, resyncing = false;

  const setStatus = (s) => { c.status = s; hooks.onStatus?.(s); };
  const send = (msg) => {
    if (!socket || !c.connected) return;
    try { socket.send(JSON.stringify(msg)); } catch { /* 연결이 끊기는 중 */ }
  };
  const sendPing = () => { lastPingAt = now(); send({ type: 'ping', t0: lastPingAt }); };
  c.matchTime = (ms = now()) => (ms + sync.offset - c.startAt) / 1000;
  c.serverToLocal = (ms) => ms - sync.offset;

  function connect() {
    socket = opts.open();
    socket.onopen = () => {
      c.connected = true;
      hooks.onConnection?.(true);
      send({ type: 'join', nickname: opts.nickname, version: VERSION, create: !!opts.create && !c.token, token: c.token });
    };
    socket.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      onMessage(msg);
    };
    socket.onclose = () => onClose();
    socket.onerror = () => { /* onclose가 뒤따른다 */ };
  }

  function onClose() {
    const was = c.connected;
    c.connected = false;
    socket = null;
    if (was) hooks.onConnection?.(false);
    if (left || c.status === 'error' || c.status === 'over') return;
    if (c.status === 'playing' && c.token) {
      // 경기 중 끊김: RECONNECT_RETRY마다 다시 접속, RECONNECT_WAIT가 지나면 포기
      if (lostAt === null) lostAt = now();
      retryAt = now() + ONLINE.RECONNECT_RETRY * 1000;
      return;
    }
    fail(was ? 'lost' : 'limit'); // 처음부터 연결이 안 됨 = 서버 오류·무료 한도 초과 등
  }

  function fail(code) {
    c.errorCode = code;
    setStatus('error');
    hooks.onError?.(code);
  }

  // ── 경기 상태 기억·되감기 ──
  function remember() {
    const g = c.game;
    snaps.push({ t: g.ball.t, s: { ...matchSnapshot(g), tossAt: g.tossAt, lastHit, sentToss } });
    const keep = g.ball.t - ONLINE.SNAP_TIME;
    let k = 0;
    while (k < snaps.length - 1 && snaps[k].t < keep) k++;
    if (k) snaps.splice(0, k);
  }
  function findSnap(t) {
    for (let i = snaps.length - 1; i >= 0; i--) if (Math.abs(snaps[i].t - t) < DT / 2) return snaps[i];
    return null;
  }
  function restore(entry) {
    const g = c.game;
    restoreMatch(g, entry.s);
    g.results.length = Math.min(g.results.length, entry.s.resultsLen);
    seen = Math.min(seen, g.results.length);
    g.tossAt = entry.s.tossAt;
    lastHit = entry.s.lastHit;
    sentToss = entry.s.sentToss;
    snaps = snaps.filter((x) => x.t < entry.t - DT / 2);
    c.stats.rewinds++;
    hooks.onRewind?.(entry.t);
  }
  function replayTo(target) {
    const was = replaying;
    replaying = true;
    while (c.game.ball.t < target - DT / 2) {
      remember();
      afterStep(replayStep(c.game, DT, params), true);
    }
    replaying = was;
  }

  // ── 경기 진행 ──
  function makeGame(firstServer) {
    const made = opts.makePlayer(c.me);
    c.ai = made.ai ?? null;
    const players = { [c.me]: made.player, [-c.me]: createPlayer(-c.me) };
    c.game = createRally({
      players, ais: c.ai ? [c.ai] : [], rng: createRng(opts.seed ?? 1), firstServer, local: [c.me], retoss: false,
    });
    snaps = []; remoteQueue = []; pending = []; seen = 0; lastHit = null; sentToss = null;
    c.serverRules = c.game.rules;
  }

  function liveStep() {
    const g = c.game;
    while (remoteQueue.length && remoteQueue[0].t <= g.ball.t + DT / 2) applyRemote(remoteQueue.shift());
    remember();
    afterStep(stepMatch(g, DT, params), false);
  }

  function afterStep(events, replay) {
    const g = c.game;
    if (!replay) {
      // 내 토스·타격을 서버로 보낸다
      if (g.lastToss && g.lastToss !== sentToss && g.lastToss.side === c.me) {
        sentToss = g.lastToss;
        tossSeq = ++seq;
        lastHit = { side: c.me, seq: tossSeq };
        send({ type: 'toss', seq: tossSeq, t: g.lastToss.t, x: g.lastToss.x });
      }
      for (const e of events) {
        if (e.type !== 'racket' || e.side !== c.me || !e.shot) continue;
        const p = g.players[c.me];
        const loc = toLocal(e.pos, c.me);
        const r = racketPointAt(p.samples, e.t) ?? { x: loc.x, y: loc.z };
        lastHit = { side: c.me, seq: ++seq };
        send({
          type: e.shot.quality?.serve ? 'serve' : 'hit', seq, t: e.t, pos: vec3(e.pos),
          vel: vec3(e.shot.vel), spin: vec3(e.shot.spin), shotType: e.shot.shotType, racket: { x: r.x, z: r.y },
        });
      }
    }
    applyCorrections();
    for (; seen < g.results.length; seen++) {
      const r = g.results[seen];
      if (!r.server) r.tentative = true; // 내 화면의 판정: 서버 point가 오면 확정·정정
    }
    hooks.onStep?.(events, replay);
  }

  // 상대 토스·타격을 지금 상태(시각 = 그 타격 시각)에 적용
  function applyRemote(msg) {
    const g = c.game;
    const opp = -c.me;
    c.stats.remote++;
    if (msg.type === 'toss') {
      tossBall(g, opp, msg.x, g.ball.t, params);
      lastHit = { side: opp, seq: msg.seq };
      afterStep([], true);
      return;
    }
    const shot = { shotType: msg.shotType, quality: { remote: true } };
    const e = applyHit(g, opp, { vel: msg.vel, spin: msg.spin, shot }, params);
    g.players[opp].lastShot = shot;
    g.lastShot = { side: opp, ...shot };
    lastHit = { side: opp, seq: msg.seq };
    incoming(g, c.me, g.ball.t, params);
    afterStep([e], true);
  }

  function onRemote(msg) {
    const g = c.game;
    if (!g) return;
    if (msg.t > g.ball.t + DT / 2) {
      remoteQueue.push(msg);
      remoteQueue.sort((a, b) => a.t - b.t);
      return;
    }
    const target = g.ball.t;
    const entry = findSnap(msg.t);
    if (entry) restore(entry);
    applyRemote(msg); // 기억 범위보다 늦게 왔으면 지금 상태에 바로 적용한다 (서버 보정이 맞춰 준다)
    replayTo(target);
    hooks.onRemote?.(msg, Math.max(0, target - msg.t));
  }

  // 바운드 보정: 서버가 계산한 바운드 직후 공 상태와 내 공이 CORRECT_EPS보다 다르면 바꾼다
  function applyCorrections() {
    const g = c.game;
    for (let i = 0; i < pending.length; i++) {
      const k = pending[i];
      if (!lastHit || k.side !== lastHit.side || k.seq !== lastHit.seq) { pending.splice(i--, 1); continue; }
      if (k.t > g.ball.t + DT / 2) continue;
      pending.splice(i--, 1);
      if (Math.abs(k.t - g.ball.t) < DT / 2) {
        if (dist(g.ball.pos, k.pos) > ONLINE.CORRECT_EPS) {
          Object.assign(g.ball, { pos: vec3(k.pos), vel: vec3(k.vel), spin: vec3(k.spin) });
          c.stats.corrections++;
        }
      } else if (!replaying) {
        const entry = findSnap(k.t);
        if (!entry || dist(entry.s.ball.pos, k.pos) <= ONLINE.CORRECT_EPS) continue;
        const target = g.ball.t;
        restore(entry);
        Object.assign(g.ball, { pos: vec3(k.pos), vel: vec3(k.vel), spin: vec3(k.spin) });
        c.stats.corrections++;
        replayTo(target);
        return;
      }
    }
  }

  // 서버 득점 판정: 규칙 상태를 그대로 받아들인다
  function onPoint(msg) {
    const g = c.game;
    if (!g) return;
    const r = {
      type: msg.kind, winner: msg.winner, loser: msg.loser, reason: msg.reason, score: msg.score, games: msg.games,
      rally: msg.rally, t: msg.t, gameOver: msg.gameOver, matchOver: msg.matchOver, practice: false, server: true,
    };
    let local = null;
    for (let i = g.results.length - 1; i >= 0; i--) {
      const x = g.results[i];
      if (x.server || x.settled) break;
      if (x.tentative) { local = x; break; }
    }
    const matched = !!local && local.type === r.type && local.winner === r.winner && local.reason === r.reason;
    if (local) local.settled = true;
    if (matched) {
      local.confirmed = true;
      Object.assign(local, { score: r.score, games: r.games, matchOver: r.matchOver, gameOver: r.gameOver });
      c.stats.confirmed++;
    } else {
      if (local) { local.overruled = true; r.corrected = true; c.stats.corrected++; }
      g.results.push(r);
    }
    g.rules = msg.rules;
    g.nextAt = msg.nextAt;
    c.serverRules = msg.rules;
    snaps = []; // 서버가 확정한 시각 이전으로는 되감지 않는다
    pending = [];
    hooks.onServerResult?.(matched ? local : r, matched);
  }

  function onReject(msg) {
    c.stats.rejects++;
    const g = c.game;
    if (g && msg.seq === tossSeq && g.rules.phase === 'serving' && g.rules.lastHitter === 0) {
      // 토스 거부(상대 대기 중 등): 다시 공을 들고 기다린다
      g.rules = toServe(g.rules);
      holdServe(g, g.ball.t, params);
    } else if (g && lastHit && lastHit.side === c.me && lastHit.seq === msg.seq) {
      const entry = findSnap(msg.t);
      if (entry) {
        const target = g.ball.t;
        restore(entry);
        replayTo(target);
      }
    }
    hooks.onReject?.(msg);
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'joined':
        c.me = msg.you;
        c.token = msg.token;
        c.code = msg.code;
        c.players = msg.players;
        resyncing = !!msg.resume;
        lostAt = null; retryAt = null;
        sync.clear();
        if (!resyncing) setStatus('syncing');
        hooks.onLobby?.(c.players);
        sendPing();
        break;
      case 'lobby':
        c.players = msg.players;
        hooks.onLobby?.(c.players);
        break;
      case 'pong':
        sync.add(clockSample(msg.t0, msg.t1, msg.t2, now()));
        if ((c.status === 'syncing' || resyncing) && sync.count < ONLINE.SYNC_SAMPLES) sendPing();
        else if (c.status === 'syncing' || resyncing) {
          if (!resyncing) setStatus('waiting');
          resyncing = false;
          send({ type: 'ready', rtt: sync.rtt });
        }
        break;
      case 'start':
        c.startAt = msg.startAt;
        c.players = msg.players;
        makeGame(msg.firstServer);
        setStatus('playing');
        hooks.onStart?.();
        break;
      case 'resume':
        c.startAt = msg.startAt;
        c.players = msg.players;
        makeGame(msg.firstServer);
        restoreMatch(c.game, msg.game);
        c.serverRules = c.game.rules;
        c.oppAway = msg.opp ? c.serverToLocal(msg.opp.until) : null;
        setStatus('playing');
        hooks.onStart?.();
        break;
      case 'toss': case 'serve': case 'hit':
        onRemote(msg);
        break;
      case 'correct':
        pending.push(msg);
        if (c.game) applyCorrections();
        break;
      case 'reject':
        onReject(msg);
        break;
      case 'point':
        onPoint(msg);
        break;
      case 'racket': {
        const p = c.game?.players[-c.me];
        if (!p) break;
        const last = p.samples[p.samples.length - 1];
        if (last && msg.t <= last.t) break;
        p.samples.push({ t: msg.t, x: msg.x, y: msg.z, b: false });
        pruneSamples(p.samples, msg.t);
        break;
      }
      case 'opp':
        c.oppAway = msg.state === 'away' ? c.serverToLocal(msg.until) : null;
        hooks.onOpp?.(msg.state, c.oppAway);
        break;
      case 'end':
        c.endMsg = msg;
        setStatus('over');
        hooks.onEnd?.(msg);
        break;
      case 'error':
        fail(msg.code);
        break;
      default:
        break;
    }
  }

  // ── 바깥에서 부르는 함수 ──
  c.connect = () => { setStatus('connecting'); connect(); };

  // 프레임마다: 시계 재기·재접속·경기 진행(서버 시각까지)·라켓 위치 전송
  c.tick = (ms = now()) => {
    if (lostAt !== null && !c.connected) {
      if (ms - lostAt > ONLINE.RECONNECT_WAIT * 1000) { lostAt = null; fail('lost'); return; }
      if (ms >= retryAt && !socket) { retryAt = ms + ONLINE.RECONNECT_RETRY * 1000; connect(); }
    }
    if (c.connected && c.status === 'playing' && !resyncing && ms - lastPingAt > ONLINE.SYNC_INTERVAL * 1000) sendPing();
    const g = c.game;
    if (!g || (c.status !== 'playing' && c.status !== 'over') || resyncing) return;
    const target = c.matchTime(ms);
    for (let n = 0; g.ball.t < target - DT / 2 && n < ONLINE.MAX_CATCHUP_STEPS; n++) liveStep();
    if (c.status === 'playing' && g.ball.t - lastRacketT >= 1 / ONLINE.RACKET_HZ) {
      const last = g.players[c.me].samples[g.players[c.me].samples.length - 1];
      if (last) {
        lastRacketT = g.ball.t;
        send({ type: 'racket', t: g.ball.t, x: last.x, z: last.y });
      }
    }
  };

  // 내 서브 토스 (사람: 클릭)
  c.toss = (x) => {
    const g = c.game;
    if (!g || c.status !== 'playing' || c.oppAway !== null) return false;
    return tossBall(g, c.me, x, g.ball.t, params);
  };

  // 상대가 칠 차례인 공이 상대 도달 범위 안에 있는가 (화면: 상대 타격을 기다리며 공을 늦춘다)
  c.awaitingOpponent = () => {
    const g = c.game;
    if (!g) return false;
    const r = g.rules, opp = -c.me;
    if (!(r.phase === 'serving' || r.phase === 'rally') || !canHit(r, opp)) return false;
    const serve = r.phase === 'serving' && r.lastHitter === 0;
    if (!serve && !bouncedOn(r, opp)) return false;
    return toLocal(g.ball.pos, opp).y <= g.players[opp].yPlane + params.REACH_Y;
  };

  c.leave = () => {
    left = true;
    send({ type: 'leave' });
    try { socket?.close(); } catch { /* 이미 닫힘 */ }
  };

  return c;
}
