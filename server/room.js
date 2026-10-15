// Durable Object: 방 하나 = 객체 하나. 방 관리·검증·득점 판정은 public/shared/host.js(순수 클래스)가 하고,
// 여기서는 WebSocket Hibernation API·저장소·알람을 Host의 io로 연결하는 얇은 껍데기만 둔다.
// cloudflare:workers를 import하지 않는 일반 클래스라 Node 테스트에서 가짜 ctx로 직접 만들 수 있다.
import { Host } from '../public/shared/host.js';
import { ONLINE } from '../public/shared/constants.js';

// 이 방 서버가 있는 Cloudflare 데이터센터 코드 (예: NRT, ICN, LAX). 모르면 null
export async function whereAmI(fetchFn = fetch) {
  try {
    const res = await fetchFn(ONLINE.WHERE_URL, { signal: AbortSignal.timeout(ONLINE.WHERE_TIMEOUT) });
    const m = (await res.text()).match(/^colo=([A-Z0-9]+)$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const STORE_KEY = 'host';

export class Room {
  // env.CLOCK·env.RNG: 테스트용 가짜 시계 { now() }·난수 함수 (없으면 실제 시각·crypto 난수)
  constructor(ctx, env = {}) {
    this.ctx = ctx;
    this.env = env;
    const clock = env.CLOCK ?? Date;
    this.host = new Host({
      now: () => clock.now(),
      rng: env.RNG ?? (() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32),
      send: (id, msg) => {
        const ws = this.socket(id);
        try { ws?.send(JSON.stringify(msg)); } catch { /* 닫히는 중인 소켓 */ }
      },
      close: (id, code, reason) => {
        try { this.socket(id)?.close(code, reason); } catch { /* 이미 닫힘 */ }
      },
      setTimer: (at) => (at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at)),
      save: (snap) => ctx.storage.put(STORE_KEY, snap),
      clear: () => ctx.storage.deleteAll(),
    });
    // 잠들었다 깨어난 경우: 저장해 둔 방 상태를 되살린다 (메시지 처리 전에 끝나도록 막아 둔다)
    ctx.blockConcurrencyWhile(async () => {
      const snap = await ctx.storage.get(STORE_KEY);
      if (snap) this.host.restore(snap);
    });
  }

  // 소켓 ↔ id: id는 소켓 첨부(serializeAttachment)에 있어 잠들었다 깨어나도 남는다
  socket(id) {
    return this.ctx.getWebSockets().find((ws) => ws.deserializeAttachment()?.id === id) ?? null;
  }
  idOf(ws) { return ws.deserializeAttachment()?.id ?? null; }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket 전용 주소입니다.', { status: 426 });
    const code = new URL(request.url).pathname.split('/').pop();
    // 방 서버 위치를 한 번 알아 둔다 (입장 응답 joined에 실어 보내 화면에 표시: 핑이 높을 때 원인 확인용)
    if (!this.whereTried) {
      this.whereTried = true;
      this.host.serverColo = await whereAmI();
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.accept(server, code);
    return new Response(null, { status: 101, webSocket: client });
  }

  // 새 연결 (fetch와 테스트 공용)
  accept(ws, code) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ id: crypto.randomUUID() });
    if (code && !this.host.code) this.host.code = code;
    this.host.connect(this.idOf(ws));
  }

  webSocketMessage(ws, data) {
    this.host.message(this.idOf(ws), typeof data === 'string' ? data : new TextDecoder().decode(data));
  }

  webSocketClose(ws, code) {
    this.host.disconnect(this.idOf(ws));
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* 이미 닫힘 */ }
  }

  webSocketError(ws) {
    this.host.disconnect(this.idOf(ws));
  }

  alarm() {
    this.host.timer();
  }
}
