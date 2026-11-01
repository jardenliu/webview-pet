import { describe, expect, test } from 'bun:test';
import {
  isEventAnim,
  nextStatusAnim,
  pick,
  pickCategoryAction,
  pickSleepSet,
  pickSlot,
  pickWeightedCategory,
  rollKind,
  slotIncludes,
} from '../src/shared/pickers.js';
import type { CategoryPool, SleepSet } from '../src/shared/types.js';

describe('pick', () => {
  test('picks from pool', () => {
    for (let i = 0; i < 20; i++) {
      expect(['a', 'b', 'c']).toContain(pick(['a', 'b', 'c']));
    }
  });

  test('excludes the given entry', () => {
    for (let i = 0; i < 20; i++) {
      expect(pick(['a', 'b'], 'a')).toBe('b');
    }
  });

  test('single-entry pool falls back to itself when excluded', () => {
    expect(pick(['only'], 'only')).toBe('only');
  });
});

describe('pickSleepSet', () => {
  const sets: SleepSet[] = [
    { start: ['s1'], loop: ['l1'], end: ['e1'] },
    { start: ['s2'], loop: ['l2'], end: ['e2'] },
  ];

  test('returns null for empty list', () => {
    expect(pickSleepSet([])).toBeNull();
  });

  test('returns a whole set', () => {
    for (let i = 0; i < 20; i++) {
      const set = pickSleepSet(sets)!;
      expect(sets).toContain(set);
      // the three segments must come from the same set
      expect(set.start[0]!.slice(1)).toBe(set.loop[0]!.slice(1));
      expect(set.loop[0]!.slice(1)).toBe(set.end[0]!.slice(1));
    }
  });
});

describe('pickSlot', () => {
  test('string slot returns itself', () => {
    expect(pickSlot('anim-a')).toBe('anim-a');
    expect(pickSlot('anim-a', 'anim-a')).toBe('anim-a');
  });

  test('array slot picks one and avoids exclude', () => {
    for (let i = 0; i < 20; i++) {
      expect(pickSlot(['x', 'y', 'z'], 'x')).not.toBe('x');
    }
  });

  test('array slot falls back when exclude empties the pool', () => {
    expect(pickSlot(['only'], 'only')).toBe('only');
  });
});

describe('slotIncludes', () => {
  test('string and array forms', () => {
    expect(slotIncludes('a', 'a')).toBe(true);
    expect(slotIncludes('a', 'b')).toBe(false);
    expect(slotIncludes(['a', 'b'], 'b')).toBe(true);
    expect(slotIncludes(['a', 'b'], 'c')).toBe(false);
  });
});

describe('isEventAnim', () => {
  test('finds names across pools', () => {
    const events = { whisper: ['w1', ['w2', 'w3']], status: ['s1'] };
    expect(isEventAnim(events, 'w2')).toBe(true);
    expect(isEventAnim(events, 's1')).toBe(true);
    expect(isEventAnim(events, 'zzz')).toBe(false);
    expect(isEventAnim(undefined, 'w1')).toBe(false);
  });
});

describe('nextStatusAnim', () => {
  test('rotates within a multi-candidate slot', () => {
    const pool = [['a', 'b', 'c']];
    for (let i = 0; i < 20; i++) {
      const next = nextStatusAnim(pool, 'a')!;
      expect(['b', 'c']).toContain(next);
    }
  });

  test('returns null for single-candidate slots', () => {
    expect(nextStatusAnim(['a'], 'a')).toBeNull();
    expect(nextStatusAnim([['a']], 'a')).toBeNull();
    expect(nextStatusAnim(['a', 'b'], 'zzz')).toBeNull();
  });
});

describe('rollKind', () => {
  const w = { idle: 10, turn: 5, move: 5 };

  test('maps the roll to kinds by cumulative weight', () => {
    expect(rollKind(0.0, w)).toBe('idle');
    expect(rollKind(0.09, w)).toBe('idle');
    expect(rollKind(0.1, w)).toBe('turn');
    expect(rollKind(0.149, w)).toBe('turn');
    expect(rollKind(0.15, w)).toBe('move');
    expect(rollKind(0.199, w)).toBe('move');
    expect(rollKind(0.2, w)).toBe('action');
    expect(rollKind(0.99, w)).toBe('action');
  });

  test('fixed pets never turn or move', () => {
    // With turn/move zeroed, only the idle band (0 .. 0.10) stays idle.
    expect(rollKind(0.05, w, { fixed: true })).toBe('idle');
    expect(rollKind(0.12, w, { fixed: true })).toBe('action');
    expect(rollKind(0.18, w, { fixed: true })).toBe('action');
    expect(rollKind(0.3, w, { fixed: true })).toBe('action');
  });

  test('idle=0 degrades gracefully', () => {
    const w0 = { idle: 0, turn: 0, move: 0 };
    expect(rollKind(0.5, w0)).toBe('action');
    expect(rollKind(0.0, w0)).toBe('action');
  });
});

describe('pickWeightedCategory', () => {
  const cats: CategoryPool[] = [
    { id: 'text', weight: 50, noMirror: true, actions: ['t1'] },
    { id: 'moves', weight: 50, actions: ['m1'] },
  ];

  test('skips noMirror categories when facing right', () => {
    for (let i = 0; i < 20; i++) {
      expect(pickWeightedCategory(cats, 'right')!.id).toBe('moves');
    }
  });

  test('allows everything when facing left', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(pickWeightedCategory(cats, 'left')!.id);
    expect(ids.has('text')).toBe(true);
    expect(ids.has('moves')).toBe(true);
  });

  test('returns null for empty categories', () => {
    expect(pickWeightedCategory([], 'left')).toBeNull();
    expect(pickWeightedCategory([{ id: 'e', weight: 1, actions: [] }], 'left')).toBeNull();
  });
});

describe('pickCategoryAction', () => {
  test('falls back to the idle pool', () => {
    const result = pickCategoryAction([], ['idle-a', 'idle-b'], 'left', 'idle-a');
    expect(result.id).toBe('FALLBACK');
    expect(result.name).toBe('idle-b');
  });

  test('picks from a category', () => {
    const result = pickCategoryAction([{ id: 'c', weight: 1, actions: ['only'] }], ['idle'], 'left', '');
    expect(result).toEqual({ id: 'c', name: 'only' });
  });
});
