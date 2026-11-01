/**
 * Shared type definitions for webview-pet.
 * These types are used by both the host (Node/Bun) side and the renderer side.
 */

/** Axis-aligned rectangle in physical pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Animation pool ───────────────────────────────────────────────────────────

/** One move (wander) animation with optional per-action overrides. */
export interface MoveSpec {
  /** Minimum travel distance in px, scaled by petSize / 462. */
  minDist: number;
  /** Maximum travel distance in px, scaled by petSize / 462. */
  maxDist: number;
  /** Screen-edge margin in px, scaled by petSize / 462. */
  margin: number;
  /** Seconds at the start of the animation where the pet stays in place. */
  leadSec: number;
  /** Seconds at the end of the animation where the pet stays in place. */
  tailSec: number;
}

export interface MoveAction {
  /** Animation name (file name without extension) played while moving. */
  name: string;
  /** Optional per-action overrides of the default move parameters. */
  params?: Partial<MoveSpec>;
}

export interface MovesPool {
  default: MoveSpec;
  actions: MoveAction[];
}

/**
 * An event animation slot. A plain string plays that animation; an array
 * picks one candidate at random (avoiding the last played one).
 */
export type EventSlot = string | string[];

export interface CategoryPool {
  /** Category id shown in the context menu. */
  id: string;
  /** Relative weight when the random chain picks an action. */
  weight: number;
  /**
   * When true, animations in this category are skipped while the pet faces
   * right (they contain text that would look wrong when mirrored).
   */
  noMirror?: boolean;
  /** Animation names in this category. */
  actions: string[];
}

/** A complete sleep set: start / loop / end segments picked as one unit. */
export interface SleepSet {
  start: string[];
  loop: string[];
  end: string[];
}

export interface PetAnimations {
  /** Idle animations; the random chain picks one after each cycle. */
  idle: string[];
  /** Turn animations; playing one flips the pet's facing when it ends. */
  turn?: string[];
  /** Animations played while the pet is being dragged. */
  drag?: string[];
  /** Animations played on click. */
  clicks?: string[];
  /** Wander animations with real window movement. */
  moves?: MovesPool;
  /** Random action categories picked by weight. */
  categories?: CategoryPool[];
  /** Event animation pools triggered explicitly (never in the random chain). */
  events?: {
    /** Linked into speech bubbles when `say({ anim: true })` is used. */
    whisper?: EventSlot[];
    /** Level-indexed pool used by `setStatus(level)`. */
    status?: EventSlot[];
  };
  /** Optional sleep sets; without this the pet cannot sleep. */
  sleep?: SleepSet[];
}

/** Random-chain weights. The remainder of the 100 % goes to category actions. */
export interface AnimationWeights {
  idle: number;
  turn: number;
  move: number;
}

// ── Physics ──────────────────────────────────────────────────────────────────

export interface PhysicsParams {
  /** Downward acceleration in px/s². */
  gravity: number;
  /** Bounce energy retention (0..1). */
  restitution: number;
  /** Ground friction coefficient per second. */
  groundFriction: number;
  /** Whether the pet can bounce off the top edge of the desktop area. */
  ceilingBounce: boolean;
  /** Global multiplier applied to thrown velocities. */
  throwPower: number;
  /** Enable momentum-exchange collisions between multiple pets. */
  petCollision: boolean;
  /** Keep throws/wanders inside the screen the pet was released on. */
  confineToScreen: boolean;
}

// ── Placement ────────────────────────────────────────────────────────────────

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

export interface PetPositionSpec {
  /** Corner of the work area to anchor to. Ignored when `x`/`y` are set. */
  corner?: Corner;
  /** Horizontal margin from the corner in px. */
  marginX?: number;
  /** Vertical margin from the corner in px. */
  marginY?: number;
  /**
   * Absolute position of the pet-window top-left in physical pixels.
   * When set, corner anchoring is ignored.
   */
  x?: number;
  y?: number;
}

/** Hit rectangle inside the 640×360 animation canvas. */
export interface HitBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ── Pet configuration ────────────────────────────────────────────────────────

export interface PetFontConfig {
  /** Font family used in bubbles and menus. Falls back to a system stack. */
  family?: string;
  /** Font size in px. */
  size?: number;
  /** Optional font file (ttf/otf) served to the renderer. */
  file?: string;
}

export interface SleepTexts {
  /** Lines spoken when falling asleep. */
  start?: string[];
  /** Lines spoken when waking up. */
  end?: string[];
  /** Lines spoken when a request is refused because the pet is asleep. */
  refuse?: string[];
}

export interface BubbleConfig {
  /** Default bubble duration in ms (0 = keep until replaced). */
  durationMs?: number;
  /** Max bubble width as a multiple of the pet width (default 1.2). */
  maxWidthRatio?: number;
}

/** A custom context-menu item. Clicks arrive via the `menu-click` event. */
export interface MenuItemSpec {
  /** Stable id used in the click event. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional group name; items sharing a group are grouped in a submenu. */
  group?: string;
  /** Hide the item when false (can be changed later via `setMenuItems`). */
  enabled?: boolean;
}

export interface PetConfig {
  /** Unique pet id (used by events and multi-pet control). */
  id: string;
  /** Display name shown in menus/notifications. Defaults to `id`. */
  name?: string;
  /** Animation canvas width in px; height is width × 9 / 16. Default 462. */
  size?: number;
  /** Directory holding `<动画名>.webm` animation files. */
  assetsDir: string;
  /** Animation pools. */
  animations: PetAnimations;
  /** Random-chain weights; remaining probability goes to category actions. */
  animationWeights?: AnimationWeights;
  /** Physics parameters; merged over the app-level defaults. */
  physics?: Partial<PhysicsParams>;
  /** Font settings for bubbles and menus. */
  font?: PetFontConfig;
  /** When true the pet never turns/wanders on its own. */
  fixed?: boolean;
  /**
   * Click feedback sound: `true` uses the built-in click, a string uses that
   * audio file, `false`/omitted disables it.
   */
  clickSound?: boolean | string;
  /** Initial placement. Defaults to bottom-right of the primary work area. */
  position?: PetPositionSpec;
  /** Hit rectangle in canvas coordinates. */
  hitBox?: HitBox;
  /** Sleep-related bubble texts. */
  sleepTexts?: SleepTexts;
  /** Bubble behaviour. */
  bubble?: BubbleConfig;
  /** Initial custom context-menu items. */
  menu?: MenuItemSpec[];
  /**
   * Delay in ms before the interactive hit area releases the pointer after it
   * leaves the pet body. Default 400.
   */
  hoverReleaseMs?: number;
}

// ── Runtime command payloads (host → renderer) ───────────────────────────────

export type Facing = 'left' | 'right';

export interface SayPayload {
  text: string;
  /** Image URL shown in the bubble. */
  image?: string;
  /** Duration in ms; 0 = keep until replaced. Defaults to the bubble config. */
  duration?: number;
  /** Play an `events.whisper` animation alongside the bubble. */
  anim?: boolean;
  /** Force facing while the linked animation plays. */
  facing?: Facing;
  /** clear=true hides the current bubble. */
  clear?: boolean;
}

export interface PlayPayload {
  /** Animation name from the pool; ignored when `url` is set. */
  name?: string;
  /** External animation URL (webm). */
  url?: string;
  /** Flip the pet for this playback. Omitted = keep current facing. */
  facing?: Facing;
  /** Play once (default) or loop forever. */
  loop?: boolean;
  /** Receipt id; playback status changes are reported with this id. */
  playbackId?: string;
  /** Movement performed while a move animation plays. */
  move?: MovePayload;
  /** Apply the squash-and-stretch feedback when the animation starts. */
  squash?: boolean;
  /** Suppress the "return to random chain" behaviour after this ends. */
  noResume?: boolean;
}

export interface MovePayload {
  /** Target window center in normalized desktop coordinates (0..1). */
  x: number;
  y: number;
  /** Movement profile. */
  mode: 'instant' | 'spring' | 'line';
  /** Duration in ms for `line` moves. */
  duration?: number;
  /** Seconds at the start of the move animation that stay in place. */
  leadSec?: number;
  /** Seconds at the end of the move animation that stay in place. */
  tailSec?: number;
}

export interface SleepPayload {
  sleeping: true;
  start: string;
  loop: string;
  end: string;
}

export type HostCommand =
  | ({ t: 'play' } & PlayPayload)
  | ({ t: 'say' } & SayPayload)
  | { t: 'menu'; items: MenuNode[] }
  | ({ t: 'move' } & MovePayload)
  | { t: 'throw'; angle: number; power: number }
  | ({ t: 'sleep' } & SleepPayload)
  | { t: 'wake' }
  | { t: 'freeze'; frozen: boolean }
  | { t: 'set-config'; config: RendererConfig }
  | { t: 'geometry'; geometry: DisplayGeometry; home: { x: number; y: number } }
  | { t: 'hit'; vx: number; vy: number }
  | { t: 'squash'; amount: number }
  | { t: 'home' }
  | { t: 'status'; level: number; text?: string | null; terminal?: boolean }
  | { t: 'status-clear' }
  | { t: 'sound' };

/** Menu tree sent to the renderer for the right-click menu. */
export interface MenuNode {
  id: string;
  label: string;
  hint?: string;
  /** Group name; nodes sharing a group collapse into one submenu. */
  group?: string;
  children?: MenuNode[];
  /** Disable item (e.g. sleep item while no sleep set exists). */
  disabled?: boolean;
  checked?: boolean;
}

// ── Renderer → host events ───────────────────────────────────────────────────

export interface RendererEventMap {
  ready: { petId: string };
  /** Animation playback ended. */
  ended: { name: string; source: 'name' | 'url' };
  /** A move animation finished and the window reached its target. */
  'move-ended': { x: number; y: number };
  'drag-start': { x: number; y: number };
  'drag-end': { x: number; y: number; vx: number; vy: number };
  'throw-start': { x: number; y: number; vx: number; vy: number };
  'throw-end': { x: number; y: number; reason: 'rest' | 'cancelled' };
  click: { x: number; y: number; button: number };
  'context-menu': { x: number; y: number };
  'menu-click': { menuId: string };
  /** Interactive-state hints used by the click-through policy. */
  'set-busy': { busy: boolean };
  'set-interactive': { interactive: boolean };
  /** Rects (window-relative, physical px) that must stay interactive. */
  'input-regions': { rects: Array<{ x: number; y: number; width: number; height: number }> };
  /** Current window position report (physical px, window top-left). */
  'window-pos': { x: number; y: number };
  /** Periodic flight report for cross-pet collision handling. */
  flight: { x: number; y: number; vx: number; vy: number };
  /** Audio finished loading / failed. */
  'sound-error': { src: string };
  /** Renderer-side error report. */
  error: { message: string };
}

// ── Host-side public events ──────────────────────────────────────────────────

export interface PlaybackReceipt {
  playbackId: string;
  status: 'accepted' | 'playing' | 'ended' | 'failed' | 'cancelled';
  reason?: string;
}

export interface Pose {
  /** Normalized desktop coordinates (0..1) of the pet window center. */
  x: number;
  y: number;
  facing: Facing;
  sleeping: boolean;
  flying: boolean;
  dragging: boolean;
}

// ── Renderer boot config ─────────────────────────────────────────────────────

/** Multi-monitor geometry in physical pixels. */
export interface DisplayGeometry {
  /** Per-screen work areas (taskbars excluded). */
  areas: Rect[];
  /** Per-screen full panels (taskbar included). */
  panels: Rect[];
  /** Hull of all areas — the normalized coordinate frame for moveTo/pose. */
  hull: Rect;
}

export interface RendererConfig {
  petId: string;
  petName: string;
  /** Canvas width in px (canvas is always 16:9). */
  size: number;
  /** Physics merged params. */
  physics: PhysicsParams;
  /** Base URL for animation assets, e.g. `anim/`. */
  assetBase: string;
  animations: PetAnimations;
  animationWeights: AnimationWeights;
  hitBox: HitBox;
  font: {
    family: string;
    size: number;
    /** Absolute path of a font file to serve, or null for the system stack. */
    file: string | null;
  };
  fixed: boolean;
  clickSound: string | null;
  bubble: Required<BubbleConfig>;
  sleepTexts: SleepTexts;
  /** Window metrics computed by the host (physical pixels). */
  window: {
    width: number;
    height: number;
    marginL: number;
    marginT: number;
    marginR: number;
    marginB: number;
    bottomPad: number;
  };
  /** Home position: pet bounding-box top-left in physical screen px. */
  home: { x: number; y: number };
  /** Multi-monitor geometry (physical px). */
  geometry: DisplayGeometry;
  hoverReleaseMs: number;
}
