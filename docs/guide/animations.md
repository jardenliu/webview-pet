# 动画系统

宠物的一切表现都来自动画池。本页讲清楚池子怎么配、随机链怎么掷骰、事件动画怎么联动。

## 动画文件

- 格式：**VP9 alpha webm**（带透明通道），16:9 画布（640×360 逻辑分辨率）。
- 命名：文件名（不含 `.webm`）就是动画名，API 里用同名字符串引用。
- 同名文件放一个目录，通过 `assetsDir` 传入。

## 动画池一览

```ts
animations: {
  idle: string[];          // 待机：随机链主循环，每轮随机挑一个
  turn?: string[];         // 转向：播完自动翻转朝向
  drag?: string[];         // 拖拽中播放
  clicks?: string[];       // 点击反馈
  moves?: MovesPool;       // 漫游（带动窗口真实移动）
  categories?: CategoryPool[];  // 分类小动作（按权重掷骰）
  events?: {
    whisper?: EventSlot[]; // say({ anim: true }) 旁白动画
    status?: EventSlot[];  // setStatus(level) 按档位取
  };
  sleep?: SleepSet[];      // 睡觉三件套，配置后才能睡
}
```

::: warning 未配置的池子
没配 `sleep` 时 `pet.sleep()` 返回 `{ ok: false, reason: 'no-sleep-animations' }`。其他池子缺省只是对应行为不触发，不会报错。
:::

## 随机链（idle 循环）

宠物在待机时按权重掷骰决定下一段动作：

```ts
animationWeights: { idle: 45, turn: 10, move: 15 }
```

- `idle` / `turn` / `move` 是百分比权重；
- **剩余概率**（100 − 45 − 10 − 15 = 30%）给 `categories` 里的小动作，各分类再按自身 `weight` 二次掷骰；
- `fixed: true` 的宠物永不自主转向和漫游，只响应点击 / 事件 / 命令。

## 漫游（moves）

```ts
moves: {
  default: { minDist: 80, maxDist: 260, margin: 24, leadSec: 0.6, tailSec: 0.6 },
  actions: [
    { name: '走路' },
    { name: '快跑', params: { maxDist: 400, leadSec: 0.3 } },  // 覆盖默认参数
  ],
}
```

| 字段 | 含义 |
|---|---|
| `minDist` / `maxDist` | 目标点距离范围（px，按 `size / 462` 缩放） |
| `margin` | 距屏幕边缘的最小留白 |
| `leadSec` / `tailSec` | 动画开头 / 结尾原地不动的秒数（对齐起停步态） |

每个 action 可用 `params` 覆盖默认参数。移动到目标点时窗口真实位移，配合弹簧 / 直线 / 瞬移三种模式（见 [物理与拖拽](./physics)）。

## 分类小动作（categories）

```ts
categories: [
  { id: '小动作', weight: 30, actions: ['哼歌摇摆', '伸懒腰'] },
  { id: '心情', weight: 15, actions: ['思考冒泡', '垂头叹气'], noMirror: true },
]
```

| 字段 | 含义 |
|---|---|
| `id` | 右键菜单里显示的分类名 |
| `weight` | 二次掷骰的相对权重 |
| `noMirror` | 朝右时跳过（动画内含文字，镜像会反） |
| `actions` | 该分类下的动画名列表 |

## 事件动画（events）

事件动画**不进随机链**，只在被显式触发时播放：

```ts
events: {
  whisper: ['哼歌摇摆', '伸懒腰'],           // say({ anim: true }) 随机挑
  status: [
    ['思考冒泡'],                            // level 0
    ['走路'],                                // level 1
    ['哼歌摇摆', '伸懒腰'],                  // level 2（数组 = 随机挑一个）
  ],
}
```

- `EventSlot` 可以是单个字符串（固定播这个），或字符串数组（随机挑，避免连播同一个）；
- `status[level]` 越界时自动兜底到最后一档；
- `pet.setStatus(2, '干活中…')` → 播 `status[2]` 里的动画 + 气泡文字。

## 睡觉三件套（sleep）

```ts
sleep: [
  {
    start: ['睡觉-开始'],   // 入睡动画
    loop: ['睡觉-循环'],    // 睡着后循环
    end: ['睡觉-起来'],     // 醒来动画
  },
]
```

每个 `SleepSet` 三段是**一体抽取**的：入睡挑中的 set，循环和醒来沿用同一套，保证画风连续。多套 set 随机挑一套。

## 播放控制

```ts
const playback = pet.play('伸懒腰', {
  facing: 'left',   // 强制朝向
  loop: false,      // true = 循环直到被打断
  squash: true,     // 起播时 Q 弹挤压反馈
  move: { x: 0.5, y: 0.5, mode: 'spring' },  // 边播边走
});

playback.done.then((status) => {
  // status: 'ended' | 'interrupted' | ...
});
```

`pet.playUrl(url)` 可以播放外部 webm（不进素材目录）。`pet.play(name, { loop: true })` 的循环播放会被下一次 `play` / 拖拽 / 睡觉等打断。

## 音效

```ts
clickSound: true,                 // 内置点击音效
clickSound: './assets/oof.wav',   // 自定义音频
clickSound: false,                // 关闭
```

`pet.playClickSound()` 可手动触发。
