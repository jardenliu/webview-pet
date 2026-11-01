/**
 * Movement geometry and corner placement: pure math shared by the host and the
 * renderer so both plan identical routes.
 */
import { randomBetween } from './pickers.js';
import { rectAtPoint, rectBottom, rectRight } from './physics.js';
import type { Corner, Rect } from './types.js';

/** Planned move endpoints in normalized coordinates. */
export interface MovePlan {
  /** Start center, x ratio over the hull width. */
  startRatio: number;
  /** Start center, y ratio over the hull height. */
  startYRatio: number;
  /** Target center, x ratio over the hull width. */
  targetRatio: number;
  /** |target − start| as a ratio. */
  totalRatio: number;
}

/**
 * Plan one horizontal wander move. Returns null when the target is outside the
 * allowed region (including the safety margin).
 *
 * `sideAllow` is the transparent strip on each side of the video box: edges are
 * respected by the pet *body*, not the whole box. `areas` switches the check to
 * a multi-monitor union (holes are unreachable).
 */
export const planMove = (o: {
  cx: number;
  cy: number;
  W: number;
  H: number;
  dir: 1 | -1;
  minDist: number;
  maxDist: number;
  margin: number;
  halfW: number;
  sideAllow?: number;
  areas?: Rect[];
}): MovePlan | null => {
  const side = o.sideAllow ?? 0;
  const distance = randomBetween(o.minDist, o.maxDist);
  const target = o.cx + o.dir * distance;
  if (o.areas && o.areas.length > 0) {
    // Both body edges must land on some screen (straddling a seam is allowed).
    const bodyHalf = o.halfW - side;
    if (!rectAtPoint(o.areas, target - bodyHalf - o.margin, o.cy)) return null;
    if (!rectAtPoint(o.areas, target + bodyHalf + o.margin, o.cy)) return null;
  } else {
    const leftBound = o.margin + o.halfW - side;
    const rightBound = o.W - o.margin - o.halfW + side;
    if (target < leftBound || target > rightBound) return null;
  }
  return {
    startRatio: o.cx / o.W,
    startYRatio: o.cy / o.H,
    targetRatio: target / o.W,
    totalRatio: Math.abs(target - o.cx) / o.W,
  };
};

/**
 * Corner + margins → pet bounding-box top-left in pixels. When `area` is given
 * the corner belongs to that screen instead of the whole hull (multi-monitor
 * hull corners may not belong to any monitor).
 */
export const anchorPixel = (o: {
  corner: Corner;
  marginX: number;
  marginY: number;
  size: number;
  W: number;
  H: number;
  area?: Rect;
}): { x: number; y: number } => {
  const height = (o.size * 9) / 16;
  const a = o.area ?? { x: 0, y: 0, width: o.W, height: o.H };
  const left = a.x + o.marginX;
  const top = a.y + o.marginY;
  const right = rectRight(a) - o.size - o.marginX;
  const bottom = rectBottom(a) - height - o.marginY;
  switch (o.corner) {
    case 'top-left':
      return { x: left, y: top };
    case 'top-right':
      return { x: right, y: top };
    case 'bottom-left':
      return { x: left, y: bottom };
    case 'bottom-right':
      return { x: right, y: bottom };
    case 'center':
      return { x: a.x + (a.width - o.size) / 2, y: a.y + (a.height - height) / 2 };
  }
};
