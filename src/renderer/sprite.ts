/**
 * PetSprite — the renderer-side pet body: dual-buffer webm playback, the random
 * animation chain, drag/throw physics, the speech bubble and the context menu.
 *
 * Coordinates: motion math runs in physical pixels (screen space); DOM layout
 * is percentage-based so it is scale-factor independent; pointer coordinates
 * (CSS px) are converted at the boundary via devicePixelRatio.
 */
import {
  ASSET_LOAD_TIMEOUT_MS,
  BUBBLE_DURATION_MS,
  CANVAS_H,
  CANVAS_W,
  CLICK_SOUND_MS,
  CLICK_SOUND_VOLUME,
  CROSSFADE_MS,
  DEFAULT_HIT_BOX,
  DRAG_THRESHOLD,
  FLIGHT_REPORT_MS,
  MAX_STEP_DT,
  SLEEP_REFUSE_MS,
  SLINGSHOT_DOUBLE_MS,
  SQ_DURATION_MS,
  SQ_HARD_SPEED,
  SQ_MAX_SQUASH,
  SQ_SOFT_SPEED,
  SQ_SQUASH,
  TERMINAL_BUBBLE_DURATION_MS,
} from '../shared/constants.js';
import {
  clampPointToRegion,
  bodyPixelBox,
  collidePet,
  estimateReleaseVelocity,
  landingSquash,
  pullAngle,
  rectsOverlap,
  resolveRect,
  screenOfBox,
  slingshotPower,
  slingshotVelocity,
  softClampSpeed,
  springStep,
  squashScale,
  throwFrame,
  throwSpace,
  throwVelocity,
  trimTrail,
  type DragSample,
  type Rect,
  type ThrowSpace,
  type ThrowState,
} from '../shared/physics.js';
import {
  anchorPixel,
  planMove,
  type MovePlan,
} from '../shared/motion.js';
import {
  isEventAnim,
  nextStatusAnim,
  pick,
  pickCategoryAction,
  pickSlot,
  rollKind,
} from '../shared/pickers.js';
import type {
  DisplayGeometry,
  Facing,
  HostCommand,
  MenuNode,
  MovePayload,
  RendererConfig,
  SleepPayload,
} from '../shared/types.js';

declare global {
  interface Window {
    __PET_CONFIG__?: RendererConfig;
    __petDispatch__?: (cmd: HostCommand) => void;
    ipc?: { postMessage: (msg: string) => void };
    webviewjs?: { startDragging: () => void };
  }
}

interface PendingMove {
  plan: MovePlan;
  dir: 1 | -1;
  leadSec: number;
  tailSec: number;
}

interface SayState {
  text: string;
  image?: string;
  expiresAt: number | null; // null = persistent until replaced
}

export class PetSprite {
  readonly config: RendererConfig;

  // ── DOM ────────────────────────────────────────────────────────────────────
  private readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly hitEl: HTMLElement;
  private readonly bubbleEl: HTMLElement;
  private readonly menuEl: HTMLElement;
  private readonly videoA: HTMLVideoElement;
  private readonly videoB: HTMLVideoElement;
  private clickAudio: HTMLAudioElement | null = null;
  private lastClickSoundAt = 0;

  // ── Layout (physical px) ───────────────────────────────────────────────────
  readonly size: number;
  readonly height: number;
  readonly halfW: number;
  readonly halfH: number;
  readonly bottomPad: number;
  readonly winH: number;
  readonly margin: { t: number; r: number; b: number; l: number };
  readonly hitRect: { x: number; y: number; w: number; h: number };
  readonly sideAllow: number;

  // ── Position & facing (physical px, screen space) ──────────────────────────
  pos: { x: number; y: number } | null = null;
  private _facing: Facing = 'left';
  customPos: { rx: number; ry: number } | null = null;

  // ── Playback ───────────────────────────────────────────────────────────────
  private front = 0;
  private gen = 0;
  private pending: { anim: string; once: boolean; gen: number } | null = null;
  private pendingSquash = false;
  anim = '';
  private once = true;
  private lastSource: 'name' | 'url' = 'name';
  private playback: string | null = null;
  private frozen = false;

  // ── Sleep state machine ────────────────────────────────────────────────────
  sleeping = false;
  private sleepSet: SleepPayload | null = null;
  private sleepPhase: 'start' | 'loop' | 'end' | null = null;

  // ── Status (external state linkage) ────────────────────────────────────────
  private statusLevel: number | null = null;
  private statusTerminal = false;
  private statusText: string | null = null;

  // ── Bubble ─────────────────────────────────────────────────────────────────
  private sayState: SayState | null = null;
  private bubbleTimer: number | null = null;

  // ── Motion drivers ─────────────────────────────────────────────────────────
  private pendingMove: PendingMove | null = null;
  private moveRef = 0;
  private moveToken = 0;
  private dragFollowRef = 0;
  private dragFollowToken = 0;
  private dragTarget: { x: number; y: number } | null = null;
  private dragVel = { vx: 0, vy: 0 };
  private throwRef = 0;
  private throwToken = 0;
  throwState: ThrowState | null = null;
  private posFollowRef = 0;
  private posFollowToken = 0;
  private squashRef = 0;
  private squashToken = 0;
  private lastFlightReport = 0;
  private poseTimer: number | null = null;
  private space: ThrowSpace | null = null;
  private geometry: DisplayGeometry;

  // ── Input state ────────────────────────────────────────────────────────────
  private dragState: {
    active: boolean;
    dragging: boolean;
    sx: number;
    sy: number;
    petX: number;
    petY: number;
    pressT: number;
    moveT: number;
    moveX: number;
    moveY: number;
    sling?: boolean;
    anchorX?: number;
    anchorY?: number;
  } = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0, pressT: 0, moveT: 0, moveX: 0, moveY: 0 };
  private dragTrail: DragSample[] = [];
  private lastPressAt = -Infinity;
  private justDragged = false;
  private menuOpen = false;
  private inputBusyFlag = false;
  private interactiveFlag = false;

  constructor(config: RendererConfig) {
    this.config = config;
    this.size = config.size;
    this.height = (this.size * 9) / 16;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = config.window.bottomPad;
    this.winH = this.height + this.bottomPad;
    this.margin = {
      t: config.window.marginT,
      r: config.window.marginR,
      b: config.window.marginB,
      l: config.window.marginL,
    };
    this.geometry = config.geometry;

    const hb = config.hitBox ?? DEFAULT_HIT_BOX;
    // Hit rect in window-relative physical px (includes the stage bottomPad shift).
    this.hitRect = {
      x: (hb.x0 / CANVAS_W) * this.size,
      y: this.bottomPad + (hb.y0 / CANVAS_H) * this.height,
      w: ((hb.x1 - hb.x0) / CANVAS_W) * this.size,
      h: ((hb.y1 - hb.y0) / CANVAS_H) * this.height,
    };
    this.sideAllow = (hb.x0 / CANVAS_W) * this.size;

    this.root = document.getElementById('pet-root')!;
    this.stage = document.getElementById('pet-stage')!;
    this.hitEl = document.getElementById('pet-hit')!;
    this.bubbleEl = document.getElementById('pet-bubble')!;
    this.menuEl = document.getElementById('pet-menu')!;
    this.videoA = document.getElementById('pet-vid-a') as HTMLVideoElement;
    this.videoB = document.getElementById('pet-vid-b') as HTMLVideoElement;

    this.applyLayout();
    this.bindEvents();
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  /** Percentage layout: physical metrics become fractions of the viewport. */
  private applyLayout(): void {
    const winW = this.size + this.margin.l + this.margin.r;
    const winH = this.winH + this.margin.t + this.margin.b;
    const dpr = window.devicePixelRatio || 1;
    const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(4)}%`;

    this.stage.style.left = pct(this.margin.l, winW);
    this.stage.style.top = pct(this.margin.t, winH);
    this.stage.style.width = pct(this.size, winW);
    this.stage.style.height = pct(this.height, winH);
    // The stage sits shifted down by bottomPad at rest (feet stay visible).
    this.stage.style.setProperty('--bottom-pad-ratio', `${(((this.bottomPad / this.height) * 100) || 0).toFixed(4)}%`);
    this.stage.style.transform = `translateY(${((this.bottomPad / this.height) * 100).toFixed(4)}%)`;

    const hx = this.margin.l + this.hitRect.x;
    const hy = this.margin.t + this.hitRect.y;
    this.hitEl.style.left = pct(hx, winW);
    this.hitEl.style.top = pct(hy, winH);
    this.hitEl.style.width = pct(this.hitRect.w, winW);
    this.hitEl.style.height = pct(this.hitRect.h, winH);

    const rootStyle = this.root.style;
    rootStyle.setProperty('--pet-font', this.config.font.family);
    rootStyle.setProperty('--pet-font-size', `${((this.config.font.size / winW) * 100).toFixed(3)}vw`);
    rootStyle.setProperty('--bubble-max-w', `${((this.config.bubble.maxWidthRatio * this.size) / winW * 100).toFixed(3)}vw`);
    // Anchor the bubble just above the stage (which sits marginT+bottomPad down).
    const bubbleBottom = winH - this.margin.t - this.bottomPad + 8;
    rootStyle.setProperty('--bubble-bottom', `${((bubbleBottom / winH) * 100).toFixed(3)}%`);
    void dpr;
  }

  private bindEvents(): void {
    this.hitEl.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.hitEl.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    window.addEventListener('blur', () => this.onWindowBlur());
  }

  // ── Bridge helpers ─────────────────────────────────────────────────────────

  private emit(type: string, payload: unknown): void {
    try {
      window.ipc?.postMessage(JSON.stringify([type, payload]));
    } catch {
      /* bridge not ready */
    }
  }

  // ── Facing ─────────────────────────────────────────────────────────────────

  get facing(): Facing {
    return this._facing;
  }

  set facing(next: Facing) {
    const value = next === 'right' ? 'right' : 'left';
    if (this._facing === value) return;
    this._facing = value;
    this.markPoseDirty();
    this.applyVideoTransform();
  }

  private applyVideoTransform(): void {
    const mirror = this._facing === 'right' ? 'scaleX(-1) ' : '';
    for (const el of [this.videoA, this.videoB]) {
      if (!el.classList.contains('is-front')) continue;
      if (!el.style.transform.includes('scaleY')) el.style.transform = mirror.trim();
    }
  }

  // ── Pose / bounds reporting ────────────────────────────────────────────────

  private markPoseDirty(): void {
    if (this.poseTimer !== null) return;
    this.poseTimer = window.setTimeout(() => {
      this.poseTimer = null;
      this.reportPose();
    }, 400);
  }

  private reportPose(): void {
    if (!this.pos) return;
    const hull = this.geometry.hull;
    this.emit('pose', {
      x: (this.pos.x + this.halfW - hull.x) / hull.width,
      y: (this.pos.y + this.halfH - hull.y) / hull.height,
      facing: this._facing,
      sleeping: this.sleeping,
    });
  }

  /** All movement funnels through here: updates `pos` and moves the window. */
  sendBounds(px: number, py: number): void {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    this.emit('move-window', {
      x: Math.round(px - this.margin.l),
      y: Math.round(py - this.margin.t),
    });
    this.markPoseDirty();
  }

  /** Initial placement: corner anchor or custom position. */
  position(): void {
    const hull = this.geometry.hull;
    let x: number;
    let y: number;
    if (this.customPos) {
      x = this.customPos.rx * hull.width + hull.x - this.halfW;
      y = this.customPos.ry * hull.height + hull.y - this.halfH;
    } else {
      const home = this.config.home;
      x = home.x;
      y = home.y;
    }
    this.sendBounds(x, y);
  }

  /** Home = the configured anchor position (corner placement). */
  goHome(): void {
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  }

  currentCenterX(): number {
    if (this.pos) return this.pos.x + this.halfW;
    return 0;
  }

  currentCenterY(): number {
    if (this.pos) return this.pos.y + this.halfH;
    return 0;
  }

  // ── Throw space ────────────────────────────────────────────────────────────

  private throwSpaceOf(): ThrowSpace {
    if (!this.space) {
      this.space = throwSpace({
        areas: this.geometry.areas,
        panels: this.geometry.panels,
        size: this.size,
        sideAllow: this.sideAllow,
      });
    }
    return this.space;
  }

  /** Display geometry changed: rebuild the throw space and re-locate the pet. */
  setGeometry(geo: DisplayGeometry, home?: { x: number; y: number }): void {
    this.geometry = geo;
    if (home) (this.config as { home: { x: number; y: number } }).home = home;
    this.space = null;
    if (this.dragState.active || this.throwState) return;
    this.stopMove();
    if (!this.pos) {
      this.position();
      return;
    }
    // Preserve world position; clamp back onto the visible union if a screen
    // disappeared from under the pet.
    const centerOld = { x: this.pos.x + this.halfW, y: this.pos.y + this.halfH };
    const clamped = clampPointToRegion(geo.areas, centerOld.x, centerOld.y);
    if (clamped.x !== centerOld.x || clamped.y !== centerOld.y) {
      this.customPos = {
        rx: (clamped.x - geo.hull.x) / geo.hull.width,
        ry: (clamped.y - geo.hull.y) / geo.hull.height,
      };
    } else if (this.customPos) {
      this.customPos = {
        rx: (centerOld.x - geo.hull.x) / geo.hull.width,
        ry: (centerOld.y - geo.hull.y) / geo.hull.height,
      };
    }
    this.position();
  }

  // ── Playback engine ────────────────────────────────────────────────────────

  /**
   * Dual-buffer source switch with crossfade. `next` is a pool name (served
   * from the asset base) unless `url` is set. `once=false` loops forever.
   */
  switchTo(next: string, nextOnce: boolean, playbackId?: string | null, url?: string): void {
    if (!next) return;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) {
      // Same target already loading: keep the squash feedback alive.
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(this.front === 0 ? this.videoA : this.videoB);
      }
      if (playbackId) {
        this.playback = playbackId;
        this.emit('playback', { playbackId, status: 'playing' });
      }
      return;
    }
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const el = this.front === 0 ? this.videoB : this.videoA;
    this.lastSource = url ? 'url' : 'name';
    el.src = url || this.config.assetBase + encodeURIComponent(next) + '.webm';
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    const loadGuard = (why: string, reason: string) => {
      if (!this.pending || this.pending.gen !== gen) return;
      this.pending = null;
      console.warn('[webview-pet] asset load failed anim=' + next + ': ' + why);
      if (playbackId) {
        if (this.playback === playbackId) this.playback = null;
        this.emit('playback', { playbackId, status: 'failed', reason });
      }
    };
    const loadTimer = window.setTimeout(() => loadGuard('10s timeout', 'asset-load'), ASSET_LOAD_TIMEOUT_MS);
    el.onerror = () => {
      window.clearTimeout(loadTimer);
      loadGuard('video error', 'decode-error');
    };
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      window.clearTimeout(loadTimer);
      el.onerror = null;
      if (this.pending && this.pending.gen !== gen) return;
      const old = this.front === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        old.pause();
        if (this.playback && this.playback !== playbackId) {
          this.emit('playback', { playbackId: this.playback, status: 'cancelled', reason: 'superseded' });
        }
      }
      this.front = this.front === 0 ? 1 : 0;
      this.pending = null;
      this.playback = playbackId || null;
      el.style.transform = this._facing === 'right' ? 'scaleX(-1)' : '';
      el.play()
        .then(() => {
          if (playbackId) this.emit('playback', { playbackId, status: 'playing' });
        })
        .catch(() => {
          if (!playbackId) return;
          if (this.playback === playbackId) this.playback = null;
          this.emit('playback', { playbackId, status: 'failed', reason: 'play-rejected' });
        });
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(el);
      }
      if (this.pendingMove) this.startMoveDrive(el);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }

  playOnce(name: string, playbackId?: string | null, url?: string): void {
    this.anim = name;
    this.once = true;
    this.switchTo(name, true, playbackId, url);
  }

  playUrlOnce(url: string, playbackId?: string | null): void {
    this.stopMove();
    this.anim = url;
    this.once = true;
    this.switchTo(url, true, playbackId, url);
  }

  // ── Random chain ───────────────────────────────────────────────────────────

  /** The single entry of the random chain, reached when a playback ends. */
  playIdle(): void {
    if (this.frozen) return;
    if (this.sleeping) return;
    this.stopMove();
    const { animations, animationWeights } = this.config;
    const roll = Math.random();
    const k = rollKind(roll, animationWeights, { fixed: this.config.fixed });
    let next: string;
    if (k === 'idle') {
      next = pick(animations.idle, this.anim);
    } else if (k === 'turn') {
      next = pick(animations.turn ?? [], this.anim);
    } else if (k === 'move') {
      const moved = this.tryMove();
      if (moved === false) {
        next = pickCategoryAction(animations.categories ?? [], animations.idle, this._facing, this.anim).name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        this.playOnce(this.anim);
        return;
      }
    } else {
      next = pickCategoryAction(animations.categories ?? [], animations.idle, this._facing, this.anim).name;
    }
    this.playOnce(next);
  }

  /** Chain advancement after a one-shot playback ends. */
  handleEnded(): void {
    if (this.playback) {
      const done = this.playback;
      this.playback = null;
      this.emit('playback', { playbackId: done, status: 'ended' });
    }
    this.emit('ended', { name: this.anim, source: this.lastSource });
    // Sleep state machine owns the chain while asleep.
    if (this.sleeping) {
      const set = this.sleepSet;
      if (set && this.sleepPhase === 'start') {
        this.sleepPhase = 'loop';
        this.anim = set.loop;
        this.once = false;
        this.switchTo(set.loop, false);
        return;
      }
      if (set && this.sleepPhase === 'end') {
        this.sleeping = false;
        this.sleepSet = null;
        this.sleepPhase = null;
        this.emit('sleep-ended', {});
        this.playIdle();
        return;
      }
      if (set && this.anim !== set.loop) {
        this.anim = set.loop;
        this.once = false;
        this.switchTo(set.loop, false);
      }
      return;
    }
    if (this.dragState.active) return;
    if (this.frozen) return;
    const { animations } = this.config;
    if (isEventAnim(animations.events, this.anim)) {
      // Status animations rotate within their slot while the status persists.
      const pool = animations.events?.status ?? [];
      const next = this.statusLevel !== null && !this.statusTerminal ? nextStatusAnim(pool, this.anim) : null;
      if (next !== null) {
        this.playOnce(next);
        return;
      }
      if (this.resumeStatusAnim()) return;
      if (animations.idle.length) this.playOnce(pick(animations.idle, this.anim));
      return;
    }
    if ((animations.turn ?? []).includes(this.anim)) {
      this.facing = this._facing === 'left' ? 'right' : 'left';
    }
    if ((animations.drag ?? []).includes(this.anim) || (animations.clicks ?? []).includes(this.anim)) {
      if (this.resumeStatusAnim()) return;
      if (animations.idle.length) this.playOnce(pick(animations.idle, this.anim));
      return;
    }
    this.playIdle();
  }

  /** Resume the status-slot loop after an interaction animation ends. */
  resumeStatusAnim(): boolean {
    if (this.frozen || this.sleeping) return false;
    const level = this.statusLevel;
    if (level === null || this.statusTerminal) return false;
    const pool = this.config.animations.events?.status;
    if (!pool || pool.length === 0) return false;
    const slot = pool[level];
    if (slot === undefined) return false;
    const name = pickSlot(slot, this.anim);
    const rotating = Array.isArray(slot) && slot.length > 1;
    if (rotating) this.playOnce(name);
    else this.switchTo(name, false);
    return true;
  }

  // ── Sleep ──────────────────────────────────────────────────────────────────

  /** Sleep state command: `{sleeping:true, start, loop, end}` or `{sleeping:false}`. */
  setSleep(state: SleepPayload | { sleeping: false }): void {
    if (!state.sleeping) {
      if (!this.sleeping || this.sleepPhase === 'end') return;
      if (this.sleepPhase === 'start') {
        // Interrupted while falling asleep: cancel without playing the wake-up.
        this.sleeping = false;
        this.sleepSet = null;
        this.sleepPhase = null;
        this.emit('sleep-ended', {});
        return;
      }
      this.sleepPhase = 'end';
      this.stopMove();
      this.playOnce(this.sleepSet!.end);
      return;
    }
    if (this.sleeping) return;
    const set = state;
    this.sleeping = true;
    this.sleepSet = set;
    this.sleepPhase = 'start';
    this.stopMove();
    this.setStatusInternal(null, false, null);
    this.playOnce(set.start);
    this.sayRandom(this.config.sleepTexts.start, SLEEP_REFUSE_MS);
    this.emit('sleep-started', {});
  }

  /** Click while asleep: request a wake-up (host mirrors the state). */
  requestWake(): void {
    this.emit('sleep-request', { action: 'wake' });
  }

  requestSleep(): void {
    this.emit('sleep-request', { action: 'sleep' });
  }

  /** Refuse text shown when a request is rejected because the pet is asleep. */
  refuseWhileSleeping(): void {
    this.sayRandom(this.config.sleepTexts.refuse, SLEEP_REFUSE_MS);
  }

  private sayRandom(pool: string[] | undefined, duration: number): void {
    if (!pool || pool.length === 0) return;
    this.showSay(pick(pool), undefined, duration, false);
  }

  // ── Freeze (lock) ──────────────────────────────────────────────────────────

  applyFreeze(next: boolean): void {
    if (this.frozen === next) return;
    this.frozen = next;
    const el = this.front === 0 ? this.videoA : this.videoB;
    if (next) {
      this.stopMove();
      if (el) el.pause();
      const interrupted = this.playback;
      if (interrupted) {
        this.playback = null;
        this.emit('playback', { playbackId: interrupted, status: 'cancelled', reason: 'frozen' });
      }
      this.setStatusInternal(this.statusLevel, this.statusTerminal, null);
      return;
    }
    // Unfreeze: resume the sleep pose, then the status loop, else one idle.
    if (this.sleeping) {
      if (el) el.play().catch(() => {});
      return;
    }
    if (this.resumeStatusAnim()) return;
    if (this.config.animations.idle.length) this.playOnce(pick(this.config.animations.idle, this.anim));
  }

  // ── Status linkage ─────────────────────────────────────────────────────────

  setStatus(level: number, text: string | null, terminal: boolean): void {
    this.setStatusInternal(level, terminal, text);
  }

  private setStatusInternal(level: number | null, terminal: boolean, text: string | null): void {
    this.statusLevel = level;
    this.statusTerminal = terminal;
    this.statusText = text;
    if (level !== null) {
      // Pick and play the status animation unless frozen or asleep.
      if (!this.frozen && !this.sleeping) {
        const pool = this.config.animations.events?.status;
        const slot = pool?.[level];
        if (slot !== undefined) {
          const name = pickSlot(slot, this.anim);
          if (Array.isArray(slot) && slot.length > 1) this.playOnce(name);
          else this.switchTo(name, false);
        }
      }
    }
    this.renderBubble();
  }

  clearStatus(): void {
    this.setStatusInternal(null, false, null);
    if (!this.frozen && !this.sleeping && !this.dragState.active) {
      if (this.config.animations.idle.length) this.playOnce(pick(this.config.animations.idle, this.anim));
    }
  }

  // ── Bubble ─────────────────────────────────────────────────────────────────

  /**
   * Show a speech bubble. `anim` links an `events.whisper` animation.
   */
  showSay(text: string, image?: string, duration?: number, anim = false, facing?: Facing): void {
    const d = duration ?? this.config.bubble.durationMs ?? BUBBLE_DURATION_MS;
    this.sayState = {
      text,
      image,
      expiresAt: d > 0 ? Date.now() + d : null,
    };
    if (anim && !this.frozen && !this.sleeping && !this.dragState.active) {
      const pool = this.config.animations.events?.whisper;
      if (pool && pool.length) {
        const name = pickSlot(pool[0]!, this.anim);
        this.playOnce(name);
      }
    }
    if (facing) this.facing = facing;
    this.renderBubble();
    this.scheduleBubbleExpire();
  }

  clearSay(): void {
    this.sayState = null;
    this.renderBubble();
    if (this.bubbleTimer !== null) {
      window.clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
  }

  private scheduleBubbleExpire(): void {
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = null;
    const expiries = [this.sayState?.expiresAt, this.statusTerminal ? (this.statusExpires ?? null) : null].filter(
      (v): v is number => typeof v === 'number',
    );
    if (expiries.length === 0) return;
    const next = Math.min(...expiries);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubbleTimer = null;
      const now = Date.now();
      if (this.sayState && this.sayState.expiresAt !== null && this.sayState.expiresAt <= now) this.sayState = null;
      if (this.statusTerminal && this.statusExpires !== null && this.statusExpires <= now) {
        this.setStatusInternal(null, false, null);
      }
      this.renderBubble();
      this.scheduleBubbleExpire();
    }, Math.max(0, next - Date.now()) + 20);
  }

  private statusExpires: number | null = null;

  /**
   * Single-slot bubble rendering. Priority: terminal status (does not yield)
   * > say > persistent status (yields freely).
   */
  renderBubble(): void {
    if (this.statusTerminal && this.statusText) {
      if (this.statusExpires === null) this.statusExpires = Date.now() + TERMINAL_BUBBLE_DURATION_MS;
    } else {
      this.statusExpires = null;
    }
    let show: SayState | null = null;
    if (this.statusTerminal && this.statusText) {
      show = { text: this.statusText, expiresAt: this.statusExpires };
    } else if (this.sayState) {
      show = this.sayState;
    } else if (this.statusText) {
      show = { text: this.statusText, expiresAt: null };
    }
    if (!show) {
      this.bubbleEl.classList.remove('is-on');
      this.bubbleEl.innerHTML = '';
      return;
    }
    const key = show.text + '|' + (show.image ?? '');
    if (this.bubbleEl.dataset.key === key && this.bubbleEl.classList.contains('is-on')) return;
    this.bubbleEl.dataset.key = key;
    this.bubbleEl.innerHTML = '';
    const text = document.createElement('div');
    text.textContent = show.text;
    this.bubbleEl.appendChild(text);
    if (show.image) {
      const img = document.createElement('img');
      img.className = 'bubble-img';
      img.src = show.image;
      img.addEventListener('error', () => img.remove());
      this.bubbleEl.appendChild(img);
    }
    this.bubbleEl.classList.add('is-on');
    this.scheduleBubbleExpire();
  }

  // ── Squash ─────────────────────────────────────────────────────────────────

  startSquash(el: HTMLVideoElement, depth = SQ_SQUASH): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const token = ++this.squashToken;
    if (this.squashRef) cancelAnimationFrame(this.squashRef);
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / SQ_DURATION_MS, 1);
      const scale = squashScale(u, depth);
      el.style.transform = (this._facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = 0;
        el.style.transformOrigin = '';
        el.style.transform = this._facing === 'right' ? 'scaleX(-1)' : '';
      }
    };
    this.squashRef = requestAnimationFrame(step);
  }

  private stopSquash(): void {
    this.squashToken++;
    if (this.squashRef) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = 0;
    }
  }

  // ── Motion: wander ─────────────────────────────────────────────────────────

  /** Plan and start a wander move. Returns false when no route is possible. */
  tryMove(preferredName?: string, playbackId?: string | null): boolean | string {
    if (this.moveRef || this.pendingMove || this.throwState) return true;
    const moves = this.config.animations.moves;
    if (!moves || !moves.actions.length) return false;
    const chosen = preferredName
      ? moves.actions.find((a) => a.name === preferredName) || null
      : moves.actions[Math.floor(Math.random() * moves.actions.length)];
    if (!chosen) return false;
    const mp = { ...moves.default, ...(chosen.params ?? {}) };
    const dir: 1 | -1 = this._facing === 'right' ? 1 : -1;
    const hull = this.geometry.hull;
    const distScale = this.size / 462;
    const cx = this.currentCenterX();
    const cy = this.currentCenterY();
    const wanderArea = this.config.physics.confineToScreen ? resolveRect(this.geometry.areas, cx, cy) : null;
    const plan = planMove({
      cx: cx - hull.x,
      cy: cy - hull.y,
      W: hull.width,
      H: hull.height,
      dir,
      minDist: mp.minDist * distScale,
      maxDist: mp.maxDist * distScale,
      margin: mp.margin,
      halfW: this.halfW,
      sideAllow: this.sideAllow,
      areas: wanderArea ? [{ x: wanderArea.x - hull.x, y: wanderArea.y - hull.y, width: wanderArea.width, height: wanderArea.height }] : undefined,
    });
    if (!plan) return false;
    this.pendingMove = { plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.anim = chosen.name;
    this.once = true;
    this.switchTo(chosen.name, true, playbackId);
    return chosen.name;
  }

  /** Drive window movement during a wander animation (lead/tail hold still). */
  private startMoveDrive(el: HTMLVideoElement): void {
    const pm = this.pendingMove;
    if (!pm || this.moveRef) return;
    this.pendingMove = null;
    const { plan, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const hull = this.geometry.hull;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX: number;
      if (t <= leadSec) ratioX = plan.startRatio;
      else if (t >= duration - tailSec) ratioX = plan.targetRatio;
      else ratioX = plan.startRatio + (plan.targetRatio - plan.startRatio) * ((t - leadSec) / travelWindow);
      const targetX = ratioX * hull.width + hull.x - this.halfW;
      const targetY = plan.startYRatio * hull.height + hull.y - this.halfH;
      this.sendBounds(targetX, targetY);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = 0;
        this.customPos = { rx: (targetX + this.halfW - hull.x) / hull.width, ry: (targetY + this.halfH - hull.y) / hull.height };
        this.emit('move-ended', { x: this.customPos.rx, y: this.customPos.ry });
      }
    };
    this.moveRef = requestAnimationFrame(step);
  }

  stopMove(): void {
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRef) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = 0;
    }
    this.stopPosFollow();
  }

  // ── Motion: drag follow ────────────────────────────────────────────────────

  private stopDragFollow(): void {
    this.dragFollowToken++;
    if (this.dragFollowRef) {
      cancelAnimationFrame(this.dragFollowRef);
      this.dragFollowRef = 0;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  }

  private startDragFollow(): void {
    if (this.dragFollowRef) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target || !this.pos) {
        this.dragFollowRef = 0;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, MAX_STEP_DT * 2);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = springStep(vel.vx, x, target.x, dt, this.config.physics.throwPower);
      vel.vy = springStep(vel.vy, y, target.y, dt, this.config.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y);
      this.dragFollowRef = requestAnimationFrame(step);
    };
    this.dragFollowRef = requestAnimationFrame(step);
  }

  // ── Motion: throw ──────────────────────────────────────────────────────────

  stopThrow(): void {
    this.throwToken++;
    if (this.throwRef) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = 0;
    }
    this.throwState = null;
  }

  /** Gravity integration with edge bouncing, landing squash and flight reports. */
  startThrow(px: number, py: number, vx: number, vy: number): void {
    this.stopDragFollow();
    this.stopMove();
    const physics = this.config.physics;
    const lockScreen = physics.confineToScreen ? screenOfBox(this.throwSpaceOf(), px, py) : -1;
    const token = ++this.throwToken;
    let state: ThrowState = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false;
    this.emit('throw-start', { x: px, y: py, vx, vy });
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy;
      const sp = this.throwSpaceOf();
      const res = throwFrame(state, dt, sp, physics, lockScreen);
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.throwState = state;
      if (now - this.lastFlightReport > FLIGHT_REPORT_MS) {
        this.lastFlightReport = now;
        this.emit('flight', {
          x: state.x + this.halfW,
          y: state.y + this.halfH,
          vx: state.vx,
          vy: state.vy,
          size: this.size,
        });
      }
      // Local multi-pet collision against host-broadcast peer states.
      if (physics.petCollision) {
        const myBody = bodyPixelBox({
          x: state.x,
          y: state.y,
          size: this.size,
          bottomPad: this.bottomPad,
          hitBox: this.config.hitBox,
        });
        for (const [id, o] of Object.entries(this.others)) {
          if (!o) continue;
          const otherBody = bodyPixelBox({
            x: o.x,
            y: o.y,
            size: o.size,
            bottomPad: o.bottomPad ?? 0,
            hitBox: this.config.hitBox,
          });
          if (!rectsOverlap(myBody, otherBody)) continue;
          const hit = collidePet(
            { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: this.size },
            { x: o.x, y: o.y, vx: o.vx, vy: o.vy, size: o.size },
          );
          if (hit) {
            state.vx = hit.fvx;
            state.vy = hit.fvy;
            this.throwState = state;
            this.emit('collide', { targetId: id, vx: hit.hvx, vy: hit.hvy });
            break;
          }
        }
      }
      this.sendBounds(res.x, res.y);
      // Landing squash on the air → ground transition.
      const curBounds = sp.bounds[res.screen] ?? sp.bounds[0];
      const grounded = curBounds ? res.y >= curBounds.maxY - 1 : false;
      if (res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, landingSquash(fallingVy, SQ_SOFT_SPEED, SQ_HARD_SPEED, SQ_MAX_SQUASH));
      }
      prevGrounded = grounded;
      if (res.atRest) {
        this.throwRef = 0;
        this.throwState = null;
        const hull = this.geometry.hull;
        this.customPos = {
          rx: (this.pos!.x + this.halfW - hull.x) / hull.width,
          ry: (this.pos!.y + this.halfH - hull.y) / hull.height,
        };
        this.emit('throw-end', { x: this.customPos.rx, y: this.customPos.ry, reason: 'rest' });
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  }

  /** Peer states broadcast by the host for collision detection. */
  others: Record<string, { x: number; y: number; vx: number; vy: number; size: number; bottomPad?: number } | null> = {};

  /** External throw command: angle (deg, CCW from east) + power multiplier. */
  throwWith(angleDeg: number, power: number): void {
    if (this.dragState.active) return;
    const v = throwVelocity(angleDeg, power);
    if (this.pos) this.startThrow(this.pos.x, this.pos.y, v.vx, v.vy);
  }

  /** Collision bounce from another pet. */
  onDeskHit(vx: number, vy: number): void {
    this.stopMove();
    this.stopDragFollow();
    this.stopThrow();
    if (this.pos) this.startThrow(this.pos.x, this.pos.y, vx, vy);
  }

  // ── Motion: position command ───────────────────────────────────────────────

  private stopPosFollow(): void {
    this.posFollowToken++;
    if (this.posFollowRef) {
      cancelAnimationFrame(this.posFollowRef);
      this.posFollowRef = 0;
    }
  }

  /**
   * Move the pet center to normalized hull coordinates.
   * `instant` teleports, `spring` chases with the drag spring, `line` tweens.
   */
  moveToCenter(rx: number, ry: number, mode: 'instant' | 'spring' | 'line', duration = 0): void {
    if (this.dragState.active) return;
    this.stopThrow();
    this.stopMove();
    const hull = this.geometry.hull;
    const c = clampPointToRegion(this.geometry.areas, rx * hull.width + hull.x, ry * hull.height + hull.y);
    const fx = (c.x - hull.x) / hull.width;
    const fy = (c.y - hull.y) / hull.height;
    const px = c.x - this.halfW;
    const py = c.y - this.halfH;
    if (mode === 'instant' || (mode === 'line' && duration <= 0)) {
      this.sendBounds(px, py);
      this.customPos = { rx: fx, ry: fy };
      this.emit('move-ended', { x: fx, y: fy });
      return;
    }
    const token = ++this.posFollowToken;
    if (mode === 'line') {
      const fromX = this.pos?.x ?? px;
      const fromY = this.pos?.y ?? py;
      const t0 = performance.now();
      const step = () => {
        if (this.posFollowToken !== token) return;
        const p = Math.min((performance.now() - t0) / Math.max(duration, 1), 1);
        if (p >= 1) {
          this.posFollowRef = 0;
          this.sendBounds(px, py);
          this.customPos = { rx: fx, ry: fy };
          this.emit('move-ended', { x: fx, y: fy });
          return;
        }
        this.sendBounds(fromX + (px - fromX) * p, fromY + (py - fromY) * p);
        this.posFollowRef = requestAnimationFrame(step);
      };
      this.posFollowRef = requestAnimationFrame(step);
      return;
    }
    let last = performance.now();
    const vel = { vx: 0, vy: 0 };
    const step = () => {
      if (this.posFollowToken !== token) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, MAX_STEP_DT * 2);
      last = now;
      let x = this.pos!.x;
      let y = this.pos!.y;
      vel.vx = springStep(vel.vx, x, px, dt, this.config.physics.throwPower);
      vel.vy = springStep(vel.vy, y, py, dt, this.config.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y);
      if (Math.abs(px - x) < 0.5 && Math.abs(py - y) < 0.5 && Math.abs(vel.vx) < 1 && Math.abs(vel.vy) < 1) {
        this.posFollowRef = 0;
        this.sendBounds(px, py);
        this.customPos = { rx: fx, ry: fy };
        this.emit('move-ended', { x: fx, y: fy });
        return;
      }
      this.posFollowRef = requestAnimationFrame(step);
    };
    this.posFollowRef = requestAnimationFrame(step);
  }

  /** External absolute-position command (physical px, box top-left). */
  setBoxPos(x: number, y: number): void {
    this.stopThrow();
    this.stopMove();
    this.sendBounds(x, y);
    const hull = this.geometry.hull;
    this.customPos = {
      rx: (x + this.halfW - hull.x) / hull.width,
      ry: (y + this.halfH - hull.y) / hull.height,
    };
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private dpr(): number {
    return window.devicePixelRatio || 1;
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    // Grabbing a frozen pet = user takeover; the host releases the lock.
    if (this.frozen) {
      this.applyFreeze(false);
      this.emit('lock-takeover', {});
    }
    this.stopThrow();
    this.stopDragFollow();
    this.stopMove();
    this.dragTrail = [];
    const pressNow = performance.now();
    const sling = pressNow - this.lastPressAt < SLINGSHOT_DOUBLE_MS;
    this.lastPressAt = sling ? -Infinity : pressNow;
    this.hitEl.classList.add('dragging');
    this.closeMenu();
    try {
      this.hitEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.dragState = {
      active: true,
      dragging: false,
      sx: e.screenX,
      sy: e.screenY,
      petX: this.pos?.x ?? 0,
      petY: this.pos?.y ?? 0,
      pressT: performance.now(),
      moveT: performance.now(),
      moveX: e.screenX,
      moveY: e.screenY,
      sling,
      anchorX: (this.pos?.x ?? 0) + this.halfW,
      anchorY: (this.pos?.y ?? 0) + this.halfH,
    };
    this.syncInputBusy();
  }

  onPointerMove(e: PointerEvent): void {
    const d = this.dragState;
    if (!d.active) return;
    if (e.buttons === 0) {
      // Buttons released without a pointerup: finish the drag here.
      this.onPointerUp(e);
      return;
    }
    const k = this.dpr();
    const dx = (e.screenX - d.sx) * k;
    const dy = (e.screenY - d.sy) * k;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.dragging = true;
      d.moveT = performance.now();
      d.moveX = e.screenX;
      d.moveY = e.screenY;
      this.stage.classList.add('is-held');
      if ((this.config.animations.drag ?? []).length && !this.sleeping) {
        this.playOnce(pick(this.config.animations.drag!));
      }
      this.emit('drag-start', { x: this.pos?.x ?? 0, y: this.pos?.y ?? 0 });
      this.syncInputBusy();
    }
    const now = performance.now();
    this.dragTrail.push({ t: now, x: e.screenX * k, y: e.screenY * k });
    this.dragTrail = trimTrail(this.dragTrail, now);
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    this.startDragFollow();
  }

  onPointerUp(e: PointerEvent): void {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.hitEl.classList.remove('dragging');
    this.stopDragFollow();
    this.stage.classList.remove('is-held');
    this.syncInputBusy();
    if (wasDragging && this.pos) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (!this.sleeping && !this.resumeStatusAnim()) {
        if (this.config.animations.idle.length) this.playOnce(pick(this.config.animations.idle, this.anim));
      }
      const px = this.pos.x;
      const py = this.pos.y;
      if (d.sling) {
        // Slingshot: power = pull distance, direction opposite the pull.
        const pullX = px + this.halfW - d.anchorX!;
        const pullY = py + this.halfH - d.anchorY!;
        const dist = Math.hypot(pullX, pullY);
        const rawPower = slingshotPower(dist, this.size);
        const v = slingshotVelocity(pullAngle(pullX, pullY), rawPower, this.config.physics.throwPower);
        this.dragTrail = [];
        this.emit('drag-end', { x: px, y: py, vx: v.vx, vy: v.vy });
        this.startThrow(px, py, v.vx, v.vy);
      } else {
        let vel = estimateReleaseVelocity(this.dragTrail, performance.now(), this.config.physics);
        const lastSample = this.dragTrail[this.dragTrail.length - 1];
        const fresh = lastSample ? performance.now() - lastSample.t <= 150 : false;
        if (!vel && fresh && Number.isFinite(e.screenX)) {
          // Coalesced pointer streams flatten the trail to a single point; fall
          // back to the average velocity from press to release (same dead zone +
          // soft cap so careful placement still sets the pet down gently).
          const dt = (performance.now() - d.pressT) / 1000;
          const raw = {
            vx: ((e.screenX - d.sx) * this.dpr()) / dt,
            vy: ((e.screenY - d.sy) * this.dpr()) / dt,
          };
          const rawSpeed = Math.hypot(raw.vx, raw.vy);
          if (dt > 0.02 && rawSpeed > 1) {
            const speed = softClampSpeed(rawSpeed) * this.config.physics.throwPower;
            if (speed >= 500) {
              vel = { vx: (raw.vx / rawSpeed) * speed, vy: (raw.vy / rawSpeed) * speed };
            }
          }
        }
        this.dragTrail = [];
        this.emit('drag-end', { x: px, y: py, vx: vel?.vx ?? 0, vy: vel?.vy ?? 0 });
        if (vel) {
          this.startThrow(px, py, vel.vx, vel.vy);
        } else {
          const hull = this.geometry.hull;
          this.customPos = {
            rx: (px + this.halfW - hull.x) / hull.width,
            ry: (py + this.halfH - hull.y) / hull.height,
          };
          this.position();
        }
      }
    }
  }

  onClick(e: MouseEvent): void {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    this.stopThrow();
    this.stopMove();
    if (this.sleeping) {
      this.playClickSound();
      const front = this.front === 0 ? this.videoA : this.videoB;
      if (front) this.startSquash(front);
      this.requestWake();
      if (this.sleepPhase === 'start') {
        this.sleeping = false;
        this.sleepSet = null;
        this.sleepPhase = null;
        if ((this.config.animations.clicks ?? []).length) this.playOnce(pick(this.config.animations.clicks!));
      }
      this.emit('click', { x: e.clientX, y: e.clientY, button: 0, woke: true });
      return;
    }
    this.playClickSound();
    this.emit('click', { x: e.clientX, y: e.clientY, button: 0, woke: false });
    if (!(this.config.animations.clicks ?? []).length) return;
    this.pendingSquash = true;
    this.playOnce(pick(this.config.animations.clicks!));
  }

  onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const r = this.hitRect;
    const k = this.dpr();
    const px = e.clientX * k - this.margin.l;
    const py = e.clientY * k - this.margin.t;
    const inBody = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    if (!inBody && !this.menuOpen) return;
    this.emit('context-menu', { x: e.clientX, y: e.clientY });
    this.openMenu(e.clientX, e.clientY);
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.dragState.active) return;
    if (this.menuOpen) {
      this.syncInputRegions();
      return;
    }
    void e;
  }

  private onWindowBlur(): void {
    this.closeMenu();
  }

  // ── Click-through cooperation ──────────────────────────────────────────────

  private inputBusy(): boolean {
    return this.dragState.active || this.menuOpen;
  }

  private syncInputBusy(): void {
    this.syncInputRegions();
    const busy = this.inputBusy();
    if (busy === this.inputBusyFlag) return;
    this.inputBusyFlag = busy;
    this.emit('set-busy', { busy });
  }

  private syncInputRegions(): void {
    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    const controls = [...document.querySelectorAll('#pet-menu.is-open, .pet-submenu.is-open')];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const k = this.dpr();
        rects.push({ x: r.x * k, y: r.y * k, width: r.width * k, height: r.height * k });
      }
    }
    this.emit('input-regions', { rects });
  }

  setInteractive(flag: boolean): void {
    const next = !!flag;
    if (next === this.interactiveFlag) return;
    this.interactiveFlag = next;
    this.emit('set-interactive', { interactive: next });
  }

  // ── Click sound ────────────────────────────────────────────────────────────

  private playClickSound(): void {
    const src = this.config.clickSound;
    if (!src) return;
    const now = Date.now();
    if (now - this.lastClickSoundAt < CLICK_SOUND_MS) return;
    this.lastClickSoundAt = now;
    try {
      if (!this.clickAudio) this.clickAudio = new Audio(src);
      this.clickAudio.volume = CLICK_SOUND_VOLUME;
      this.clickAudio.currentTime = 0;
      const p = this.clickAudio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* audio unavailable */
    }
  }

  // ── Context menu ───────────────────────────────────────────────────────────

  private menuItems: MenuNode[] = [];

  setMenuItems(items: MenuNode[]): void {
    this.menuItems = items;
    if (this.menuOpen) this.renderMenu();
  }

  private buildMenuTree(): MenuNode[] {
    const items: MenuNode[] = [];
    const sleepSets = this.config.animations.sleep;
    if (sleepSets && sleepSets.length) {
      items.push({ id: 'action:sleep', label: this.sleeping ? '起来' : '睡觉', hint: 'S' });
    }
    items.push({ id: 'action:home', label: '回到初始位置' });
    const cats = this.config.animations.categories ?? [];
    const moveActions = this.config.animations.moves?.actions ?? [];
    const actionChildren: MenuNode[] = [];
    for (const c of cats) {
      if (!c.actions.length) continue;
      actionChildren.push({
        id: 'cat:' + c.id,
        label: c.id,
        children: c.actions.map((a) => ({ id: 'anim:' + a, label: a })),
      });
    }
    for (const m of moveActions) {
      actionChildren.push({ id: 'move:' + m.name, label: m.name });
    }
    if (actionChildren.length) {
      items.push({ id: 'action:actions', label: '动作', children: actionChildren });
    }
    if (this.menuItems.length) {
      const groups = new Map<string, MenuNode[]>();
      for (const it of this.menuItems) {
        const g = it.group ?? '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(it);
      }
      for (const [g, list] of groups) {
        if (!g) {
          items.push(...list);
        } else if (list.length === 1) {
          items.push(list[0]!);
        } else {
          items.push({ id: 'group:' + g, label: g, children: list });
        }
      }
    }
    return items;
  }

  openMenu(x: number, y: number): void {
    this.menuOpen = true;
    this.renderMenu();
    this.menuEl.classList.add('is-open');
    const k = this.dpr();
    const rect = this.menuEl.getBoundingClientRect();
    const maxX = (window.innerWidth * k - rect.width * k - 8) / k;
    const maxY = (window.innerHeight * k - rect.height * k - 8) / k;
    this.menuEl.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
    this.menuEl.style.top = Math.max(4, Math.min(y, maxY)) + 'px';
    this.syncInputBusy();
  }

  closeMenu(): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.menuEl.classList.remove('is-open');
    this.menuEl.innerHTML = '';
    this.closeAllSubmenus();
    this.syncInputBusy();
  }

  private closeAllSubmenus(): void {
    for (const el of [...document.querySelectorAll('.pet-submenu')]) el.remove();
  }

  private renderMenu(): void {
    this.menuEl.innerHTML = '';
    const tree = this.buildMenuTree();
    for (const node of tree) this.menuEl.appendChild(this.renderMenuNode(node, this.menuEl));
  }

  private renderMenuNode(node: MenuNode, container: HTMLElement): HTMLElement {
    if (node.id === '-') {
      const sep = document.createElement('div');
      sep.className = 'pet-menu-sep';
      return sep;
    }
    const el = document.createElement('div');
    el.className = 'pet-menu-item';
    const label = document.createElement('span');
    label.textContent = node.label;
    el.appendChild(label);
    if (node.hint) {
      const hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = node.hint;
      el.appendChild(hint);
    }
    if (node.children && node.children.length) {
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = '▸';
      el.appendChild(chev);
      let sub: HTMLElement | null = null;
      el.addEventListener('mouseenter', () => {
        this.closeAllSubmenus();
        sub = document.createElement('div');
        sub.className = 'pet-submenu is-open';
        for (const child of node.children!) sub.appendChild(this.renderMenuNode(child, sub));
        container.appendChild(sub);
        const r = el.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        sub.style.left = cr.width - 6 + 'px';
        sub.style.top = r.top - cr.top - 6 + 'px';
        this.syncInputRegions();
      });
      el.addEventListener('mouseleave', (e) => {
        const to = e.relatedTarget as HTMLElement | null;
        if (to && sub && sub.contains(to)) return;
      });
    } else {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dispatchMenuAction(node.id);
        this.closeMenu();
      });
    }
    return el;
  }

  private dispatchMenuAction(id: string): void {
    if (id.startsWith('action:')) {
      const action = id.slice(7);
      if (action === 'sleep') {
        if (this.sleeping) this.requestWake();
        else this.requestSleep();
        this.emit('menu-action', { action });
        return;
      }
      if (action === 'home') {
        this.goHome();
        this.emit('menu-action', { action });
        return;
      }
      return; // submenu headers
    }
    if (id.startsWith('anim:')) {
      const name = id.slice(5);
      this.stopMove();
      this.stopThrow();
      // Text-bearing animations must not be mirrored: face left before playing.
      const noMirror = (this.config.animations.categories ?? []).some(
        (c) => c.noMirror && c.actions.includes(name),
      );
      if (noMirror && this._facing === 'right') this.facing = 'left';
      this.playOnce(name);
      this.emit('menu-action', { action: 'play', name });
      return;
    }
    if (id.startsWith('move:')) {
      const name = id.slice(5);
      this.tryMove(name);
      this.emit('menu-action', { action: 'move', name });
      return;
    }
    if (id.startsWith('cat:') || id.startsWith('group:')) return;
    this.emit('menu-click', { menuId: id });
  }

  // ── Host commands ──────────────────────────────────────────────────────────

  dispatch(cmd: HostCommand): void {
    switch (cmd.t) {
      case 'play': {
        if (this.sleeping) {
          this.refuseWhileSleeping();
          if (cmd.playbackId) this.emit('playback', { playbackId: cmd.playbackId, status: 'cancelled', reason: 'sleeping' });
          return;
        }
        if (cmd.url) {
          this.playUrlOnce(cmd.url, cmd.playbackId ?? null);
          return;
        }
        if (cmd.facing) this.facing = cmd.facing;
        if (cmd.squash) this.pendingSquash = true;
        // Optional simultaneous move: the move driver animates the window while
        // the animation plays; without `move` the pet only changes animation.
        if (cmd.move) {
          this.moveToCenter(cmd.move.x, cmd.move.y, cmd.move.mode, cmd.move.duration ?? 0);
        }
        if (cmd.loop) {
          this.anim = cmd.name!;
          this.once = false;
          this.switchTo(cmd.name!, false, cmd.playbackId ?? null);
        } else {
          this.playOnce(cmd.name!, cmd.playbackId ?? null);
        }
        return;
      }
      case 'say':
        if (cmd.clear) {
          this.clearSay();
          return;
        }
        this.showSay(cmd.text, cmd.image, cmd.duration, cmd.anim ?? false, cmd.facing);
        return;
      case 'menu':
        this.setMenuItems(cmd.items);
        return;
      case 'move':
        this.moveToCenter(cmd.x, cmd.y, cmd.mode, cmd.duration ?? 0);
        return;
      case 'throw':
        this.throwWith(cmd.angle, cmd.power);
        return;
      case 'sleep':
        this.setSleep({ sleeping: true, start: cmd.start, loop: cmd.loop, end: cmd.end });
        return;
      case 'wake':
        this.setSleep({ sleeping: false });
        return;
      case 'freeze':
        this.applyFreeze(cmd.frozen);
        return;
      case 'set-config':
        this.applyNewConfig(cmd.config);
        return;
      case 'geometry':
        this.setGeometry(cmd.geometry, cmd.home);
        return;
      case 'hit':
        this.onDeskHit(cmd.vx, cmd.vy);
        return;
      case 'home':
        this.goHome();
        return;
      case 'squash':
        this.startSquash(this.front === 0 ? this.videoA : this.videoB, cmd.amount);
        return;
      case 'status':
        this.setStatus(cmd.level, cmd.text ?? null, cmd.terminal ?? false);
        return;
      case 'status-clear':
        this.clearStatus();
        return;
      case 'sound':
        this.playClickSound();
        return;
    }
  }

  private applyNewConfig(config: RendererConfig): void {
    Object.assign(this.config as unknown as Record<string, unknown>, config as unknown as Record<string, unknown>);
    this.geometry = config.geometry;
    this.space = null;
    this.applyLayout();
    this.renderBubble();
  }

  /** Boot: place the pet and start the chain. */
  start(): void {
    this.position();
    if (this.config.animations.idle.length) {
      this.playOnce(pick(this.config.animations.idle));
    }
    this.emit('ready', { petId: this.config.petId });
  }
}
