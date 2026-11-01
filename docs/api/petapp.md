# PetApp

应用级容器：管理 webview 生命周期、多宠物窗口、托盘与显示器几何。

```ts
import { PetApp } from 'webview-pet';

const app = new PetApp(options?);
```

## PetAppOptions

```ts
interface PetAppOptions {
  physics?: Partial<PhysicsParams>;  // 全局默认物理参数
  tray?: TrayOptions;                // 托盘图标与菜单，省略则无托盘
  taskbarWatchdog?: boolean;         // Windows：周期性重申跳过任务栏
  devtools?: boolean;                // 打开 webview devtools
  keepAliveAfterClose?: boolean;     // 全部窗口关闭后保持进程（默认 false）
}
```

## 方法

### createPet(config)

创建一只宠物。**必须在 `start()` 之前调用**，窗口在 `start()` 时统一亮起。

```ts
const pet = app.createPet(config: PetConfig): Pet;
```

- `config.id` 必须唯一，重复会抛错；
- 返回的 [Pet](./pet) 实例承载全部交互 API。

### start()

启动应用并显示全部宠物窗口。

```ts
await app.start(): Promise<void>;
```

### getPet(id) / getPets() / removePet(id)

```ts
app.getPet('bean'): Pet | undefined;
app.getPets(): Pet[];
app.removePet('mochi'): void;
```

### notify(title, body?)

发送系统通知。

```ts
app.notify('构建完成', '去看看小宠物吧'): void;
```

### quit()

关闭全部窗口并退出应用。

```ts
app.quit(): void;
```

### getMonitors() / getPrimaryIndex()

查询显示器几何（物理像素）。

```ts
app.getMonitors(): MonitorLike[];
app.getPrimaryIndex(): number;
```

## 事件

```ts
app.on(event, listener): PetApp;
app.off(event, listener): PetApp;
```

| 事件 | 载荷 | 说明 |
|---|---|---|
| `ready` | — | 应用就绪 |
| `quit` | — | 即将退出 |
| `pet-added` | `Pet` | 宠物创建后 |
| `pet-removed` | `Pet` | 宠物移除后 |

## 示例：多宠物 + 托盘

```ts
const app = new PetApp({
  physics: { gravity: 1400, restitution: 0.78 },
  tray: { /* ... */ },
  taskbarWatchdog: true,
});

app.createPet({ id: 'bean', /* ... */ });
app.createPet({ id: 'mochi', /* ... */ });

app.on('pet-removed', (pet) => console.log('bye', pet.name));

await app.start();
```
