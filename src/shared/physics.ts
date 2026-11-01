/**
 * Physics: drag spring, release-velocity estimation, contact resolution and
 * gravity integration. Pure functions over coordinates — identical input gives
 * identical output, so the host and the renderer feel the same.
 */
import type { PhysicsParams, Rect } from './types.js';
import {
  ACCEL_GAIN_MAX,
  ACCEL_REF,
  DEAD_ZONE_SPEED,
  DEFAULT_PHYSICS,
  MAX_STEP_DT,
  MAX_THROW_SPEED,
  MIN_SPAN_MS,
  PEAK_WEIGHT,
  RELEASE_STALE_MS,
  RELEASE_WINDOW_MS,
  RESTITUTION,
  REST_NORMAL,
  REST_NORMAL_EPS,
  REST_TANGENT,
  SEG_MIN_DT_MS,
  SLINGSHOT_REF_RATIO,
  GROUND_FRICTION,
  SPRING_C,
  SPRING_K,
  SUBSTEP_MAX,
  SUBSTEP_PX,
  THROW_SPEED_ANCHOR,
  TRAIL_KEEP_MS,
} from './constants.js';

// ── Rect helpers ─────────────────────────────────────────────────────────────

export type { Rect } from './types.js';

export const rectRight = (r: Rect): number => r.x + r.width;
export const rectBottom = (r: Rect): number => r.y + r.height;

/** Index of the rect containing the point, or -1. */
export const indexAtPoint = (rects: readonly Rect[], x: number, y: number): number =>
  rects.findIndex((r) => x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r));

/** Index of the rect closest to the point (by edge distance). */
export const nearestIndex = (rects: readonly Rect[], x: number, y: number): number => {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const dx = Math.max(r.x - x, 0, x - rectRight(r));
    const dy = Math.max(r.y - y, 0, y - rectBottom(r));
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
};

// ── Spring & speed limiting ──────────────────────────────────────────────────

/**
 * Overdamped spring velocity step on one axis; the caller then applies
 * `x += v * dt`. `power` scales K and C together (same shape, faster or lazier).
 */
export const springStep = (
  v: number,
  x: number,
  target: number,
  dt: number,
  power: number = DEFAULT_PHYSICS.throwPower,
): number => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;

/** Soft speed cap: cap×(1-e^(-s/cap)). Monotonic, never exceeds the cap. */
export const softClampSpeed = (speed: number): number => {
  if (speed <= 0) return 0;
  return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};

// ── Contact resolution ───────────────────────────────────────────────────────

export type ContactEdge = 'left' | 'right' | 'ceiling' | 'floor';

export const CONTACT_NORMALS: Readonly<Record<ContactEdge, { readonly nx: number; readonly ny: number }>> = {
  left: { nx: 1, ny: 0 },
  right: { nx: -1, ny: 0 },
  ceiling: { nx: 0, ny: 1 },
  floor: { nx: 0, ny: -1 },
};

export interface ContactResult {
  readonly vx: number;
  readonly vy: number;
  /** Outgoing normal speed (px/s, ≥ 0, along the outward normal). */
  readonly normalSpeed: number;
  /** Outgoing tangent speed (px/s, signed). */
  readonly tangentSpeed: number;
}

/**
 * Resolve one contact: the normal component bounces with the restitution (and
 * sticks when slow), the tangent component only decays with friction.
 */
export const resolveContact = (
  speed: { readonly vx: number; readonly vy: number },
  edge: ContactEdge,
  physics: PhysicsParams,
  dt: number,
): ContactResult => {
  const { nx, ny } = CONTACT_NORMALS[edge];
  const tx = -ny;
  const ty = nx;
  const vn = speed.vx * nx + speed.vy * ny;
  const vt = speed.vx * tx + speed.vy * ty;
  // Stick instead of micro-bouncing when gravity pins the pet to the surface.
  const normalSpeed = Math.abs(vn) < REST_NORMAL ? 0 : Math.abs(vn) * physics.restitution;
  const tangentSpeed = vt * Math.max(0, 1 - physics.groundFriction * dt);
  return {
    vx: normalSpeed * nx + tangentSpeed * tx,
    vy: normalSpeed * ny + tangentSpeed * ty,
    normalSpeed,
    tangentSpeed,
  };
};

/** True when every contact this step is stuck and the tangent speed is low. */
export const isRestingOnContacts = (
  edges: readonly ContactEdge[],
  speed: { readonly vx: number; readonly vy: number },
): boolean => {
  if (edges.length === 0) return false;
  return edges.every((edge) => {
    const { nx, ny } = CONTACT_NORMALS[edge];
    const normal = Math.abs(speed.vx * nx + speed.vy * ny);
    const tangent = Math.abs(speed.vx * -ny + speed.vy * nx);
    return normal < REST_NORMAL_EPS && tangent < REST_TANGENT;
  });
};

// ── Throw space (multi-monitor) ──────────────────────────────────────────────

/** Allowed top-left range for the pet bounding box on one screen. */
export interface ThrowBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ThrowState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ThrowSpace {
  /** Per-screen top-left bounds (same order as `areas`). */
  bounds: ThrowBounds[];
  /** Per-screen work areas (taskbars excluded) — used for bounce & ownership. */
  areas: Rect[];
  /** Per-screen full panels (taskbar included) — used for edge-gap detection. */
  panels: Rect[];
  /** Pet bounding-box width. */
  size: number;
}

/** Bounds for a pet bounding box on one area. `sideAllow` lets the transparent
 *  strips of the video box hang over the edges so the *body* touches them. */
export const throwBoundsIn = (area: Rect, size: number, sideAllow = 0): ThrowBounds => {
  const h = (size * 9) / 16;
  return {
    minX: area.x - sideAllow,
    minY: area.y,
    maxX: rectRight(area) - size + sideAllow,
    maxY: rectBottom(area) - h,
  };
};

export const throwSpace = (o: {
  areas: Rect[];
  panels?: Rect[];
  size: number;
  sideAllow?: number;
}): ThrowSpace => ({
  bounds: o.areas.map((a) => throwBoundsIn(a, o.size, o.sideAllow ?? 0)),
  areas: o.areas,
  panels: o.panels && o.panels.length === o.areas.length ? o.panels : o.areas,
  size: o.size,
});

/** Which screen owns the pet: the one under the body center, else the nearest. */
export const screenOfBox = (space: ThrowSpace, x: number, y: number): number => {
  const cx = x + space.size / 2;
  const cy = y + (space.size * 9) / 16 / 2;
  const hit = indexAtPoint(space.areas, cx, cy);
  return hit >= 0 ? hit : nearestIndex(space.areas, cx, cy);
};

// ── Throw stepping ───────────────────────────────────────────────────────────

export interface ThrowHit {
  edge: ContactEdge;
  /** Impact speed along the normal before the bounce (px/s). */
  speed: number;
}

export interface ThrowStepResult extends ThrowState {
  screen: number;
  bounced: boolean;
  atRest: boolean;
  hit: ThrowHit | null;
  contacts: ContactEdge[];
}

/**
 * One gravity-integration step with boundary bouncing over a multi-screen
 * space. Crossing into a neighbouring screen is allowed (no bounce) unless
 * `lockScreen` confines the pet to one screen.
 */
export const throwStepRegion = (
  s: ThrowState,
  dtRaw: number,
  space: ThrowSpace,
  physics: PhysicsParams = DEFAULT_PHYSICS,
  lockScreen = -1,
): ThrowStepResult => {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
  let { x, y, vx, vy } = s;
  vy += physics.gravity * dt;
  x += vx * dt;
  y += vy * dt;
  if (space.areas.length === 0) {
    return { x, y, vx, vy, screen: -1, bounced: false, atRest: false, hit: null, contacts: [] };
  }

  const h = (space.size * 9) / 16;
  let bounced = false;
  let hit: ThrowHit | null = null;
  const contacts: ContactEdge[] = [];
  const record = (edge: ContactEdge, speed: number): void => {
    contacts.push(edge);
    if (hit === null || speed > hit.speed) hit = { edge, speed };
  };

  const locked = Number.isInteger(lockScreen) && lockScreen >= 0 && lockScreen < space.areas.length;
  const pickScreen = (i: number): number => (locked ? lockScreen : i);

  let cur = screenOfBox(space, x, y);
  let b = space.bounds[pickScreen(cur)];
  let a = space.areas[pickScreen(cur)];
  const pa = space.panels[pickScreen(cur)] || a;
  const cy = y + h / 2;

  // Horizontal: bounce only when there is no neighbouring screen past the edge.
  if (x < b.minX) {
    if (locked || indexAtPoint(space.panels, pa.x - 1, cy) < 0) {
      record('left', Math.abs(vx));
      x = b.minX;
      const out = resolveContact({ vx, vy }, 'left', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  } else if (x > b.maxX) {
    if (locked || indexAtPoint(space.panels, rectRight(pa), cy) < 0) {
      record('right', Math.abs(vx));
      x = b.maxX;
      const out = resolveContact({ vx, vy }, 'right', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  }

  cur = screenOfBox(space, x, y);
  b = space.bounds[pickScreen(cur)];
  a = space.areas[pickScreen(cur)];
  const pa2 = space.panels[pickScreen(cur)] || a;
  const cx = x + space.size / 2;

  // Vertical: same rule; `ceilingBounce: false` lets the pet fly off the top.
  if (y < b.minY) {
    if (physics.ceilingBounce && (locked || indexAtPoint(space.panels, cx, pa2.y - 1) < 0)) {
      record('ceiling', Math.abs(vy));
      y = b.minY;
      const out = resolveContact({ vx, vy }, 'ceiling', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  } else if (y >= b.maxY) {
    if (locked || indexAtPoint(space.panels, cx, rectBottom(pa2)) < 0) {
      record('floor', Math.abs(vy));
      y = b.maxY;
      const out = resolveContact({ vx, vy }, 'floor', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  }

  return {
    x,
    y,
    vx,
    vy,
    screen: screenOfBox(space, x, y),
    bounced,
    atRest: isRestingOnContacts(contacts, { vx, vy }),
    hit,
    contacts,
  };
};

/**
 * Integrate a full frame with sub-stepping: a single step may not travel more
 * than SUBSTEP_PX so corners and floors are never skipped at high speed.
 */
export const throwFrame = (
  s: ThrowState,
  dt: number,
  space: ThrowSpace,
  physics: PhysicsParams = DEFAULT_PHYSICS,
  lockScreen = -1,
): ThrowStepResult => {
  const dist = Math.hypot(s.vx, s.vy) * Math.min(Math.max(dt, 0), MAX_STEP_DT);
  const steps = Math.min(SUBSTEP_MAX, Math.max(1, Math.ceil(dist / SUBSTEP_PX)));
  const stepDt = dt / steps;
  let cur: ThrowStepResult = { ...s, screen: -1, bounced: false, atRest: false, hit: null, contacts: [] };
  let rest = true;
  for (let i = 0; i < steps; i++) {
    const next = throwStepRegion(cur, stepDt, space, physics, lockScreen);
    cur = {
      ...next,
      bounced: cur.bounced || next.bounced,
      hit: next.hit ? next.hit : cur.hit,
      contacts: [...cur.contacts, ...next.contacts],
    };
    if (!next.atRest) rest = false;
  }
  cur.atRest = rest && cur.contacts.length > 0;
  return cur;
};

// ── Release velocity estimation ──────────────────────────────────────────────

export interface DragSample {
  /** Timestamp in ms (performance.now()). */
  t: number;
  x: number;
  y: number;
}

/** Drop samples older than the trail-retention window. */
export const trimTrail = (trail: DragSample[], now: number): DragSample[] => {
  const cutoff = now - TRAIL_KEEP_MS;
  let i = 0;
  while (i < trail.length && trail[i].t < cutoff) i++;
  return i === 0 ? trail : trail.slice(i);
};

/**
 * Turn a command throw (`angle` degrees CCW from east, `power` multiplier) into
 * an initial velocity. Screen y grows downwards, so a 90° throw goes up.
 */
export const throwVelocity = (angleDeg: number, power: number): { vx: number; vy: number } => {
  const speed = softClampSpeed(power * THROW_SPEED_ANCHOR);
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};

/** Reference pull distance for one unit of slingshot power. */
export const slingshotRefDist = (size: number): number => (size > 0 ? size * SLINGSHOT_REF_RATIO : 0);

/** Pull distance → slingshot power multiplier (linear, unclamped). */
export const slingshotPower = (dist: number, size: number): number => {
  const ref = slingshotRefDist(size);
  if (!(ref > 0) || !(dist > 0) || !Number.isFinite(dist)) return 0;
  return dist / ref;
};

/** Pull vector → launch angle (degrees): the pet flies opposite the pull. */
export const pullAngle = (pullX: number, pullY: number): number => (Math.atan2(pullY, -pullX) * 180) / Math.PI;

/**
 * Slingshot launch velocity. Same angle convention as {@link throwVelocity} but
 * without the soft cap: pulling further must always launch faster.
 */
export const slingshotVelocity = (
  angleDeg: number,
  power: number,
  throwPower: number = DEFAULT_PHYSICS.throwPower,
): { vx: number; vy: number } => {
  const speed = THROW_SPEED_ANCHOR * Math.max(0, power) * Math.max(0, throwPower);
  if (speed === 0) return { vx: 0, vy: 0 };
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};

/**
 * Estimate the release velocity from a pointer trail. Direction comes from the
 * window endpoints (jitter-proof); magnitude blends the endpoint average and
 * the window peak, with a gain while still accelerating, then the soft cap and
 * `physics.throwPower`. Returns null for a gentle set-down.
 */
export const estimateReleaseVelocity = (
  trail: DragSample[],
  now: number,
  physics: PhysicsParams = DEFAULT_PHYSICS,
): { vx: number; vy: number } | null => {
  if (trail.length === 0) return null;
  const last = trail[trail.length - 1];
  if (now - last.t > RELEASE_STALE_MS) return null;
  const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
  if (win.length < 2) return null;
  const t0 = win[0].t;
  const x0 = win[0].x;
  const y0 = win[0].y;
  const t1 = win[win.length - 1].t;
  const x1 = win[win.length - 1].x;
  const y1 = win[win.length - 1].y;
  const spanMs = t1 - t0;
  if (spanMs < MIN_SPAN_MS) return null;
  const baseVx = ((x1 - x0) / spanMs) * 1000;
  const baseVy = ((y1 - y0) / spanMs) * 1000;
  const baseSpeed = Math.hypot(baseVx, baseVy);
  if (baseSpeed < 1e-6) return null;

  // Segment speeds (dense samples merged forward; dt floored at SEG_MIN_DT_MS).
  const segSpeeds: { speed: number; tEnd: number }[] = [];
  let px = x0;
  let py = y0;
  let pt = t0;
  for (const s of win.slice(1)) {
    const dt = s.t - pt;
    if (dt >= SEG_MIN_DT_MS) {
      segSpeeds.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, tEnd: s.t });
      px = s.x;
      py = s.y;
      pt = s.t;
    }
  }
  const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;

  // Late-acceleration gain: still-speeding-up flicks launch a bit harder.
  let accel = 0;
  if (segSpeeds.length >= 2) {
    const lastSeg = segSpeeds[segSpeeds.length - 1];
    const firstSeg = segSpeeds[0];
    accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1000, MIN_SPAN_MS / 1000);
  }
  const speedBeforeClamp =
    ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) *
    (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
  const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
  if (speed < DEAD_ZONE_SPEED) return null;
  return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
};

// ── Region helpers (multi-monitor unions) ────────────────────────────────────

/** The rect containing the point, or null. */
export const rectAtPoint = (rects: readonly Rect[], x: number, y: number): Rect | null => {
  for (const r of rects) if (x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r)) return r;
  return null;
};

/** The rect under the point, falling back to the nearest one. */
export const resolveRect = (rects: readonly Rect[], x: number, y: number): Rect | null => {
  const hit = rectAtPoint(rects, x, y);
  if (hit) return hit;
  const i = nearestIndex(rects, x, y);
  return i < 0 ? null : rects[i]!;
};

/** Clamp a point into a rect (1 px inset on the right/bottom edges). */
export const clampPointInRect = (r: Rect, x: number, y: number): { x: number; y: number } => ({
  x: Math.min(Math.max(x, r.x), rectRight(r) - 1),
  y: Math.min(Math.max(y, r.y), rectBottom(r) - 1),
});

/** Clamp a point into the union of rects (into the nearest rect when outside). */
export const clampPointToRegion = (rects: readonly Rect[], x: number, y: number): { x: number; y: number } => {
  if (rectAtPoint(rects, x, y)) return { x, y };
  const i = nearestIndex(rects, x, y);
  return i < 0 ? { x, y } : clampPointInRect(rects[i]!, x, y);
};

/**
 * Re-anchor a pet center after the monitor topology changed: preserve world
 * coordinates and only clamp when the point ended up in a hole.
 */
export const rebaseCenter = (
  center: { x: number; y: number },
  fromOrigin: { x: number; y: number },
  toOrigin: { x: number; y: number },
  areas: readonly Rect[],
): { x: number; y: number } =>
  clampPointToRegion(areas, center.x + fromOrigin.x - toOrigin.x, center.y + fromOrigin.y - toOrigin.y);

// ── Multi-pet collision ──────────────────────────────────────────────────────

export interface PetCollider {
  /** Bounding-box top-left in physical px. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pet bounding-box width (mass ∝ size²). */
  size: number;
}

/**
 * Body box (hit-box proportions mapped into viewport pixels) — the geometry
 * used for inter-pet collision detection.
 */
export const bodyPixelBox = (o: {
  x: number;
  y: number;
  size: number;
  bottomPad: number;
  hitBox: { x0: number; y0: number; x1: number; y1: number };
}): { left: number; top: number; right: number; bottom: number } => {
  const h = (o.size * 9) / 16;
  return {
    left: o.x + (o.hitBox.x0 / 640) * o.size,
    top: o.y + o.bottomPad + (o.hitBox.y0 / 360) * h,
    right: o.x + (o.hitBox.x1 / 640) * o.size,
    bottom: o.y + o.bottomPad + (o.hitBox.y1 / 360) * h,
  };
};

/** Rectangle intersection test. */
export const rectsOverlap = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * One near-elastic separation between a flying pet and another pet:
 * momentum is conserved along the center-line, tangent components are kept.
 * Returns null when the normal cannot be determined or the bodies separate.
 */
export const collidePet = (
  fly: PetCollider,
  hit: PetCollider,
): { fvx: number; fvy: number; hvx: number; hvy: number; impactSpeed: number } | null => {
  const hf = (fly.size * 9) / 16 / 2;
  const hh = (hit.size * 9) / 16 / 2;
  const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
  const cy = hit.y + hh - (fly.y + hf);
  const dist = Math.hypot(cx, cy);
  if (dist < 1e-6) return null;
  const nx = cx / dist;
  const ny = cy / dist;
  const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
  if (vrel <= 0) return null; // separating
  const e = 0.995;
  const m1 = fly.size * fly.size;
  const m2 = hit.size * hit.size;
  const v1n = fly.vx * nx + fly.vy * ny;
  const v2n = hit.vx * nx + hit.vy * ny;
  const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
  const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
  return {
    fvx: fly.vx - v1n * nx + v1n2 * nx,
    fvy: fly.vy - v1n * ny + v1n2 * ny,
    hvx: hit.vx - v2n * nx + v2n2 * nx,
    hvy: hit.vy - v2n * ny + v2n2 * ny,
    impactSpeed: vrel,
  };
};

// ── Squash & stretch ─────────────────────────────────────────────────────────

/**
 * Landing impact speed → squash depth (faster = flatter), used as the `depth`
 * parameter of {@link squashScale}.
 */
export const landingSquash = (impactSpeed: number, soft: number, hard: number, maxSquash: number): number => {
  const t = Math.min(Math.max((Math.abs(impactSpeed) - soft) / (hard - soft), 0), 1);
  return Math.min(0.8, 1 - t * (1 - maxSquash));
};

/**
 * Squash curve: u∈[0,1] → scaleY. Compression eases in over the first 45 %,
 * then an easeOutBack rebound overshoots slightly (~4 %).
 */
export const squashScale = (u: number, squash: number): number => {
  if (u < 0.45) {
    const p = u / 0.45;
    return 1 - (1 - squash) * p * p;
  }
  const p = (u - 0.45) / 0.55;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};
