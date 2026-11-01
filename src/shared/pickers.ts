/**
 * Pure selection logic: random picks, event slots, weighted dice.
 * Shared by the host and the renderer so the random chain behaves identically
 * no matter which side rolls it. No DOM, fully unit-testable.
 */
import type { CategoryPool, EventSlot, PetAnimations, SleepSet } from './types.js';

/** Pick one entry at random; `exclude` avoids immediate repeats. */
export const pick = <T>(pool: readonly T[], exclude?: T): T => {
  const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
  // A single-entry pool that excludes itself falls back to the pool: repeating
  // beats returning undefined.
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)];
};

/**
 * Pick one whole sleep set. The three segments must come from the same set so
 * the pet never "sits down to sleep and stands up to wake".
 */
export const pickSleepSet = (sets: readonly SleepSet[]): SleepSet | null =>
  sets.length > 0 ? sets[Math.floor(Math.random() * sets.length)] : null;

/** Resolve one event slot: a plain string plays as-is, an array picks one. */
export const pickSlot = (slot: EventSlot, exclude?: string): string => {
  if (typeof slot === 'string') return slot;
  const entries = exclude === undefined ? slot : slot.filter((n) => n !== exclude);
  const src = entries.length ? entries : slot;
  return src[Math.floor(Math.random() * src.length)];
};

/** Whether a slot contains the given animation name. */
export const slotIncludes = (slot: EventSlot, anim: string): boolean =>
  typeof slot === 'string' ? slot === anim : slot.includes(anim);

/** Whether an event pool contains the given animation name. */
export const poolIncludes = (pool: readonly EventSlot[], anim: string): boolean =>
  pool.some((slot) => slotIncludes(slot, anim));

/** Whether any event pool of the animation config contains the given name. */
export const isEventAnim = (events: Readonly<PetAnimations['events']> | undefined, anim: string): boolean =>
  events ? Object.values(events).some((pool) => pool && poolIncludes(pool, anim)) : false;

/**
 * Continue a long-running status animation: if the pool slot holding `current`
 * has more candidates, rotate to the next one. Returns null when there is
 * nothing to rotate to.
 */
export const nextStatusAnim = (pool: readonly EventSlot[], current: string): string | null => {
  const idx = pool.findIndex((slot) => slotIncludes(slot, current));
  if (idx === -1) return null;
  const slot = pool[idx];
  if (!Array.isArray(slot) || slot.length <= 1) return null;
  return pickSlot(slot, current);
};

/** Random integer in [min, max). */
export const randomBetween = (min: number, max: number): number => Math.floor(min + Math.random() * (max - min));

/** Pick a random entry from a string array; convenience alias. */
export const pickName = (pool: readonly string[], exclude?: string): string => pick(pool, exclude);

/**
 * Pick a category by weight. When the pet faces right, `noMirror` categories
 * (text-bearing animations) are skipped and the remaining weights renormalized.
 */
export const pickWeightedCategory = (categories: CategoryPool[], facing: string): CategoryPool | null => {
  const cats = categories.filter((c) => c.actions.length > 0);
  if (!cats.length) return null;
  const filtered = cats.filter((c) => !(c.noMirror && facing === 'right'));
  const eligible = filtered.length ? filtered : cats;
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * totalW;
  for (const c of eligible) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return eligible[eligible.length - 1];
};

export type RollKind = 'idle' | 'turn' | 'move' | 'action';

export interface RollOptions {
  /** The pet is fixed: turn/move weights count as zero. */
  fixed?: boolean;
}

/**
 * Roll the random-chain dice: a value in [0, 1) maps to the next animation
 * kind. Whatever probability remains after idle/turn/move goes to `action`.
 */
export const rollKind = (roll: number, w: { idle: number; turn: number; move: number }, opts?: RollOptions): RollKind => {
  const turn = opts?.fixed ? 0 : w.turn;
  const move = opts?.fixed ? 0 : w.move;
  const topEnd = (w.idle + turn + move) / 100;
  if (roll < w.idle / 100) return 'idle';
  if (roll < (w.idle + turn) / 100) return 'turn';
  if (roll < topEnd) return 'move';
  return 'action';
};

/**
 * Pick a category action; falls back to the idle pool when no category is
 * usable. `facing` filters noMirror categories, `current` avoids repeats.
 */
export const pickCategoryAction = (
  categories: CategoryPool[],
  idlePool: string[],
  facing: string,
  current: string,
): { id: string; name: string } => {
  const cat = pickWeightedCategory(categories, facing);
  if (!cat) return { id: 'FALLBACK', name: pick(idlePool, current) };
  return { id: cat.id, name: pick(cat.actions, current) };
};
