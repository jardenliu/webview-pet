import { describe, expect, test } from 'bun:test';
import {
  bodyPixelBox,
  collidePet,
  estimateReleaseVelocity,
  isRestingOnContacts,
  nearestIndex,
  indexAtPoint,
  rectsOverlap,
  resolveContact,
  softClampSpeed,
  springStep,
  throwFrame,
  throwSpace,
  throwVelocity,
  trimTrail,
  type DragSample,
  type PetCollider,
  type Rect,
} from '../src/shared/physics.js';
import { DEAD_ZONE_SPEED, MAX_THROW_SPEED, THROW_SPEED_ANCHOR } from '../src/shared/constants.js';
import type { PhysicsParams } from '../src/shared/types.js';

const physics: PhysicsParams = {
  gravity: 1400,
  restitution: 0.78,
  groundFriction: 2.5,
  ceilingBounce: true,
  throwPower: 1,
  petCollision: true,
  confineToScreen: false,
};

describe('rect helpers', () => {
  const rects: Rect[] = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 200, y: 0, width: 100, height: 100 },
  ];

  test('indexAtPoint', () => {
    expect(indexAtPoint(rects, 50, 50)).toBe(0);
    expect(indexAtPoint(rects, 250, 50)).toBe(1);
    expect(indexAtPoint(rects, 150, 50)).toBe(-1);
  });

  test('nearestIndex', () => {
    expect(nearestIndex(rects, 150, 50)).toBeGreaterThanOrEqual(0);
    expect(nearestIndex(rects, -10, 50)).toBe(0);
    expect(nearestIndex(rects, 400, 50)).toBe(1);
  });
});

describe('springStep', () => {
  test('converges toward the target without overshooting', () => {
    let v = 0;
    let x = 0;
    const target = 100;
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      v = springStep(v, x, target, 1 / 60);
      x += v * (1 / 60);
      expect(x).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = x;
    }
    expect(x).toBeGreaterThan(95);
  });
});

describe('softClampSpeed', () => {
  test('monotonic and bounded', () => {
    expect(softClampSpeed(0)).toBe(0);
    expect(softClampSpeed(-5)).toBe(0);
    let last = 0;
    for (let s = 100; s <= 50000; s += 500) {
      const v = softClampSpeed(s);
      expect(v).toBeGreaterThan(last);
      expect(v).toBeLessThan(MAX_THROW_SPEED);
      last = v;
    }
  });
});

describe('resolveContact', () => {
  test('floor bounce kills the normal and keeps friction on tangent', () => {
    const out = resolveContact({ vx: 100, vy: 500 }, 'floor', physics, 1 / 60);
    expect(out.vy).toBeLessThanOrEqual(0); // bounced upward
    expect(Math.abs(out.vy)).toBeCloseTo(500 * 0.78, 0);
    expect(out.vx).toBeLessThan(100); // friction deceleration
  });

  test('slow normal sticks instead of bouncing', () => {
    const out = resolveContact({ vx: 100, vy: 10 }, 'floor', physics, 1 / 60);
    expect(out.normalSpeed).toBe(0);
    expect(out.vy).toBe(0);
  });

  test('isRestingOnContacts', () => {
    expect(isRestingOnContacts([], { vx: 0, vy: 0 })).toBe(false);
    expect(isRestingOnContacts(['floor'], { vx: 0, vy: 0 })).toBe(true);
    expect(isRestingOnContacts(['floor'], { vx: 50, vy: 0 })).toBe(false);
    expect(isRestingOnContacts(['floor'], { vx: 0, vy: 30 })).toBe(false);
  });
});

describe('throwVelocity', () => {
  test('90 degrees throws upward', () => {
    const { vx, vy } = throwVelocity(90, 1);
    expect(Math.abs(vx)).toBeLessThan(1e-6);
    expect(vy).toBeLessThan(0);
  });

  test('0 degrees throws right', () => {
    const { vx, vy } = throwVelocity(0, 1);
    expect(vx).toBeGreaterThan(0);
    expect(Math.abs(vy)).toBeLessThan(1e-6);
    expect(vx).toBeCloseTo(softClampSpeed(THROW_SPEED_ANCHOR), 3);
  });

  test('power scales monotonically', () => {
    const a = throwVelocity(45, 0.5);
    const b = throwVelocity(45, 2);
    expect(Math.hypot(b.vx, b.vy)).toBeGreaterThan(Math.hypot(a.vx, a.vy));
  });
});

describe('estimateReleaseVelocity', () => {
  test('returns null for a stationary trail', () => {
    const trail: DragSample[] = [
      { t: 0, x: 100, y: 100 },
      { t: 20, x: 100, y: 100 },
      { t: 40, x: 100, y: 100 },
    ];
    expect(estimateReleaseVelocity(trail, 50, physics)).toBeNull();
  });

  test('returns null when the pointer stopped before release', () => {
    const trail: DragSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 20, x: 300, y: 0 },
      { t: 400, x: 300, y: 0 }, // stale
    ];
    expect(estimateReleaseVelocity(trail, 420, physics)).toBeNull();
  });

  test('estimates direction and speed for a fast flick', () => {
    const trail: DragSample[] = [];
    for (let i = 0; i <= 8; i++) trail.push({ t: i * 15, x: i * 60, y: 100 });
    const v = estimateReleaseVelocity(trail, 8 * 15, physics);
    expect(v).not.toBeNull();
    expect(v!.vx).toBeGreaterThan(0);
    expect(Math.abs(v!.vy)).toBeLessThan(Math.abs(v!.vx) / 4);
    expect(Math.hypot(v!.vx, v!.vy)).toBeGreaterThanOrEqual(DEAD_ZONE_SPEED);
  });

  test('slow movement falls below the dead zone', () => {
    const trail: DragSample[] = [];
    for (let i = 0; i <= 8; i++) trail.push({ t: i * 15, x: 100 + i * 2, y: 100 });
    expect(estimateReleaseVelocity(trail, 8 * 15, physics)).toBeNull();
  });

  test('throwPower scales the result', () => {
    const trail: DragSample[] = [];
    for (let i = 0; i <= 8; i++) trail.push({ t: i * 15, x: i * 60, y: 100 });
    const v1 = estimateReleaseVelocity(trail, 8 * 15, physics)!;
    const v2 = estimateReleaseVelocity(trail, 8 * 15, { ...physics, throwPower: 0.5 })!;
    expect(Math.hypot(v2.vx, v2.vy)).toBeLessThan(Math.hypot(v1.vx, v1.vy));
  });

  test('trimTrail drops old samples', () => {
    const trail: DragSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 300, x: 10, y: 10 },
      { t: 450, x: 20, y: 20 },
    ];
    const trimmed = trimTrail(trail, 500);
    expect(trimmed.length).toBe(2);
    expect(trimmed[0]!.t).toBe(300);
  });
});

describe('throwFrame', () => {
  const space = throwSpace({ areas: [{ x: 0, y: 0, width: 1920, height: 1080 }], size: 462 });

  test('gravity pulls down and the floor catches the pet', () => {
    let s = { x: 500, y: 0, vx: 0, vy: 0 };
    let rest = false;
    for (let i = 0; i < 600 && !rest; i++) {
      const r = throwFrame(s, 1 / 60, space, physics);
      s = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      rest = r.atRest;
    }
    expect(rest).toBe(true);
    expect(s.y).toBeCloseTo(1080 - (462 * 9) / 16, 0);
  });

  test('floor bounces lose energy', () => {
    // Drop from near the floor so the ceiling is never touched.
    let s = { x: 500, y: 700, vx: 0, vy: 400 };
    const bounces: number[] = [];
    let atRest = false;
    for (let i = 0; i < 300; i++) {
      const r = throwFrame(s, 1 / 60, space, physics);
      if (r.hit?.edge === 'floor' && r.hit.speed > 50) {
        // The outgoing bounce is the impact speed times the restitution.
        expect(-r.vy).toBeLessThanOrEqual(r.hit.speed * 0.785);
        bounces.push(-r.vy);
      }
      s = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      if (r.atRest) {
        atRest = true;
        break;
      }
    }
    expect(atRest).toBe(true);
    expect(bounces.length).toBeGreaterThan(1);
    for (let i = 1; i < bounces.length; i++) {
      expect(bounces[i]!).toBeLessThanOrEqual(bounces[i - 1]! + 1);
    }
  });

  test('confineToScreen keeps the pet on one screen', () => {
    const multi = throwSpace({
      areas: [
        { x: 0, y: 0, width: 1920, height: 1080 },
        { x: 1920, y: 0, width: 1920, height: 1080 },
      ],
      size: 462,
    });
    let s = { x: 1500, y: 500, vx: 2500, vy: -200 };
    for (let i = 0; i < 120; i++) {
      const r = throwFrame(s, 1 / 60, multi, physics, 0);
      expect(r.x).toBeLessThanOrEqual(1920 - 462 + 1);
      s = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
    }
  });
});

describe('collision', () => {
  const hitBox = { x0: 200, y0: 50, x1: 440, y1: 335 };

  test('overlapping body boxes detected', () => {
    const a = { x: 0, y: 0, vx: 0, vy: 0, size: 640 };
    const b = { x: 100, y: 0, vx: 0, vy: 0, size: 640 };
    const boxA = bodyPixelBox({ ...a, bottomPad: 0, hitBox });
    const boxB = bodyPixelBox({ ...b, bottomPad: 0, hitBox });
    expect(rectsOverlap(boxA, boxB)).toBe(true);
    const boxC = bodyPixelBox({ x: 400, y: 0, size: 640, bottomPad: 0, hitBox });
    expect(rectsOverlap(boxA, boxC)).toBe(false);
  });

  test('equal masses exchange normal velocities (near-elastic)', () => {
    const a: PetCollider = { x: 0, y: 0, vx: 100, vy: 0, size: 100 };
    const b: PetCollider = { x: 80, y: 0, vx: -100, vy: 0, size: 100 };
    const r = collidePet(a, b)!;
    expect(r.fvx).toBeLessThan(0);
    expect(r.hvx).toBeGreaterThan(0);
    expect(r.impactSpeed).toBeCloseTo(200, 3);
  });

  test('separating bodies are not collided', () => {
    const a: PetCollider = { x: 0, y: 0, vx: -100, vy: 0, size: 100 };
    const b: PetCollider = { x: 80, y: 0, vx: 100, vy: 0, size: 100 };
    expect(collidePet(a, b)).toBeNull();
  });
});
