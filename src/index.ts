/**
 * webview-pet — desktop pet library for Node.js and Bun, powered by
 * `@webviewjs/webview`. Import `PetApp`, create a pet, control it with plain
 * function calls.
 *
 * ```ts
 * import { PetApp } from 'webview-pet';
 *
 * const app = new PetApp({ tray: { icon: './icon.png' } });
 * const pet = app.createPet({
 *   id: 'main',
 *   name: '小鲸',
 *   assetsDir: './assets/animation',
 *   animations: {
 *     idle: ['待机呼吸休闲'],
 *     turn: ['东张西望'],
 *     drag: ['被鼠标拖拽悬空反馈'],
 *     clicks: ['点击回应-开心跃动'],
 *     moves: { default: { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 }, actions: [{ name: '螃蟹走路' }] },
 *     categories: [{ id: '小动作', weight: 20, actions: ['悠闲哼歌'] }],
 *     sleep: [{ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] }],
 *   },
 * });
 *
 * await app.start();
 * pet.say('你好呀~', { duration: 5000 });
 * pet.play('悠闲哼歌');
 * ```
 */
export { PetApp, type PetAppOptions, type TrayOptions, type PetAppEventMap } from './host/app.js';
export {
  Pet,
  type SayOptions,
  type PlayOptions,
  type PlaybackHandle,
  type LockHandle,
  type MoveToOptions,
  type StatusOptions,
  type SleepResult,
  type PetEventMap,
} from './host/pet.js';
export type { PetWindow, FlightState } from './host/pet-window.js';
export {
  buildGeometry,
  buildRendererConfig,
  computeHome,
  computeWindowMetrics,
  monitorRects,
  boundingRect,
  type MonitorLike,
  type WindowMetrics,
} from './host/geometry.js';

// Shared types (config shapes)
export type {
  AnimationWeights,
  BubbleConfig,
  CategoryPool,
  Corner,
  DisplayGeometry,
  EventSlot,
  Facing,
  HitBox,
  MenuItemSpec,
  MenuNode,
  MoveAction,
  MovePayload,
  MoveSpec,
  MovesPool,
  PetAnimations,
  PetConfig,
  PetFontConfig,
  PetPositionSpec,
  PhysicsParams,
  PlaybackReceipt,
  Pose,
  Rect,
  RendererConfig,
  SleepSet,
  SleepTexts,
} from './shared/types.js';

// Tunables and pure helpers that consumers may want for custom UIs
export {
  DEFAULT_PHYSICS,
  DEFAULT_HIT_BOX,
  BUBBLE_DURATION_MS,
  GRAVITY,
  RESTITUTION,
  GROUND_FRICTION,
  THROW_SPEED_ANCHOR,
  PET_SIZE_REF,
} from './shared/constants.js';
export {
  pick,
  pickSleepSet,
  pickSlot,
  pickCategoryAction,
  rollKind,
  type RollKind,
} from './shared/pickers.js';
export {
  throwVelocity,
  slingshotVelocity,
  estimateReleaseVelocity,
  softClampSpeed,
  springStep,
  type DragSample,
} from './shared/physics.js';
export { anchorPixel, planMove, type MovePlan } from './shared/motion.js';
