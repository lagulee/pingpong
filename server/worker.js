// Worker 진입점.
// 0단계: 정적 파일 제공만 한다. WebSocket 업그레이드와 방 라우팅은 5단계에서 추가한다.
export { Room } from './room.js';

export default {
  async fetch(request, env) {
    // 정적 자산과 일치하지 않은 요청만 여기로 온다. 자산 처리기에 넘겨 404 등을 맡긴다.
    return env.ASSETS.fetch(request);
  },
};
