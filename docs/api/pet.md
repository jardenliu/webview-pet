# Pet

单只宠物实例，由 [`app.createPet()`](./petapp#createPet) 返回。一切交互能力皆函数。

## 属性

| 属性 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 创建时指定的唯一 id |
| `name` | `string` | 显示名 |
| `config` | `PetConfig` | 生效的完整配置 |

## 说话

### say(text, options?)

```ts
pet.say(text: string, options?: SayOptions): void;

interface SayOptions {
  duration?: number;    // ms；0 = 常驻直到被替换（默认 10 000）
  image?: string;       // 气泡配图 URL 或绝对路径
  anim?: boolean;       // 联动 events.whisper 动画
  facing?: Facing;      // 旁白期间强制朝向 'left' | 'right'
}
```

### clearBubble()

立即收起当前气泡。

## 播放

### play(name, options?)

播放素材池中的动画，返回播放句柄。

```ts
pet.play(name: string, options?: PlayOptions): PlaybackHandle;

interface PlayOptions {
  facing?: Facing;       // 本次播放强制朝向
  loop?: boolean;        // true = 循环直到被打断
  squash?: boolean;      // 起播时 Q 弹挤压反馈
  move?: MovePayload;    // 边播边移动
}

interface PlaybackHandle {
  playbackId: string;
  done: Promise<'ended' | string>;  // 终态状态
}
```

```ts
const playback = pet.play('伸懒腰', { squash: true });
playback.done.then((status) => console.log(status));
```

### playUrl(url, options?)

播放外部 webm（不走素材池）。

```ts
pet.playUrl(url: string, options?: Omit<PlayOptions, 'loop'>): PlaybackHandle;
```

## 移动与抛掷

### moveTo(x, y, options?)

移动到归一化桌面坐标 `(x, y) ∈ [0, 1]²`。

```ts
pet.moveTo(x: number, y: number, options?: MoveToOptions): void;

interface MoveToOptions {
  mode?: 'instant' | 'spring' | 'line';  // 默认 'spring'
  duration?: number;                     // line 模式时长 ms
}
```

### throwAt(angle, power?)

以 `angle` 度方向、`power` 倍力度抛出。

```ts
pet.throwAt(angle: number, power = 1): void;
```

### goHome() / setPosition(x, y) / getPose()

```ts
pet.goHome(): void;                       // 回初始锚点
pet.setPosition(x: number, y: number): void;  // 物理像素坐标
pet.getPose(): Pose;                      // { x, y, facing, ... }
```

## 显示

```ts
pet.show(): void;
pet.hide(): void;
pet.squash(amount = 0.55): void;   // Q 弹挤压反馈
pet.playClickSound(): void;        // 手动播点击音效
```

## 睡觉

```ts
pet.sleep(): SleepResult;
pet.wake(): void;
pet.isSleeping(): boolean;

interface SleepResult {
  ok: boolean;
  reason?: 'no-sleep-animations' | 'already-sleeping' | 'locked';
}
```

## 占用锁

```ts
pet.acquireLock(options?: { ttl?: number }): LockHandle;
pet.releaseLock(): void;      // 无条件释放
pet.isLocked(): boolean;

interface LockHandle {
  readonly id: string;
  readonly expiresAt: number;
  renew(ttlMs?: number): number;  // 续期，返回新到期时间
  release(): void;
  readonly active: boolean;
}
```

锁过期自动释放；用户拖走宠物触发 `lock-released`（`reason: 'takeover'`），用户优先。

## 状态联动

```ts
pet.setStatus(level: number, text?: string, options?: StatusOptions): void;
pet.clearStatus(): void;

interface StatusOptions {
  terminal?: boolean;  // 终态：10s 气泡、不被随机链覆盖
}
```

`level` 索引 `animations.events.status` 数组，越界兜底到最后一档。

## 菜单

```ts
pet.setMenuItems(items: MenuItemSpec[]): void;  // 全量替换
pet.addMenuItem(item: MenuItemSpec): void;
pet.removeMenuItem(id: string): void;

interface MenuItemSpec {
  id: string;
  label: string;
  group?: string;      // 同组收进子菜单
  enabled?: boolean;
}
```

## 几何同步

显示器插拔时调用（一般无需手动，App 层自动刷新）：

```ts
pet.refreshGeometry(monitors, primaryIndex = 0): void;
pet.updateMonitors(monitors, primaryIndex = 0): void;
pet.dispose(): void;   // 销毁窗口
```

## 事件

```ts
pet.on(event, listener): Pet;
pet.off(event, listener): Pet;
```

完整事件表见[互动能力 → 事件订阅](/guide/interaction#事件订阅)。

## 完整示例

```ts
pet.on('click', ({ woke }) => {
  if (!woke) pet.say('别戳我啦', { duration: 2500 });
});

pet.on('drag-end', ({ vx, vy }) => console.log('甩出', vx, vy));

const lock = pet.acquireLock({ ttl: 30_000 });
pet.say('我被锁住啦，随便拖我试试（拖走 = 抢锁）');

await wait(3000);
if (lock.active) lock.release();
pet.clearStatus();
```
