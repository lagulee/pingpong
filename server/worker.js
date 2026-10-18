// Worker 진입점: /api/new(방 코드 발급), /ws/:roomCode(WebSocket → 방 Durable Object), 그 외는 정적 자산(public/).
import { makeCode, validCode } from '../public/shared/host.js';
import { ONLINE } from '../public/shared/constants.js';

export { Room } from './room.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// 방 코드 → 방 Durable Object. 처음 만들 때만 위치가 정해진다(이미 있는 방은 옮겨지지 않음).
// 힌트가 없으면 방장의 첫 접속이 들어온 접속 지점 근처. 런타임이 모르는 힌트는 get()이 오류를 내므로 다음 힌트, 마지막에는 힌트 없이.
export function roomStub(env, code, hints = ONLINE.LOCATION_HINTS) {
  const id = env.ROOM.idFromName(code);
  for (const locationHint of hints) {
    try { return env.ROOM.get(id, { locationHint }); } catch { /* 다음 힌트 */ }
  }
  return env.ROOM.get(id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/new') return json({ code: makeCode(rng) });
    // 내가 접속한 Cloudflare 접속 지점 (핑 진단용 화면 표시)
    if (url.pathname === '/api/where') return json({ colo: request.cf?.colo ?? null, country: request.cf?.country ?? null });
    const m = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!validCode(code)) return json({ error: 'noRoom' }, 404);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade' }, 426);
      try {
        const stub = roomStub(env, code);
        return await stub.fetch(new Request(`${url.origin}/ws/${code}`, request));
      } catch {
        // 무료 한도 초과 등: 과금 없이 오류가 난다 → 클라이언트는 "잠시 후 다시 시도" 안내
        return json({ error: 'limit' }, 503);
      }
    }
    // 정적 자산과 일치하지 않은 요청만 여기로 온다. 자산 처리기에 넘겨 404 등을 맡긴다.
    return env.ASSETS.fetch(request);
  },
};
