import { game } from './game.js';

export const privateCasinoConfig = {
  chatUrl: 'https://vk.me/join/7ScmA4KxnWkkuVlXVycmWx9SIsB751g_BQs=',
  coinMinimum: 1000 * game.kcScale,
  coinMultipliers: [180, 360, 720, 1440, 2880, 5760, 11520],
  multiplierScale: 100,
  jackpotSeedMin: 1000,
  jackpotSeedMax: 1_000_000,
  jackpotGrowthMin: 5000,
  jackpotGrowthMax: 100_000,
  jackpotHour: 19,
  jackpotMinute: 30,
  workerMs: 1000,
  workerBatch: 20
} as const;
