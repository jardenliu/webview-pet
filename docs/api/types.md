# 类型定义

全部类型均可从包入口直接导入：

```ts
import type {
  PetConfig, PetAnimations, PhysicsParams, /* ... */
} from 'webview-pet';
```

## PetConfig

`app.createPet()` 的完整配置。

```ts
interface PetConfig {
  id: string;                 // 唯一 id（必填）
  name?: string;              // 显示名，默认 = id
  size?: number;              // 画框宽 px，高 = 宽 × 9/16，默认 462
  assetsDir: string;          // <动画名>.webm 素材目录（必填）
  animations: PetAnimations;  // 动画池（必填）
  animationWeights?: AnimationWeights;
  physics?: Partial<PhysicsParams>;   // 覆盖全局物理
  font?: PetFontConfig;
  fixed?: boolean;            // true = 永不自主转向 / 漫游
  clickSound?: boolean | string;
  position?: PetPositionSpec;
  hitBox?: HitBox;
  sleepTexts?: SleepTexts;
  bubble?: BubbleConfig;
  menu?: MenuItemSpec[];
  hoverReleaseMs?: number;    // 命中区释放延迟，默认 400
}
```

## PetAnimations

```ts
interface PetAnimations {
  idle: string[];             // 待机池（必填）
  turn?: string[];            // 转向池（播完翻转朝向）
  drag?: string[];            // 拖拽池
  clicks?: string[];          // 点击池
  moves?: MovesPool;          // 漫游池
  categories?: CategoryPool[];// 分类小动作
  events?: {
    whisper?: EventSlot[];    // say({ anim: true }) 旁白
    status?: EventSlot[];     // setStatus(level) 按档位取
  };
  sleep?: SleepSet[];         // 睡觉三件套
}

type EventSlot = string | string[];  // 字符串数组 = 随机挑一个
```

### MovesPool / MoveSpec / MoveAction

```ts
interface MovesPool {
  default: MoveSpec;
  actions: MoveAction[];      // 每项可覆盖 default
}

interface MoveSpec {
  minDist: number;            // 最小移动距离 px（按 size/462 缩放）
  maxDist: number;
  margin: number;             // 屏幕边缘留白
  leadSec: number;            // 动画开头原地秒数
  tailSec: number;            // 动画结尾原地秒数
}

interface MoveAction {
  name: string;               // 动画名
  params?: Partial<MoveSpec>; // 覆盖默认参数
}
```

### CategoryPool / SleepSet / AnimationWeights

```ts
interface CategoryPool {
  id: string;                 // 右键菜单分类名
  weight: number;             // 掷骰权重
  noMirror?: boolean;         // 朝右时跳过（动画含文字）
  actions: string[];
}

interface SleepSet {
  start: string[];            // 入睡
  loop: string[];             // 睡着循环
  end: string[];              // 醒来
}

interface AnimationWeights {
  idle: number;               // 百分比权重
  turn: number;
  move: number;               // 剩余给 categories
}
```

## PhysicsParams

```ts
interface PhysicsParams {
  gravity: number;            // px/s²
  restitution: number;        // 0..1 落地能量保留
  groundFriction: number;     // 每秒摩擦系数
  ceilingBounce: boolean;
  throwPower: number;         // 抛掷力度倍率
  petCollision: boolean;      // 多宠碰撞
  confineToScreen: boolean;   // 锁屏
}
```

## 位置与命中

```ts
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

interface PetPositionSpec {
  corner?: Corner;            // 工作区锚点角，设 x/y 时忽略
  marginX?: number;
  marginY?: number;
  x?: number;                 // 绝对物理像素坐标
  y?: number;
}

interface HitBox {            // 640×360 画布坐标
  x0: number; y0: number;
  x1: number; y1: number;
}
```

## 菜单与气泡

```ts
interface MenuItemSpec {
  id: string;
  label: string;
  group?: string;             // 同组收进子菜单
  enabled?: boolean;
}

interface BubbleConfig {
  durationMs?: number;        // 默认气泡时长，0 = 常驻
  maxWidthRatio?: number;     // 最大气泡宽 / 宠物宽，默认 1.2
}

interface PetFontConfig {
  family?: string;
  size?: number;
  file?: string;              // ttf/otf 字体文件
}

interface SleepTexts {
  start?: string[];           // 入睡台词
  end?: string[];             // 醒来台词
  refuse?: string[];          // 睡着拒扰台词
}
```

## 运行时载荷

```ts
type Facing = 'left' | 'right';

interface Pose {
  x: number; y: number;
  facing: Facing;
  // ...运动学细节
}

interface MovePayload {
  x: number; y: number;                   // 归一化目标坐标
  mode: 'instant' | 'spring' | 'line';
  duration?: number;
  leadSec?: number;
  tailSec?: number;
}

interface PlaybackReceipt {
  playbackId: string;
  status: string;
  reason?: string;
}
```

## 事件映射

```ts
interface PetEventMap {
  ready: [];
  click: [{ x: number; y: number; button: number; woke: boolean }];
  'drag-start': [{ x: number; y: number }];
  'drag-end': [{ x: number; y: number; vx: number; vy: number }];
  'throw-start': [{ x: number; y: number; vx: number; vy: number }];
  'throw-end': [{ x: number; y: number; reason: string }];
  'move-ended': [{ x: number; y: number }];
  'sleep-started': [];
  'sleep-ended': [];
  'sleep-request': [{ action: 'sleep' | 'wake' }];
  'menu-action': [{ action: string; name?: string }];
  'menu-click': [{ menuId: string }];
  'context-menu': [{ x: number; y: number }];
  pose: [Pose];
  playback: [PlaybackReceipt];
  ended: [{ name: string; source: string }];
  'lock-acquired': [{ id: string; expiresAt: number }];
  'lock-released': [{ id: string; reason: 'released' | 'expired' | 'takeover' }];
  error: [{ message: string }];
  close: [{ preventDefault(): void; defaultPrevented: boolean }];
}

interface PetAppEventMap {
  ready: [];
  quit: [];
  'pet-added': [Pet];
  'pet-removed': [Pet];
}
```

## 辅助导出

包入口还导出一批可复用的纯函数与常量（物理、运动、抽签等）：

```ts
import {
  GRAVITY, RESTITUTION, GROUND_FRICTION, THROW_SPEED_ANCHOR,
  DEFAULT_HIT_BOX, DEFAULT_PHYSICS, BUBBLE_DURATION_MS, PET_SIZE_REF,
  // 运动 / 物理纯函数
  springStep, throwVelocity, estimateReleaseVelocity, slingshotVelocity,
  softClampSpeed, anchorPixel, planMove, computeHome,
  // 抽签
  pick, pickSlot, pickCategoryAction, pickSleepSet, rollKind,
  // 几何
  boundingRect, buildGeometry, monitorRects,
} from 'webview-pet';
```

这些函数签名见源码 [src/shared](https://github.com/jardenliu/webview-pet/tree/main/src/shared)。
