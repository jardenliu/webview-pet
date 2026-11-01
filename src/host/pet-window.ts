/**
 * PetWindow — owns one native pet window + its webview: command dispatch,
 * renderer event plumbing, the click-through policy and the taskbar watchdog.
 */
import {
  POINTER_POLL_MS,
  TASKBAR_WATCHDOG_MS,
  HOVER_RELEASE_MS,
} from '../shared/constants.js';
import type { HostCommand, RendererConfig } from '../shared/types.js';
import { createAssetHandler, type AssetContext } from './assets.js';
import type { WindowMetrics } from './geometry.js';

export interface PetWindowCallbacks {
  onReady(): void;
  onEvent(type: string, payload: Record<string, unknown>): void;
  onClose(event: { preventDefault(): void; defaultPrevented: boolean }): void;
}

export interface PetWindowOptions {
  config: RendererConfig;
  metrics: WindowMetrics;
  assets: AssetContext;
  title: string;
  x: number;
  y: number;
  devtools: boolean;
  taskbarWatchdog: boolean;
  hoverReleaseMs: number;
}

/** Payload of a moving pet, broadcast for cross-pet collision detection. */
export interface FlightState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

type NativeApp = import('@webviewjs/webview').Application;
type NativeWindow = import('@webviewjs/webview').BrowserWindow;
type NativeWebview = import('@webviewjs/webview').Webview;

const jsString = (value: unknown): string =>
  JSON.stringify(value).replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

export class PetWindow {
  readonly win: NativeWindow;
  readonly webview: NativeWebview;

  private readonly opts: PetWindowOptions;
  private readonly cb: PetWindowCallbacks;
  private config: RendererConfig;

  private queue: HostCommand[] = [];
  private ready = false;
  private disposed = false;

  // Click-through policy state
  private interactive = false;
  private busy = false;
  private inputRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private taskbarTimer: ReturnType<typeof setInterval> | null = null;

  // Window position (physical px, top-left) and pet box position
  winX: number;
  winY: number;
  boxX: number;
  boxY: number;

  /** Last flight report (physical px, box top-left + velocity) or null at rest. */
  flight: FlightState | null = null;

  constructor(app: NativeApp, opts: PetWindowOptions, cb: PetWindowCallbacks) {
    this.opts = opts;
    this.cb = cb;
    this.config = opts.config;
    this.winX = Math.round(opts.x - opts.metrics.marginL);
    this.winY = Math.round(opts.y - opts.metrics.marginT);
    this.boxX = Math.round(opts.x);
    this.boxY = Math.round(opts.y);

    const win = app.createBrowserWindow({
      title: opts.title,
      width: Math.round(opts.metrics.width),
      height: Math.round(opts.metrics.height),
      x: this.winX,
      y: this.winY,
      transparent: true,
      decorations: false,
      alwaysOnTop: true,
      alwaysOnBottom: false,
      visible: true,
      focused: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      windowsSkipTaskbar: true,
      windowsUndecoratedShadow: false,
      macosHasShadow: false,
    });
    this.win = win;
    win.setSkipTaskbar(true);
    try {
      win.setHasShadow(false);
    } catch {
      /* platform without shadow control */
    }

    win.registerProtocol('pet', createAssetHandler(opts.assets));

    const webview = win.createWebview({
      url: 'pet://localhost/index.html',
      transparent: true,
      autoplay: true,
      enableDevtools: opts.devtools,
    });
    this.webview = webview;
    try {
      webview.setBackgroundColor(0, 0, 0, 0);
    } catch {
      /* optional */
    }

    webview.onIpcMessage((message) => this.handleIpc(message));
    win.on('close', (event) => this.cb.onClose(event));
    win.on('move', (e) => {
      this.winX = e.x;
      this.winY = e.y;
      this.syncBoxFromWindow();
    });

    this.startPointerPolling();
    if (opts.taskbarWatchdog && process.platform === 'win32') this.startTaskbarWatchdog();
    // Start click-through; the poller opens it up when the cursor hits the body.
    win.setIgnoreCursorEvents(true);
  }

  // ── Positioning ────────────────────────────────────────────────────────────

  private syncBoxFromWindow(): void {
    this.boxX = this.winX + this.opts.metrics.marginL;
    this.boxY = this.winY + this.opts.metrics.marginT;
  }

  /** Move the window so the pet box top-left lands on the given physical px. */
  moveBoxTo(x: number, y: number): void {
    this.boxX = Math.round(x);
    this.boxY = Math.round(y);
    this.winX = this.boxX - this.opts.metrics.marginL;
    this.winY = this.boxY - this.opts.metrics.marginT;
    this.win.setPosition(this.winX, this.winY, false);
  }

  // ── Command dispatch ───────────────────────────────────────────────────────

  send(cmd: HostCommand): void {
    if (this.disposed) return;
    if (!this.ready) {
      this.queue.push(cmd);
      return;
    }
    this.dispatchNow(cmd);
  }

  private dispatchNow(cmd: HostCommand): void {
    try {
      this.webview.evaluateScript(`window.__petDispatch__ && window.__petDispatch__(${jsString(cmd)})`);
    } catch (err) {
      console.warn('[webview-pet] dispatch failed', err);
    }
  }

  private flush(): void {
    const q = this.queue;
    this.queue = [];
    for (const cmd of q) this.dispatchNow(cmd);
  }

  // ── Renderer → host events ─────────────────────────────────────────────────

  private handleIpc(message: { body: Buffer }): void {
    let type: string;
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(message.body.toString('utf8')) as [string, Record<string, unknown>];
      type = parsed[0];
      payload = parsed[1] ?? {};
    } catch {
      return;
    }
    switch (type) {
      case 'ready':
        this.ready = true;
        this.flush();
        this.cb.onReady();
        return;
      case 'move-window': {
        const x = Number(payload.x);
        const y = Number(payload.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          this.boxX = x + this.opts.metrics.marginL;
          this.boxY = y + this.opts.metrics.marginT;
          this.winX = x;
          this.winY = y;
          this.win.setPosition(x, y, false);
        }
        return;
      }
      case 'set-busy':
        this.busy = payload.busy === true;
        this.evaluateInteractive();
        this.cb.onEvent(type, payload);
        return;
      case 'input-regions':
        this.inputRects = Array.isArray(payload.rects) ? (payload.rects as typeof this.inputRects) : [];
        this.evaluateInteractive();
        this.cb.onEvent(type, payload);
        return;
      case 'flight': {
        const size = Number(payload.size) || this.config.size;
        const h = (size * 9) / 16;
        this.flight = {
          x: Number(payload.x) - size / 2,
          y: Number(payload.y) - h / 2,
          vx: Number(payload.vx) || 0,
          vy: Number(payload.vy) || 0,
          size,
        };
        this.cb.onEvent(type, payload);
        return;
      }
      case 'throw-end':
        this.flight = null;
        this.cb.onEvent(type, payload);
        return;
      case 'drag-start':
        this.flight = null;
        this.cb.onEvent(type, payload);
        return;
      default:
        this.cb.onEvent(type, payload);
        return;
    }
  }

  // ── Click-through policy ───────────────────────────────────────────────────

  private startPointerPolling(): void {
    this.pollTimer = setInterval(() => {
      if (this.disposed) return;
      try {
        this.evaluateInteractive();
      } catch {
        /* window may be gone */
      }
    }, POINTER_POLL_MS);
    this.pollTimer.unref?.();
  }

  private cursorInHit(): boolean {
    let cursor: { x: number; y: number };
    try {
      cursor = this.win.getCursorPosition(false);
    } catch {
      return false;
    }
    const relX = cursor.x - this.winX;
    const relY = cursor.y - this.winY;
    const r = this.opts.metrics.hitRect;
    if (relX >= r.x && relX <= r.x + r.w && relY >= r.y && relY <= r.y + r.h) return true;
    for (const rect of this.inputRects) {
      if (relX >= rect.x && relX <= rect.x + rect.width && relY >= rect.y && relY <= rect.y + rect.height) {
        return true;
      }
    }
    return false;
  }

  private evaluateInteractive(): void {
    if (this.disposed) return;
    const want = this.busy || this.cursorInHit();
    if (want) {
      if (this.hoverTimer) {
        clearTimeout(this.hoverTimer);
        this.hoverTimer = null;
      }
      this.setInteractive(true);
      return;
    }
    if (!this.interactive) return;
    // Dwell before releasing: keeps click-drag sequences across the margin sane.
    if (this.hoverTimer) return;
    this.hoverTimer = setTimeout(
      () => {
        this.hoverTimer = null;
        if (this.disposed || this.busy || this.cursorInHit()) return;
        this.setInteractive(false);
      },
      Math.max(0, this.opts.hoverReleaseMs ?? HOVER_RELEASE_MS),
    );
    this.hoverTimer.unref?.();
  }

  private setInteractive(next: boolean): void {
    if (this.interactive === next) return;
    this.interactive = next;
    try {
      this.win.setIgnoreCursorEvents(!next);
    } catch {
      /* disposed */
    }
  }

  private startTaskbarWatchdog(): void {
    this.taskbarTimer = setInterval(() => {
      if (this.disposed) return;
      try {
        this.win.setSkipTaskbar(true);
      } catch {
        /* disposed */
      }
    }, TASKBAR_WATCHDOG_MS);
    this.taskbarTimer.unref?.();
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  setConfig(config: RendererConfig): void {
    this.config = config;
    (this.opts as { config: RendererConfig }).config = config;
    this.send({ t: 'set-config', config });
  }

  updateGeometry(config: RendererConfig, metrics: WindowMetrics, x: number, y: number): void {
    this.config = config;
    (this.opts as { config: RendererConfig }).config = config;
    (this.opts as { metrics: WindowMetrics }).metrics = metrics;
    this.win.setSize(Math.round(metrics.width), Math.round(metrics.height), false);
    this.moveBoxTo(x, y);
    this.send({ t: 'geometry', geometry: config.geometry, home: config.home });
    this.send({ t: 'set-config', config });
  }

  show(): void {
    try {
      this.win.show();
      this.win.setSkipTaskbar(true);
      this.win.setAlwaysOnTop(true);
    } catch {
      /* disposed */
    }
  }

  hide(): void {
    try {
      this.win.hide();
    } catch {
      /* disposed */
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.taskbarTimer) clearInterval(this.taskbarTimer);
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.pollTimer = null;
    this.taskbarTimer = null;
    this.hoverTimer = null;
    try {
      this.webview.dispose();
    } catch {
      /* already gone */
    }
    try {
      this.win.dispose();
    } catch {
      /* already gone */
    }
  }
}
