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
  maxMessageLength: 4_096,
  chatInventoryLimit: 256,
  leaderboardSize: 20,
  referralRewardKC: 1_500_000,
  notificationIntervalMs: 2_000,
  notificationLeaseMs: 120_000,
  notificationRetryMs: 5_000,
  notificationMaxRetryMs: 3_600_000,
  mining: {
    durationMs: 6 * 60 * 60 * 1_000,
    hourMs: 60 * 60 * 1_000,
    initialRate: 10_000_000,
    minWithdrawal: 100_000_000,
    precision: 100_000,
    minIncrease: 1_500_000,
    maxIncrease: 8_000_000,
    growthNumerator: 6,
    growthDenominator: 5,
    prices: [200_000, 500_000, 800_000, 1_400_000, 2_300_000, 3_300_000,
      4_100_000, 4_900_000, 5_900_000, 7_800_000, 9_800_000, 10_900_000,
      12_700_000, 14_200_000, 17_000_000, 20_300_000]
  },
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
