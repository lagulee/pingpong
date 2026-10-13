// main.js — 게임 진입점. 0단계: 탁구대 장면만 그린다.
import { createRenderer } from './render.js';

const canvas = document.getElementById('game');
const view = createRenderer(canvas);

window.addEventListener('resize', view.resize);

function frame() {
  view.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.getElementById('status').textContent = '0단계: 탁구대 장면';
