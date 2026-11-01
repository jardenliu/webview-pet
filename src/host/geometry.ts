/**
 * Display geometry and window-metrics computation (physical pixels).
 */
import {
  CANVAS_FOOT_Y,
  CANVAS_H,
  DEFAULT_HIT_BOX,
  PET_SIZE_REF,
  WINDOW_MARGIN_RATIO,
} from '../shared/constants.js';
import { anchorPixel } from '../shared/motion.js';
import type {
  Corner,
  DisplayGeometry,
  HitBox,
  PetPositionSpec,
  RendererConfig,
  Rect,
} from '../shared/types.js';

export interface MonitorLike {
  name?: string;
  scaleFactor: number;
  size: { width: number; height: number };
  position: { x: number; y: number };
}

/** Convert monitor descriptors into physical-pixel rectangles. */
export const monitorRects = (monitors: MonitorLike[]): Rect[] =>
  monitors.map((m) => ({
    x: m.position.x,
    y: m.position.y,
    width: m.size.width,
    height: m.size.height,
  }));

export const boundingRect = (rects: Rect[]): Rect => {
  if (rects.length === 0) return { x: 0, y: 0, width: 1920, height: 1080 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Build the display geometry block shared with the renderer. */
export const buildGeometry = (monitors: MonitorLike[]): DisplayGeometry => {
  const areas = monitorRects(monitors);
  return {
    areas,
    panels: areas.map((r) => ({ ...r })),
    hull: boundingRect(areas),
  };
};

/** Window metrics for one pet, in physical pixels. */
export interface WindowMetrics {
  width: number;
  height: number;
  marginL: number;
  marginT: number;
  marginR: number;
  marginB: number;
  bottomPad: number;
  canvasW: number;
  canvasH: number;
  hitRect: { x: number; y: number; w: number; h: number };
  sideAllow: number;
}

export const computeWindowMetrics = (o: {
  size: number;
  fontSize: number;
  hitBox?: HitBox;
  bubbleReserve?: number;
}): WindowMetrics => {
  const size = o.size;
  const canvasH = (size * 9) / 16;
  const bottomPad = (canvasH * (CANVAS_H - CANVAS_FOOT_Y)) / CANVAS_H;
  const m = size * WINDOW_MARGIN_RATIO;
  const bubbleReserve = o.bubbleReserve ?? o.fontSize * 7 + 24;
  const marginT = Math.max(m, bubbleReserve);
  const hb = o.hitBox ?? DEFAULT_HIT_BOX;
  return {
    width: size + m + m,
    height: canvasH + bottomPad + marginT + m,
    marginL: m,
    marginT,
    marginR: m,
    marginB: m,
    bottomPad,
    canvasW: size,
    canvasH,
    // Window-relative physical px (margins included) — this is what the
    // click-through poll compares raw cursor positions against.
    hitRect: {
      x: m + (hb.x0 / 640) * size,
      y: marginT + bottomPad + (hb.y0 / CANVAS_H) * canvasH,
      w: ((hb.x1 - hb.x0) / 640) * size,
      h: ((hb.y1 - hb.y0) / CANVAS_H) * canvasH,
    },
    sideAllow: (hb.x0 / 640) * size,
  };
};

/** Resolve the home position (pet box top-left, physical px) from the spec. */
export const computeHome = (
  spec: PetPositionSpec | undefined,
  size: number,
  geometry: DisplayGeometry,
  primaryIndex = 0,
): { x: number; y: number } => {
  if (spec && Number.isFinite(spec.x) && Number.isFinite(spec.y)) {
    return { x: spec.x!, y: spec.y! };
  }
  const area = geometry.areas[Math.min(primaryIndex, geometry.areas.length - 1)] ?? geometry.hull;
  const corner: Corner = spec?.corner ?? 'bottom-right';
  return anchorPixel({
    corner,
    marginX: spec?.marginX ?? 24,
    marginY: spec?.marginY ?? 24,
    size,
    W: geometry.hull.width,
    H: geometry.hull.height,
    area,
  });
};

/** Assemble the renderer boot config for one pet. */
export const buildRendererConfig = (o: {
  petId: string;
  petName: string;
  size: number;
  assetsDir: string;
  metrics: WindowMetrics;
  geometry: DisplayGeometry;
  home: { x: number; y: number };
  font: { family: string; size: number; file: string | null };
  physics: RendererConfig['physics'];
  animations: RendererConfig['animations'];
  animationWeights: RendererConfig['animationWeights'];
  hitBox?: HitBox;
  fixed: boolean;
  clickSound: string | null;
  bubble: { durationMs: number; maxWidthRatio: number };
  sleepTexts: RendererConfig['sleepTexts'];
  hoverReleaseMs: number;
}): RendererConfig => ({
  petId: o.petId,
  petName: o.petName,
  size: o.size,
  physics: o.physics,
  assetBase: 'anim/',
  animations: o.animations,
  animationWeights: o.animationWeights,
  hitBox: o.hitBox ?? DEFAULT_HIT_BOX,
  font: o.font,
  fixed: o.fixed,
  clickSound: o.clickSound,
  bubble: o.bubble,
  sleepTexts: o.sleepTexts,
  window: {
    width: o.metrics.width,
    height: o.metrics.height,
    marginL: o.metrics.marginL,
    marginT: o.metrics.marginT,
    marginR: o.metrics.marginR,
    marginB: o.metrics.marginB,
    bottomPad: o.metrics.bottomPad,
  },
  home: o.home,
  geometry: o.geometry,
  hoverReleaseMs: o.hoverReleaseMs,
});

/** Scale a reference-scaled tuning value (like move distances) to pet size. */
export const scaleByPetSize = (value: number, size: number): number => (value * size) / PET_SIZE_REF;
