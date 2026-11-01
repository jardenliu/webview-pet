/**
 * webview-pet multi-pet demo — two pets, cross-pet collision, status linkage.
 *
 * Run (after `bun run build`):
 *   bun examples/multi.mjs     (or: node examples/multi.mjs)
 */
import { PetApp } from '../dist/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, 'assets');

const app = new PetApp({ physics: { petCollision: true } });

function makePet(id, name, corner) {
  return app.createPet({
    id,
    name,
    size: 360,
    assetsDir,
    animations: {
      idle: ['待机呼吸'],
      turn: ['东张西望'],
      drag: ['被拖拽'],
      clicks: ['点击开心'],
      moves: {
        default: { minDist: 80, maxDist: 220, margin: 20, leadSec: 0.5, tailSec: 0.5 },
        actions: [{ name: '走路' }],
      },
      categories: [{ id: '小动作', weight: 25, actions: ['哼歌摇摆', '伸懒腰', '思考冒泡'] }],
      events: {
        status: [['思考冒泡'], ['走路'], ['哼歌摇摆'], ['伸懒腰'], ['点击开心'], ['垂头叹气']],
      },
      sleep: [{ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] }],
    },
    animationWeights: { idle: 50, turn: 10, move: 15 },
    position: { corner, marginX: 28, marginY: 28 },
    clickSound: true,
  });
}

const alpha = makePet('alpha', '小蓝', 'bottom-left');
const beta = makePet('beta', '小紫', 'bottom-right');

for (const pet of [alpha, beta]) {
  pet.on('click', () => pet.say('嘿！', { duration: 2000 }));
  pet.on('throw-end', ({ reason }) => console.log(`[${pet.id}] throw-end`, reason));
  pet.on('pose', () => {});
}

await app.start();
console.log('[multi] two pets on screen — throw one into the other!');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Scripted: put one pet to work, then throw the other across the screen.
await wait(2000);
alpha.setStatus(1, '写代码中…');
beta.say('我也想玩……', { duration: 3000 });

await wait(4000);
console.log('[multi] throwing beta toward alpha');
beta.moveTo(0.28, 0.55, { mode: 'instant' });
await wait(800);
beta.throwAt(200, 1.6);

await wait(5000);
alpha.clearStatus();
alpha.say('别撞我！', { duration: 2500 });

process.on('SIGINT', () => {
  console.log('\n[multi] bye');
  app.quit();
  process.exit(0);
});
