/**
 * PetApp — application-level runtime: the native event loop, pet windows,
 * tray, display watching and the multi-pet collision broker.
 */
import { Application as NativeApplication, Notification, type TrayIcon, type BrowserWindow as NativeBrowserWindow } from '@webviewjs/webview';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { bodyPixelBox, collidePet, rectsOverlap } from '../shared/physics.js';
import type { PetConfig, PhysicsParams, Rect } from '../shared/types.js';
import { buildRendererConfig, computeWindowMetrics, type MonitorLike } from './geometry.js';
import { Pet } from './pet.js';
import { PetWindow, type FlightState } from './pet-window.js';
import type { AssetContext } from './assets.js';

export interface TrayOptions {
  /** Path to a PNG/ICO icon file, or raw image bytes. */
  icon: string | Buffer;
  tooltip?: string;
  /** Extra tray-menu items (a Quit item is appended automatically). */
  items?: Array<{ id: string; label: string }>;
  /** Hide the default Quit item. */
  hideQuit?: boolean;
}

export interface PetAppOptions {
  /** Global default physics, overridable per pet. */
  physics?: Partial<PhysicsParams>;
  /** System-tray icon and menu. Omit for no tray. */
  tray?: TrayOptions;
  /** Re-assert skip-taskbar periodically (Windows explorer rebuild workaround). */
  taskbarWatchdog?: boolean;
  /** Open the webview devtools for every pet window. */
  devtools?: boolean;
  /** Keep the app running after all pet windows are closed. Default false. */
  keepAliveAfterClose?: boolean;
}

export interface PetAppEventMap {
  ready: [];
  quit: [];
  'pet-added': [Pet];
  'pet-removed': [Pet];
}

type Listener = (...args: unknown[]) => void;

export class PetApp {
  private readonly app: NativeApplication;
  private readonly options: PetAppOptions;
  private readonly emitter = new EventEmitter();
  private readonly pets = new Map<string, Pet>();
  private readonly pendingPets: Pet[] = [];
  private tray: TrayIcon | null = null;
  private started = false;
  private disposed = false;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private monitorsKey = '';
  private monitorsCache: MonitorLike[] | null = null;
  private primaryIndexCache = 0;
  private utilityWindow: NativeBrowserWindow | null = null;
  private collisionCooldown = new Map<string, number>();

  constructor(options: PetAppOptions = {}) {
    this.options = options;
    this.app = new NativeApplication();
    this.app.on('custom-menu-click', (e) => this.handleTrayMenu(e.customMenuEvent?.id ?? ''));
    this.app.on('application-close-requested', () => this.quit());
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  on<K extends keyof PetAppEventMap>(event: K, listener: (...args: PetAppEventMap[K]) => void): this {
    this.emitter.on(event, listener as Listener);
    return this;
  }

  once<K extends keyof PetAppEventMap>(event: K, listener: (...args: PetAppEventMap[K]) => void): this {
    this.emitter.once(event, listener as Listener);
    return this;
  }

  off<K extends keyof PetAppEventMap>(event: K, listener: (...args: PetAppEventMap[K]) => void): this {
    this.emitter.off(event, listener as Listener);
    return this;
  }

  // ── Pets ───────────────────────────────────────────────────────────────────

  /**
   * Create a pet. Safe to call before or after `start()`; windows are created
   * once the app is running.
   *
   * ```ts
   * const pet = app.createPet({
   *   id: 'whale',
   *   name: '小鲸',
   *   assetsDir: './assets/animation',
   *   animations: { idle: ['待机'], clicks: ['点击回应'] },
   *   position: { corner: 'bottom-right', marginX: 24, marginY: 24 },
   *   clickSound: true,
   * });
   * ```
   */
  createPet(config: PetConfig): Pet {
    if (this.pets.has(config.id) || this.pendingPets.some((p) => p.id === config.id)) {
      throw new Error(`webview-pet: duplicate pet id "${config.id}"`);
    }
    const monitors = this.getMonitors();
    const pet = new Pet(config, {
      physics: this.options.physics,
      monitors,
      primaryIndex: this.primaryIndexCache,
    });
    if (this.started) {
      this.attachPet(pet);
    } else {
      this.pendingPets.push(pet);
    }
    this.emitter.emit('pet-added', pet);
    return pet;
  }

  /** Get a pet by id. */
  getPet(id: string): Pet | undefined {
    return this.pets.get(id);
  }

  /** All pets currently alive. */
  getPets(): Pet[] {
    return [...this.pets.values()];
  }

  /** Remove a pet and destroy its window. */
  removePet(id: string): void {
    const pet = this.pets.get(id) ?? this.pendingPets.find((p) => p.id === id);
    if (!pet) return;
    const i = this.pendingPets.indexOf(pet);
    if (i >= 0) this.pendingPets.splice(i, 1);
    this.pets.delete(id);
    pet.dispose();
    this.emitter.emit('pet-removed', pet);
    this.refreshTray();
  }

  private attachPet(pet: Pet): void {
    const metrics = pet.metricsForWindow;
    const cfg = pet.renderer;
    const assets: AssetContext = {
      assetsDir: pet.config.assetsDir,
      fontFile: cfg.font.file,
      config: () => pet.renderer,
    };
    const win = new PetWindow(
      this.app,
      {
        config: cfg,
        metrics,
        assets,
        title: pet.name,
        x: pet.home.x,
        y: pet.home.y,
        devtools: this.options.devtools ?? false,
        taskbarWatchdog: this.options.taskbarWatchdog ?? true,
        hoverReleaseMs: pet.config.hoverReleaseMs ?? 400,
      },
      {
        onReady: () => {
          pet.handleRendererEvent('ready', {});
        },
        onEvent: (type, payload) => this.handlePetEvent(pet, type, payload),
        onClose: (event) => {
          pet.handleClose(event);
          this.pets.delete(pet.id);
          if (!this.options.keepAliveAfterClose && this.pets.size === 0 && this.pendingPets.length === 0) {
            this.quit();
          }
          this.refreshTray();
        },
      },
    );
    pet.window = win;
    this.pets.set(pet.id, pet);
    pet.flushPendingCommands();
  }

  private handlePetEvent(pet: Pet, type: string, payload: Record<string, unknown>): void {
    if (type === 'flight') {
      this.brokerCollisions(pet);
    }
    pet.handleRendererEvent(type, payload);
  }

  // ── Multi-pet collision broker ─────────────────────────────────────────────

  private brokerCollisions(mover: Pet): void {
    const physics = { petCollision: mover.config.physics?.petCollision ?? this.options.physics?.petCollision ?? true };
    if (!physics.petCollision) return;
    const a = this.bodyOf(mover);
    if (!a) return;
    const now = Date.now();
    for (const other of this.pets.values()) {
      if (other === mover) continue;
      const b = this.bodyOf(other);
      if (!b) continue;
      const boxA = bodyPixelBox({
        x: a.x,
        y: a.y,
        size: a.size,
        bottomPad: mover.metrics.bottomPad,
        hitBox: mover.renderer.hitBox,
      });
      const boxB = bodyPixelBox({
        x: b.x,
        y: b.y,
        size: b.size,
        bottomPad: other.metrics.bottomPad,
        hitBox: other.renderer.hitBox,
      });
      if (!rectsOverlap(boxA, boxB)) continue;
      const key = [mover.id, other.id].sort().join('|');
      const last = this.collisionCooldown.get(key) ?? 0;
      if (now - last < 500) continue;
      const hit = collidePet(
        { x: a.x, y: a.y, vx: a.vx, vy: a.vy, size: a.size },
        { x: b.x, y: b.y, vx: b.vx, vy: b.vy, size: b.size },
      );
      if (!hit) continue;
      this.collisionCooldown.set(key, now);
      mover.send({ t: 'hit', vx: hit.fvx, vy: hit.fvy });
      other.send({ t: 'hit', vx: hit.hvx, vy: hit.hvy });
    }
  }

  private bodyOf(pet: Pet): FlightState | null {
    const win = pet.window;
    if (!win) return null;
    const size = pet.renderer.size;
    if (win.flight) return win.flight;
    return { x: win.boxX, y: win.boxY, vx: 0, vy: 0, size };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Start the runtime: create all queued pet windows and the tray. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.app.whenReady({ autoRun: true });
    for (const pet of this.pendingPets.splice(0)) this.attachPet(pet);
    this.createTray();
    this.startMonitorWatch();
    this.emitter.emit('ready');
  }

  /** Send a system notification (title + body). */
  notify(title: string, body = ''): void {
    try {
      new Notification(title, { body });
    } catch {
      /* notifications unsupported */
    }
  }

  /** Quit the app: close every pet window and stop the event loop. */
  quit(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    for (const pet of [...this.pets.values()]) {
      this.pets.delete(pet.id);
      pet.dispose();
    }
    for (const pet of this.pendingPets.splice(0)) pet.dispose();
    try {
      this.tray?.dispose();
    } catch {
      /* already gone */
    }
    this.tray = null;
    try {
      this.utilityWindow?.dispose();
    } catch {
      /* already gone */
    }
    this.utilityWindow = null;
    this.emitter.emit('quit');
    try {
      this.app.exit();
    } catch {
      /* already exiting */
    }
  }

  // ── Tray ───────────────────────────────────────────────────────────────────

  private createTray(): void {
    const trayOpts = this.options.tray;
    if (!trayOpts) return;
    try {
      this.tray = this.app.createTrayIcon({
        id: 'webview-pet',
        icon: { data: toIconBytes(trayOpts.icon) },
        tooltip: trayOpts.tooltip ?? 'webview-pet',
        menu: { items: this.trayMenuItems() },
      });
    } catch (err) {
      console.warn('[webview-pet] tray creation failed', err);
      this.tray = null;
    }
  }

  private trayMenuItems(): Array<{ id: string; label: string }> {
    const items: Array<{ id: string; label: string }> = [];
    for (const pet of this.pets.values()) {
      items.push({ id: `toggle:${pet.id}`, label: `${pet.name} (${pet.id})` });
    }
    if (!this.options.tray?.hideQuit) items.push({ id: 'quit', label: '退出' });
    return items;
  }

  private refreshTray(): void {
    if (!this.tray) return;
    try {
      this.tray.setMenu({ items: this.trayMenuItems() });
    } catch {
      /* disposed */
    }
  }

  private handleTrayMenu(id: string): void {
    if (!id) return;
    if (id === 'quit') {
      this.quit();
      return;
    }
    if (id.startsWith('toggle:')) {
      const pet = this.pets.get(id.slice(7));
      if (!pet) return;
      if (pet.window && pet.window.win.isVisible()) pet.hide();
      else pet.show();
      return;
    }
    for (const pet of this.pets.values()) {
      pet.handleRendererEvent('menu-click', { menuId: id });
    }
  }

  // ── Display watching ───────────────────────────────────────────────────────

  private startMonitorWatch(): void {
    this.monitorsKey = this.monitorKey();
    this.monitorTimer = setInterval(() => {
      this.monitorsCache = null; // force a fresh read
      const monitors = this.getMonitors();
      const key = this.monitorKey();
      if (key === this.monitorsKey) return;
      this.monitorsKey = key;
      for (const pet of this.pets.values()) pet.updateMonitors(monitors, this.primaryIndexCache);
    }, 5000);
    this.monitorTimer.unref?.();
  }

  private monitorKey(): string {
    return this.getMonitors()
      .map((m) => `${m.position.x},${m.position.y},${m.size.width}x${m.size.height}@${m.scaleFactor}`)
      .join('|');
  }

  /** Current monitor descriptors (physical pixels). */
  getMonitors(): MonitorLike[] {
    if (this.monitorsCache) return this.monitorsCache;
    try {
      // Any window can enumerate monitors; use the first pet's window if one
      // exists, otherwise a long-lived hidden utility window. (A disposed probe
      // would queue application-close-requested and kill the app at startup.)
      const anyWin = [...this.pets.values()].find((p) => p.window)?.window?.win;
      const win = anyWin ?? this.ensureUtilityWindow();
      const monitors = win.getAvailableMonitors().map((m) => ({
        name: m.name,
        scaleFactor: m.scaleFactor,
        size: { width: m.size.width, height: m.size.height },
        position: { x: m.position.x, y: m.position.y },
      }));
      if (monitors.length > 0) {
        this.monitorsCache = monitors;
        this.primaryIndexCache = this.detectPrimaryIndex(win, monitors);
      }
      return monitors.length > 0 ? monitors : this.fallbackMonitor();
    } catch {
      return this.fallbackMonitor();
    }
  }

  private ensureUtilityWindow() {
    if (!this.utilityWindow) {
      this.utilityWindow = this.app.createBrowserWindow({
        width: 1,
        height: 1,
        x: -32000,
        y: -32000,
        visible: false,
        decorations: false,
        transparent: true,
      });
    }
    return this.utilityWindow;
  }

  private detectPrimaryIndex(win: NativeBrowserWindow, monitors: MonitorLike[]): number {
    try {
      const primary = win.getPrimaryMonitor() as MonitorLike | null;
      if (!primary) return 0;
      const idx = monitors.findIndex(
        (m) =>
          m.position.x === primary.position?.x &&
          m.position.y === primary.position?.y &&
          m.size.width === primary.size?.width &&
          m.size.height === primary.size?.height,
      );
      return idx >= 0 ? idx : 0;
    } catch {
      return 0;
    }
  }

  private fallbackMonitor(): MonitorLike[] {
    return [{ scaleFactor: 1, size: { width: 1920, height: 1080 }, position: { x: 0, y: 0 } }];
  }

  /** Index of the primary monitor in . */
  getPrimaryIndex(): number {
    this.getMonitors();
    return this.primaryIndexCache;
  }
}

function toIconBytes(icon: string | Buffer): Buffer {
  if (Buffer.isBuffer(icon)) return icon;
  return readFileSync(icon);
}

// Re-exported helpers used by consumers computing custom layouts.
export { buildRendererConfig, computeWindowMetrics };
export type { Rect };
