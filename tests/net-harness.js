// 대전 테스트용 가상 세계: 가상 시계 + 인위적 지연 네트워크 + 가짜 Durable Object 저장소·WebSocket.
// 실제 server/room.js(Room)와 public/js/net.js(클라이언트)를 그대로 연결해 돌린다. (.test.js가 아니라 테스트 대상 아님)
import { Room } from '../server/room.js';
import { createOnlineClient } from '../public/js/net.js';
import { createAI } from '../public/js/ai.js';
import { createRng } from '../public/js/input.js';

// 가짜 Durable Object ctx (저장소는 Map, 알람은 시각만 기억)
export function createFakeCtx(store = new Map()) {
  const sockets = [];
  const ctx = {
    store,
    alarmAt: null,
    puts: 0,
    storage: {
      async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
      async put(k, v) { ctx.puts++; store.set(k, structuredClone(v)); },
      async deleteAll() { store.clear(); },
      async setAlarm(at) { ctx.alarmAt = at; },
      async deleteAlarm() { ctx.alarmAt = null; },
    },
    acceptWebSocket(ws) { sockets.push(ws); },
    getWebSockets() { return sockets.filter((w) => !w.closed); },
    blockConcurrencyWhile(fn) { return fn(); },
  };
  return ctx;
}

// latency: 클라이언트별 편도 지연 (ms) 또는 함수 (rng) → ms
export function createWorld({ seed = 1, start = 1_000_000 } = {}) {
  const w = {
    time: start,
    queue: [],
    n: 0,
    ctx: createFakeCtx(),
    clients: [],
    rng: createRng(seed),
  };
  w.room = new Room(w.ctx, { CLOCK: { now: () => w.time }, RNG: createRng(seed * 101 + 7) });
  w.at = (t, fn) => { w.queue.push({ t, n: w.n++, fn }); };

  // 소켓 한 쌍 (서버 쪽 ws는 Room에, 클라이언트 쪽은 net.js에)
  w.open = (lat) => {
    const delay = () => (typeof lat === 'function' ? lat(w.rng) : lat);
    // WebSocket(TCP)은 순서를 지킨다: 지연이 흔들려도 먼저 보낸 메시지가 먼저 도착한다
    let lastDown = 0, lastUp = 0;
    const down = () => (lastDown = Math.max(w.time + delay(), lastDown));
    const up = () => (lastUp = Math.max(w.time + delay(), lastUp));
    const server = {
      closed: false, att: null,
      serializeAttachment(a) { this.att = a; },
      deserializeAttachment() { return this.att; },
      send(str) { if (!this.closed) w.at(down(), () => { if (!client.closed) client.onmessage?.({ data: str }); }); },
      close() {
        if (this.closed) return;
        this.closed = true;
        w.at(w.time + delay(), () => { if (!client.closed) { client.closed = true; client.onclose?.({}); } });
      },
    };
    const client = {
      closed: false,
      send(str) { if (!this.closed) w.at(up(), () => { if (!server.closed) w.room.webSocketMessage(server, str); }); },
      close() {
        if (this.closed) return;
        this.closed = true;
        w.at(w.time + delay(), () => { if (!server.closed) { server.closed = true; w.room.webSocketClose(server, 1000); } });
        w.at(w.time, () => client.onclose?.({}));
      },
      // 네트워크가 끊긴 것처럼: 양쪽을 바로 닫는다
      drop() {
        this.closed = true; server.closed = true;
        w.at(w.time, () => w.room.webSocketClose(server, 1006));
        w.at(w.time, () => client.onclose?.({}));
      },
    };
    w.at(w.time + delay(), () => { w.room.accept(server, w.code); client.onopen?.(); });
    return client;
  };

  // AI 대전 클라이언트 하나: 편도 지연 lat, 내 시계 = 서버 시계 + clockOffset
  // hooks: net.js 훅을 더 붙일 때 (화면 흉내 등), rec.afterTick: 매 프레임 tick 뒤에 부른다
  w.addAI = ({ lat, clockOffset = 0, difficulty = 'NORMAL', nickname = 'AI', create = false, aiSeed = 1, hooks = {} }) => {
    const rec = { points: [], rejects: [], sockets: [] };
    const client = createOnlineClient({
      // rec.blocked: 네트워크가 끊긴 것처럼 새 연결이 열리지 않는다
      open: () => {
        const s = rec.blocked ? { send() {}, close() {} } : w.open(lat);
        rec.sockets.push(s);
        return s;
      },
      now: () => w.time + clockOffset,
      nickname, code: w.code, create, seed: aiSeed,
      makePlayer(side) {
        const ai = createAI(side, difficulty, createRng(aiSeed * 7 + 3));
        return { ai, player: ai.player };
      },
      hooks: {
        ...hooks,
        onServerResult: (r, matched) => rec.points.push({ ...r, matched }),
        onReject: (m) => rec.rejects.push(m),
        onOpp: (state) => { rec.opp = state; },
      },
    });
    rec.client = client;
    w.clients.push(rec);
    client.connect();
    return rec;
  };

  // 관전자 클라이언트 하나 (8단계): 선수와 같은 서버·같은 net.js, 입력 없음
  w.addSpectator = ({ lat, clockOffset = 0, nickname = '관전' } = {}) => {
    const rec = { points: [], rejects: [], sockets: [], errors: [] };
    const client = createOnlineClient({
      open: () => {
        const s = w.open(lat);
        rec.sockets.push(s);
        return s;
      },
      now: () => w.time + clockOffset,
      nickname, code: w.code, spectate: true, seed: 5,
      hooks: {
        onServerResult: (r, matched) => rec.points.push({ ...r, matched }),
        onError: (code) => rec.errors.push(code),
        onOpp: (state, until, side) => { rec.opp = { state, side }; },
      },
    });
    rec.client = client;
    w.clients.push(rec);
    client.connect();
    return rec;
  };

  // 가상 시간을 frameMs 간격으로 진행: 메시지 배달 → 알람 → 클라이언트 프레임
  w.run = (untilFn, { maxMs = 30 * 60 * 1000, frameMs = 1000 / 60 } = {}) => {
    const end = w.time + maxMs;
    while (w.time < end && !untilFn()) {
      w.time += frameMs;
      w.queue.sort((a, b) => a.t - b.t || a.n - b.n);
      while (w.queue.length && w.queue[0].t <= w.time) w.queue.shift().fn();
      if (w.ctx.alarmAt !== null && w.ctx.alarmAt <= w.time) { w.ctx.alarmAt = null; w.room.alarm(); }
      for (const c of w.clients) { c.client.tick(); c.afterTick?.(); }
    }
    return w.time < end;
  };
  return w;
}
