export const game = {
  maxRandomId: 2_147_483_647,
  maxAmount: Number.MAX_SAFE_INTEGER,
  kcScale: 100,
  euroScale: 100,
  bitcoinScale: 100_000_000,
  bonusIntervalMs: 4 * 60 * 60 * 1_000,
  bonusResetMs: 24 * 60 * 60 * 1_000,
  sequentialAccounts: 50,
  randomAccountMin: 51,
  randomAccountMax: 9_999,
  inventoryPageSize: 8,
  totalTasks: 0,
  duplicateRetries: 3,
  rewards: [
    { kc: 250_000, bitcoin: 150_000_000, case: false },
    { kc: 500_000, bitcoin: 250_000_000, case: false },
    { kc: 1_000_000, bitcoin: 250_000_000, case: false },
    { kc: 1_500_000, bitcoin: 500_000_000, case: false },
    { kc: 2_500_000, bitcoin: 750_000_000, case: false },
    { kc: 5_000_000, bitcoin: 1_000_000_000, case: false },
    { kc: 10_000_000, bitcoin: 2_500_000_000, case: true }
  ]
} as const;

export const accountCapacity = game.sequentialAccounts
  + game.randomAccountMax - game.randomAccountMin + 1;
