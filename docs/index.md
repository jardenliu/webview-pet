---
layout: home

hero:
  name: webview-pet
  text: 给你的应用一只桌面宠物
  tagline: 透明置顶气泡窗 · webm 透明动画 · 拖拽抛掷物理 · 睡觉 · 多宠物 — 全部由纯函数 API 驱动，零 Electron。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: API 参考
      link: /api/petapp
    - theme: alt
      text: GitHub
      link: https://github.com/jardenliu/webview-pet

features:
  - icon: 🫧
    title: 气泡说话
    details: pet.say() 文字 / 配图气泡，自动排优先级、限时消失、支持联动动画旁白。
  - icon: 🎬
    title: 动画池播放
    details: VP9-alpha webm 双缓冲交叉淡入。待机 / 转向 / 拖拽 / 点击 / 漫游 / 事件 / 睡觉全链动画池。
  - icon: 🖱️
    title: 拖拽手感
    details: 过阻尼弹簧跟手、甩抛初速估算、弹弓（双击后拉）、落地 Q 弹，全都有。
  - icon: 🚀
    title: 抛掷物理
    details: 重力 / 反弹 / 摩擦 / 多屏边界 / 屏间穿越，confineToScreen 可锁屏。
  - icon: 💤
    title: 睡觉状态机
    details: start / loop / end 三段式动画套件，睡着拒扰、点击叫醒、自然醒。
  - icon: 🔒
    title: 占用锁
    details: 第三方独占控制（TTL + 续期），用户拖走即抢锁 — 用户优先。
  - icon: 📊
    title: 状态联动
    details: 外部状态档位 → 对应动画 + 气泡，例如「思考中 / 干活中 / 完成」。
  - icon: 🧩
    title: 右键菜单
    details: 内置项 + 动作树 + 自定义菜单项（分组子菜单），menu-click 事件回传。
  - icon: 🐾
    title: 多宠物
    details: 一宠一窗、跨宠动量守恒碰撞、托盘统一管理。
  - icon: 🪟
    title: 点击穿透
    details: 只有宠物身体响应鼠标，其余区域穿透到下层窗口，不挡工作。
  - icon: 📦
    title: 零 Electron
    details: 基于 @webviewjs/webview（Tauri 的 tao/wry），Node.js ≥ 20 或 Bun 直接跑。
  - icon: ✨
    title: 纯函数 API
    details: 不用学事件总线或状态机，一切能力皆函数：say / play / moveTo / throwAt / sleep。
---

## 30 秒跑起来

```bash
npm install webview-pet
```

```ts
import { PetApp } from 'webview-pet';

const app = new PetApp();
const pet = app.createPet({
  id: 'bean',
  name: '小蓝豆',
  assetsDir: './assets/animation', // <动画名>.webm 素材目录
  animations: {
    idle: ['待机呼吸'],
    clicks: ['点击开心'],
    moves: {
      default: { minDist: 80, maxDist: 260, margin: 24, leadSec: 0.6, tailSec: 0.6 },
      actions: [{ name: '走路' }],
    },
    sleep: [{ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] }],
  },
});

await app.start();

pet.say('你好呀~', { duration: 4000 });
```

<div class="demo-strip">
  <video src="./待机呼吸.webm" autoplay loop muted playsinline></video>
  <video src="./点击开心.webm" autoplay loop muted playsinline></video>
  <video src="./走路.webm" autoplay loop muted playsinline></video>
</div>

<style>
.demo-strip {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin: 32px 0 8px;
  flex-wrap: wrap;
}
.demo-strip video {
  width: 220px;
  border-radius: 12px;
  background: repeating-conic-gradient(#e2e8f0 0% 25%, #f8fafc 0% 50%) 50% / 20px 20px;
}
.dark .demo-strip video {
  background: repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%) 50% / 20px 20px;
}
</style>
