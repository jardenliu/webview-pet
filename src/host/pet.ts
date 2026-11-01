/**
 * Pet — the public per-pet controller. Every pet capability is a plain
 * function call: speech bubbles, animation playback with receipts, movement,
 * throwing, sleep, exclusive locks, status linkage, menus and events.
 */
import { EventEmitter } from 'node:events';
import {
  BUBBLE_DURATION_MS,
  DEFAULT_PHYSICS,
  SLEEP_REFUSE_MS,
  TERMINAL_BUBBLE_DURATION_MS,
} from '../shared/constants.js';
import { pick, pickSleepSet, pickSlot } from '../shared/pickers.js';
import type {
  Facing,
  MenuItemSpec,
  MovePayload,
  PetConfig,
  PhysicsParams,
  PlaybackReceipt,
  Pose,
  RendererConfig,
} from '../shared/types.js';
import {
  buildRendererConfig,
  buildGeometry,
  computeHome,
  computeWindowMetrics,
  type MonitorLike,
  type WindowMetrics,
} from './geometry.js';
import type { PetWindow } from './pet-window.js';

// ── Public option shapes ─────────────────────────────────────────────────────

export interface SayOptions {
  /** Duration in ms; 0 keeps the bubble until replaced. Default 10 000. */
  duration?: number;
  /** Image URL (http(s) or an absolute file path) shown under the text. */
  image?: string;
  /** Play an `events.whisper` animation alongside the bubble. */
  anim?: boolean;
  /** Force the pet's facing while the linked animation plays. */
  facing?: Facing;
}

export interface PlayOptions {
  /** Flip the pet for this playback. */
  facing?: Facing;
  /** Loop forever instead of playing once. */
  loop?: boolean;
  /** Squash feedback when the animation starts. */
  squash?: boolean;
  /** Move while the animation plays. */
  move?: MovePayload;
}

export interface PlaybackHandle {
  playbackId: string;
  /** Resolves with the terminal status of this playback. */
  done: Promise<PlaybackReceipt['status']>;
}

export interface LockHandle {
  readonly id: string;
  readonly expiresAt: number;
  /** Extend the lock; returns the new expiry. */
  renew(ttlMs?: number): number;
  /** Release the lock early. */
  release(): void;
  readonly active: boolean;
}

export interface MoveToOptions {
  mode?: 'instant' | 'spring' | 'line';
  /** Duration in ms for `line` moves. */
  duration?: number;
}

export interface StatusOptions {
  /** Terminal statuses show a 10 s bubble and never auto-rotate. */
  terminal?: boolean;
}

export interface SleepResult {
  ok: boolean;
  reason?: 'no-sleep-animations' | 'already-sleeping' | 'locked';
}

export interface PetEventMap {
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

type Listener = (...args: unknown[]) => void;

const DEFAULT_TTL = 30_000;

export class Pet {
  readonly id: string;
  readonly name: string;
  readonly config: PetConfig;

  /** @internal */
  window: PetWindow | null = null;
  /** @internal */
  metrics!: WindowMetrics;

  private readonly emitter = new EventEmitter();
  private readonly physicsMerged: PhysicsParams;
  private rendererConfig: RendererConfig;

  private pose: Pose = { x: 0, y: 0, facing: 'left', sleeping: false, flying: false, dragging: false };

  // Locks
  private lockId: string | null = null;
  private lockExpiresAt = 0;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private lockTtl = DEFAULT_TTL;

  // Sleep state (host mirror of the renderer state machine)
  private sleeping = false;

  // Playback receipts
  private receipts = new Map<
    string,
    { status: PlaybackReceipt['status']; reason?: string; resolve: (s: PlaybackReceipt['status']) => void }
  >();

  // Custom menu items
  private menuItems: MenuItemSpec[] = [];

  // Commands issued before the window exists are delivered on attach.
  private pendingCommands: Array<Parameters<PetWindow['send']>[0]> = [];

  constructor(config: PetConfig, defaults: { physics?: Partial<PhysicsParams>; monitors: MonitorLike[]; primaryIndex?: number }) {
    this.config = config;
    this.id = config.id;
    this.name = config.name ?? config.id;
    this.physicsMerged = { ...DEFAULT_PHYSICS, ...(defaults.physics ?? {}), ...(config.physics ?? {}) };
    const geometry = buildGeometry(defaults.monitors);
    const fontSize = config.font?.size ?? 15;
    this.metrics = computeWindowMetrics({
      size: config.size ?? 462,
      fontSize,
      hitBox: config.hitBox,
    });
    const home = computeHome(config.position, config.size ?? 462, geometry, defaults.primaryIndex ?? 0);
    this.rendererConfig = buildRendererConfig({
      petId: config.id,
      petName: this.name,
      size: config.size ?? 462,
      assetsDir: config.assetsDir,
      metrics: this.metrics,
      geometry,
      home,
      font: {
        family: config.font?.family ?? "'Segoe UI', 'Microsoft YaHei', sans-serif",
        size: fontSize,
        file: config.font?.file ?? null,
      },
      physics: this.physicsMerged,
      animations: config.animations,
      animationWeights: config.animationWeights ?? { idle: 60, turn: 15, move: 10 },
      hitBox: config.hitBox,
      fixed: config.fixed ?? false,
      clickSound: resolveClickSound(config.clickSound),
      bubble: {
        durationMs: config.bubble?.durationMs ?? BUBBLE_DURATION_MS,
        maxWidthRatio: config.bubble?.maxWidthRatio ?? 1.2,
      },
      sleepTexts: config.sleepTexts ?? {},
      hoverReleaseMs: config.hoverReleaseMs ?? 400,
    });
  }

  // ── Internals wired by PetApp ──────────────────────────────────────────────

  /** @internal */
  get renderer(): RendererConfig {
    return this.rendererConfig;
  }

  /** @internal */
  get metricsForWindow(): WindowMetrics {
    return this.metrics;
  }

  /** @internal */
  get home(): { x: number; y: number } {
    return this.rendererConfig.home;
  }

  /** @internal */
  handleRendererEvent(type: string, payload: Record<string, unknown>): void {
    switch (type) {
      case 'ready':
        // Push the initial menu model and any queued state.
        this.sendMenuModel();
        this.emit('ready');
        return;
      case 'pose': {
        this.pose = {
          x: Number(payload.x) || 0,
          y: Number(payload.y) || 0,
          facing: (payload.facing as Facing) ?? 'left',
          sleeping: payload.sleeping === true,
          flying: this.pose.flying,
          dragging: this.pose.dragging,
        };
        this.emit('pose', this.getPose());
        return;
      }
      case 'playback': {
        const id = String(payload.playbackId ?? '');
        const status = payload.status as PlaybackReceipt['status'];
        const receipt = this.receipts.get(id);
        if (receipt) {
          receipt.status = status;
          receipt.reason = payload.reason as string | undefined;
          if (status === 'ended' || status === 'failed' || status === 'cancelled') {
            receipt.resolve(status);
          }
        }
        this.emit('playback', { playbackId: id, status, reason: payload.reason as string | undefined });
        return;
      }
      case 'throw-start':
        this.pose.flying = true;
        this.emit('throw-start', payload as unknown as { x: number; y: number; vx: number; vy: number });
        return;
      case 'throw-end':
        this.pose.flying = false;
        this.emit('throw-end', payload as unknown as { x: number; y: number; reason: string });
        return;
      case 'drag-start':
        this.pose.dragging = true;
        // User takeover: any active lock is dropped immediately.
        if (this.lockId) this.doReleaseLock('takeover');
        this.emit('drag-start', payload as unknown as { x: number; y: number });
        return;
      case 'drag-end':
        this.pose.dragging = false;
        this.emit('drag-end', payload as unknown as { x: number; y: number; vx: number; vy: number });
        return;
      case 'lock-takeover':
        if (this.lockId) this.doReleaseLock('takeover');
        return;
      case 'sleep-started':
        this.sleeping = true;
        this.emit('sleep-started');
        return;
      case 'sleep-ended':
        this.sleeping = false;
        this.emit('sleep-ended');
        return;
      case 'sleep-request': {
        const action = payload.action === 'wake' ? 'wake' : 'sleep';
        if (action === 'wake') this.wake();
        else this.sleep();
        this.emit('sleep-request', { action });
        return;
      }
      case 'menu-click':
        this.emit('menu-click', { menuId: String(payload.menuId ?? '') });
        return;
      case 'menu-action':
        this.emit('menu-action', payload as { action: string; name?: string });
        return;
      case 'ended':
        this.emit('ended', payload as { name: string; source: string });
        return;
      case 'error':
        this.emit('error', { message: String(payload.message ?? 'unknown') });
        return;
      default:
        this.emit(type as keyof PetEventMap, payload as never);
        return;
    }
  }

  /** @internal */
  handleClose(event: { preventDefault(): void; defaultPrevented: boolean }): void {
    this.emit('close', event);
    if (!event.defaultPrevented) {
      this.dispose();
    }
  }

  /** @internal Send a raw command to the renderer. */
  send(cmd: Parameters<PetWindow['send']>[0]): void {
    if (!this.window) {
      this.pendingCommands.push(cmd);
      return;
    }
    this.window.send(cmd);
  }

  /** @internal Deliver buffered commands once the window exists. */
  flushPendingCommands(): void {
    const queued = this.pendingCommands;
    this.pendingCommands = [];
    for (const cmd of queued) this.window?.send(cmd);
  }

  private emit<K extends keyof PetEventMap>(event: K, ...args: PetEventMap[K]): void {
    this.emitter.emit(event, ...args);
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  on<K extends keyof PetEventMap>(event: K, listener: (...args: PetEventMap[K]) => void): this {
    this.emitter.on(event, listener as Listener);
    return this;
  }

  once<K extends keyof PetEventMap>(event: K, listener: (...args: PetEventMap[K]) => void): this {
    this.emitter.once(event, listener as Listener);
    return this;
  }

  off<K extends keyof PetEventMap>(event: K, listener: (...args: PetEventMap[K]) => void): this {
    this.emitter.off(event, listener as Listener);
    return this;
  }

  // ── Speech ─────────────────────────────────────────────────────────────────

  /**
   * Show a speech bubble above the pet.
   *
   * ```ts
   * pet.say('你好呀~', { duration: 5000, image: 'https://…/cat.png', anim: true });
   * ```
   */
  say(text: string, options: SayOptions = {}): void {
    this.send({
      t: 'say',
      text: String(text ?? ''),
      image: resolveImage(options.image),
      duration: options.duration ?? this.rendererConfig.bubble.durationMs ?? BUBBLE_DURATION_MS,
      anim: options.anim ?? false,
      facing: options.facing,
    });
  }

  /** Hide the current speech bubble. */
  clearBubble(): void {
    this.send({ t: 'say', text: '', clear: true });
  }

  // ── Animations ─────────────────────────────────────────────────────────────

  /**
   * Play a named animation from the pool (or an external URL via `url`).
   * Returns a handle whose `done` promise reports how the playback ended.
   */
  play(name: string, options: PlayOptions & { url?: string } = {}): PlaybackHandle {
    const playbackId = `pb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.sleeping && !this.lockId) {
      // Sleeping pets refuse animations; a lock holder overrides (frozen play).
      this.send({ t: 'say', text: pick(this.config.sleepTexts?.refuse ?? ['我在睡觉……']), duration: SLEEP_REFUSE_MS });
      return {
        playbackId,
        done: Promise.resolve('cancelled' as const),
      };
    }
    const prev = [...this.receipts.entries()].find(([, r]) => r.status === 'accepted' || r.status === 'playing');
    if (prev) {
      prev[1].status = 'cancelled';
      prev[1].resolve('cancelled');
    }
    let resolve!: (s: PlaybackReceipt['status']) => void;
    const done = new Promise<PlaybackReceipt['status']>((r) => {
      resolve = r;
    });
    this.receipts.set(playbackId, { status: 'accepted', resolve });
    this.send({
      t: 'play',
      name: options.url ? undefined : name,
      url: options.url,
      facing: options.facing,
      loop: options.loop ?? false,
      squash: options.squash ?? false,
      move: options.move,
      playbackId,
    });
    return { playbackId, done };
  }

  /** Play an external animation URL (webm) once. */
  playUrl(url: string, options: Omit<PlayOptions, 'loop'> = {}): PlaybackHandle {
    return this.play(url, { ...options, url });
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  /**
   * Move the pet center to normalized desktop coordinates (0..1 across the
   * monitor hull). `mode`: `instant` teleports, `spring` chases, `line` tweens.
   */
  moveTo(x: number, y: number, options: MoveToOptions = {}): void {
    this.send({
      t: 'move',
      x: clamp01(x),
      y: clamp01(y),
      mode: options.mode ?? 'spring',
      duration: options.duration ?? 0,
    });
  }

  /** Throw the pet: `angle` in degrees (0 = right, CCW positive), `power` ×1 ≈ 1200 px/s. */
  throwAt(angle: number, power = 1): void {
    this.send({ t: 'throw', angle, power });
  }

  /** Return to the configured home position (corner placement). */
  goHome(): void {
    this.send({ t: 'home' });
  }

  /** Move the pet box top-left to an absolute physical-pixel position. */
  setPosition(x: number, y: number): void {
    const hull = this.rendererConfig.geometry.hull;
    const size = this.rendererConfig.size;
    const h = (size * 9) / 16;
    this.send({
      t: 'move',
      x: (x + size / 2 - hull.x) / hull.width,
      y: (y + h / 2 - hull.y) / hull.height,
      mode: 'instant',
    });
  }

  /** Current pose: normalized position + facing + state flags. */
  getPose(): Pose {
    return { ...this.pose };
  }

  /** Window visibility (taskbar-independent; the pet window is always hidden from the taskbar). */
  show(): void {
    this.window?.show();
  }

  hide(): void {
    this.window?.hide();
  }

  // ── Sleep ──────────────────────────────────────────────────────────────────

  /**
   * Put the pet to sleep using a random complete sleep set. The pet refuses
   * animations and wander moves until woken.
   */
  sleep(): SleepResult {
    if (!this.config.animations.sleep?.length) return { ok: false, reason: 'no-sleep-animations' };
    if (this.sleeping) return { ok: false, reason: 'already-sleeping' };
    if (this.lockId) return { ok: false, reason: 'locked' };
    const set = pickSleepSet(this.config.animations.sleep);
    if (!set) return { ok: false, reason: 'no-sleep-animations' };
    this.send({
      t: 'sleep',
      sleeping: true,
      start: pickSlot(set.start),
      loop: pickSlot(set.loop),
      end: pickSlot(set.end),
    });
    return { ok: true };
  }

  /** Wake the pet (idempotent). */
  wake(): void {
    if (!this.sleeping) {
      // Still send a wake so a stuck sleeping renderer recovers.
      this.send({ t: 'wake' });
      return;
    }
    this.send({ t: 'wake' });
  }

  /** Whether the pet is currently asleep (host-side mirror). */
  isSleeping(): boolean {
    return this.sleeping;
  }

  // ── Locks ──────────────────────────────────────────────────────────────────

  /**
   * Acquire an exclusive lock: the pet freezes (random chain stops, current
   * animation holds) until the lock expires or is released. Dragging the pet
   * takes the lock away immediately (user priority).
   */
  acquireLock(options: { ttl?: number } = {}): LockHandle {
    const ttl = Math.max(1000, options.ttl ?? this.lockTtl);
    this.lockTtl = ttl;
    // Acquiring wakes the pet first.
    if (this.sleeping) this.wake();
    const id = this.lockId ?? `lock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.lockId = id;
    this.lockExpiresAt = Date.now() + ttl;
    this.send({ t: 'freeze', frozen: true });
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => this.doReleaseLock('expired'), ttl);
    this.lockTimer.unref?.();
    this.emit('lock-acquired', { id, expiresAt: this.lockExpiresAt });
    const pet = this;
    return {
      id,
      get expiresAt() {
        return pet.lockExpiresAt;
      },
      get active() {
        return pet.lockId === id;
      },
      renew(ttlMs?: number): number {
        if (pet.lockId !== id) return pet.lockExpiresAt;
        const t = Math.max(1000, ttlMs ?? pet.lockTtl);
        pet.lockExpiresAt = Date.now() + t;
        if (pet.lockTimer) clearTimeout(pet.lockTimer);
        pet.lockTimer = setTimeout(() => pet.doReleaseLock('expired'), t);
        pet.lockTimer.unref?.();
        return pet.lockExpiresAt;
      },
      release(): void {
        if (pet.lockId === id) pet.doReleaseLock('released');
      },
    };
  }

  private doReleaseLock(reason: 'released' | 'expired' | 'takeover'): void {
    const id = this.lockId;
    if (!id) return;
    this.lockId = null;
    this.lockExpiresAt = 0;
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    this.send({ t: 'freeze', frozen: false });
    this.emit('lock-released', { id, reason });
  }

  /** Release the current lock if any. */
  releaseLock(): void {
    this.doReleaseLock('released');
  }

  /** Whether a lock is currently active. */
  isLocked(): boolean {
    return this.lockId !== null && this.lockExpiresAt > Date.now();
  }

  // ── Status linkage ─────────────────────────────────────────────────────────

  /**
   * Set an external status level (indexes `animations.events.status`) with an
   * optional bubble text. Non-terminal levels rotate multi-candidate slots and
   * keep their animation looping; terminal levels play once and show a 10 s
   * bubble.
   *
   * ```ts
   * pet.setStatus(1, '干活中…');          // persistent "working" state
   * pet.setStatus(4, '完成！', { terminal: true });
   * ```
   */
  setStatus(level: number, text?: string, options: StatusOptions = {}): void {
    this.send({
      t: 'status',
      level: Math.max(0, Math.floor(level)),
      text: text ?? null,
      terminal: options.terminal ?? false,
    });
  }

  /** Clear the status and return to the random chain. */
  clearStatus(): void {
    this.send({ t: 'status-clear' });
  }

  // ── Menus ──────────────────────────────────────────────────────────────────

  /** Replace the custom context-menu items (built-in items stay). */
  setMenuItems(items: MenuItemSpec[]): void {
    this.menuItems = items.slice();
    this.sendMenuModel();
  }

  /** Add or replace one custom menu item. */
  addMenuItem(item: MenuItemSpec): void {
    const idx = this.menuItems.findIndex((i) => i.id === item.id);
    if (idx >= 0) this.menuItems[idx] = item;
    else this.menuItems.push(item);
    this.sendMenuModel();
  }

  /** Remove a custom menu item by id. */
  removeMenuItem(id: string): void {
    this.menuItems = this.menuItems.filter((i) => i.id !== id);
    this.sendMenuModel();
  }

  private sendMenuModel(): void {
    const nodes = this.menuItems
      .filter((i) => i.enabled !== false)
      .map((i) => ({ id: i.id, label: i.label, group: i.group }));
    this.send({ t: 'menu', items: nodes });
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  /** Force the click feedback sound (when enabled in the config). */
  playClickSound(): void {
    this.send({ t: 'sound' });
  }

  /** Play the squash-and-stretch feedback with a custom depth. */
  squash(amount = 0.55): void {
    this.send({ t: 'squash', amount });
  }

  /** Recompute geometry after monitor topology changed (called by PetApp). */
  /** @internal */
  refreshGeometry(monitors: MonitorLike[], primaryIndex = 0): void {
    const geometry = buildGeometry(monitors);
    const home = computeHome(this.config.position, this.config.size ?? 462, geometry, primaryIndex);
    this.rendererConfig = { ...this.rendererConfig, geometry, home };
    this.metrics = computeWindowMetrics({
      size: this.config.size ?? 462,
      fontSize: this.rendererConfig.font.size,
      hitBox: this.config.hitBox,
    });
    this.window?.updateGeometry(this.rendererConfig, this.metrics, this.window.boxX, this.window.boxY);
  }

  /** @internal */
  updateMonitors(monitors: MonitorLike[], primaryIndex = 0): void {
    this.refreshGeometry(monitors, primaryIndex);
  }

  /** Destroy the pet window and release resources. */
  dispose(): void {
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
    this.lockId = null;
    for (const [, r] of this.receipts) {
      if (r.status === 'accepted' || r.status === 'playing') {
        r.status = 'cancelled';
        r.resolve('cancelled');
      }
    }
    this.receipts.clear();
    this.window?.dispose();
    this.window = null;
    this.emitter.removeAllListeners();
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

function resolveClickSound(clickSound: boolean | string | undefined): string | null {
  if (clickSound === true) return 'sound/click.wav';
  if (typeof clickSound === 'string' && clickSound) {
    return clickSound.startsWith('http') || clickSound.startsWith('pet://') ? clickSound : 'local/' + encodeURIComponent(clickSound);
  }
  return null;
}

function resolveImage(image: string | undefined): string | undefined {
  if (!image) return undefined;
  return image.startsWith('http') || image.startsWith('pet://') ? image : 'local/' + encodeURIComponent(image);
}

// Terminal bubble duration is exposed for consumers implementing custom UIs.
export { TERMINAL_BUBBLE_DURATION_MS };
