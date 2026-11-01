# 物理与拖拽

桌面宠物最重要的就是「手感」。本页讲拖拽跟手、甩抛、弹弓、落地弹跳与多屏行为。

## 物理参数

全局默认在 `new PetApp({ physics })` 里配，单只宠物可在 `createPet({ physics })` 覆盖：

```ts
const app = new PetApp({
  physics: {
    gravity: 1400,          // 下落加速度 px/s²
    restitution: 0.78,      // 落地能量保留 0..1（越大弹得越高）
    groundFriction: 0.995,  // 地面摩擦系数（每秒）
    ceilingBounce: false,   // 是否能撞到天花板弹回
    throwPower: 1,          // 抛掷力度全局倍率
    petCollision: true,     // 多宠动量守恒碰撞
    confineToScreen: false, // 抛出 / 漫游锁在当前屏
  },
});
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `gravity` | 1400 | 越大下落越「重」 |
| `restitution` | 0.78 | 落地弹跳衰减 |
| `groundFriction` | — | 落地后水平速度衰减 |
| `ceilingBounce` | false | 打开后上抛能撞天花板 |
| `throwPower` | 1 | 所有抛掷初速乘以它 |
| `petCollision` | true | 多宠物间碰撞交换动量 |
| `confineToScreen` | false | 锁屏，不穿越到其他显示器 |

## 拖拽手感

- **弹簧跟手**：拖动时宠物以过阻尼弹簧追指针，有轻微惯性滞后，不僵硬；
- **甩抛**：松手时根据最近的指针轨迹估算初速方向与大小，宠物沿抛物线飞出，落地弹几下停住；
- **弹弓**：双击宠物后拉开再松手，方向与力度由拉伸向量决定；
- **拖拽动画**：拖拽期间播放 `animations.drag` 池里的动画；
- **Q 弹反馈**：落地 / 挤压时播放 squash 形变，`pet.squash(amount)` 也可手动触发。

拖拽事件：

```ts
pet.on('drag-start', ({ x, y }) => {});
pet.on('drag-end', ({ x, y, vx, vy }) => {});        // vx/vy = 松手初速
pet.on('throw-start', ({ x, y, vx, vy }) => {});
pet.on('throw-end', ({ x, y, reason }) => {});       // reason: 'rest' | ...
```

## 程序化移动与抛掷

```ts
// 移动到归一化坐标 (0..1) × (0..1)，相对于桌面工作区
pet.moveTo(0.5, 0.35, {
  mode: 'spring',     // 'instant' 瞬移 | 'spring' 弹簧 | 'line' 匀速
  duration: 800,      // line 模式的时长 ms
});

pet.throwAt(60, 1.2); // 朝 60° 方向、1.2 倍力度抛出
pet.goHome();          // 回到初始锚点
pet.setPosition(x, y); // 直接设置物理像素坐标
pet.getPose();         // { x, y, facing, ... } 查询当前位姿
```

## 多屏

- 抛掷可以**穿越屏幕边界**，落到另一块显示器上（除非 `confineToScreen: true`）；
- 显示器插拔时窗口几何自动刷新，`pet.refreshGeometry()` / `pet.updateMonitors()` 可手动同步；
- `position.corner` 锚定的是**主屏**工作区角落：`'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'`。

## 点击穿透

窗口整体透明置顶，但**只有宠物身体命中框**响应鼠标，其余像素穿透到下层应用，不挡工作。

```ts
hitBox: { x0: 200, y0: 80, x1: 440, y1: 360 },  // 640×360 画布坐标
hoverReleaseMs: 400,                            // 指针离开身体后延迟释放 ms
```

不配 `hitBox` 时按动画内容自动估算。
