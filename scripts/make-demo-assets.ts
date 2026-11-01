/**
 * Demo asset generator: draws a small original blob character and encodes a
 * pool of VP9-alpha webm animations (the same form dsh-pet ships: 640×360,
 * `alpha_mode=1`) with ffmpeg. Output lands in examples/assets/.
 *
 * Usage: bun run scripts/make-demo-assets.ts
 */
import { $ } from 'bun';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const W = 640;
const H = 360;
const FPS = 24;
const FEET = 330; // foot baseline, matches CANVAS_FOOT_Y

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const outDir = join(root, 'examples/assets');
await mkdir(outDir, { recursive: true });

// ── RGBA canvas helpers ──────────────────────────────────────────────────────

type Img = Uint8ClampedArray;

const newImg = (): Img => new Uint8ClampedArray(W * H * 4);

function blend(img: Img, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const sa = Math.min(1, a);
  const da = img[i + 3]! / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  img[i] = Math.round((r * sa + img[i]! * da * (1 - sa)) / outA);
  img[i + 1] = Math.round((g * sa + img[i + 1]! * da * (1 - sa)) / outA);
  img[i + 2] = Math.round((b * sa + img[i + 2]! * da * (1 - sa)) / outA);
  img[i + 3] = Math.round(outA * 255);
}

function ellipse(
  img: Img,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: [number, number, number],
  alpha = 1,
): void {
  const x0 = Math.floor(cx - rx - 2);
  const x1 = Math.ceil(cx + rx + 2);
  const y0 = Math.floor(cy - ry - 2);
  const y1 = Math.ceil(cy + ry + 2);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      // soft edge over the outer 6 %
      let a = alpha;
      if (d > 1) {
        if (d > 1.06) continue;
        a *= 1 - (d - 1) / 0.06;
      }
      blend(img, x, y, color[0], color[1], color[2], a);
    }
  }
}

function roundRect(
  img: Img,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: [number, number, number],
  alpha = 1,
): void {
  for (let py = Math.floor(y); py < y + h; py++) {
    for (let px = Math.floor(x); px < x + w; px++) {
      const dx = Math.max(x + radius - px, 0, px - (x + w - radius));
      const dy = Math.max(y + radius - py, 0, py - (y + h - radius));
      const d = Math.sqrt(dx * dx + dy * dy) / radius;
      let a = alpha;
      if (d > 1) {
        if (d > 1.08) continue;
        a *= 1 - (d - 1) / 0.08;
      }
      blend(img, px, py, color[0], color[1], color[2], a);
    }
  }
}

// ── The blob character ──────────────────────────────────────────────────────

const BODY: [number, number, number] = [126, 200, 255];
const BODY_SHADE: [number, number, number] = [92, 168, 235];
const DARK: [number, number, number] = [40, 52, 72];
const WHITE: [number, number, number] = [255, 255, 255];
const BLUSH: [number, number, number] = [255, 150, 160];
const MOUTH: [number, number, number] = [70, 60, 80];

interface BlobPose {
  cx?: number;
  /** Bottom (feet) y; defaults to FEET. */
  baseY?: number;
  scaleX?: number;
  scaleY?: number;
  /** 1 = open, 0 = closed. */
  eyeOpen?: number;
  /** Pupil offset, -1..1 (left..right). */
  look?: number;
  /** Mouth shape. */
  mouth?: 'smile' | 'o' | 'flat' | 'happy';
  blush?: boolean;
  /** Extra drawn bits (arms up, zzz, thought bubbles…). */
  extra?: 'arms-up' | 'zzz' | 'thought' | 'sweat' | 'sparkle';
}

function drawBlob(img: Img, pose: BlobPose = {}): void {
  const cx = pose.cx ?? W / 2;
  const baseY = pose.baseY ?? FEET;
  const sx = pose.scaleX ?? 1;
  const sy = pose.scaleY ?? 1;
  const bw = 108 * sx;
  const bh = 96 * sy;
  const cy = baseY - bh;

  // ground shadow
  ellipse(img, cx, FEET + 6, 88 * sx, 12, [30, 40, 60], 0.18);

  // body (slightly egg-shaped: wider bottom)
  ellipse(img, cx, cy, bw, bh, BODY, 1);
  ellipse(img, cx, cy + bh * 0.25, bw * 0.92, bh * 0.72, BODY_SHADE, 0.35);
  // top gloss
  ellipse(img, cx - bw * 0.28, cy - bh * 0.42, bw * 0.34, bh * 0.22, WHITE, 0.28);

  const eyeY = cy - bh * 0.1;
  const eyeDx = 34 * sx;
  const eyeR = 13 * sx;
  const open = Math.max(0, Math.min(1, pose.eyeOpen ?? 1));
  const look = (pose.look ?? 0) * 7;

  if (open > 0.12) {
    for (const side of [-1, 1]) {
      ellipse(img, cx + side * eyeDx, eyeY, eyeR, eyeR * open, DARK, 1);
      ellipse(img, cx + side * eyeDx + look - 3, eyeY - 4 * open, eyeR * 0.32, eyeR * 0.32 * open, WHITE, 0.95);
      ellipse(img, cx + side * eyeDx + look + 4, eyeY + 4 * open, eyeR * 0.16, eyeR * 0.16 * open, WHITE, 0.8);
    }
  } else {
    // closed eyes: gentle arcs
    for (const side of [-1, 1]) {
      roundRect(img, cx + side * eyeDx - 12 * sx, eyeY - 2, 24 * sx, 4, 2, DARK, 0.9);
    }
  }

  // mouth
  const my = cy + bh * 0.28;
  const m = pose.mouth ?? 'smile';
  if (m === 'o') {
    ellipse(img, cx, my, 9 * sx, 11 * sy, MOUTH, 0.92);
  } else if (m === 'flat') {
    roundRect(img, cx - 12 * sx, my, 24 * sx, 4, 2, MOUTH, 0.85);
  } else if (m === 'happy') {
    ellipse(img, cx, my - 2, 16 * sx, 12 * sy, MOUTH, 0.9);
    ellipse(img, cx, my - 7, 14 * sx, 8 * sy, BODY, 1);
  } else {
    // smile arc approximated with three dots of decreasing size
    ellipse(img, cx - 11 * sx, my - 3, 3.4, 3.4, MOUTH, 0.9);
    ellipse(img, cx, my + 1, 3.8, 3.8, MOUTH, 0.9);
    ellipse(img, cx + 11 * sx, my - 3, 3.4, 3.4, MOUTH, 0.9);
  }

  if (pose.blush !== false) {
    ellipse(img, cx - eyeDx - 12 * sx, eyeY + 16, 11 * sx, 6.5, BLUSH, 0.5);
    ellipse(img, cx + eyeDx + 12 * sx, eyeY + 16, 11 * sx, 6.5, BLUSH, 0.5);
  }

  if (pose.extra === 'arms-up') {
    ellipse(img, cx - bw * 1.02, cy - bh * 0.72, 17 * sx, 17 * sx, BODY, 1);
    ellipse(img, cx + bw * 1.02, cy - bh * 0.72, 17 * sx, 17 * sx, BODY, 1);
    ellipse(img, cx - bw * 1.02, cy - bh * 0.72, 9 * sx, 9 * sx, BODY_SHADE, 0.3);
    ellipse(img, cx + bw * 1.02, cy - bh * 0.72, 9 * sx, 9 * sx, BODY_SHADE, 0.3);
  }
  if (pose.extra === 'zzz') {
    // three floating "z" dots of decreasing size
    ellipse(img, cx + bw * 1.25, cy - bh * 1.15, 8, 8, DARK, 0.55);
    ellipse(img, cx + bw * 1.45, cy - bh * 1.45, 6, 6, DARK, 0.45);
    ellipse(img, cx + bw * 1.6, cy - bh * 1.72, 4, 4, DARK, 0.35);
  }
  if (pose.extra === 'thought') {
    ellipse(img, cx + bw * 1.25, cy - bh * 0.95, 7, 7, WHITE, 0.9);
    ellipse(img, cx + bw * 1.5, cy - bh * 1.25, 11, 11, WHITE, 0.9);
    ellipse(img, cx + bw * 1.85, cy - bh * 1.7, 17, 17, WHITE, 0.9);
  }
  if (pose.extra === 'sweat') {
    ellipse(img, cx + bw * 0.92, cy - bh * 0.62, 7, 10, [140, 200, 255], 0.85);
    ellipse(img, cx + bw * 0.92, cy - bh * 0.68, 3.4, 4.4, WHITE, 0.7);
  }
  if (pose.extra === 'sparkle') {
    for (const [ox, oy, r] of [
      [-150, -120, 7],
      [160, -90, 9],
      [120, -150, 5],
      [-130, -60, 5],
    ] as const) {
      ellipse(img, cx + ox, cy + oy, r, r, WHITE, 0.85);
    }
  }
}

// ── Animation recipes ───────────────────────────────────────────────────────

interface Recipe {
  /** Output file name without extension (the animation pool name). */
  name: string;
  duration: number;
  /** Draw frame `t` (seconds) into the image. */
  draw(img: Img, t: number): void;
}

const loopT = (t: number, period: number): number => ((t % period) + period) % period;

const recipes: Recipe[] = [
  {
    name: '待机呼吸',
    duration: 3,
    draw(img, t) {
      const bob = Math.sin((t / 3) * Math.PI * 2) * 5;
      const breathe = 1 + Math.sin((t / 3) * Math.PI * 2 + 1) * 0.022;
      // blink near the end of the cycle
      const blink = t > 2.15 && t < 2.32 ? 0.12 : 1;
      drawBlob(img, { baseY: FEET - bob, scaleY: breathe, eyeOpen: blink });
    },
  },
  {
    name: '东张西望',
    duration: 2,
    draw(img, t) {
      // look left, then right (the random chain flips facing when this ends)
      const look = t < 1 ? -1 + t * 0.4 : 0.6 - (t - 1) * 1.2;
      const tilt = Math.sin(t * Math.PI) * 6;
      drawBlob(img, { cx: W / 2 + tilt, look, mouth: 'flat' });
    },
  },
  {
    name: '被拖拽',
    duration: 2,
    draw(img, t) {
      const swing = Math.sin(t * Math.PI * 2) * 7;
      drawBlob(img, {
        cx: W / 2 + swing,
        baseY: FEET - 26,
        scaleY: 1.12,
        scaleX: 0.94,
        eyeOpen: 1.1,
        mouth: 'o',
        extra: 'arms-up',
      });
    },
  },
  {
    name: '点击开心',
    duration: 1.2,
    draw(img, t) {
      // squash: compress, overshoot, settle (bottom-anchored)
      let scaleY = 1;
      if (t < 0.16) scaleY = 1 - (t / 0.16) * 0.28;
      else if (t < 0.36) scaleY = 0.72 + ((t - 0.16) / 0.2) * 0.38;
      else if (t < 0.6) scaleY = 1.1 - ((t - 0.36) / 0.24) * 0.1;
      const hop = t > 0.16 && t < 0.4 ? Math.sin(((t - 0.16) / 0.24) * Math.PI) * 16 : 0;
      drawBlob(img, { baseY: FEET - hop, scaleY, scaleX: 2 - scaleY, mouth: 'happy', eyeOpen: 1.05, extra: 'sparkle' });
    },
  },
  {
    name: '走路',
    duration: 2.4,
    draw(img, t) {
      const step = (t / 0.32) * Math.PI * 2;
      const bob = Math.abs(Math.sin(step)) * 9;
      const tilt = Math.sin(step) * 4;
      drawBlob(img, {
        cx: W / 2 + tilt,
        baseY: FEET - bob,
        scaleY: 1 + Math.sin(step * 2) * 0.03,
        mouth: 'smile',
      });
    },
  },
  {
    name: '哼歌摇摆',
    duration: 2.6,
    draw(img, t) {
      const sway = Math.sin((t / 2.6) * Math.PI * 2) * 14;
      const look = Math.sin((t / 2.6) * Math.PI * 2 + 1.2) * 0.6;
      drawBlob(img, {
        cx: W / 2 + sway,
        look,
        mouth: t % 1.3 < 0.5 ? 'o' : 'smile',
        eyeOpen: 0.9,
      });
    },
  },
  {
    name: '伸懒腰',
    duration: 2,
    draw(img, t) {
      let sx = 1;
      let sy = 1;
      if (t < 0.7) {
        sx = 1 + (t / 0.7) * 0.16;
        sy = 1 - (t / 0.7) * 0.12;
      } else if (t < 1.3) {
        sx = 1.16 - ((t - 0.7) / 0.6) * 0.28;
        sy = 0.88 + ((t - 0.7) / 0.6) * 0.32;
      } else {
        sx = 0.88 + ((t - 1.3) / 0.7) * 0.12;
        sy = 1.2 - ((t - 1.3) / 0.7) * 0.2;
      }
      drawBlob(img, { scaleX: sx, scaleY: sy, eyeOpen: t < 0.7 ? 0.35 : 1, mouth: 'o' });
    },
  },
  {
    name: '思考冒泡',
    duration: 2.6,
    draw(img, t) {
      drawBlob(img, { look: -0.55, eyeOpen: 0.85, mouth: 'flat', extra: 'thought', baseY: FEET - Math.sin(t * 2.2) * 3 });
    },
  },
  {
    name: '垂头叹气',
    duration: 2.2,
    draw(img, t) {
      const sink = Math.min(t * 12, 8);
      drawBlob(img, { baseY: FEET + sink, scaleY: 0.95, scaleX: 1.05, eyeOpen: 0.45, mouth: 'flat', extra: 'sweat' });
    },
  },
  {
    name: '睡觉-开始',
    duration: 2,
    draw(img, t) {
      const sink = (t / 2) * 18;
      drawBlob(img, {
        baseY: FEET + sink,
        scaleY: 1 - (t / 2) * 0.12,
        scaleX: 1 + (t / 2) * 0.12,
        eyeOpen: Math.max(0, 1 - t * 1.4),
        mouth: 'flat',
      });
    },
  },
  {
    name: '睡觉-循环',
    duration: 3,
    draw(img, t) {
      const breathe = 1 + Math.sin((t / 3) * Math.PI * 2) * 0.03;
      drawBlob(img, {
        baseY: FEET + 18,
        scaleY: 0.88 * breathe,
        scaleX: 1.12,
        eyeOpen: 0,
        mouth: 'flat',
        extra: 'zzz',
      });
    },
  },
  {
    name: '睡觉-起来',
    duration: 1.8,
    draw(img, t) {
      const rise = 18 - (t / 1.8) * 18;
      const stretch = t < 0.6 ? 0.88 + (t / 0.6) * 0.18 : 1.06 - ((t - 0.6) / 1.2) * 0.06;
      drawBlob(img, {
        baseY: FEET + rise,
        scaleY: stretch,
        scaleX: 2 - stretch,
        eyeOpen: Math.min(1, t * 1.8),
        mouth: t < 0.9 ? 'o' : 'smile',
      });
    },
  },
];

// ── Frame encoding via ffmpeg ────────────────────────────────────────────────

async function encode(recipe: Recipe): Promise<void> {
  const frames = Math.round(recipe.duration * FPS);
  const outFile = join(outDir, `${recipe.name}.webm`);
  const ff = Bun.spawn(
    [
      'ffmpeg',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${W}x${H}`,
      '-r',
      String(FPS),
      '-i',
      '-',
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuva420p',
      '-auto-alt-ref',
      '0',
      '-b:v',
      '0',
      '-crf',
      '32',
      '-an',
      outFile,
    ],
    { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
  );
  for (let f = 0; f < frames; f++) {
    const img = newImg();
    recipe.draw(img, f / FPS);
    await ff.stdin.write(img);
  }
  await ff.stdin.end();
  const code = await ff.exited;
  const err = await new Response(ff.stderr).text();
  if (code !== 0) {
    console.error(`[assets] ${recipe.name} failed:`, err.slice(-400));
    process.exit(1);
  }
  console.log(`[assets] ${recipe.name}.webm (${frames} frames)`);
}

console.log(`[assets] generating ${recipes.length} demo animations → ${outDir}`);
for (const recipe of recipes) await encode(recipe);
console.log('[assets] done');
