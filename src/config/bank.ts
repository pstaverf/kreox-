import { game } from './game.js';

export const bankConfig = {
  dayMs: 24 * 60 * 60 * 1000,
  weekMs: 7 * 24 * 60 * 60 * 1000,
  savingsPercent: 2,
  transferPercent: 5,
  maxDeposits: 5,
  maxDeposit: 10_000_000 * game.kcScale,
  earlyPenaltyPercent: 10,
  depositRates: { 3: 2, 10: 4 },
  workerIntervalMs: 5000,
  workerBatch: 20,
  retryMs: 60_000,
  pensionMinDays: 30,
  pensionHighDays: 60,
  pensionBasic: [500, 700, 900, 1000, 1200, 1500, 1800, 2500, 5000],
  pensionHigh: [5000, 7000, 10000, 12000, 15000, 20000, 25000],
  casinoTexts: ['🎰 Оформляем лицензию…', '🎰 Создаем игры…', '🎰 Настраиваем рандом…'],
  depositPercents: [5, 10, 20, 50, 100],
  timeZone: 'Europe/Moscow'
} as const;
