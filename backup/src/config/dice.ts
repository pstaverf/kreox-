export const diceConfig = {
  minPlayers: 2,
  maxPlayers: 5,
  maxGames: 5,
  lifetimeMs: 30 * 60 * 1_000,
  workerMs: 2_000,
  retryMs: 5_000,
  batchSize: 20,
  sides: 12,
  commissionId: 888801846,
  feeScale: 10_000,
  winnerFee: 100,
  tieFee: 345,
  minimum: { kc: 1_000, euro: 10, bitcoin: 10 }
} as const;
