import { game } from './game.js';

export const casinoConfig = {
  minimum: 1000 * game.kcScale,
  maxBets: 10,
  maximum: 1_000_000 * game.kcScale,
  acceptanceMs: 10_000,
  extensionMs: 500,
  resultsMs: 5000,
  workerMs: 250,
  workerBatch: 40,
  announcementBatch: 20,
  chatPageSize: 200,
  chatSyncMs: 60_000,
  retryMs: 60_000,
  historySize: 20,
  directorPercent: 1,
  dealerPercent: 1,
  electionRefundPercent: 50,
  sectors: [1, 2, 5, 10, 20, 40],
  weights: [23, 15, 7, 4, 2, 1],
  maxCrash: 500_000,
  crashPrecision: 100,
  crashReturnPercent: 97,
  crashRandomSize: 1_000_000_000,
  moscowOffsetMs: 3 * 60 * 60 * 1000,
  dayMs: 24 * 60 * 60 * 1000
} as const;
