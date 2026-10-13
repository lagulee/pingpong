// Durable Object: 방 하나를 관리한다.
// 0단계: wrangler.jsonc의 등록(new_sqlite_classes)이 배포되도록 빈 클래스만 둔다. 실제 기능은 5단계에서 구현한다.
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch() {
    return new Response('대전 기능은 아직 준비 중입니다.', { status: 501 });
  }
}
