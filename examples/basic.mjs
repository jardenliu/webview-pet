/**
 * webview-pet basic demo — one pet, full capability tour.
 *
 * Run (after `bun run build`):
 *   bun examples/basic.mjs     (or: node examples/basic.mjs)
 *
 * Interact: drag it around (throw it!), right-click for the menu, click it.
 * The scripted timeline below exercises the function API every few seconds.
 */
import { PetApp } from '../dist/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, 'assets');

const app = new PetApp({
  physics: { gravity: 1400, restitution: 0.78 },
  taskbarWatchdog: true,
});

const pet = app.createPet({
  id: 'bean',
  name: '小蓝豆',
  size: 420,
  assetsDir,
  animations: {
    idle: ['待机呼吸'],
    turn: ['东张西望'],
    drag: ['被拖拽'],
    clicks: ['点击开心'],
    moves: {
      default: { minDist: 80, maxDist: 260, margin: 24, leadSec: 0.6, tailSec: 0.6 },
      actions: [{ name: '走路' }],
    },
    categories: [
      { id: '小动作', weight: 30, actions: ['哼歌摇摆', '伸懒腰'] },
      { id: '心情', weight: 15, actions: ['思考冒泡', '垂头叹气'] },
    ],
    events: {
      whisper: ['哼歌摇摆'],
      status: [['思考冒泡'], ['走路'], ['哼歌摇摆'], ['伸懒腰'], ['点击开心'], ['垂头叹气']],
    },
    sleep: [{ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] }],
  },
  animationWeights: { idle: 45, turn: 10, move: 15 },
  position: { corner: 'bottom-right', marginX: 32, marginY: 32 },
  clickSound: true,
  fixed: false,
  sleepTexts: {
    start: ['好困……我先睡一会儿。'],
    end: ['唔……我醒了。'],
    refuse: ['我在睡觉，别烦我……'],
  },
});

pet.on('click', ({ woke }) => {
  console.log('[event] click', woke ? '(woke the pet)' : '');
  if (!woke) pet.say(pick(['你好呀~', '别戳我啦', '找我有事吗？', '嘿嘿']), { duration: 3000 });
});

pet.on('drag-end', ({ vx, vy }) => {
  console.log('[event] drag-end', { vx: Math.round(vx), vy: Math.round(vy) });
});

pet.on('throw-end', ({ reason }) => console.log('[event] throw-end', reason));
pet.on('sleep-started', () => console.log('[event] sleep-started'));
pet.on('sleep-ended', () => console.log('[event] sleep-ended'));
pet.on('menu-click', ({ menuId }) => {
  console.log('[event] menu-click', menuId);
  pet.say(`你点了「${menuId}」`, { duration: 2500 });
});
pet.on('pose', (pose) => {
  // quiet: uncomment to watch movement telemetry
  // console.log('[event] pose', pose.x.toFixed(3), pose.y.toFixed(3), pose.facing);
});
void pet.on('pose', () => {});

pet.setMenuItems([
  { id: 'feed', label: '投喂小鱼干', group: '互动' },
  { id: 'pet', label: '摸摸头', group: '互动' },
]);

await app.start();
console.log('[demo] pet started — try dragging / right-clicking / clicking it');

// ── Scripted tour of the function API ────────────────────────────────────────

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function tour() {
  await wait(1500);
  pet.say('你好呀~ 我是小蓝豆！', { duration: 4000 });

  await wait(4500);
  console.log('[demo] play()');
  const playback = pet.play('伸懒腰');
  playback.done.then((status) => console.log('[demo] playback done:', status));

  await wait(3000);
  console.log('[demo] setStatus()');
  pet.setStatus(0, '思考中…');

  await wait(3000);
  console.log('[demo] moveTo()');
  pet.moveTo(0.5, 0.35, { mode: 'spring' });

  await wait(2500);
  console.log('[demo] throwAt()');
  pet.throwAt(60, 1.2);

  await wait(3500);
  console.log('[demo] setStatus(terminal)');
  pet.setStatus(4, '完成！', { terminal: true });

  await wait(3500);
  console.log('[demo] lock()');
  const lock = pet.acquireLock({ ttl: 4000 });
  pet.say('我被锁住啦，随便拖我试试（拖走 = 抢锁）', { duration: 3500 });

  await wait(4500);
  if (lock.active) lock.release();
  pet.clearStatus();

  await wait(1000);
  console.log('[demo] sleep()');
  const r = pet.sleep();
  console.log('[demo] sleep result:', r);

  await wait(6000);
  console.log('[demo] wake()');
  pet.wake();

  await wait(3000);
  pet.say('函数 API 巡演结束，随便玩吧！', { duration: 5000 });
  console.log('[demo] tour complete — the pet keeps idling; Ctrl+C to quit');
}

tour();

process.on('SIGINT', () => {
  console.log('\n[demo] bye');
  app.quit();
  process.exit(0);
});

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
