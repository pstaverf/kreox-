import assert from 'node:assert/strict';
import { test } from 'node:test';
import { levelProgress } from '../src/services/levels.js';

const cases = [
  [0, 1, 0, 4], [1, 1, 1, 4], [3, 1, 3, 4],
  [4, 2, 0, 12], [15, 2, 11, 12], [16, 3, 0, 18],
  [33, 3, 17, 18], [34, 4, 0, 24], [57, 4, 23, 24],
  [58, 5, 0, 30], [87, 5, 29, 30], [88, 6, 0, 36]
] as const;

test('levels require 4, 12, 18 XP, then 24, 30, 36 and so on, with progress resetting at each transition', () => {
  for (const [total, level, experience, required] of cases) {
    assert.deepEqual(levelProgress(total), { level, experience, required });
  }
});

test('level calculation stays exact and bounded even for very large stored totals', () => {
  for (const total of [1_000_000, 1_000_000_000_000, Number.MAX_SAFE_INTEGER]) {
    const progress = levelProgress(total);
    assert.ok(Number.isSafeInteger(progress.level));
    assert.ok(progress.experience >= 0 && progress.experience < progress.required);
    const level = BigInt(progress.level);
    const spent = level === 1n ? 0n : 3n * level * (level - 1n) - 2n;
    assert.equal(spent + BigInt(progress.experience), BigInt(total));
    assert.equal(progress.required, progress.level === 1 ? 4 : 6 * progress.level);
  }
  for (const invalid of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => levelProgress(invalid), /Invalid experience/u);
  }
});
