# 互动能力

气泡说话、状态联动、睡觉、占用锁、右键菜单与事件订阅。

## 气泡说话（say）

```ts
pet.say('你好呀~', {
  duration: 4000,          // ms，0 = 常驻直到被替换
  image: './cat.png',      // 气泡配图（http(s) 或绝对路径）
  anim: true,              // 联动 events.whisper 动画
  facing: 'left',          // 旁白期间强制朝向
});

pet.clearBubble();         // 立即收起气泡
```

- 气泡自动排优先级：新消息可顶掉旧的，限时消失；
- 全局行为可调：`bubble: { durationMs, maxWidthRatio }`；
- 字体可定制：`font: { family, size, file }`（file 支持 ttf/otf，自动下发给渲染层）。

## 状态联动（setStatus）

把外部状态（如 AI 工作阶段）映射到动画 + 气泡：

```ts
// events.status 是按档位排列的动画池
pet.setStatus(0, '思考中…');           // 播 status[0] 动画 + 气泡
pet.setStatus(4, '完成！', { terminal: true });  // 终态：长气泡、不再自转
pet.clearStatus();
```

- `status[level]` 越界兜底到最后一档；
- `terminal: true` 的状态显示 10 秒气泡且不会被随机链覆盖。

## 睡觉（sleep / wake）

```ts
const result = pet.sleep();
// { ok: true } 或 { ok: false, reason: 'no-sleep-animations' | 'already-sleeping' | 'locked' }

pet.isSleeping();   // boolean
pet.wake();         // 强制叫醒
```

- 睡着后进入 `start → loop → end` 三段式循环；
- **睡着拒扰**：点击 / 拖拽会得到拒绝气泡（`sleepTexts.refuse`），点击可叫醒；
- 台词可定制：

```ts
sleepTexts: {
  start: ['好困……我先睡一会儿。'],
  end: ['唔……我醒了。'],
  refuse: ['我在睡觉，别烦我……'],
}
```

## 占用锁（acquireLock）

第三方（比如一个 AI agent）想独占宠物时用锁；**用户拖走即抢锁**（用户优先）：

```ts
const lock = pet.acquireLock({ ttl: 30_000 });

lock.active;          // 是否仍持有
lock.expiresAt;       // 到期时间戳
lock.renew(10_000);   // 续期，返回新到期时间
lock.release();       // 提前释放

pet.isLocked();
pet.releaseLock();    // 无条件释放当前锁
```

- 锁过期自动释放；被用户抢走时触发 `lock-released`（`reason: 'takeover'`）；
- 睡觉时 `acquireLock` 会失败（`sleep()` 返回 `reason: 'locked'` 反之亦然）。

## 右键菜单

```ts
pet.setMenuItems([
  { id: 'feed', label: '投喂小鱼干', group: '互动' },
  { id: 'pet', label: '摸摸头', group: '互动' },
  { id: 'about', label: '关于', enabled: true },
]);

pet.addMenuItem({ id: 'later', label: '稍后再说' });
pet.removeMenuItem('later');

pet.on('menu-click', ({ menuId }) => {
  if (menuId === 'feed') pet.say('嗷呜，谢谢！');
});
```

- 同 `group` 的项自动收进子菜单；
- 内置项（睡觉 / 唤醒等）与动作树（categories）自动出现在菜单里；
- `menu-action` 事件携带内置动作的 `{ action, name }`。

## 事件订阅

```ts
pet.on(event, listener);   // 返回 this，可链式
pet.off(event, listener);
```

| 事件 | 载荷 | 说明 |
|---|---|---|
| `ready` | — | 窗口就绪 |
| `click` | `{ x, y, button, woke }` | 点击；`woke` = 刚叫醒 |
| `drag-start` / `drag-end` | `{ x, y, vx, vy }` | 拖拽起止（end 含松手初速） |
| `throw-start` / `throw-end` | `{ x, y, vx, vy, reason }` | 抛掷起止 |
| `move-ended` | `{ x, y }` | moveTo / 漫游到达 |
| `sleep-started` / `sleep-ended` | — | 睡着 / 醒来 |
| `sleep-request` | `{ action: 'sleep' \| 'wake' }` | 睡眠请求被接受前 |
| `menu-click` | `{ menuId }` | 自定义菜单点击 |
| `menu-action` | `{ action, name? }` | 内置动作点击 |
| `context-menu` | `{ x, y }` | 右键唤出菜单 |
| `pose` | `Pose` | 位姿持续上报 |
| `playback` | `PlaybackReceipt` | 播放状态变化 |
| `ended` | `{ name, source }` | 某动画自然播完 |
| `lock-acquired` / `lock-released` | `{ id, expiresAt }` / `{ id, reason }` | 锁生命周期 |
| `error` | `{ message }` | 渲染层错误 |
| `close` | `{ preventDefault() }` | 窗口关闭前（可拦截） |

`PetApp` 层面还有 `ready` / `quit` / `pet-added` / `pet-removed`。

## 托盘与通知

```ts
const app = new PetApp({
  tray: { /* 托盘图标与菜单 */ },
  taskbarWatchdog: true,   // Windows 任务栏占位守护
  devtools: false,         // 打开 webview 调试器
});

app.notify('构建完成', '去看看小宠物吧');
```
