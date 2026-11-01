# 快速开始

## 安装

```bash
npm install webview-pet
# 或
bun add webview-pet
```

`@webviewjs/webview` 作为依赖自动安装（原生 NAPI，Windows / macOS / Linux 预编译）。运行时需要 **Node.js ≥ 20** 或 **Bun ≥ 1.3**。

::: tip 仅支持 ESM
请使用 `import` 导入（包内含 `"type": "module"`）。CommonJS 项目可用动态 `import()`。
:::

## 准备动画素材

宠物的每一个动作都是一段 **VP9-alpha webm**（带透明通道），放在一个目录里，文件名（不含扩展名）即动画名：

```
assets/animation/
├── 待机呼吸.webm
├── 东张西望.webm
├── 被拖拽.webm
├── 点击开心.webm
├── 走路.webm
├── 睡觉-开始.webm
├── 睡觉-循环.webm
└── 睡觉-起来.webm
```

::: details 没有素材？仓库里有演示素材
[`examples/assets/`](https://github.com/jardenliu/webview-pet/tree/main/examples/assets) 里有一套完整的演示动画（含睡觉三件套），克隆仓库即可试用。
:::

## 创建一只宠物

```ts
import { PetApp } from 'webview-pet';

const app = new PetApp();

const pet = app.createPet({
  id: 'bean',                        // 唯一 id
  name: '小蓝豆',
  size: 420,                         // 画框宽（16:9 画布）
  assetsDir: './assets/animation',
  animations: {
    idle: ['待机呼吸'],              // 待机动画池
    turn: ['东张西望'],              // 转向动画（播完自动换朝向）
    drag: ['被拖拽'],                // 被拖着时播放
    clicks: ['点击开心'],            // 点击反馈
    moves: {
      default: { minDist: 80, maxDist: 260, margin: 24, leadSec: 0.6, tailSec: 0.6 },
      actions: [{ name: '走路' }],
    },
    categories: [
      { id: '小动作', weight: 30, actions: ['哼歌摇摆', '伸懒腰'] },
    ],
    events: {
      whisper: ['哼歌摇摆'],         // say({ anim: true }) 时联动播放
      status: [['思考冒泡'], ['走路'], ['哼歌摇摆']],  // setStatus(level) 按档位取
    },
    sleep: [{ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] }],
  },
  animationWeights: { idle: 45, turn: 10, move: 15 }, // 剩余概率给 categories
  position: { corner: 'bottom-right', marginX: 32, marginY: 32 },
  clickSound: true,
});

await app.start();
```

`app.start()` 之后宠物窗口就会出现在屏幕上，开始按随机链播动画。

## 一切能力皆函数

```ts
// 说话
pet.say('你好呀~', { duration: 4000 });

// 播放指定动画，拿到播放句柄
pet.play('伸懒腰').done.then((status) => console.log('播放结束:', status));

// 移动到屏幕归一化坐标 (x, y) ∈ [0, 1]
pet.moveTo(0.5, 0.4, { mode: 'spring' });   // instant | spring | line

// 以 angle° 方向、power 力度抛出去
pet.throwAt(60, 1.2);

// 睡觉 / 叫醒
pet.sleep();
pet.wake();
```

完整 API 见 [Pet](/api/pet) 与 [PetApp](/api/petapp)。

## 多宠物

```ts
const bean = app.createPet({ id: 'bean', /* ... */ });
const mochi = app.createPet({ id: 'mochi', /* ... */ });

await app.start();          // 一次 start，全部窗口一起亮
app.getPets();              // [bean, mochi]
app.removePet('mochi');     // 移除
```

多宠物默认开启跨宠碰撞（动量守恒），可在 `physics.petCollision` 关闭。

## 优雅退出

```ts
process.on('SIGINT', () => {
  app.quit();
  process.exit(0);
});
```

`app.quit()` 关闭全部窗口并退出。若希望关窗后进程继续存活，用 `new PetApp({ keepAliveAfterClose: true })`。
