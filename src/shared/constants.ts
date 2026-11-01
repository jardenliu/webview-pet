/**
 * Tuned constants for the pet runtime: drag spring, throw physics and squash.
 * Values follow the proven dsh-pet feel; they are overridable per pet through
 * the `physics` config section (which only carries the parameters, not these
 * tuning numbers).
 */
import type { PhysicsParams } from './types.js';

// ── Canvas / window geometry ─────────────────────────────────────────────────

/** Animation canvas width reference; the canvas is always 16:9. */
export const CANVAS_W = 640;
export const CANVAS_H = 360;

/** Foot baseline inside the canvas; extra bottom padding keeps feet visible. */
export const CANVAS_FOOT_Y = 330;

/** Reference pet width used to scale move distances and hit boxes. */
export const PET_SIZE_REF = 462;

/** Window margin on each side as a ratio of the pet width. */
export const WINDOW_MARGIN_RATIO = 0.5;

/** Default hit rectangle inside the 640×360 canvas. */
export const DEFAULT_HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 } as const;

/** Click cursor-near-edge release delay before click-through resumes. */
export const HOVER_RELEASE_MS = 400;

/** Click-through decision polling interval (ms). */
export const POINTER_POLL_MS = 60;

// ── Drag spring ──────────────────────────────────────────────────────────────

/** Drag spring stiffness; bigger tracks the pointer tighter. */
export const SPRING_K = 200;

/** Drag spring damping; ζ = c/(2√k) ≈ 1.06, overdamped, no overshoot. */
export const SPRING_C = 30;

/** Pointer trail retention window (ms) used for release-velocity estimation. */
export const TRAIL_KEEP_MS = 200;

/** Release velocity estimation window (ms). */
export const RELEASE_WINDOW_MS = 150;

/** A pause longer than this before release means "set down gently". */
export const RELEASE_STALE_MS = 150;

/** Windows shorter than this cannot be estimated (ms). */
export const MIN_SPAN_MS = 20;

/** Minimum dt (ms) between speed segments; filters jitter from high-rate mice. */
export const SEG_MIN_DT_MS = 8;

/** Below this speed a release is not a throw (px/s). */
export const DEAD_ZONE_SPEED = 500;

/** Soft throw speed cap (px/s): cap×(1-e^(-s/cap)), monotonic, asymptotic. */
export const MAX_THROW_SPEED = 3600;

/** Release speed = endpoint average×(1-w) + window peak×w. */
export const PEAK_WEIGHT = 0.5;

/** Reference acceleration (px/s²) for the late-acceleration gain. */
export const ACCEL_REF = 8000;

/** Maximum late-acceleration gain (60 %). */
export const ACCEL_GAIN_MAX = 0.6;

// ── Throw physics defaults ───────────────────────────────────────────────────

export const GRAVITY = 1400;
export const RESTITUTION = 0.78;
export const GROUND_FRICTION = 2.5;

export const DEFAULT_PHYSICS: PhysicsParams = {
  gravity: GRAVITY,
  restitution: RESTITUTION,
  groundFriction: GROUND_FRICTION,
  ceilingBounce: true,
  throwPower: 1,
  petCollision: true,
  confineToScreen: false,
};

/** Anchor speed for `throw(angle, power)`: power = 1 → 1200 px/s before the soft cap. */
export const THROW_SPEED_ANCHOR = 1200;

/** Pull distance that maps to one unit of slingshot power, as a pet-width ratio. */
export const SLINGSHOT_REF_RATIO = 0.6;

/** Stick to a contact when the normal speed is below this (px/s). */
export const REST_NORMAL = 40;

/** Consider the pet at rest when the tangent speed is below this (px/s). */
export const REST_TANGENT = 15;

/** Normal-speed tolerance confirming the pet is stuck to a surface (px/s). */
export const REST_NORMAL_EPS = 1;

/** Max physics step (s) so a background-throttle hiccup cannot teleport the pet. */
export const MAX_STEP_DT = 0.05;

/** Squash amplitude: the pet compresses to 55 % height. */
export const SQ_SQUASH = 0.55;

/** Squash duration (ms). */
export const SQ_DURATION_MS = 220;

/** Landing impact speed for the lightest squash (px/s). */
export const SQ_SOFT_SPEED = 300;

/** Landing impact speed that saturates the squash (px/s). */
export const SQ_HARD_SPEED = 1500;

/** Maximum landing squash (same as the click squash). */
export const SQ_MAX_SQUASH = 0.55;

/** Largest displacement per integration step before sub-stepping (px). */
export const SUBSTEP_PX = 8;

/** Maximum sub-steps per frame. */
export const SUBSTEP_MAX = 64;

/** Multi-pet collision restitution (≈ 0.5 % energy loss). */
export const PET_BOUNCE_E = 0.995;

/** Slingshot double-press window (ms). */
export const SLINGSHOT_DOUBLE_MS = 200;

/** Minimum pointer movement (px) before a press becomes a drag. */
export const DRAG_THRESHOLD = 5;

/** Flight report throttle for cross-pet collisions (ms). */
export const FLIGHT_REPORT_MS = 30;

/** Click sound throttle (ms). */
export const CLICK_SOUND_MS = 100;

/** Click sound volume. */
export const CLICK_SOUND_VOLUME = 0.5;

// ── Bubble / playback ────────────────────────────────────────────────────────

/** Default bubble duration (ms). */
export const BUBBLE_DURATION_MS = 10_000;

/** Terminal-status bubble duration (ms). */
export const TERMINAL_BUBBLE_DURATION_MS = 10_000;

/** Fade-out before swapping bubble content (ms). */
export const BUBBLE_FADE_MS = 250;

/** Video load timeout (ms) before a playback is marked failed. */
export const ASSET_LOAD_TIMEOUT_MS = 10_000;

/** Crossfade duration when switching animations (ms). */
export const CROSSFADE_MS = 180;

/** Refuse-text bubble duration while asleep (ms). */
export const SLEEP_REFUSE_MS = 8000;

/** Pose report throttle (ms). */
export const POSE_REPORT_MS = 400;

// ── Taskbar / topmost watchdogs ──────────────────────────────────────────────

/** Re-assert skip-taskbar at this interval (ms); explorer rebuilds resurrect it. */
export const TASKBAR_WATCHDOG_MS = 3000;

/** Default topmost re-assert interval (ms); disabled unless enabled in options. */
export const TOPMOST_WATCHDOG_MS = 10_000;
