export interface LevelProgress {
  level: number;
  experience: number;
  required: number;
}

function spentBeforeLevel(level: bigint): bigint {
  return level === 1n ? 0n : 3n * level * (level - 1n) - 2n;
}

export function levelProgress(totalExperience: number): LevelProgress {
  if (!Number.isSafeInteger(totalExperience) || totalExperience < 0) throw new Error('Invalid experience');
  const total = BigInt(totalExperience);
  let lower = 1n;
  let upper = 2n;
  while (spentBeforeLevel(upper) <= total) {
    lower = upper;
    upper *= 2n;
  }
  while (lower + 1n < upper) {
    const middle = (lower + upper) / 2n;
    if (spentBeforeLevel(middle) <= total) lower = middle;
    else upper = middle;
  }
  return {
    level: Number(lower),
    experience: Number(total - spentBeforeLevel(lower)),
    required: lower === 1n ? 4 : Number(6n * lower)
  };
}
