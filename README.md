<div align="center">

# webview-pet

**为任意 Node.js / Bun 项目快速接入桌面宠物（桌宠）能力**

Transparent always-on-top pet windows with webm alpha animation, drag &amp; throw
physics, speech bubbles, sleep, locks, menus and multi-pet support — all driven
by plain function calls. Powered by [`@webviewjs/webview`](https://www.npmjs.com/package/@webviewjs/webview)
(Tauri's tao/wry), no Electron.

</div>

---

## 特性

- 🫧 **气泡说话** — `pet.say()` 文字/配图气泡，自动排优先级、限时消失
- 🎬 **动画池播放** — VP9-alpha webm 双缓冲交叉淡入，待机/转向/拖拽/点击/漫游/事件/睡觉全链
- 🎲 **随机链** — 权重掷骰（待机/转向/走位/分类小动作），`fixed` 模式不乱跑
- 🖱️ **拖拽手感** — 过阻尼弹簧跟手、甩抛初速估算、弹弓（双击后拉）、落地 Q 弹
- 🚀 **抛掷物理** — 重力/反弹/摩擦/多屏边界/屏间穿越、`confineToScreen` 锁屏
- 💤 **睡觉状态机** — start/loop/end 三段式动画套件，睡着拒扰、点击叫醒
- 🔒 **占用锁** — 第三方独占控制，用户拖走即抢锁（用户优先）
- 📊 **状态联动** — 外部状态档位 → 对应动画 + 气泡（如「思考中/干活中/完成」）
- 🧩 **右键菜单** — 内置项 + 动作树 + 自定义菜单项（分组子菜单）
- 🐾 **多宠物** — 一宠一窗、跨宠碰撞（动量守恒）、托盘统一管理
- 🪟 **点击穿透** — 只有宠物身体响应鼠标，其余区域穿透到下层窗口
- 📦 **零 DSH / 零 Electron 依赖** — 纯函数 API，任何 Node.js ≥ 20 或 Bun 项目可调用

## 安装

```bash
npm install webview-pet
# 或
bun add webview-pet
```

> `@webviewjs/webview` 作为依赖自动安装（原生 NAPI，Windows/macOS/Linux 预编译），
> 请保持 npm 的 optional dependencies 机制可用。运行时 Node.js ≥ 20 或 Bun ≥ 1.3。
>
> **仅支持 ESM**：请使用 `import` 导入（`package.json` 含 `"type": "module"`），
> CommonJS 的 `require()` 不可用；CJS 项目可改用动态 `import()`。

## 快速开始

```ts
import { PetApp } from 'webview-pet';

const app = new PetApp();
const pet = app.createPet({
  id: 'bean',
  name: '小蓝豆',
  size: 420,                       // 画框宽（16:9 画布）
  assetsDir: './assets/animation', // <动画名>.webm 素材目录
  animations: {
    idle: ['待机呼吸'],
    turn: ['东张西望'],
    drag: ['被拖拽'],
    clicks: ['点击开心'],
    moves: {
      default: { minDist: 80, maxDist: 260, margin: 24, leadSec: 0.6, tailSec: 0.6 },
      actions: [{ name: '走路' }],
    },
    categories: [{ id: '小动作', weight: 30, actions: ['哼歌摇摆', '伸懒腰'] }],
    events: {
      whisper: ['哼歌摇摆'],
      status: [['思考冒泡'], ['走路'], ['哼歌摇摆'], ['伸懒腰'], ['点击开心'], ['垂头叹气']],
    },
    sleep: [{ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] }],
  },
  animationWeights: { idle: 45, turn: 10, move: 15 }, // 剩余概率给 categories
  position: { corner: 'bottom-right', marginX: 32, marginY: 32 },
  clickSound: true,
});

await app.start();

// 一切能力皆函数：
pet.say('你好呀~', { duration: 4000 });
pet.play('伸懒腰').done.then((status) => console.log('播放结束:', status));
pet.moveTo(0.5, 0.4, { mode: 'spring' });
pet.throwAt(60, 1.2);
pet.setStatus(1, '干活中…');
pet.sleep();
pet.wake();

pet.on('click', () => pet.say('别戳我啦', { duration: 2500 }));
```

运行完整示例（仓库内，含 12 个演示动画）：

```bash
bun run build
bun examples/basic.mjs    # 单宠全功能巡演
bun examples/multi.mjs    # 双宠 + 跨宠碰撞
```

## 素材格式

动画文件放在 `assetsDir` 下，**文件名（不含扩展名）= 动画池里的名字**：

- 画布 640×360（16:9），宠物脚底基线在 y=330
- 编码：**VP9 + alpha 透明 webm**（`ffmpeg -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0`）
- macOS 可另备同名 `.mov`（HEVC-alpha，Safari/WebKit 兼容）
- 想自己造素材？运行 `bun run scripts/make-demo-assets.ts` 看一个纯 ffmpeg 生成的示例

## 动画池结构

```ts
interface PetAnimations {
  idle: string[];                 // 待机池，随机链等概率抽
  turn?: string[];                // 转向池，播完自动翻转朝向（镜像）
  drag?: string[];                // 被拖拽时播
  clicks?: string[];              // 点击回应
  moves?: {                       // 漫游（带动真实位移）
    default: { minDist: number; maxDist: number; margin: number; leadSec: number; tailSec: number };
    actions: Array<{ name: string; params?: Partial<MoveSpec> }>;
  };
  categories?: Array<{            // 随机小动作分类（按 weight 加权）
    id: string; weight: number; noMirror?: boolean; actions: string[];
  }>;
  events?: {
    whisper?: EventSlot[];        // say({ anim: true }) 联动
    status?: EventSlot[];         // setStatus(level) 档位动画
  };
  sleep?: Array<{                 // 睡觉「套」：三段同套随机
    start: string[]; loop: string[]; end: string[];
  }>;
}
```

`EventSlot = string | string[]`：字符串 = 固定播；数组 = 触发时随机抽 1 并避开刚播过的。

## 函数 API

### 应用层 `PetApp`

| 函数 | 说明 |
| --- | --- |
| `new PetApp(options?)` | 创建应用。`{ physics, tray, taskbarWatchdog, devtools, keepAliveAfterClose }` |
| `app.createPet(config)` | 创建宠物（可在 `start()` 前后调用，命令自动缓冲） |
| `app.start()` | 启动事件循环、创建窗口与托盘 |
| `app.quit()` | 关闭全部宠物窗口并退出 |
| `app.getPets()` / `app.getPet(id)` | 查询宠物 |
| `app.removePet(id)` | 移除单只宠物 |
| `app.notify(title, body?)` | 系统通知 |
| `app.on('ready' \| 'pet-added' \| 'pet-removed' \| 'quit', fn)` | 应用事件 |

### 宠物 `Pet`

| 函数 | 说明 |
| --- | --- |
| `pet.say(text, { duration, image, anim, facing })` | 说话气泡；`image` 支持 http(s) 或本地文件路径 |
| `pet.clearBubble()` | 收起气泡 |
| `pet.play(name, { facing, loop, squash, move })` | 点播动画，返回 `{ playbackId, done }`；`done` 回 `ended/failed/cancelled` |
| `pet.playUrl(url, opts)` | 播放外部 webm 一次 |
| `pet.moveTo(x, y, { mode: 'instant'\|'spring'\|'line', duration })` | 移动到归一化坐标（0~1，多屏外接矩形） |
| `pet.throwAt(angle, power)` | 抛掷（度，0=右、逆时针正；power 1 ≈ 1200 px/s） |
| `pet.goHome()` | 回初始位置 |
| `pet.setPosition(x, y)` | 绝对定位（物理像素，包围盒左上角） |
| `pet.getPose()` | 实况：归一化位置 + 朝向 + 睡/飞/拖状态 |
| `pet.sleep()` / `pet.wake()` | 睡觉 / 叫醒（三段式动画，`sleep()` 返回 `{ ok, reason }`） |
| `pet.isSleeping()` | 是否睡着 |
| `pet.acquireLock({ ttl })` | 占用锁：冻结随机链；拖走即被抢锁。返回 `{ id, renew(), release(), active }` |
| `pet.releaseLock()` / `pet.isLocked()` | 释放 / 查询锁 |
| `pet.setStatus(level, text?, { terminal })` | 外部状态档位（`events.status[level]`）+ 气泡；`terminal` 显示 10s 不轮换 |
| `pet.clearStatus()` | 清除状态回随机链 |
| `pet.setMenuItems(items)` / `addMenuItem` / `removeMenuItem` | 自定义右键菜单项（`{ id, label, group? }`） |
| `pet.show()` / `pet.hide()` | 显示 / 隐藏窗口 |
| `pet.squash(amount?)` | Q 弹挤压反馈 |
| `pet.playClickSound()` | 播点击音效 |
| `pet.dispose()` | 销毁窗口与资源 |

### 宠物事件

```ts
pet.on('click', ({ x, y, button, woke }) => {});
pet.on('drag-start' | 'drag-end', ({ x, y, vx, vy }) => {});
pet.on('throw-start' | 'throw-end', ({ x, y, ... }) => {});
pet.on('move-ended', ({ x, y }) => {});        // 归一化落点
pet.on('sleep-started' | 'sleep-ended', () => {});
pet.on('menu-click', ({ menuId }) => {});      // 自定义菜单项被点
pet.on('menu-action', ({ action, name }) => {}); // 内置动作（sleep/home/play/move）
pet.on('pose', (pose) => {});                  // 位置实况（约 400ms 节流）
pet.on('playback', ({ playbackId, status, reason }) => {});
pet.on('ended', ({ name, source }) => {});
pet.on('lock-acquired' | 'lock-released', ...);
pet.on('close', (e) => e.preventDefault());    // 拦截窗口关闭
```

### 物理参数

```ts
interface PhysicsParams {
  gravity: number;        // 1400 px/s²
  restitution: number;    // 0.78 边缘反弹恢复系数
  groundFriction: number; // 2.5 /s 切向摩擦
  ceilingBounce: boolean; // true 顶部可弹
  throwPower: number;     // 1.0 抛掷力度倍率
  petCollision: boolean;  // true 多宠碰撞
  confineToScreen: boolean; // false 抛掷/漫游可跨屏
}
```

## 与 dsh-pet 的关系

本库参考 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）的桌宠核心实现复刻：
动画状态机、拖拽/抛掷物理手感、气泡与菜单语义、三段式睡觉、占用锁模型均移植自其
已验证的参数与分支逻辑，但**完全去 DSH / 去 Electron / 去 HTTP 服务**——
能力全部以函数 API 形式暴露，任何 Node.js 项目开箱即用。LLM 对话、余额、语音、
待办等 dsh 特有能力不在本库范围内（可由调用方在事件回调里自行接入）。

## 平台支持

| 平台 | 状态 |
| --- | --- |
| Windows | ✅ 完整（WebView2，任务栏看门狗，点击穿透） |
| macOS | ✅ 可用（WebKit；建议动画用 HEVC-alpha `.mov`） |
| Linux | ✅ 可用（WebKitGTK 4.1；Wayland 下部分窗口能力受限） |

## 开发

```bash
bun install
bun run build        # 打包渲染端 + 编译宿主库到 dist/
bun test             # 共享层单测
bun run typecheck    # 双 tsconfig 类型检查
bun run demo         # 运行 basic 示例
```

## License

MIT © webview-pet contributors

---

<div align="center">

English summary: a desktop-pet library for Node.js/Bun built on `@webviewjs/webview`.
Transparent always-on-top pet windows, webm alpha animations, drag/throw physics,
speech bubbles, sleep, locks, custom menus, multi-pet collisions — all controlled
through plain function calls. See the API tables above.

</div>
